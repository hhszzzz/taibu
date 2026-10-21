import 'server-only';

import path from 'node:path';
import readXlsxFile from 'read-excel-file/universal';
import { getDocumentProxy } from 'unpdf';
import { wordBodyText, wordDocumentPartName, WORD_RELATIONSHIPS_PART } from './document-word.server';
import { readZipArchive, writeStoredZip, ZipArchiveError } from './document-zip.server';
import {
    documentFormatOf,
    documentRejection,
    MAX_DOCUMENT_BYTES,
    MAX_DOCUMENT_NAME_LENGTH,
    MAX_DOCUMENT_TEXT_BYTES,
    type DocumentFormat,
    type DocumentParserKind,
} from './document-formats';

export type DocumentTextErrorCode =
    | 'UNSUPPORTED_FORMAT' | 'EMPTY_FILE' | 'FILE_TOO_LARGE' | 'UNREADABLE' | 'NO_TEXT' | 'TEXT_TOO_LARGE' | 'TIMEOUT';

/** A document that cannot be read as text; its message is shown to the user as is. */
export class DocumentTextError extends Error {
    constructor(readonly code: DocumentTextErrorCode, message: string) {
        super(message);
        this.name = 'DocumentTextError';
    }
}

const STATUS: Record<DocumentTextErrorCode, number> = {
    UNSUPPORTED_FORMAT: 415, EMPTY_FILE: 400, FILE_TOO_LARGE: 413, UNREADABLE: 422, NO_TEXT: 422, TEXT_TOO_LARGE: 413, TIMEOUT: 422,
};
export const documentTextErrorStatus = (error: DocumentTextError) => STATUS[error.code];

/**
 * Reads one document as plain text. Size and format are checked before a parser runs, and what it returns is
 * normalized and bounded after. A parser should stop when `signal` aborts; it may throw a DocumentTextError to
 * explain what is wrong with a file, and any other error it throws reaches the user as an unreadable file.
 * Reading runs on the request's event loop.
 */
export type DocumentParser = (bytes: Uint8Array, context: { name: string; signal: AbortSignal }) => Promise<string>;
export type DocumentParsers = Readonly<Partial<Record<DocumentParserKind, DocumentParser>>>;

/** Time one document may take to read. */
export const DOCUMENT_PARSE_TIMEOUT_MS = 20_000;

/** Every route that reads documents draws on this one per-user budget, since reading occupies the event loop. */
export const DOCUMENT_TEXT_RATE_LIMIT = { endpoint: 'document-text', maxRequests: 20, windowMs: 60_000 } as const;

const decodeUtf8: DocumentParser = async bytes => {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new DocumentTextError('UNREADABLE', '文本需为 UTF-8 编码，请另存为 UTF-8 后上传');
    }
};

/** pdf.js reads the predefined CJK CMaps and standard fonts from disk; next.config traces both into the build. */
const PDFJS_DATA = path.join(process.cwd(), 'node_modules', 'pdfjs-dist');
export const PDF_CMAP_DIRECTORY = `${path.join(PDFJS_DATA, 'cmaps')}/`;
const PDF_STANDARD_FONT_DIRECTORY = `${path.join(PDFJS_DATA, 'standard_fonts')}/`;
export const PDF_MAX_PAGES = 500;
/** Reading text decodes no image; the cap only stops a hostile declaration from allocating gigabytes. */
const PDF_MAX_IMAGE_PIXELS = 16_777_216;

const readPdf: DocumentParser = async (bytes, { signal }) => {
    // pdf.js may take over the buffer it is handed, so it gets a copy.
    const pdf = await getDocumentProxy(bytes.slice(), {
        cMapUrl: PDF_CMAP_DIRECTORY,
        cMapPacked: true,
        standardFontDataUrl: PDF_STANDARD_FONT_DIRECTORY,
        maxImageSize: PDF_MAX_IMAGE_PIXELS,
        verbosity: 0,
    }).catch((error: unknown) => {
        if (error instanceof Error && error.name === 'PasswordException') throw new DocumentTextError('UNREADABLE', 'PDF 已加密，请解除密码后上传');
        throw error;
    });
    try {
        if (pdf.numPages > PDF_MAX_PAGES) throw new DocumentTextError('TEXT_TOO_LARGE', `PDF 超过 ${PDF_MAX_PAGES} 页，请拆分后上传`);
        const pages: string[] = [];
        for (let number = 1; number <= pdf.numPages; number += 1) {
            signal.throwIfAborted();
            const page = await pdf.getPage(number);
            const { items } = await page.getTextContent();
            pages.push(items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : '').join(''));
            page.cleanup();
        }
        const text = pages.join('\n\n').replace(/[^\S\n]+/gu, ' ').replace(/ ?\n ?/gu, '\n').replace(/\n{3,}/gu, '\n\n');
        if (!text.trim()) throw new DocumentTextError('NO_TEXT', 'PDF 中没有可提取的文字，扫描件请先识别成文字后上传');
        return text;
    } finally {
        await pdf.loadingTask.destroy();
    }
};

/** Office parts are XML; at most this much of them is inflated, and embedded media is never read. */
const OFFICE_ZIP_LIMITS = { maxEntries: 5_000, maxBytes: 32 * 1024 * 1024 };
const isOfficeXml = (name: string) => /\.(?:xml|rels)$/iu.test(name);
/** Encrypted Office files and the 97-2003 formats are OLE compound files rather than zip archives. */
const COMPOUND_FILE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** The parts of an Office document that `include` selects, read within the limits above. */
function officeParts(bytes: Uint8Array, label: string, include: (name: string) => boolean): Map<string, Uint8Array> {
    if (COMPOUND_FILE_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
        throw new DocumentTextError('UNREADABLE', `${label} 文件已加密或为 97-2003 旧格式，请解除密码并另存为新格式后上传`);
    }
    try {
        return readZipArchive(bytes, { ...OFFICE_ZIP_LIMITS, include });
    } catch (error) {
        if (!(error instanceof ZipArchiveError)) throw error;
        if (error.problem === 'too-large') throw new DocumentTextError('TEXT_TOO_LARGE', `${label} 文件内容过多，请拆分后上传`);
        if (error.problem === 'encrypted') throw new DocumentTextError('UNREADABLE', `${label} 文件已加密，请解除密码后上传`);
        throw new DocumentTextError('UNREADABLE', `${label} 文件无法读取，请确认文件未损坏`);
    }
}

/** Reads only the relationships and the body they name; headers, footers, notes and styles are left unread. */
const readDocx: DocumentParser = async (bytes, { signal }) => {
    const part = wordDocumentPartName(officeParts(bytes, 'Word', name => name === WORD_RELATIONSHIPS_PART).get(WORD_RELATIONSHIPS_PART));
    const body = officeParts(bytes, 'Word', name => name === part).get(part);
    if (!body) throw new DocumentTextError('UNREADABLE', 'Word 文件无法读取，请确认文件未损坏');
    return wordBodyText(new TextDecoder().decode(body), signal);
};

function formatCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    // Spreadsheet dates carry no time zone; the library reads them as UTC.
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return '';
        const iso = value.toISOString();
        return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
    }
    // Excel keeps 15 significant digits; more only shows binary rounding noise.
    if (typeof value === 'number') return String(Number(value.toPrecision(15)));
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value).replace(/\s+/gu, ' ').trim();
}

/** One sheet as tab-separated rows under its name; blank rows and trailing blank cells are dropped. */
export function formatSheet(name: string, rows: readonly (readonly unknown[])[]): string {
    const lines = rows.map(row => row.map(formatCell).join('\t').replace(/\t+$/u, '')).filter(line => line.trim());
    return lines.length ? `## 工作表：${name}\n${lines.join('\n')}` : '';
}

const readXlsx: DocumentParser = async (bytes, { signal }) => {
    // The library reads the workbook itself, so it gets the parts repacked: exactly the bytes counted above.
    const archive = writeStoredZip(officeParts(bytes, 'Excel', isOfficeXml));
    signal.throwIfAborted();
    const sheets = await readXlsxFile(archive.buffer);
    return sheets.map(({ sheet, data }) => formatSheet(sheet, data)).filter(Boolean).join('\n\n');
};

/** Parsers by kind; docs/manual/Architecture.md「附件文字提取」lists what each guards against. */
export const DOCUMENT_PARSERS: Readonly<Record<DocumentParserKind, DocumentParser>> = {
    text: decodeUtf8,
    pdf: readPdf,
    docx: readDocx,
    xlsx: readXlsx,
};

export interface ExtractedDocument {
    name: string;
    format: DocumentFormat;
    text: string;
}

function whenAborted(signal: AbortSignal): Promise<never> {
    return new Promise((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
}

/** A long name is shortened in front of its extension, which says what the text was read from. */
function boundedName(name: string, extension: string): string {
    if (name.length <= MAX_DOCUMENT_NAME_LENGTH) return name;
    const stem = name.slice(0, MAX_DOCUMENT_NAME_LENGTH - extension.length - 1).replace(/[\uD800-\uDBFF]$/u, '');
    return `${stem}.${extension}`;
}

export function createDocumentTextExtractor(parsers: DocumentParsers, timeoutMs = DOCUMENT_PARSE_TIMEOUT_MS) {
    return async function extractDocumentText(file: { name: string; bytes: Uint8Array }, signal?: AbortSignal): Promise<ExtractedDocument> {
        const format = documentFormatOf(file.name);
        if (!format) throw new DocumentTextError('UNSUPPORTED_FORMAT', documentRejection(file.name) ?? '不支持该文件类型');
        const name = boundedName(file.name.trim(), format.extension);
        const parser = parsers[format.parser];
        // Every catalog format has a parser (DOCUMENT_PARSERS is typed per kind); this guards partial test registries.
        if (!parser) throw new DocumentTextError('UNSUPPORTED_FORMAT', `暂不支持 ${format.label} 文件`);
        if (!file.bytes.length) throw new DocumentTextError('EMPTY_FILE', '文件为空');
        if (file.bytes.length > MAX_DOCUMENT_BYTES) throw new DocumentTextError('FILE_TOO_LARGE', '文件不能超过 10MB');

        const deadline = AbortSignal.timeout(timeoutMs);
        const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
        let raw: string;
        try {
            // A parser that ignores its signal still cannot hold the request past the deadline.
            raw = await Promise.race([parser(file.bytes, { name, signal: bounded }), whenAborted(bounded)]);
        } catch (error) {
            if (deadline.aborted) throw new DocumentTextError('TIMEOUT', '文件解析超时，请拆分后重试');
            if (signal?.aborted) throw signal.reason;
            if (error instanceof DocumentTextError) throw error;
            console.warn('[document-text]', { format: format.extension, error: error instanceof Error ? error.name : typeof error });
            throw new DocumentTextError('UNREADABLE', `${format.label} 文件无法读取，请确认文件未损坏`);
        }
        // trim() also drops a leading byte-order mark.
        const text = raw.replace(/\r\n?/gu, '\n').trim();
        if (text.includes('\u0000')) throw new DocumentTextError('UNREADABLE', '文件包含无法识别的二进制内容');
        if (!text) throw new DocumentTextError('NO_TEXT', '没有提取到文字内容');
        if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_TEXT_BYTES) throw new DocumentTextError('TEXT_TOO_LARGE', '提取出的文字超过 2MB，请拆分后上传');
        return { name, format, text };
    };
}

export const extractDocumentText = createDocumentTextExtractor(DOCUMENT_PARSERS);
