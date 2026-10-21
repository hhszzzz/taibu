import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createMockAuthContext } from './helpers/supabase-mock';
import { createMockScopedDb } from './helpers/db-mock';
import { GET as activityRoute } from '../app/api/agent/activity/route';
import { getAgentActivityPollDelay, getConversationAgentMarkers, getConversationNoticeIds, parseAgentActivity, type AgentActivity } from '../lib/agent/activity';

const [a, b, c, d] = Array.from({ length: 4 }, () => randomUUID());

test('activity payloads keep only well-formed runs and notices', () => {
    assert.equal(parseAgentActivity(null), null);
    assert.equal(parseAgentActivity({ runs: [] }), null, 'both lists are required');
    const run = randomUUID(), notice = randomUUID();
    assert.deepEqual(parseAgentActivity({
        runs: [{ runId: run, conversationId: a, status: 'running' }, { runId: run, conversationId: b, status: 'completed' }, { runId: 'x', conversationId: c, status: 'queued' }, null],
        notices: [{ id: notice, conversationId: c, status: 'completed' }, { id: notice, conversationId: 'not-a-uuid', status: 'completed' }, { id: notice, conversationId: d, status: 'cancelled' }],
    }), { runs: [{ runId: run, conversationId: a, status: 'running' }], notices: [{ id: notice, conversationId: c, status: 'completed' }] });
    const many = parseAgentActivity({ runs: Array.from({ length: 80 }, () => ({ runId: randomUUID(), conversationId: randomUUID(), status: 'queued' })), notices: [] });
    assert.equal(many?.runs.length, 50, 'the list is bounded like the server query');
});

test('only live runs produce sidebar markers; finished notices stay in the notification center', () => {
    const activity: AgentActivity = {
        runs: [{ runId: randomUUID(), conversationId: a, status: 'queued' }, { runId: randomUUID(), conversationId: b, status: 'awaiting_input' }, { runId: randomUUID(), conversationId: c, status: 'cancelling' }],
        notices: [
            { id: randomUUID(), conversationId: a, status: 'completed' },
            { id: randomUUID(), conversationId: d, status: 'completed' },
            { id: randomUUID(), conversationId: d, status: 'failed' },
        ],
    };
    assert.deepEqual([...getConversationAgentMarkers(activity)], [[a, 'running'], [b, 'awaiting'], [c, 'running']]);
    assert.equal(getConversationAgentMarkers(activity).has(d), false, 'completed/failed notices never add an in-page marker');
    assert.equal(getConversationAgentMarkers(activity).get(b), 'awaiting', 'a waiting question stays visible while open');
    assert.equal(getConversationAgentMarkers({ runs: [], notices: [{ id: randomUUID(), conversationId: c, status: 'failed' }] }).size, 0, 'failures are left to the toast and notification center');
    assert.equal(getConversationAgentMarkers(null).size, 0);

    assert.deepEqual(getConversationNoticeIds(activity, d), activity.notices.slice(1).map(notice => notice.id), 'opening reads every task notice of that conversation');
    assert.deepEqual(getConversationNoticeIds(activity, null), []);
    assert.equal(getAgentActivityPollDelay(activity), 10_000);
    assert.equal(getAgentActivityPollDelay({ runs: [], notices: activity.notices }), 60_000);
    assert.equal(getAgentActivityPollDelay(null), 60_000);
});

function fixture(t: TestContext) {
    const owner = randomUUID();
    const calls: { table: string; method: string; args: unknown[] }[] = [];
    const rows: Record<string, unknown[]> = {};
    const errors: Record<string, unknown> = {};
    const scoped = createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                const query = {
                    select() { calls.push({ table, method: 'select', args: [] }); return query; },
                    where(...args: unknown[]) { calls.push({ table, method: 'where', args }); return query; },
                    orderBy(...args: unknown[]) { calls.push({ table, method: 'orderBy', args }); return query; },
                    limit(...args: unknown[]) { calls.push({ table, method: 'limit', args }); return query; },
                    async execute() {
                        if (table in errors) throw errors[table];
                        return rows[table] ?? [];
                    },
                };
                return query;
            },
        } as never),
    });
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    t.mock.method(api, 'requireUserContext', async () => createMockAuthContext({}, owner, scoped));
    return { owner, calls, rows, errors, api };
}
const request = () => new NextRequest('http://localhost/api/agent/activity');

test('activity route reads only the caller’s active runs and unread task notices', async t => {
    const f = fixture(t);
    const run = randomUUID(), notice = randomUUID();
    f.rows.agent_runs = [{ id: run, conversation_id: a, status: 'awaiting_input' }];
    f.rows.notifications = [
        { id: notice, event_data: { kind: 'agent', conversationId: b, status: 'completed', messageId: 'agent:x' } },
        { id: randomUUID(), event_data: { kind: 'briefing', conversationId: c, status: 'completed' } },
        { id: randomUUID(), event_data: null },
    ];
    const response = await activityRoute(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { runs: [{ runId: run, conversationId: a, status: 'awaiting_input' }], notices: [{ id: notice, conversationId: b, status: 'completed' }] });
    const filters = (table: string) => f.calls.filter(call => call.table === table).map(call => [call.method, ...call.args]);
    assert.deepEqual(filters('agent_runs').filter(([method]) => method === 'where').map(call => call.slice(1)), [['user_id', '=', f.owner], ['status', 'in', ['queued', 'running', 'awaiting_input', 'cancelling']]]);
    const noticeFilters = filters('notifications').filter(([method]) => method === 'where').map(call => call.slice(1));
    assert.ok(noticeFilters.some(([field, operator, value]) => field === 'user_id' && operator === '=' && value === f.owner));
    assert.ok(noticeFilters.some(([field, operator, value]) => field === 'is_read' && operator === '=' && value === false));
    assert.ok(noticeFilters.some(([field, operator, value]) => field === 'event_key' && operator === 'like' && value === 'agent:%'));
    assert.ok(noticeFilters.some(([field, operator]) => field === 'created_at' && operator === '>='), 'notices past retention are not shown');
    assert.ok(noticeFilters.length === 4 && filters('agent_runs').some(([method, value]) => method === 'limit' && value === 50) && filters('notifications').some(([method, value]) => method === 'limit' && value === 50));
});

test('activity route requires a session and reports read failures without details', async t => {
    const f = fixture(t);
    f.errors.notifications = { message: 'relation "notifications" does not exist' };
    const failed = await activityRoute(request());
    assert.equal(failed.status, 503);
    const body = await failed.json() as { error?: { code?: string; message?: string } } & Record<string, unknown>;
    assert.equal(JSON.stringify(body).includes('relation'), false, 'database errors stay on the server');
    t.mock.method(f.api, 'requireUserContext', async () => ({ error: { message: '请先登录', status: 401 } }));
    assert.equal((await activityRoute(request())).status, 401);
});
