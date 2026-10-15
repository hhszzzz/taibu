import test from 'node:test';
import assert from 'node:assert/strict';
import { CONVERSATION_EXPORT_EVENT, conversationExportUrl, downloadConversationExport, requestConversationExport } from '../lib/chat/conversation-export';

test('export URLs encode the conversation and carry the format and tool flag', () => {
    assert.equal(conversationExportUrl('abc', 'md', false), '/api/conversations/abc/export?format=md&tools=0');
    assert.equal(conversationExportUrl('a/b?c', 'html', true), '/api/conversations/a%2Fb%3Fc/export?format=html&tools=1');
});

test('a refused export reports a retryable message before any download starts', async t => {
    const requested: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        requested.push(String(input));
        return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    });
    await assert.rejects(downloadConversationExport('abc', 'html', true), { message: '导出失败，请重试' });
    assert.deepEqual(requested, ['/api/conversations/abc/export?format=html&tools=1']);
});

test('export requests reach the dialog as one window event', t => {
    // Node has no window; the helper only dispatches on it.
    const target = new EventTarget();
    Object.defineProperty(globalThis, 'window', { value: target, configurable: true });
    t.after(() => { Reflect.deleteProperty(globalThis, 'window'); });
    let received = 0;
    target.addEventListener(CONVERSATION_EXPORT_EVENT, () => { received++; });
    requestConversationExport();
    assert.equal(received, 1);
});
