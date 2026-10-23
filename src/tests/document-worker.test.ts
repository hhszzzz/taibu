import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DocumentTextError } from '../lib/ai/document-formats';
import { createDocumentTextExtractor, decodeTextDocument, documentTextErrorStatus, type DocumentParser } from '../lib/ai/document-text.server';
import {
    DOCUMENT_WORKER_FILE,
    DOCUMENT_WORKER_LIMITS,
    DocumentWorkerError,
    createDocumentWorkerParser,
    type DocumentWorkerLimits,
} from '../lib/ai/document-worker.server';
import { SONG_UCS2, docxDocument, inflatingPdf, pdfDocument, showText, xlsxWorkbook } from './helpers/document-fixtures';

const directory = mkdtempSync(path.join(tmpdir(), 'taibu-document-worker-'));
after(() => rmSync(directory, { recursive: true, force: true }));

const utf8 = (text: string) => new TextEncoder().encode(text);
const pdf = utf8('%PDF');
const limits = (overrides: Partial<DocumentWorkerLimits>): DocumentWorkerLimits => ({ ...DOCUMENT_WORKER_LIMITS, ...overrides });
/** The request's checks and normalization around a PDF parser, as in production. */
const pdfExtractor = (parser: DocumentParser, timeoutMs?: number) => createDocumentTextExtractor({ pdf: parser }, timeoutMs);

/** A stand-in worker module; the job arrives as `workerData`. */
function workerScript(name: string, body: string): string {
    const file = path.join(directory, `${name}.mjs`);
    writeFileSync(file, `import { parentPort, workerData } from 'node:worker_threads';\n${body}\n`);
    return file;
}

async function refusal(promise: Promise<unknown>): Promise<DocumentTextError> {
    try {
        await promise;
    } catch (error) {
        assert.ok(error instanceof DocumentTextError, `expected DocumentTextError, got ${String(error)}`);
        return error;
    }
    assert.fail('expected the document to be refused');
}

let bundle: string | undefined;
/** The real worker, bundled once by the build script into the test directory. */
function builtWorker(): string {
    if (!bundle) {
        bundle = path.join(directory, 'bundle', 'document-text-worker.mjs');
        execFileSync(process.execPath, ['scripts/build-document-worker.mjs', bundle], { stdio: 'pipe' });
    }
    return bundle;
}

test('a worker answers with text, a refusal or the name of a parser error, and the request treats each as it would in-process', async t => {
    t.mock.method(console, 'warn', () => undefined);
    const answer = pdfExtractor(createDocumentWorkerParser(workerScript('answer', 'parentPort.postMessage({ text: ` ${workerData.name}\\r\\n${workerData.bytes.length} ` });')));
    assert.deepEqual(await answer({ name: ' 命书.pdf ', bytes: pdf }), { name: '命书.pdf', format: { extension: 'pdf', label: 'PDF', parser: 'pdf' }, text: '命书.pdf\n4' });
    const refuse = pdfExtractor(createDocumentWorkerParser(workerScript('refuse', "parentPort.postMessage({ refusal: { code: 'NO_TEXT', message: 'PDF 中没有可提取的文字' } });")));
    const refused = await refusal(refuse({ name: 'a.pdf', bytes: pdf }));
    assert.deepEqual([refused.code, refused.message], ['NO_TEXT', 'PDF 中没有可提取的文字']);
    const crash = pdfExtractor(createDocumentWorkerParser(workerScript('crash', "parentPort.postMessage({ failure: 'InvalidPDFException' });")));
    const unreadable = await refusal(crash({ name: 'a.pdf', bytes: pdf }));
    assert.equal(unreadable.code, 'UNREADABLE');
    assert.match(unreadable.message, /^PDF 文件无法读取/u);
});

test('a worker stuck past the deadline, or left by its caller, is terminated and gives its turn back', async () => {
    // The loop never yields, so only terminating the thread stops it.
    const parse = createDocumentWorkerParser(workerScript('stuck', "if (workerData.name.startsWith('stuck')) for (;;);\nparentPort.postMessage({ text: 'ok' });"), limits({ concurrency: 1 }));
    // The only turn returns when the stuck thread has exited; until then the next document would wait and be refused as busy.
    const next = () => pdfExtractor(parse)({ name: 'next.pdf', bytes: pdf });
    assert.equal((await refusal(pdfExtractor(parse, 300)({ name: 'stuck.pdf', bytes: pdf }))).code, 'TIMEOUT');
    assert.equal((await next()).text, 'ok');
    const caller = new AbortController();
    const leaving = pdfExtractor(parse)({ name: 'stuck.pdf', bytes: pdf }, caller.signal);
    setTimeout(() => caller.abort(new Error('client left')), 50);
    await assert.rejects(leaving, /client left/u);
    assert.equal((await next()).text, 'ok');
});

test('a worker past its memory is stopped as a document with too much content, before the server is', async () => {
    // Buffers outside the heap, as pdf.js inflates a stream, and objects on it.
    const buffers = workerScript('buffers', 'const held = [];\nfor (;;) held.push(new Uint8Array(1024 * 1024).fill(1));');
    const objects = workerScript('objects', 'const held = [];\nfor (;;) held.push({ index: held.length, text: String(held.length).repeat(8) });');
    for (const file of [buffers, objects]) {
        const error = await refusal(pdfExtractor(createDocumentWorkerParser(file, limits({ heapMb: 32, bufferMb: 32 })))({ name: 'a.pdf', bytes: pdf }));
        assert.equal(error.code, 'TEXT_TOO_LARGE', file);
        assert.equal(error.message, 'PDF 文件内容过多，请拆分后上传');
    }
});

test('documents beyond the concurrent workers wait their turn, and are refused as busy when it does not come', async () => {
    const parse = createDocumentWorkerParser(
        workerScript('slow', "setTimeout(() => parentPort.postMessage({ text: workerData.name }), workerData.name.startsWith('slow') ? 600 : 0);"),
        limits({ concurrency: 1, waitMs: 150 }),
    );
    const extract = pdfExtractor(parse);
    const first = extract({ name: 'slow.pdf', bytes: pdf });
    const busy = await refusal(extract({ name: 'busy.pdf', bytes: pdf }));
    assert.deepEqual([busy.code, documentTextErrorStatus(busy)], ['BUSY', 503]);
    const caller = new AbortController();
    const leaving = extract({ name: 'left.pdf', bytes: pdf }, caller.signal);
    caller.abort(new Error('client left'));
    await assert.rejects(leaving, /client left/u);
    assert.equal((await first).text, 'slow.pdf');
    assert.equal((await extract({ name: 'after.pdf', bytes: pdf })).text, 'after.pdf', 'the caller who left gave up its place');
});

test('the document waiting queue refuses excess jobs immediately and frees aborted slots', async () => {
    const parse = createDocumentWorkerParser(
        workerScript('bounded-queue', "setTimeout(() => parentPort.postMessage({ text: workerData.name }), 250);"),
        limits({ concurrency: 1, maxWaiting: 1, waitMs: 2000 }),
    );
    const extract = pdfExtractor(parse);
    const running = extract({ name: 'running.pdf', bytes: pdf });
    const controller = new AbortController();
    const waiting = extract({ name: 'waiting.pdf', bytes: pdf }, controller.signal);
    const rejected = await refusal(extract({ name: 'excess.pdf', bytes: pdf }));
    assert.equal(rejected.code, 'BUSY');
    controller.abort(new Error('cancel queue'));
    await assert.rejects(waiting, /cancel queue/);
    const replacement = extract({ name: 'replacement.pdf', bytes: pdf });
    assert.equal((await running).text, 'running.pdf');
    assert.equal((await replacement).text, 'replacement.pdf');
});

test('a worker that cannot start or stops without answering fails the request, not the document', async t => {
    const errors = t.mock.method(console, 'error', () => undefined);
    for (const file of [
        path.join(directory, 'missing.mjs'),
        workerScript('broken', "throw new Error('broken bundle');"),
        workerScript('exits', 'process.exit(3);'),
    ]) {
        await assert.rejects(pdfExtractor(createDocumentWorkerParser(file))({ name: 'a.pdf', bytes: pdf }), DocumentWorkerError, file);
    }
    assert.equal(errors.mock.callCount(), 3, 'each failure is logged for the operator');
});

test('the bundled worker reads Chinese PDF, Word and Excel text the way the request does, and checks itself', async t => {
    const worker = builtWorker();
    assert.equal(DOCUMENT_WORKER_FILE, path.join(process.cwd(), '.agent', 'document-text-worker.mjs'), 'where scripts/build-document-worker.mjs writes it');
    const parse = createDocumentWorkerParser(worker);
    const extract = createDocumentTextExtractor({ text: decodeTextDocument, pdf: parse, docx: parse, xlsx: parse });
    assert.equal((await extract({ name: '命书.pdf', bytes: pdfDocument([showText('<4F60597D>')], SONG_UCS2) })).text, '你好');
    assert.equal((await extract({ name: '报告.docx', bytes: docxDocument(['第一段', '第二段']) })).text, '第一段\n\n第二段');
    assert.equal((await extract({ name: '流年.xlsx', bytes: xlsxWorkbook([{ name: '流年', rows: [['年份', '干支'], [2024, '甲辰']] }]) })).text, '## 工作表：流年\n年份\t干支\n2024\t甲辰');
    t.mock.method(console, 'warn', () => undefined);
    assert.equal((await refusal(extract({ name: '坏.pdf', bytes: utf8('%PDF-1.4 not really') }))).code, 'UNREADABLE');
    assert.match(execFileSync(process.execPath, [worker, '--check'], { encoding: 'utf8' }), /Document worker check passed/u);
    for (const license of ['pdf.js', 'unpdf', 'saxen', 'read-excel-file', 'fflate']) {
        assert.ok(existsSync(path.join(path.dirname(worker), 'licenses', `${license}.LICENSE`)), `${license} license ships with the bundle`);
    }
});

test('a PDF whose content stream inflates past the buffer budget is stopped there', async () => {
    const bomb = await inflatingPdf(256);
    assert.ok(bomb.length < 1024 * 1024, 'the file itself is small');
    const started = Date.now();
    const error = await refusal(pdfExtractor(createDocumentWorkerParser(builtWorker(), limits({ bufferMb: 64 })))({ name: '炸弹.pdf', bytes: bomb }));
    assert.equal(error.code, 'TEXT_TOO_LARGE');
    assert.ok(Date.now() - started < 10_000, `stopped after ${Date.now() - started}ms`);
});
