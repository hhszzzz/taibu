import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST as extract } from '../app/api/chat/extract/route';
import { DocumentTextError, MAX_DOCUMENT_BYTES, documentFormatOf, type DocumentFormat } from '../lib/ai/document-formats';
import { DOCUMENT_TEXT_RATE_LIMIT } from '../lib/ai/document-text.server';
import { DocumentWorkerError } from '../lib/ai/document-worker.server';
import { blockRouteNetwork, mockAIFeatureState, mockAIRateLimit, mockRouteUserContext } from './helpers/route-mock';

function upload(file?: File) {
    const form = new FormData();
    if (file) form.append('file', file);
    return new NextRequest('http://localhost/api/chat/extract', { method: 'POST', body: form });
}

function fixture(t: TestContext, options: { allowed?: boolean } = {}) {
    blockRouteNetwork(t);
    mockAIFeatureState(t);
    const limits: Array<{ identifier: string; endpoint: string }> = [];
    mockAIRateLimit(t, async (identifier, endpoint, config) => {
        limits.push({ identifier, endpoint });
        return { allowed: options.allowed ?? true, remaining: 0, resetAt: new Date(Date.now() + config.windowMs) };
    });
    mockRouteUserContext(t, {}, 'reader-1');
    return { limits };
}

test('extraction returns the document text and stores nothing', async t => {
    const { limits } = fixture(t);
    const response = await extract(upload(new File(['# 命书\r\n甲辰'], ' 命书.md ', { type: 'text/markdown' })));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { name: '命书.md', text: '# 命书\n甲辰' });
    assert.deepEqual(limits, [{ identifier: 'reader-1', endpoint: DOCUMENT_TEXT_RATE_LIMIT.endpoint }]);
});

test('PDF and Office files go to the shared extractor; a busy or failed worker is not blamed on the file', async t => {
    fixture(t);
    // The extractor parses these in the bundled worker, which document-worker.test.ts builds and runs.
    const documents = require('../lib/ai/document-text.server') as typeof import('../lib/ai/document-text.server');
    const word = documentFormatOf('报告.docx') as DocumentFormat;
    const outcomes: Array<() => Promise<string>> = [
        async () => '第一段',
        async () => { throw new DocumentTextError('BUSY', '文件解析繁忙，请稍后重试'); },
        async () => { throw new DocumentWorkerError('The document worker failed'); },
    ];
    const signals: Array<AbortSignal | undefined> = [];
    t.mock.method(documents, 'extractDocumentText', async (file: { name: string; bytes: Uint8Array }, signal?: AbortSignal) => {
        signals.push(signal);
        return { name: file.name, format: word, text: await outcomes[signals.length - 1]() };
    });
    const errors = t.mock.method(console, 'error', () => undefined);
    const send = () => extract(upload(new File(['PK'], '报告.docx')));
    assert.deepEqual(await (await send()).json(), { name: '报告.docx', text: '第一段' });
    const busy = await send();
    assert.equal(busy.status, 503);
    assert.equal((await busy.json()).code, 'BUSY');
    const failed = await send();
    assert.deepEqual([failed.status, (await failed.json()).error], [500, '文件解析失败，请重试']);
    assert.equal(errors.mock.callCount(), 1);
    assert.ok(signals.every(signal => signal instanceof AbortSignal), 'the request signal reaches the extractor');
});

test('extraction requires a signed-in user', async t => {
    blockRouteNetwork(t);
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    t.mock.method(api, 'requireUserContext', async () => ({ error: { message: '请先登录', status: 401 } }));
    assert.equal((await extract(upload(new File(['x'], 'a.txt')))).status, 401);
});

test('extraction is closed while the AI module is disabled', async t => {
    blockRouteNetwork(t);
    mockAIFeatureState(t, { status: 'disabled' });
    mockRouteUserContext(t, {});
    const response = await extract(upload(new File(['x'], 'a.txt')));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'FEATURE_DISABLED');
});

test('a rate-limited user is refused before the file is read', async t => {
    fixture(t, { allowed: false });
    // An unreadable body would answer 400 if the route read it first.
    const request = new NextRequest('http://localhost/api/chat/extract', { method: 'POST', body: 'not multipart' });
    assert.equal((await extract(request)).status, 429);
});

test('missing, oversized and unsupported uploads are refused with their reason', async t => {
    fixture(t);
    const missing = await extract(upload());
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, '请选择文件');
    assert.equal((await extract(upload(new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], 'big.txt')))).status, 413);
    const legacy = await extract(upload(new File(['x'], '旧.doc')));
    assert.equal(legacy.status, 415);
    assert.deepEqual(await legacy.json(), { success: false, error: '暂不支持 Word 97-2003（.doc）文件，请另存为 .docx 后上传', code: 'UNSUPPORTED_FORMAT' });
    const broken = await extract(upload(new File([new Uint8Array([0xff, 0xfe, 0x00])], '坏.txt')));
    assert.equal(broken.status, 422);
    assert.deepEqual(await broken.json(), { success: false, error: '文本需为 UTF-8 编码，请另存为 UTF-8 后上传', code: 'UNREADABLE' });
});

test('an upload far past the limit stops being read partway through', async t => {
    fixture(t);
    const boundary = 'taibu-upload-boundary';
    const megabyte = new Uint8Array(1024 * 1024).fill(0x61);
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="huge.txt"\r\nContent-Type: text/plain\r\n\r\n`));
        },
        pull(controller) {
            pulled += megabyte.length;
            controller.enqueue(megabyte);
        },
        cancel() {
            cancelled = true;
        },
    });
    const request = new NextRequest('http://localhost/api/chat/extract', {
        method: 'POST',
        body,
        duplex: 'half',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    assert.equal((await extract(request)).status, 413);
    assert.ok(cancelled, 'the rest of the body is refused');
    assert.ok(pulled < MAX_DOCUMENT_BYTES * 2, `read ${pulled} bytes`);
});
