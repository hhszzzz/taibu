import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery, type DatabaseConnection } from 'kysely';
import type { DB } from '../lib/db/generated/schema';
import type { ScopedDb, TxOptions } from '../lib/db/context.server';
import { createMockAuthContext } from './helpers/auth-mock';

test('records list compiles an owner-scoped any-tag filter and counts within the same snapshot', async t => {
    const statements: CompiledQuery[] = [];
    const rows = [{ id: 'record-a', tags: ['甲'] }, { id: 'record-b', tags: ['乙'] }];
    const connection: DatabaseConnection = {
        async executeQuery<R>(query: CompiledQuery) {
            statements.push(query);
            return { rows: (query.sql.includes('count(*)') ? [{ count: '2' }] : rows) as R[] };
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
    const options: Array<TxOptions | undefined> = [];
    const scoped: ScopedDb = {
        scope: { kind: 'user', userId: 'user-1' },
        tx: async (work, config) => {
            options.push(config);
            return db.transaction().execute(work);
        },
        rpc: async () => { throw new Error('unexpected rpc'); },
    };
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const auth = t.mock.method(api, 'requireUserContext', async () => createMockAuthContext('user-1', scoped));
    const { GET } = require('../app/api/records/route') as typeof import('../app/api/records/route');
    const request = (query = '') => new NextRequest(`http://localhost/api/records${query}`);
    const response = await GET(request('?tag=甲&tag=乙&page=2&pageSize=2'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { records: rows, total: 2 });
    assert.deepEqual(options, [{ isolationLevel: 'repeatable read' }]);
    assert.equal(statements.length, 2);
    for (const statement of statements) {
        assert.match(statement.sql, /"user_id" = \$1 and "tags" && \$2/u);
        assert.deepEqual(statement.parameters.slice(0, 2), ['user-1', ['甲', '乙']]);
    }
    assert.deepEqual(statements[0]?.parameters.slice(2), [2, 2]);
    assert.doesNotMatch(statements[1]!.sql, /limit|offset/u);

    // 搜索同时匹配标签；sort=date 按记录所在日期（事件日期，没有就用写入时间）排序，置顶仍在最前。
    statements.length = 0;
    const searchResponse = await GET(request('?search=甲&sort=date&pageSize=5'));
    assert.equal(searchResponse.status, 200);
    assert.equal(statements.length, 2);
    const listSql = statements[0]!.sql;
    assert.match(listSql, /array_to_string\("tags"/u);
    assert.ok(statements[0]!.parameters.includes('%甲%'), 'the search pattern also feeds the tag match');
    assert.match(listSql, /order by "is_pinned" desc, coalesce\("event_date", "created_at"\) desc/u);
    assert.equal(options.length, 2);

    assert.equal((await GET(request('?page=0'))).status, 400);
    assert.equal(options.length, 2, 'invalid pagination must not query the database');
    assert.equal((await GET(request('?sort=wrong'))).status, 400);
    assert.equal(options.length, 2, 'an unknown sort must not query the database');
    auth.mock.mockImplementation(async () => ({ error: { message: '请先登录', status: 401 } }));
    assert.equal((await GET(request())).status, 401);
    assert.equal(options.length, 2, 'an unauthenticated request must not query the database');
});
