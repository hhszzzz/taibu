import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { parseChatRequestBody } from '../lib/server/chat/request';
import { readRequestBytes, readUploadedFile } from '../lib/api-utils';

const request = (body: string) => new NextRequest('http://localhost/api/chat', { method: 'POST', body });

test('chat rejects malformed messages and oversized content before preparation', async () => {
    for (const body of ['{', 'null', '[]', '{}', ...[null, 1, {}, { role: 'tool', content: 'x' }, { role: 'user', content: 3 }].map(message => JSON.stringify({ messages: [message] })), JSON.stringify({ messages: Array(4097).fill({ role: 'user', content: '' }) })]) {
        const result = await parseChatRequestBody(request(body));
        assert.ok(result instanceof Response, body);
        assert.equal(result.status, 400);
    }
    const oversized = await parseChatRequestBody(request(JSON.stringify({ messages: [{ role: 'user', content: '中'.repeat(700_000) }] })));
    assert.ok(oversized instanceof Response);
    assert.equal(oversized.status, 413, 'content limit is in UTF-8 bytes');
    const valid = await parseChatRequestBody(request(JSON.stringify({ messages: [{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好！' }] })));
    assert.ok(!(valid instanceof Response));
    assert.equal(valid.messages[1]?.content, '你好！');
});

test('body limits count bytes instead of trusting Content-Length and cancel oversized streams', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
        cancel() { cancelled = true; },
    });
    const streamed = new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Length': '1' }, body: stream, duplex: 'half' } as RequestInit);
    const result = await parseChatRequestBody(streamed as NextRequest);
    assert.ok(result instanceof Response);
    assert.equal(result.status, 413);
    assert.equal(cancelled, true);
    const broken = new Request('http://localhost', { method: 'POST', body: new ReadableStream({ start(controller) { controller.error(new Error('connection closed')); } }), duplex: 'half' } as RequestInit);
    assert.deepEqual(await readRequestBytes(broken, 32), { error: { message: '请求体读取失败', status: 400 } });
});

test('bounded request reading preserves valid multipart uploads and rejects oversized files', async () => {
    const upload = (size: number) => {
        const form = new FormData();
        form.set('file', new File(['a'.repeat(size)], 'fixture.txt'));
        return new Request('http://localhost/upload', { method: 'POST', body: form });
    };
    const result = await readUploadedFile(upload(16), 32);
    assert.ok('file' in result);
    assert.equal(await result.file.text(), 'a'.repeat(16));
    const tooLarge = await readUploadedFile(upload(33), 32);
    assert.ok('error' in tooLarge);
    assert.equal(tooLarge.error.status, 413);
});
