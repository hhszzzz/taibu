import 'server-only';

import {
    DocumentTextError,
    documentFormatOf,
    documentRejection,
    documentText,
    MAX_DOCUMENT_BYTES,
    MAX_DOCUMENT_NAME_LENGTH,
    type DocumentFormat,
    type DocumentParserKind,
    type DocumentTextErrorCode,
} from './document-formats';
import { createDocumentWorkerParser, DOCUMENT_WORKER_FILE, DocumentWorkerError } from './document-worker.server';

export { DocumentTextError, type DocumentTextErrorCode } from './document-formats';

const STATUS: Record<DocumentTextErrorCode, number> = {
    UNSUPPORTED_FORMAT: 415, EMPTY_FILE: 400, FILE_TOO_LARGE: 413, UNREADABLE: 422, NO_TEXT: 422, TEXT_TOO_LARGE: 413, TIMEOUT: 422, BUSY: 503,
};
export const documentTextErrorStatus = (error: DocumentTextError) => STATUS[error.code];

/**
 * Reads one document as plain text. Size and format are checked before a parser runs, and what it returns is
 * normalized and bounded after. A parser should stop when `signal` aborts; it may throw a DocumentTextError to
 * explain what is wrong with a file, and any other error it throws reaches the user as an unreadable file.
 */
export type DocumentParser = (bytes: Uint8Array, context: { name: string; format: DocumentFormat; signal: AbortSignal }) => Promise<string>;
export type DocumentParsers = Readonly<Partial<Record<DocumentParserKind, DocumentParser>>>;

/** Time one document may take to read, including its wait for a worker. */
export const DOCUMENT_PARSE_TIMEOUT_MS = 20_000;

/** Every route that reads documents draws on this one per-user budget. */
export const DOCUMENT_TEXT_RATE_LIMIT = { endpoint: 'document-text', maxRequests: 20, windowMs: 60_000 } as const;

/** Text files are decoded in the request; nothing in them can make decoding run away. */
export const decodeTextDocument: DocumentParser = async bytes => {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new DocumentTextError('UNREADABLE', '文本需为 UTF-8 编码，请另存为 UTF-8 后上传');
    }
};

const readInWorker = createDocumentWorkerParser(DOCUMENT_WORKER_FILE);

/** Parsers by kind: PDF, Word and Excel are parsed in the document worker (document-worker.server.ts). */
export const DOCUMENT_PARSERS: Readonly<Record<DocumentParserKind, DocumentParser>> = {
    text: decodeTextDocument,
    pdf: readInWorker,
    docx: readInWorker,
    xlsx: readInWorker,
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
            raw = await Promise.race([parser(file.bytes, { name, format, signal: bounded }), whenAborted(bounded)]);
        } catch (error) {
            if (deadline.aborted) throw new DocumentTextError('TIMEOUT', '文件解析超时，请拆分后重试');
            if (signal?.aborted) throw signal.reason;
            // A worker that failed says nothing about the document, so it is not reported as unreadable.
            if (error instanceof DocumentTextError || error instanceof DocumentWorkerError) throw error;
            console.warn('[document-text]', { format: format.extension, error: error instanceof Error ? error.name : typeof error });
            throw new DocumentTextError('UNREADABLE', `${format.label} 文件无法读取，请确认文件未损坏`);
        }
        return { name, format, text: documentText(raw) };
    };
}

export const extractDocumentText = createDocumentTextExtractor(DOCUMENT_PARSERS);
