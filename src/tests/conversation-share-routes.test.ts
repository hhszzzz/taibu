import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { ChatMessage } from '../types';
import { createMockAuthContext } from './helpers/auth-mock';
import { createMockScopedDb } from './helpers/db-mock';
import { GET as getShare, POST as saveShare, DELETE as revokeShare } from '../app/api/conversations/[id]/share/route';
import { GET as listShares } from '../app/api/shares/route';

type Call = { table: string; field: string; value: unknown };

function fixture(t: TestContext) {
    const owner = randomUUID(), id = randomUUID();
    const calls: Call[] = [];
    const rows: Record<string, unknown> = {
        conversations: { id, title: '我的对话', updated_at: '2026-10-19T08:00:00.123456+00:00' },
    };
    const rpcResults: Record<string, { data: unknown; error: unknown }> = {};
    const db = createMockScopedDb({
        tx: async (work) => work({
            selectFrom: (table: string) => {
                const record = (field: string, value: unknown) => { calls.push({ table, field, value }); return query; };
                const query = {
                    select: () => query,
                    where: (field: string, _operator: string, value: unknown) => record(field, value),
                    orderBy: () => query,
                    limit: () => query,
                    executeTakeFirst: async () => rows[table] ?? undefined,
                    execute: async () => {
                        const row = rows[table];
                        return Array.isArray(row) ? row : row ? [row] : [];
                    },
                };
                return query;
            },
        } as never),
        rpc: async (name: string, args: Record<string, unknown>) => {
            calls.push({ table: 'rpc', field: name, value: args });
            const result = rpcResults[name];
            if (result?.error) {
                const error = result.error as { code?: string; message?: string };
                throw Object.assign(new Error(error.message ?? 'rpc failed'), { code: error.code });
            }
            return result?.data ?? null;
        },
    });
    const history: ChatMessage[] = [
        { id: 'u1', role: 'user', content: '问题', createdAt: '2026-10-19T00:00:00.000Z', mentions: [{ type: 'bazi_chart', id: 'chart-id', name: '张三', preview: '' }] },
        { id: 'a1', role: 'assistant', content: '回答', createdAt: '2026-10-19T00:00:01.000Z', model: 'model-key', metadata: { promptDiagnostics: { systemPrompt: 'secret' } } },
    ];
    let messages = history;
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const loader = require('../lib/server/conversation-messages') as typeof import('../lib/server/conversation-messages');
    const exporter = require('../lib/chat/conversation-export.server') as typeof import('../lib/chat/conversation-export.server');
    t.mock.method(api, 'requireUserContext', async () => createMockAuthContext(owner, db));
    t.mock.method(loader, 'loadAllConversationMessages', async () => ({ messages, error: null }));
    const enrich = t.mock.method(exporter, 'enrichConversationBasis', async (_db: unknown, list: ChatMessage[]) => list);
    return {
        owner, id, calls, rows, api, enrich,
        rpc(name: string, data: unknown, error: unknown = null) { rpcResults[name] = { data, error }; },
        setMessages(next: ChatMessage[]) { messages = next; },
        rpcCalls: (name: string) => calls.filter(call => call.table === 'rpc' && call.field === name).map(call => call.value as Record<string, unknown>),
    };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body?: unknown) => new NextRequest('http://localhost/api/conversations/x/share', {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
const shareRow = (token: string, includeCharts = false) => ({ token, conversation_id: 'ignored', title: '我的对话', include_charts: includeCharts, created_at: '2026-10-19T08:00:00Z', updated_at: '2026-10-19T08:05:00Z' });

test('every share endpoint requires a signed-in caller', async t => {
    const f = fixture(t);
    t.mock.method(f.api, 'requireUserContext', async () => ({ error: { message: '请先登录', status: 401 } }));
    assert.equal((await getShare(request('GET'), params(f.id))).status, 401);
    assert.equal((await saveShare(request('POST', {}), params(f.id))).status, 401);
    assert.equal((await revokeShare(request('DELETE'), params(f.id))).status, 401);
    assert.equal((await listShares(new NextRequest('http://localhost/api/shares'))).status, 401);
    assert.equal(f.calls.length, 0);
});

test("another account's conversation is indistinguishable from a missing one", async t => {
    const f = fixture(t);
    f.rows.conversations = null;
    assert.equal((await getShare(request('GET'), params(f.id))).status, 404);
    assert.equal((await saveShare(request('POST', {}), params(f.id))).status, 404);
    assert.equal((await revokeShare(request('DELETE'), params(f.id))).status, 404);
    assert.ok(f.calls.some(call => call.table === 'conversations' && call.field === 'user_id' && call.value === f.owner));
    assert.equal(f.calls.some(call => call.table === 'rpc'), false);
    assert.equal((await getShare(request('GET'), params('not-a-uuid'))).status, 400);
});

test('creating a link sends a sanitised snapshot pinned to the conversation version', async t => {
    const f = fixture(t);
    f.rpc('upsert_conversation_share', shareRow('A'.repeat(43)));
    const response = await saveShare(request('POST', {}), params(f.id));
    assert.equal(response.status, 200);
    const body = await response.json() as { share: { token: string; path: string; includeCharts: boolean } };
    assert.deepEqual(body.share, { token: 'A'.repeat(43), path: `/share/${'A'.repeat(43)}`, includeCharts: false, createdAt: '2026-10-19T08:00:00Z', updatedAt: '2026-10-19T08:05:00Z' });
    const [args] = f.rpcCalls('upsert_conversation_share');
    assert.equal(args.p_conversation, f.id);
    assert.match(String(args.p_token), /^[A-Za-z0-9_-]{43}$/);
    assert.equal(args.p_title, '我的对话');
    assert.equal(args.p_include_charts, false);
    assert.equal(args.p_source_updated_at, '2026-10-19T08:00:00.123456+00:00');
    assert.deepEqual(args.p_snapshot, [
        { role: 'user', content: '问题', createdAt: '2026-10-19T00:00:00.000Z', mentionTypes: ['bazi_chart'] },
        { role: 'assistant', content: '回答', createdAt: '2026-10-19T00:00:01.000Z' },
    ]);
    for (const secret of ['chart-id', '张三', 'model-key', 'secret', 'u1', 'a1']) assert.equal(JSON.stringify(args.p_snapshot).includes(secret), false, secret);
    // Chart basis lives in run artifacts and is only read after an explicit opt-in.
    assert.equal(f.enrich.mock.callCount(), 0);
});

test('refreshing keeps the existing token returned by the database and honours the chart opt-in', async t => {
    const f = fixture(t);
    const token = 'b'.repeat(43);
    f.rpc('upsert_conversation_share', shareRow(token, true));
    const first = await (await saveShare(request('POST', { includeCharts: true }), params(f.id))).json() as { share: { token: string } };
    const second = await (await saveShare(request('POST', { includeCharts: true }), params(f.id))).json() as { share: { token: string; includeCharts: boolean } };
    assert.equal(first.share.token, token);
    assert.equal(second.share.token, token);
    assert.equal(second.share.includeCharts, true);
    const calls = f.rpcCalls('upsert_conversation_share');
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].p_token, calls[1].p_token, 'each request offers a fresh candidate; the database keeps the active one');
    assert.equal(f.enrich.mock.callCount(), 2);
});

test('busy, stale and oversized conversations are refused with distinct statuses', async t => {
    const f = fixture(t);
    f.rpc('upsert_conversation_share', null, { code: '55006', message: 'CONVERSATION_BUSY' });
    assert.equal((await saveShare(request('POST', {}), params(f.id))).status, 409);
    f.rpc('upsert_conversation_share', null, { code: '40001', message: 'SHARE_SOURCE_CHANGED' });
    assert.equal((await saveShare(request('POST', {}), params(f.id))).status, 409);
    f.rpc('upsert_conversation_share', null, { code: '22023', message: 'SHARE_SNAPSHOT_INVALID' });
    assert.equal((await saveShare(request('POST', {}), params(f.id))).status, 413);
    f.rpc('upsert_conversation_share', null, { code: 'XX000', message: 'boom' });
    assert.equal((await saveShare(request('POST', {}), params(f.id))).status, 500);
    const before = f.rpcCalls('upsert_conversation_share').length;
    f.setMessages([{ id: 'big', role: 'assistant', content: 'x'.repeat(1_100_000), createdAt: '2026-10-19T00:00:00.000Z' }]);
    assert.equal((await saveShare(request('POST', {}), params(f.id))).status, 413);
    f.setMessages([]);
    assert.equal((await saveShare(request('POST', {}), params(f.id))).status, 400);
    assert.equal(f.rpcCalls('upsert_conversation_share').length, before, 'rejected snapshots never reach the database');
    assert.equal((await saveShare(request('POST', 'not json'), params(f.id))).status, 400);
    assert.equal((await saveShare(request('POST', { includeCharts: 'yes' }), params(f.id))).status, 400);
});

test('status and revocation are scoped to the owner', async t => {
    const f = fixture(t);
    const token = 'c'.repeat(43);
    f.rows.conversation_shares = shareRow(token);
    const status = await (await getShare(request('GET'), params(f.id))).json() as { share: { token: string } | null };
    assert.equal(status.share?.token, token);
    assert.ok(f.calls.some(call => call.table === 'conversation_shares' && call.field === 'user_id' && call.value === f.owner));
    assert.ok(f.calls.some(call => call.table === 'conversation_shares' && call.field === 'revoked_at' && call.value === null));
    f.rows.conversation_shares = null;
    assert.deepEqual(await (await getShare(request('GET'), params(f.id))).json(), { share: null });

    f.rpc('revoke_conversation_share', true);
    const revoked = await revokeShare(request('DELETE'), params(f.id));
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), { revoked: true });
    assert.deepEqual(f.rpcCalls('revoke_conversation_share'), [{ p_conversation: f.id }]);
    f.rpc('revoke_conversation_share', null, { code: '42501', message: 'CONVERSATION_NOT_FOUND' });
    assert.equal((await revokeShare(request('DELETE'), params(f.id))).status, 404);
});

test('the owner list only returns active links of the caller', async t => {
    const f = fixture(t);
    f.rows.conversation_shares = [{ ...shareRow('d'.repeat(43)), conversation_id: f.id }];
    const response = await listShares(new NextRequest('http://localhost/api/shares'));
    assert.equal(response.status, 200);
    const body = await response.json() as { shares: { conversationId: string; path: string; title: string }[] };
    assert.deepEqual(body.shares.map(share => [share.conversationId, share.path, share.title]), [[f.id, `/share/${'d'.repeat(43)}`, '我的对话']]);
    assert.ok(f.calls.some(call => call.table === 'conversation_shares' && call.field === 'user_id' && call.value === f.owner));
    assert.ok(f.calls.some(call => call.table === 'conversation_shares' && call.field === 'revoked_at' && call.value === null));
});
