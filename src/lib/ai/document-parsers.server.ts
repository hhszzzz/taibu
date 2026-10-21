import 'server-only';

import path from 'node:path';
import readXlsxFile from 'read-excel-file/universal';
import { getDocumentProxy } from 'unpdf';
import { DocumentTextError } from './document-formats';
import type { DocumentParser, DocumentParsers } from './document-text.server';
import { wordBodyText, wordDocumentPartName, WORD_RELATIONSHIPS_PART } from './document-word.server';
import { readZipArchive, writeStoredZip, ZipArchiveError } from './document-zip.server';

/**
 * Parsers of PDF, Word and Excel files. The request never imports them: they run in the document worker
 * (`document-text.worker.ts`), so a file that runs away with time or memory stops a thread rather than the server.
 */

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
export const BINARY_DOCUMENT_PARSERS: DocumentParsers = {
    pdf: readPdf,
    docx: readDocx,
    xlsx: readXlsx,
};
