/**
 * Documents a message can carry as text: plain chat sends one document's text with the question, the Agent stores
 * each one as a private text attachment. The server reads each format with the parser of its kind
 * (`document-text.server.ts`); pickers offer exactly these formats. Why a document is refused, and the bounds on
 * its text, are shared by the request and the document worker that parses PDF and Office files.
 */
import type { ChatAttachment } from '@/types';

export type DocumentParserKind = 'text' | 'pdf' | 'docx' | 'xlsx';

export type DocumentTextErrorCode =
    | 'UNSUPPORTED_FORMAT' | 'EMPTY_FILE' | 'FILE_TOO_LARGE' | 'UNREADABLE' | 'NO_TEXT' | 'TEXT_TOO_LARGE' | 'TIMEOUT' | 'BUSY';

/** A document that cannot be read as text; its message is shown to the user as is. */
export class DocumentTextError extends Error {
    constructor(readonly code: DocumentTextErrorCode, message: string) {
        super(message);
        this.name = 'DocumentTextError';
    }
}

export interface DocumentFormat {
    /** Lower-case file extension, without the dot. */
    extension: string;
    label: string;
    parser: DocumentParserKind;
}

export const DOCUMENT_FORMATS: readonly DocumentFormat[] = [
    { extension: 'pdf', label: 'PDF', parser: 'pdf' },
    { extension: 'docx', label: 'Word', parser: 'docx' },
    { extension: 'xlsx', label: 'Excel', parser: 'xlsx' },
    { extension: 'txt', label: 'TXT', parser: 'text' },
    { extension: 'md', label: 'Markdown', parser: 'text' },
    { extension: 'markdown', label: 'Markdown', parser: 'text' },
    { extension: 'csv', label: 'CSV', parser: 'text' },
    { extension: 'json', label: 'JSON', parser: 'text' },
    { extension: 'log', label: 'LOG', parser: 'text' },
    { extension: 'html', label: 'HTML', parser: 'text' },
    { extension: 'xml', label: 'XML', parser: 'text' },
];

/** Older formats people still send, with what to do instead. */
const LEGACY_FORMATS: ReadonlyMap<string, string> = new Map([
    ['doc', '暂不支持 Word 97-2003（.doc）文件，请另存为 .docx 后上传'],
    ['xls', '暂不支持 Excel 97-2003（.xls）文件，请另存为 .xlsx 后上传'],
]);

/** Largest document a parser reads. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Largest text one document may yield, in UTF-8 bytes. */
export const MAX_DOCUMENT_TEXT_BYTES = 2 * 1024 * 1024;
/** Longest file name kept with a document's text. */
export const MAX_DOCUMENT_NAME_LENGTH = 200;

/** `accept` value of document pickers. */
export const DOCUMENT_ACCEPT = DOCUMENT_FORMATS.map(format => `.${format.extension}`).join(',');
/** The formats offered, for messages such as「可上传 PDF、Word…」. */
export const DOCUMENT_LABELS = [...new Set(DOCUMENT_FORMATS.map(format => format.label))].join('、');

const extensionOf = (name: string) => /\.([a-z0-9]+)$/iu.exec(name.trim())?.[1]?.toLowerCase() ?? '';

export function documentFormatOf(name: string): DocumentFormat | null {
    const extension = extensionOf(name);
    return DOCUMENT_FORMATS.find(format => format.extension === extension) ?? null;
}

/** Why a file cannot be attached as a document, or null when its format is offered. */
export function documentRejection(name: string): string | null {
    if (documentFormatOf(name)) return null;
    return LEGACY_FORMATS.get(extensionOf(name)) ?? `不支持该文件类型，可上传 ${DOCUMENT_LABELS} 文件`;
}

/** What a parser read, as the text a document yields: line endings normalized, trimmed and within the limit. */
export function documentText(raw: string): string {
    // trim() also drops a leading byte-order mark.
    const text = raw.replace(/\r\n?/gu, '\n').trim();
    if (text.includes('\u0000')) throw new DocumentTextError('UNREADABLE', '文件包含无法识别的二进制内容');
    if (!text) throw new DocumentTextError('NO_TEXT', '没有提取到文字内容');
    // Every UTF-16 unit takes at least one UTF-8 byte, so a longer text is over the limit without encoding it.
    if (text.length > MAX_DOCUMENT_TEXT_BYTES || new TextEncoder().encode(text).length > MAX_DOCUMENT_TEXT_BYTES) {
        throw new DocumentTextError('TEXT_TOO_LARGE', '提取出的文字超过 2MB，请拆分后上传');
    }
    return text;
}

/** A document's text as a request carries it: a file name and text the server extracted, within the limits above. */
export function isChatAttachment(value: unknown): value is ChatAttachment {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const { name, text } = value as Record<string, unknown>;
    return typeof name === 'string' && !!name.trim() && name.length <= MAX_DOCUMENT_NAME_LENGTH
        && typeof text === 'string' && !!text.trim() && new TextEncoder().encode(text).length <= MAX_DOCUMENT_TEXT_BYTES;
}
