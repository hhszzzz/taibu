import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import type { DB } from '../lib/db/generated/schema';
import { createMockAuthContext } from './helpers/supabase-mock';
import { createMockScopedDb } from './helpers/db-mock';
import {
    agentArchiveToday, describeMasterReviewFill, fillableMasterReviewItems, getAgentArchiveHref, getAgentArchiveProposal, getAgentArchiveRecord,
    normalizeAgentArchiveProposal, parseAgentArchiveDate, parseAgentArchiveReference, pickMasterReviewFill,
    type AgentArchiveChart, type AgentArchiveProposal,
} from '../lib/agent/archive';
import { agentArchiveEntryId } from '../lib/agent/archive.server';
import { createEmptyBaziCaseMasterReview } from '../lib/bazi-case-profile';
import { applyListFilters } from '../lib/data-sources/list-filters';
import { GET, POST } from '../app/api/agent/runs/[id]/archive/route';

const chart: AgentArchiveChart = { type: 'bazi_chart', id: randomUUID(), label: '八字命盘「本人」' };
const TODAY = '2026-10-21';

test('an entry links to a saved item by its type:ID reference, never to a board that is not saved', () => {
    const id = randomUUID();
    assert.deepEqual(parseAgentArchiveReference(` bazi_chart:${id.toUpperCase()} `), { type: 'bazi_chart', id });
    assert.deepEqual(parseAgentArchiveReference(`mbti_reading:${id}`), { type: 'mbti_reading', id });
    assert.throws(() => parseAgentArchiveReference(`artifact:${id}`), /还没有保存/);
    // A record has no table of saved items behind it, and inherited keys are not types.
    for (const reference of [`ming_record:${id}`, `__proto__:${id}`, 'bazi_chart:not-a-uuid', id])
        assert.throws(() => parseAgentArchiveReference(reference), /reference 须为已存资料的引用/, reference);
});

test('a date keeps the precision the user gave, today is China Standard Time\'s, and an event cannot lie ahead', () => {
    assert.equal(agentArchiveToday(Date.UTC(2026, 9, 20, 15, 59)), '2026-10-20');
    assert.equal(agentArchiveToday(Date.UTC(2026, 9, 20, 16, 0)), '2026-10-21');
    assert.equal(parseAgentArchiveDate('2024'), '2024-01-01');
    assert.equal(parseAgentArchiveDate('2024-3'), '2024-03-01');
    assert.equal(parseAgentArchiveDate(' 2024-03-9 '), '2024-03-09');
    assert.equal(parseAgentArchiveDate('2024-02-29'), '2024-02-29');
    for (const value of ['2023-02-29', '2024-13', '1899', '2101-01-01', '2024/03/01', '三月'])
        assert.throws(() => parseAgentArchiveDate(value), /^Error: date /, value);
    assert.equal(parseAgentArchiveDate(TODAY, TODAY), TODAY);
    assert.throws(() => parseAgentArchiveDate('2026-10-22', TODAY), /不能晚于今天/);
    assert.equal(parseAgentArchiveDate('2027-06'), '2027-06-01', 'a prediction has no such bound');
});

test('an event or a conclusion card proposes exactly what its save writes', () => {
    assert.deepEqual(normalizeAgentArchiveProposal({ kind: 'event', date: '2024-3', category: '事业', title: ' 换到新公司 ', content: ' 去了上海 ' }, chart, TODAY),
        { kind: 'event', date: '2024-03-01', category: '事业', title: '换到新公司', detail: '去了上海', chart });
    const event = { kind: 'event', date: '2024', category: '事业', title: '跳槽' } as const;
    assert.throws(() => normalizeAgentArchiveProposal({ ...event, date: '2027-01' }, null, TODAY), /预测结论/);
    assert.throws(() => normalizeAgentArchiveProposal({ ...event, category: 'prediction' }, null, TODAY), /category 只能是/);
    assert.throws(() => normalizeAgentArchiveProposal({ ...event, date: undefined }, null, TODAY), /需要 date/);
    assert.throws(() => normalizeAgentArchiveProposal({ ...event, tags: ['事业'] }, null, TODAY), /不接受 tags/);
    assert.throws(() => normalizeAgentArchiveProposal({ ...event, title: '   ' }, null, TODAY), /title 不能为空/);
    assert.throws(() => normalizeAgentArchiveProposal({ ...event, content: '长'.repeat(501) }, null, TODAY), /content 不能超过 500 字/);

    assert.deepEqual(normalizeAgentArchiveProposal({ kind: 'conclusion', title: '明年换岗', content: '官星透出', date: '2027-06', tags: [' 事业 ', '事业', '应期'] }, null, TODAY),
        { kind: 'conclusion', category: 'general', title: '明年换岗', content: '官星透出', date: '2027-06-01', tags: ['事业', '应期'], chart: null });
    const conclusion = { kind: 'conclusion', title: '结论', content: '内容' } as const;
    assert.equal(normalizeAgentArchiveProposal({ ...conclusion, category: 'prediction', date: '2028' }, chart, TODAY).kind, 'conclusion');
    assert.throws(() => normalizeAgentArchiveProposal({ ...conclusion, category: '事业' }, null, TODAY), /general 或 prediction/);
    assert.throws(() => normalizeAgentArchiveProposal({ ...conclusion, content: undefined }, null, TODAY), /content 不能为空/);
    assert.throws(() => normalizeAgentArchiveProposal({ ...conclusion, strengthLevel: '偏弱' }, null, TODAY), /不接受 strengthLevel/);
    assert.throws(() => normalizeAgentArchiveProposal({ ...conclusion, tags: Array.from({ length: 9 }, (_, index) => `标签${index}`) }, null, TODAY), /tags 最多 8 项/);
});

test('a master review card fills only the blank judgements of a saved bazi chart, the four roles as one analysis', () => {
    const proposal = normalizeAgentArchiveProposal({
        kind: 'master_review', strengthLevel: '偏弱', patterns: ['正官格', ' 正官格 '], gods: { yongShen: { basic: ['水'] }, jiShen: { basic: ['火'], advanced: ['丙'] } },
    }, chart);
    const empty = { basic: [], advanced: [] };
    assert.deepEqual(proposal, { kind: 'master_review', chart, review: {
        strengthLevel: '偏弱', patterns: ['正官格'], gods: { yongShen: { basic: ['水'], advanced: [] }, xiShen: empty, jiShen: { basic: ['火'], advanced: ['丙'] }, xianShen: empty },
    } });
    assert.throws(() => normalizeAgentArchiveProposal({ kind: 'master_review', strengthLevel: '偏弱' }, null), /bazi_chart:ID/);
    assert.throws(() => normalizeAgentArchiveProposal({ kind: 'master_review', strengthLevel: '偏弱' }, { ...chart, type: 'ziwei_chart' }), /bazi_chart:ID/);
    assert.throws(() => normalizeAgentArchiveProposal({ kind: 'master_review', strengthLevel: '强' }, chart), /strengthLevel 只能是/);
    assert.throws(() => normalizeAgentArchiveProposal({ kind: 'master_review', strengthLevel: '偏弱', title: '判断' }, chart), /不接受 title/);
    assert.throws(() => normalizeAgentArchiveProposal({ kind: 'master_review', gods: { yongShen: { basic: ['水'] }, jiShen: { basic: ['水'] } } }, chart), /同一五行不能同时属于两种喜忌/);
    assert.throws(() => normalizeAgentArchiveProposal({ kind: 'master_review', gods: { yongShen: { advanced: ['甲木乙'] } } }, chart), /包含未收录的值：甲木乙/);
    assert.throws(() => normalizeAgentArchiveProposal({ kind: 'master_review', patterns: [' '], gods: {} }, chart), /至少给出/);

    const review = (proposal as Extract<AgentArchiveProposal, { kind: 'master_review' }>).review;
    assert.deepEqual(describeMasterReviewFill(review), ['旺衰：偏弱', '格局：正官格', '用神：水', '忌神：火（进阶：丙）']);
    assert.deepEqual(describeMasterReviewFill({ gods: { ...review.gods!, yongShen: { basic: [], advanced: ['壬'] } } }), ['用神：进阶：壬', '忌神：火（进阶：丙）']);
    const blank = createEmptyBaziCaseMasterReview();
    assert.deepEqual(fillableMasterReviewItems(blank, review), ['strengthLevel', 'patterns', 'gods']);
    const theirs = { ...blank, strengthLevel: '中和' as const, xianShen: { basic: ['土' as const], advanced: [] } };
    assert.deepEqual(fillableMasterReviewItems(theirs, review), ['patterns'], 'the user\'s 旺衰 stays, and one filled role keeps all four');
    assert.deepEqual(pickMasterReviewFill(review, ['patterns']), { patterns: ['正官格'] });
    assert.deepEqual(fillableMasterReviewItems({ ...theirs, patterns: ['七杀格'] }, review), []);
});

test('a saved entry opens its record or its chart\'s case notes, and only completed calls give cards and receipts', () => {
    const id = randomUUID();
    assert.equal(getAgentArchiveHref('record', id, chart), `/records?id=${id}`);
    assert.equal(getAgentArchiveHref('case_event', id, chart), `/bazi/result?chart=${chart.id}&tab=notes`);
    assert.equal(getAgentArchiveHref('master_review', chart.id, chart), `/bazi/result?chart=${chart.id}&tab=notes`);
    assert.equal(getAgentArchiveHref('case_event', id, null), null);

    const proposal = normalizeAgentArchiveProposal({ kind: 'conclusion', title: '明年换岗', content: '官星透出' }, chart, TODAY);
    const output = { runId: 'run-1', callId: 'call-1', proposal };
    const card = (extra: Partial<{ name: string; status: string; output: unknown }>) => getAgentArchiveProposal({ name: 'propose_archive_entry', status: 'completed', output, ...extra });
    assert.deepEqual(card({}), output);
    assert.equal(card({ status: 'running' }), null);
    assert.equal(card({ name: 'record_user_event' }), null);
    assert.equal(card({ output: { ...output, callId: '' } }), null);
    assert.equal(card({ output: { ...output, proposal: { ...proposal, category: 'reflection' } } }), null);
    assert.equal(card({ output: { ...output, proposal: { kind: 'master_review', review: {} } } }), null, 'a master review needs its chart');

    const event = { date: '2024-03-01', category: '事业', title: '换到新公司', detail: '2024年3月离职', chart };
    const receipt = (value: unknown) => getAgentArchiveRecord({ name: 'record_user_event', status: 'completed', output: value });
    assert.deepEqual(receipt({ target: 'case_event', id, event }), { target: 'case_event', id, ...event });
    assert.deepEqual(receipt({ target: 'record', id, event: { ...event, detail: 7, chart: { type: 'unknown', id, label: '未知' } } }), { target: 'record', id, ...event, detail: '', chart: null });
    assert.equal(receipt({ target: 'master_review', id, event }), null);
    assert.equal(receipt({ target: 'record', id, event: { ...event, category: 'general' } }), null);
});

test('one tool call writes one entry, under the ID the database derives from the task and the call', () => {
    // md5('<run>:<call>')::uuid, as agent_archive_entry_id computes it.
    assert.equal(agentArchiveEntryId('4f9c7d0e-8a1b-4c2d-9e3f-5a6b7c8d9e0f', 'call-1'), '82193459-86ff-f65f-ca28-4254fa7a36a0');
    assert.notEqual(agentArchiveEntryId('4f9c7d0e-8a1b-4c2d-9e3f-5a6b7c8d9e0f', 'call-2'), '82193459-86ff-f65f-ca28-4254fa7a36a0');
});

test('a list narrows to the keyword in the source\'s own text and to whole China Standard Time days', () => {
    const db = new Kysely<Pick<DB, 'ming_records'>>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (queryDb) => new PostgresIntrospector(queryDb),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });
    const compiled = (ctx: Parameters<typeof applyListFilters>[1], columns: readonly string[]) => {
        const query = applyListFilters(db.selectFrom('ming_records').select(['id', 'title']), ctx, columns);
        return query ? query.compile() : null;
    };
    const narrowed = compiled({ keyword: '跳槽_50%', since: '2026-01-31', until: '2026-02-28' }, ['title', 'content']);
    assert.match(narrowed!.sql, /ilike/);
    assert.match(narrowed!.sql, /created_at >= \$3/);
    assert.match(narrowed!.sql, /created_at < \$4/);
    assert.deepEqual(narrowed!.parameters, ['%跳槽\\_50\\%%', '%跳槽\\_50\\%%', '2026-01-31T00:00:00+08:00', '2026-03-01T00:00:00+08:00']);
    // A keyword across two columns is one OR; a source with no text of its own lists nothing for one.
    assert.match(compiled({ keyword: '换岗' }, ['title', 'content'])!.sql, /\(.*ilike.* or .*ilike.*\)/);
    assert.equal(compiled({ keyword: '换岗' }, []), null);
    const open = compiled(undefined, ['title']);
    assert.doesNotMatch(open!.sql, /where/);
});

type Row = Record<string, unknown>;
interface ScopedQuery { select(): ScopedQuery; where(column: string, operator: string, value: unknown): ScopedQuery; executeTakeFirst(): Promise<Row | undefined> }

/**
 * The archive endpoints over doubles: the store finds the caller's own task and its cached card; the status reads
 * and the save run under the caller's scoped context, which must name the caller in every read.
 */
function archiveFixture(t: TestContext, proposal: AgentArchiveProposal, toolName = 'propose_archive_entry') {
    const owner = randomUUID(), runId = randomUUID(), callId = 'call-1';
    const state = {
        chartExists: true,
        saved: new Set<string>(),
        profile: undefined as Row | undefined,
        features: {} as Record<string, 'enabled' | 'disabled' | 'unavailable'>,
        rpcError: null as Error | null,
        rpc: [] as Array<[string, Record<string, unknown>]>,
        reads: [] as string[],
    };
    const artifact = { run_id: runId, call_id: callId, tool_name: toolName, kind: 'tool', args: {}, result: { content: [], details: { runId, callId, proposal } } };
    const trx = {
        selectFrom(table: string) {
            const filters: Row = {};
            const query: ScopedQuery = {
                select: () => query,
                where: (column: string, _operator: string, value: unknown) => { filters[column] = value; return query; },
                executeTakeFirst: async () => {
                    assert.equal(filters.user_id, owner, `${table} is read as the caller's own`);
                    state.reads.push(table);
                    if (table === 'bazi_charts') return state.chartExists && filters.id === chart.id ? { id: chart.id } : undefined;
                    if (table === 'bazi_case_profiles') return state.profile;
                    return state.saved.has(`${table}:${filters.id}`) ? { id: filters.id } : undefined;
                },
            };
            return query;
        },
    };
    const entry = agentArchiveEntryId(runId, callId);
    const scoped = createMockScopedDb({
        tx: work => work(trx as never),
        rpc: async (name, args) => {
            state.rpc.push([name, args]);
            if (state.rpcError) throw state.rpcError;
            if (proposal.kind === 'master_review') state.profile = { master_review: { strengthLevel: proposal.review.strengthLevel }, source_run_id: runId };
            else state.saved.add(`${proposal.kind === 'event' && proposal.chart?.type === 'bazi_chart' ? 'bazi_case_events' : 'ming_records'}:${entry}`);
            return {};
        },
    });
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
    const store = require('../lib/agent/store.server') as typeof import('../lib/agent/store.server');
    const contextModule = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
    t.mock.method(api, 'requireUserContext', async () => createMockAuthContext({}, owner, scoped));
    t.mock.method(store.AgentStore.prototype, 'getRun', async (id: string, userId?: string) => (id === runId && userId === owner ? { id: runId, user_id: owner } as never : null));
    t.mock.method(store.AgentStore.prototype, 'artifact', async (_run: unknown, call: string) => (call === callId ? artifact as never : null));
    const originalSystemDb = contextModule.systemDb;
    contextModule.systemDb = (() => scoped) as typeof contextModule.systemDb;
    t.after(() => { contextModule.systemDb = originalSystemDb; });
    t.mock.method(settings, 'readFeatureModuleStateFresh', async (feature: string) => ({ status: state.features[feature] ?? 'enabled' }) as Awaited<ReturnType<typeof settings.readFeatureModuleStateFresh>>);
    const params = (id: string) => ({ params: Promise.resolve({ id }) });
    return {
        state, runId, callId, entry,
        get: async (id: string = runId, call: string | null = callId) => {
            const response = await GET(new NextRequest(`http://localhost/api/agent/runs/${id}/archive${call === null ? '' : `?callId=${encodeURIComponent(call)}`}`), params(id));
            return { status: response.status, body: await response.json() };
        },
        save: async (body: unknown = { callId }, id: string = runId) => {
            const response = await POST(new NextRequest(`http://localhost/api/agent/runs/${id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), params(id));
            return { status: response.status, body: await response.json() };
        },
    };
}

const conclusion = normalizeAgentArchiveProposal({ kind: 'conclusion', category: 'prediction', title: '明年换岗', content: '官星透出', date: '2027-06' }, chart, TODAY);

test('a card is pending until its owner saves it under their own context, and a second save finds the same entry', async t => {
    const f = archiveFixture(t, conclusion);
    assert.deepEqual(await f.get(), { status: 200, body: { state: 'pending' } });
    const saved = { state: 'saved', target: 'record', id: f.entry, href: `/records?id=${f.entry}` };
    assert.deepEqual(await f.save(), { status: 200, body: saved });
    assert.deepEqual(f.state.rpc, [['agent_save_archive_proposal', { p_run_id: f.runId, p_call_id: f.callId }]], 'the entry is the task\'s cached card, never the request\'s');
    assert.deepEqual(await f.save({ callId: f.callId, proposal: { title: '伪造' } }), { status: 200, body: saved });
    assert.deepEqual(await f.get(), { status: 200, body: saved });
    assert.equal(f.state.reads.filter(table => table === 'bazi_charts').length, 4, 'every status read checks the linked chart is still there');
});

test('a card of another task, a call that made no card, or a malformed reference is not found and writes nothing', async t => {
    const f = archiveFixture(t, conclusion);
    assert.equal((await f.get(randomUUID())).body.code, 'AGENT_RUN_NOT_FOUND', 'another user\'s task reads as missing');
    assert.equal((await f.get(randomUUID())).status, 404);
    assert.deepEqual([(await f.get('not-a-uuid')).status, (await f.get(f.runId, null)).status, (await f.get(f.runId, 'x'.repeat(201))).status], [400, 400, 400]);
    assert.deepEqual(await f.save({ callId: 'other-call' }), { status: 404, body: { success: false, error: '保存卡片不存在', code: 'AGENT_ARCHIVE_PROPOSAL_NOT_FOUND' } });
    assert.equal((await f.save({ callId: 7 })).status, 400);
    assert.equal(f.state.rpc.length, 0);

    const memory = archiveFixture(t, conclusion, 'remember_user_fact');
    assert.equal((await memory.save()).body.code, 'AGENT_ARCHIVE_PROPOSAL_NOT_FOUND', 'a result under another tool\'s name is not a card');
    assert.equal(memory.state.rpc.length, 0);
});

test('the feature a card writes to must be on: a conclusion needs records, a case event or master review needs bazi', async t => {
    const f = archiveFixture(t, conclusion);
    f.state.features.records = 'disabled';
    assert.deepEqual(await f.save(), { status: 403, body: { success: false, error: '命理记录功能已关闭', code: 'FEATURE_DISABLED' } });
    f.state.features.records = 'unavailable';
    assert.equal((await f.save()).status, 503);
    assert.equal(f.state.rpc.length, 0);

    const event = archiveFixture(t, normalizeAgentArchiveProposal({ kind: 'event', date: '2024-03', category: '事业', title: '换到新公司' }, chart, TODAY));
    event.state.features.records = 'disabled';
    assert.deepEqual((await event.save()).body, { state: 'saved', target: 'case_event', id: event.entry, href: `/bazi/result?chart=${chart.id}&tab=notes` });
    event.state.features.bazi = 'disabled';
    assert.equal((await event.save()).body.error, '命盘功能已关闭');
});

test('a deleted chart makes its card unavailable, and a save that races the delete says so', async t => {
    const f = archiveFixture(t, conclusion);
    f.state.chartExists = false;
    assert.deepEqual(await f.get(), { status: 200, body: { state: 'unavailable', message: '八字命盘「本人」已删除，无法保存' } });
    f.state.rpcError = new Error('AGENT_ARCHIVE_CHART_NOT_FOUND');
    assert.deepEqual(await f.save(), { status: 409, body: { success: false, error: '关联的资料已删除，无法保存', code: 'AGENT_ARCHIVE_CHART_NOT_FOUND' } });
    f.state.rpcError = new Error('AGENT_ARCHIVE_PROPOSAL_NOT_FOUND');
    assert.equal((await f.save()).body.code, 'AGENT_ARCHIVE_PROPOSAL_NOT_FOUND');
});

test('a master review card is saved once its task filled it, and filled when the user\'s own judgement left nothing', async t => {
    const proposal = normalizeAgentArchiveProposal({ kind: 'master_review', strengthLevel: '偏弱' }, chart);
    const f = archiveFixture(t, proposal);
    const href = `/bazi/result?chart=${chart.id}&tab=notes`;
    assert.deepEqual((await f.get()).body, { state: 'pending' }, 'no case notes yet: everything is blank');
    assert.deepEqual((await f.save()).body, { state: 'saved', target: 'master_review', id: chart.id, href });
    f.state.profile = { master_review: { strengthLevel: '中和' }, source_run_id: null };
    assert.deepEqual((await f.get()).body, { state: 'filled', href });
    f.state.profile = { master_review: { strengthLevel: null }, source_run_id: f.runId };
    assert.deepEqual((await f.get()).body, { state: 'pending' }, 'clearing the item makes the card savable again');
});
