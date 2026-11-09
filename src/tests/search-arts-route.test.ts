import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery, type DatabaseConnection } from 'kysely';
import type { DB } from '../lib/db/generated/schema';
import type { DataSourceType } from '../lib/data-sources/types';
import { createMockAuthContext } from './helpers/auth-mock';
import { createMockScopedDb } from './helpers/db-mock';

type Row = Record<string, unknown> & { id: string; user_id: string; created_at: string };

function fixture(t: TestContext, userId: string, tables: Record<string, Row[]> = {}) {
    const statements: CompiledQuery[] = [];
    const failedTables = new Set<string>();
    const connection: DatabaseConnection = {
        async executeQuery<R>(query: CompiledQuery) {
            statements.push(query);
            const table = /from "([^"]+)"/u.exec(query.sql)?.[1] ?? '';
            if (failedTables.has(table)) throw new Error('source unavailable');
            const parameter = (pattern: RegExp) => {
                const index = pattern.exec(query.sql)?.[1];
                return index ? query.parameters[Number(index) - 1] : undefined;
            };
            const since = parameter(/created_at >= \$(\d+)/u);
            const until = parameter(/created_at < \$(\d+)/u);
            const rows = (tables[table] ?? [])
                .filter(row => row.user_id === query.parameters[0]
                    && (!since || Date.parse(row.created_at) >= Date.parse(String(since)))
                    && (!until || Date.parse(row.created_at) < Date.parse(String(until))))
                .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
            const offset = Number(parameter(/offset \$(\d+)/u) ?? 0);
            const limit = Number(parameter(/limit \$(\d+)/u) ?? rows.length);
            return { rows: rows.slice(offset, offset + limit) as R[] };
        },
        async *streamQuery<R>() { yield { rows: [] as R[] }; },
    };
    const driver = new DummyDriver();
    t.mock.method(driver, 'acquireConnection', async () => connection);
    const db = new Kysely<DB>({ dialect: {
        createAdapter: () => new PostgresAdapter(), createDriver: () => driver,
        createIntrospector: queryDb => new PostgresIntrospector(queryDb),
        createQueryCompiler: () => new PostgresQueryCompiler(),
    } });
    t.after(() => db.destroy());
    const scoped = createMockScopedDb({ scope: { kind: 'user', userId }, tx: work => work(db as never) });
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
    const auth = t.mock.method(api, 'requireUserContext', async () => createMockAuthContext(userId, scoped));
    const toggles = t.mock.method(settings, 'getFeatureToggles', async () => ({}));
    const { GET } = require('../app/api/search/arts/route') as typeof import('../app/api/search/arts/route');
    return {
        statements, failedTables, scoped, auth, toggles,
        request: (query = '') => GET(new NextRequest(`http://localhost/api/search/arts?${query}`)),
    };
}

function savedRow(userId: string, index: number, fields: Record<string, unknown> = {}): Row {
    return {
        id: `saved-${String(index).padStart(4, '0')}`, user_id: userId,
        created_at: new Date(Date.UTC(2026, 10, 1) - index * 1000).toISOString(), ...fields,
    };
}

test('saved reading search finds name and preview matches beyond the latest 100 rows', async t => {
    const userId = 'search-old-summaries';
    const bazi = Array.from({ length: 205 }, (_, index) => savedRow(userId, index, {
        name: index === 101 ? '旧档案' : '普通命盘', birth_date: index === 201 ? '1986-01-01' : '1990-01-01',
    }));
    const f = fixture(t, userId, { bazi_charts: [
        ...bazi, savedRow('another-user', 0, { name: '旧档案', birth_date: '1986-01-01' }),
    ] });
    const old = await f.request('q=旧档案&since=2026-10-01&until=2026-11-30');
    assert.equal(old.status, 200);
    assert.deepEqual((await old.json()).items.map((item: { id: string }) => item.id), ['saved-0101']);
    const pages = f.statements.filter(statement => statement.sql.includes('from "bazi_charts"'));
    assert.equal(pages.length, 3);
    for (const page of pages) {
        assert.match(page.sql, /where "user_id" = \$1 and created_at >= \$2 and created_at < \$3/u);
        assert.match(page.sql, /order by "created_at" desc, "id" desc/u);
        assert.deepEqual(page.parameters.slice(0, 3), [userId, '2026-10-01T00:00:00+08:00', '2026-12-01T00:00:00+08:00']);
    }
    assert.deepEqual(pages.map(page => page.parameters.at(-1)), [100, 100, 200]);
    const preview = await f.request('q=1986-01-01');
    assert.deepEqual((await preview.json()).items.map((item: { id: string }) => item.id), ['saved-0201']);
});

test('saved reading search matches derived hexagram names and stops after enough matching readings', async t => {
    const userId = 'search-hexagram';
    const rows = Array.from({ length: 205 }, (_, index) => savedRow(userId, index, {
        question: null, hexagram_code: index === 150 ? '111111' : '000000', changed_hexagram_code: null,
    }));
    const f = fixture(t, userId, { liuyao_divinations: rows });
    const response = await f.request('q=乾为天');
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.items.map((item: { id: string; name: string }) => [item.id, item.name]), [['saved-0150', '乾为天']]);

    const before = f.statements.length;
    const byArt = await f.request('q=六爻');
    assert.equal((await byArt.json()).items.length, 60);
    assert.equal(f.statements.slice(before).filter(statement => statement.sql.includes('from "liuyao_divinations"')).length, 1);
});

test('every saved-reading provider supports stable pagination, including records with equal save times', async t => {
    const userId = 'search-provider-pages';
    const cases: Array<[DataSourceType, string]> = [
        ['bazi_chart', 'bazi_charts'], ['ziwei_chart', 'ziwei_charts'], ['tarot_reading', 'tarot_readings'],
        ['liuyao_divination', 'liuyao_divinations'], ['mbti_reading', 'mbti_readings'], ['hepan_chart', 'hepan_charts'],
        ['face_reading', 'face_readings'], ['palm_reading', 'palm_readings'], ['qimen_chart', 'qimen_charts'],
        ['daliuren_divination', 'daliuren_divinations'], ['meihua_divination', 'meihua_divinations'], ['xiaoliuren_divination', 'xiaoliuren_divinations'],
        ['ming_record', 'ming_records'],
    ];
    const rows = [0, 1, 2].map(index => savedRow(userId, index, {
        created_at: '2026-11-01T00:00:00.000Z', name: '命盘', birth_date: '1990-01-01', spread_id: 'single',
        hexagram_code: '111111', changed_hexagram_code: null, mbti_type: 'INTJ', type: 'love',
        person1_name: '甲', person2_name: '乙', compatibility_score: 80, analysis_type: null, hand_type: null,
        dun_type: 'yang', ju_number: 1, question: '问题', day_ganzhi: '甲子', title: '命理记录', content: '资料',
    }));
    const f = fixture(t, userId, Object.fromEntries(cases.map(([, table]) => [table, rows])));
    const { getProvider } = await import('../lib/data-sources');
    for (const [type] of cases) {
        const provider = await getProvider(type);
        const page = await provider.list(userId, { db: f.scoped, offset: 1, limit: 1 });
        assert.deepEqual(page.map(item => item.id), ['saved-0001'], type);
    }
    assert.equal(f.statements.length, cases.length);
    for (const statement of f.statements) {
        assert.match(statement.sql, /where "user_id" = \$1 order by "created_at" desc, "id" desc limit \$2 offset \$3/u);
        assert.deepEqual(statement.parameters, [userId, 1, 1]);
    }
});

test('saved reading search keeps partial failures separate and skips disabled art providers', async t => {
    const userId = 'search-partial-failure';
    const f = fixture(t, userId, { bazi_charts: [savedRow(userId, 0, { name: '可用档案', birth_date: '1990-01-01' })] });
    f.failedTables.add('liuyao_divinations');
    const response = await f.request('q=可用档案');
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.items.length, 1);
    assert.deepEqual(payload.errors, [{ type: 'liuyao_divination', message: 'source unavailable' }]);
    f.toggles.mock.mockImplementation(async () => ({ liuyao: true }));
    const before = f.statements.length;
    const disabled = await f.request('q=可用档案');
    assert.deepEqual((await disabled.json()).errors, []);
    assert.ok(f.statements.slice(before).every(statement => !statement.sql.includes('from "liuyao_divinations"')));
});

test('saved reading search rejects invalid filters and anonymous requests before reading records', async t => {
    const f = fixture(t, 'search-invalid-input');
    for (const query of ['since=2026-02-30', 'until=invalid', 'since=2026-11-02&until=2026-11-01', `q=${'字'.repeat(201)}`]) {
        assert.equal((await f.request(query)).status, 400);
    }
    f.auth.mock.mockImplementation(async () => ({ error: { message: '请先登录', status: 401 } }));
    assert.equal((await f.request('q=八字')).status, 401);
    assert.equal(f.statements.length, 0);
});
