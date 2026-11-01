import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';
import { NextRequest } from 'next/server';
import { createMockAuthContext } from './helpers/auth-mock';
import { mockAIRateLimit, mockAIFeatureState } from './helpers/route-mock';


test('knowledge-base POST should create through transactional rpc', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const featureGateModule = require('../lib/feature-gate-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalEnsureFeatureRouteEnabled = featureGateModule.ensureFeatureRouteEnabled;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  const scoped = createMockScopedDb({
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      return {
        status: 'ok',
        knowledge_base: { id: 'kb-1', name: 'My KB' },
      };
    },
  });
  apiUtilsModule.requireUserContext = async () => ({ user: { id: 'user-1' }, db: scoped });
  featureGateModule.ensureFeatureRouteEnabled = async () => null;
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    featureGateModule.ensureFeatureRouteEnabled = originalEnsureFeatureRouteEnabled;
    delete require.cache[routePath];
  });

  const { POST } = await import('../app/api/knowledge-base/route');
  const response = await POST(new NextRequest('http://localhost/api/knowledge-base', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'My KB',
      description: 'test',
      weight: 'high',
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.id, 'kb-1');
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'create_knowledge_base_with_limit');
  assert.deepEqual(rpcCall.args, {
    p_user_id: 'user-1',
    p_name: 'My KB',
    p_description: 'test',
    p_weight: 'high',
    p_limit: 10,
  });
});

test('knowledge-base POST should return 403 when transactional limit is reached', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const featureGateModule = require('../lib/feature-gate-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalEnsureFeatureRouteEnabled = featureGateModule.ensureFeatureRouteEnabled;

  const scoped = createMockScopedDb({ rpc: async () => ({ status: 'limit_reached' }) });
  apiUtilsModule.requireUserContext = async () => ({ user: { id: 'user-1' }, db: scoped });
  featureGateModule.ensureFeatureRouteEnabled = async () => null;
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    featureGateModule.ensureFeatureRouteEnabled = originalEnsureFeatureRouteEnabled;
    delete require.cache[routePath];
  });

  const { POST } = await import('../app/api/knowledge-base/route');
  const response = await POST(new NextRequest('http://localhost/api/knowledge-base', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'My KB' }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error, '知识库数量已达上限');
});

test('community votes POST should toggle vote through transactional rpc', async (t) => {
  mockAIFeatureState(t);
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/community/votes/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: createMockScopedDb({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { status: 'ok', vote: 'down' };
      },
    }),
  });
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  const { POST } = await import('../app/api/community/votes/route');
  const response = await POST(new NextRequest('http://localhost/api/community/votes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetType: 'post',
      targetId: '11111111-1111-1111-1111-111111111111',
      voteType: 'down',
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.vote, 'down');
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'toggle_community_vote');
  assert.deepEqual(rpcCall.args, {
    p_target_type: 'post',
    p_target_id: '11111111-1111-1111-1111-111111111111',
    p_vote_type: 'down',
  });
});

test('records PUT togglePin should use transactional rpc', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/records/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: createMockScopedDb({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return {
          status: 'ok',
          record: { id: 'record-1', is_pinned: true },
        };
      },
    }),
  });
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  const { PUT } = await import('../app/api/records/[id]/route');
  const response = await PUT(new NextRequest('http://localhost/api/records/record-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ togglePin: true }),
  }), {
    params: Promise.resolve({ id: 'record-1' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.id, 'record-1');
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'toggle_ming_record_pin');
  assert.deepEqual(rpcCall.args, {
    p_record_id: 'record-1',
  });
});

test('records PUT togglePin should return 404 when transactional rpc reports not found', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/records/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: createMockScopedDb({
      rpc: async () => ({ status: 'not_found' }),
    }),
  });
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  const { PUT } = await import('../app/api/records/[id]/route');
  const response = await PUT(new NextRequest('http://localhost/api/records/missing', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ togglePin: true }),
  }), {
    params: Promise.resolve({ id: 'missing' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error, '记录不存在');
});

test('records DELETE should return 404 when no user-owned row is deleted', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/records/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: createMockScopedDb({
      tx: async (work) => work({
        deleteFrom() {
          const query = {
            where() { return query; },
            returning() { return query; },
            async execute() { return []; },
          };
          return query;
        },
      } as never),
    }),
  });
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  const { DELETE } = await import('../app/api/records/[id]/route');
  const response = await DELETE(new NextRequest('http://localhost/api/records/missing', {
    method: 'DELETE',
  }), {
    params: Promise.resolve({ id: 'missing' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error, '记录不存在');
});

test('knowledge-base DELETE should return 404 when no user-owned row is deleted', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const featureGateModule = require('../lib/feature-gate-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const contextModule = require('../lib/db/context.server') as any;
  const originalSystemDb = contextModule.systemDb;
  const originalEnsureFeatureRouteEnabled = featureGateModule.ensureFeatureRouteEnabled;

  const scoped = createMockScopedDb({
    tx: async (work) => work({
      deleteFrom() {
        const query = {
          where() { return query; },
          returning() { return query; },
          async execute() { return []; },
        };
        return query;
      },
    } as never),
  });
  featureGateModule.ensureFeatureRouteEnabled = async () => null;
  apiUtilsModule.requireUserContext = async () => ({ user: { id: 'user-1' }, db: scoped });
  contextModule.systemDb = () => {
    throw new Error('knowledge-base DELETE must use the caller database context');
  };
  delete require.cache[routePath];

  t.after(() => {
    featureGateModule.ensureFeatureRouteEnabled = originalEnsureFeatureRouteEnabled;
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    contextModule.systemDb = originalSystemDb;
    delete require.cache[routePath];
  });

  const { DELETE } = await import('../app/api/knowledge-base/[id]/route');
  const response = await DELETE(new NextRequest('http://localhost/api/knowledge-base/missing', {
    method: 'DELETE',
  }), {
    params: Promise.resolve({ id: 'missing' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error, '知识库不存在');
});

test('knowledge-base id routes fail closed instead of falling back to the system-admin client', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const featureGateModule = require('../lib/feature-gate-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const contextModule = require('../lib/db/context.server') as any;
  const originalSystemDb = contextModule.systemDb;
  const originalEnsureFeatureRouteEnabled = featureGateModule.ensureFeatureRouteEnabled;

  featureGateModule.ensureFeatureRouteEnabled = async () => null;
  // 用户态缺少可用的数据库客户端（例如 token 交换失败），路由必须直接失败。
  apiUtilsModule.requireUserContext = async () => ({ user: { id: 'user-1' }, db: undefined });
  contextModule.systemDb = () => {
    throw new Error('a missing caller context must never reach the system database');
  };
  delete require.cache[routePath];

  t.after(() => {
    featureGateModule.ensureFeatureRouteEnabled = originalEnsureFeatureRouteEnabled;
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    contextModule.systemDb = originalSystemDb;
    delete require.cache[routePath];
  });

  const { GET, PATCH, DELETE } = await import('../app/api/knowledge-base/[id]/route');
  const context = { params: Promise.resolve({ id: 'kb-1' }) };
  const responses = [
    await GET(new NextRequest('http://localhost/api/knowledge-base/kb-1'), context),
    await PATCH(new NextRequest('http://localhost/api/knowledge-base/kb-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '命理笔记' }),
    }), context),
    await DELETE(new NextRequest('http://localhost/api/knowledge-base/kb-1', { method: 'DELETE' }), context),
  ];

  assert.deepEqual(responses.map(response => response.status), [500, 500, 500]);
  assert.deepEqual(
    await Promise.all(responses.map(async response => (await response.json()).error)),
    ['获取知识库失败', '更新知识库失败', '删除知识库失败'],
  );
});

test('community reports POST should submit and notify via transactional rpc', async (t) => {
  mockAIFeatureState(t);
  mockAIRateLimit(t);
  const apiUtils = require('../lib/api-utils') as {
    requireUserContext: typeof import('../lib/api-utils').requireUserContext;
  };
  const originalRequireUserContext = apiUtils.requireUserContext;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtils.requireUserContext = (async () => ({
    user: { id: 'user-1' },
    db: createMockScopedDb({
      rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push({ fn, args });
        return Promise.resolve({
          status: 'ok',
          report: {
            id: 'report-1',
            reporter_id: 'user-1',
            target_type: 'comment',
            target_id: 'c0000000-0000-4000-8000-000000000001',
            reason: 'spam',
          },
        });
      },
    }),
  })) as unknown as typeof apiUtils.requireUserContext;

  t.after(() => {
    apiUtils.requireUserContext = originalRequireUserContext;
  });

  const { POST } = await import('../app/api/community/reports/route');
  const response = await POST(new NextRequest('http://localhost/api/community/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetType: 'comment',
      targetId: 'c0000000-0000-4000-8000-000000000001',
      reason: 'spam',
      description: 'bad content',
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'submit_community_report_and_notify');
  assert.deepEqual(rpcCall.args, {
    p_target_type: 'comment',
    p_target_id: 'c0000000-0000-4000-8000-000000000001',
    p_reason: 'spam',
    p_description: 'bad content',
  });
  assert.equal(payload.id, 'report-1');
  assert.equal(payload.reporter_id, 'user-1');
});

test('community reports POST should return 500 when transactional rpc fails', async (t) => {
  mockAIFeatureState(t);
  mockAIRateLimit(t);
  const apiUtils = require('../lib/api-utils') as {
    requireUserContext: typeof import('../lib/api-utils').requireUserContext;
  };
  const originalRequireUserContext = apiUtils.requireUserContext;

  apiUtils.requireUserContext = (async () => ({
    user: { id: 'user-1' },
    db: createMockScopedDb({
      rpc() {
        throw new Error('transaction failed');
      },
    }),
  })) as unknown as typeof apiUtils.requireUserContext;

  t.after(() => {
    apiUtils.requireUserContext = originalRequireUserContext;
  });

  const { POST } = await import('../app/api/community/reports/route');
  const response = await POST(new NextRequest('http://localhost/api/community/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetType: 'post',
      targetId: 'c0000000-0000-4000-8000-000000000002',
      reason: 'spam',
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, '提交举报失败');
});

test('records import POST should call transactional RPC and return imported counts', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  let rpcArgs: Record<string, unknown> | null = null;

  apiUtilsModule.requireUserContext = async () => ({
    db: createMockScopedDb({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        assert.equal(fn, 'import_ming_records_and_notes');
        rpcArgs = args;
        return {
          recordsImported: 2,
          notesImported: 1,
        };
      },
    }),
    user: { id: 'user-1' },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
  });

  const payload = {
    version: '1.0.0',
    records: [
      { title: '记录 1', content: '内容 1' },
      { title: '记录 2', content: '内容 2' },
    ],
    notes: [
      { content: '小记 1' },
    ],
  };

  const { POST } = await import('../app/api/records/import/route');
  const response = await POST(new NextRequest('http://localhost/api/records/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(rpcArgs, {
    p_records: payload.records,
    p_notes: payload.notes,
  });
  assert.equal(body.recordsImported, 2);
  assert.equal(body.notesImported, 1);
});

test('records import POST should return 500 when transactional RPC fails', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    db: createMockScopedDb({
      rpc: async () => {
        throw new Error('transaction failed');
      },
    }),
    user: { id: 'user-1' },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
  });

  const { POST } = await import('../app/api/records/import/route');
  const response = await POST(new NextRequest('http://localhost/api/records/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: '1.0.0',
      records: [{ title: '记录 1' }],
      notes: [],
    }),
  }));
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.error, '导入数据失败');
});

test('checkRateLimit should fail closed when Redis is unavailable', async (t) => {
  const redis = require('../lib/rate-limit-redis') as typeof import('../lib/rate-limit-redis');
  t.mock.method(redis, 'consumeRedisRateLimit', async () => { throw new Error('redis down'); });
  t.mock.method(console, 'error', () => {});

  const { checkRateLimit } = await import('../lib/rate-limit');
  const result = await checkRateLimit('127.0.0.1', '/api/chat/direct/prepare', {
    maxRequests: 10,
    windowMs: 60_000,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.remaining, 0);
});

test('mbti save should persist through shared save helper and return reading id', async (t) => {
  mockAIRateLimit(t, async () => assert.fail('save must not consume a rate slot'));
  const apiUtilsModule = require('../lib/api-utils') as any;
  const contextModule = require('../lib/db/context.server') as any;
  const routePath = require.resolve('../app/api/mbti/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalSystemDb = contextModule.systemDb;

  let insertedPayload: Record<string, unknown> | null = null;

  contextModule.systemDb = () => assert.fail('save must use the caller DB client');
  apiUtilsModule.requireUserContext = async () => createMockAuthContext('user-1', createMockScopedDb({
    tx: async (work) => work({
      insertInto(table: string) {
        assert.equal(table, 'mbti_readings');
        return {
          values(payload: Record<string, unknown>) {
            insertedPayload = payload;
            return {
              returning() {
                return { executeTakeFirst: async () => ({ id: 'reading-1' }) };
              },
            };
          },
        };
      },
    } as never),
  }));
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    contextModule.systemDb = originalSystemDb;
    delete require.cache[routePath];
  });

  const { POST } = await import('../app/api/mbti/route');
  const response = await POST(new NextRequest('http://localhost/api/mbti', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'save',
      type: 'INTJ',
      scores: { E: 1, I: 2, S: 3, N: 4, T: 5, F: 6, J: 7, P: 8 },
      percentages: {
        EI: { E: 40, I: 60 },
        SN: { S: 45, N: 55 },
        TF: { T: 52, F: 48 },
        JP: { J: 51, P: 49 },
      },
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.readingId, 'reading-1');
  assert.deepEqual(insertedPayload, {
    user_id: 'user-1',
    mbti_type: 'INTJ',
    scores: { E: 1, I: 2, S: 3, N: 4, T: 5, F: 6, J: 7, P: 8 },
    percentages: {
      EI: { E: 40, I: 60 },
      SN: { S: 45, N: 55 },
      TF: { T: 52, F: 48 },
      JP: { J: 51, P: 49 },
    },
  });
});

test('daliuren save should persist through shared save helper and return divination id', async (t) => {
  mockAIRateLimit(t, async () => assert.fail('save must not consume a rate slot'));
  const apiUtilsModule = require('../lib/api-utils') as any;
  const contextModule = require('../lib/db/context.server') as any;
  const routePath = require.resolve('../app/api/daliuren/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalSystemDb = contextModule.systemDb;
  const { calculateDaliuren } = await import('taibu-core');

  const insertedPayloads: Record<string, unknown>[] = [];

  contextModule.systemDb = () => assert.fail('save must use the caller DB client');
  apiUtilsModule.requireUserContext = async () => createMockAuthContext('user-1', createMockScopedDb({
    tx: async (work) => work({
      insertInto(table: string) {
        assert.equal(table, 'daliuren_divinations');
        return {
          values(payload: Record<string, unknown>) {
            insertedPayloads.push(payload);
            return {
              returning() {
                return { executeTakeFirst: async () => ({ id: 'divination-1' }) };
              },
            };
          },
        };
      },
    } as never),
  }));
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    contextModule.systemDb = originalSystemDb;
    delete require.cache[routePath];
  });

  const resultData = calculateDaliuren({
    date: '2025-01-15',
    hour: 10,
    minute: 30,
    timezone: 'Asia/Shanghai',
    question: '测试问题',
  });

  const { POST } = await import('../app/api/daliuren/route');
  const response = await POST(new NextRequest('http://localhost/api/daliuren', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'save',
      date: '2025-01-15',
      hour: 10,
      minute: 30,
      timezone: 'Asia/Shanghai',
      question: '测试问题',
      resultData,
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.divinationId, 'divination-1');
  assert.equal(insertedPayloads.length, 1);
  const [insertedPayload] = insertedPayloads;
  assert.ok(insertedPayload);
  assert.equal(insertedPayload.user_id, 'user-1');
  assert.equal(insertedPayload.question, '测试问题');
  assert.equal(insertedPayload.solar_date, '2025-01-15');
  assert.deepEqual(insertedPayload.settings, {
    hour: 10,
    minute: 30,
    timezone: 'Asia/Shanghai',
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(insertedPayload.result_data)),
    JSON.parse(JSON.stringify(resultData)),
  );
});
