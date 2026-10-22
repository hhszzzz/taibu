import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DocumentTextError, documentText } from './document-formats';
import { BINARY_DOCUMENT_PARSERS } from './document-parsers.server';
import { createDocumentTextExtractor } from './document-text.server';
import { createDocumentWorkerParser, type DocumentWorkerJob, type DocumentWorkerResult } from './document-worker.server';

/**
 * The document worker: parses one PDF, Word or Excel file in its own thread and posts the text to the request
 * (document-worker.server.ts), which terminates the thread when the file runs out of time or memory.
 * `node .agent/document-text-worker.mjs --check` reads a Chinese PDF through the bundle the way a request does, so an
 * image without the worker or without the pdf.js CMaps fails to build.
 */

async function read({ name, format, bytes }: DocumentWorkerJob): Promise<DocumentWorkerResult> {
    try {
        const parser = BINARY_DOCUMENT_PARSERS[format.parser];
        if (!parser) throw new DocumentTextError('UNSUPPORTED_FORMAT', `暂不支持 ${format.label} 文件`);
        // Nothing aborts a parse in here: the request terminates the thread instead.
        return { text: documentText(await parser(bytes, { name, format, signal: new AbortController().signal })) };
    } catch (error) {
        if (error instanceof DocumentTextError) return { refusal: { code: error.code, message: error.message } };
        return { failure: error instanceof Error ? error.name : typeof error };
    }
}

/** One page in a Chinese font that only the predefined UniGB-UCS2-H CMap decodes; pdf.js rebuilds the missing xref. */
const CHECK_PDF = [
    '%PDF-1.4',
    '1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj',
    '2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj',
    '3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Resources<</Font<</F1 4 0 R>>>>/Contents 7 0 R>> endobj',
    '4 0 obj <</Type/Font/Subtype/Type0/BaseFont/STSong-Light/Encoding/UniGB-UCS2-H/DescendantFonts[5 0 R]>> endobj',
    '5 0 obj <</Type/Font/Subtype/CIDFontType0/BaseFont/STSong-Light/CIDSystemInfo<</Registry(Adobe)/Ordering(GB1)/Supplement 2>>/FontDescriptor 6 0 R>> endobj',
    '6 0 obj <</Type/FontDescriptor/FontName/STSong-Light/Flags 6/FontBBox[0 -200 1000 900]/ItalicAngle 0/Ascent 880/Descent -120/CapHeight 880/StemV 80>> endobj',
    '7 0 obj <</Length 37>> stream',
    'BT /F1 12 Tf 10 50 Td <4F60597D> Tj ET',
    'endstream endobj',
    'trailer <</Root 1 0 R>>',
    '%%EOF',
].join('\n');

async function check() {
    const extract = createDocumentTextExtractor({ pdf: createDocumentWorkerParser(fileURLToPath(import.meta.url)) });
    const { text } = await extract({ name: 'check.pdf', bytes: new TextEncoder().encode(CHECK_PDF) });
    if (text !== '你好') throw new Error(`The document worker read ${JSON.stringify(text)} instead of 你好`);
    console.info('Document worker check passed');
}

if (!isMainThread) {
    void read(workerData as DocumentWorkerJob).then(result => parentPort?.postMessage(result));
} else if (process.argv.includes('--check')) {
    check().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
