import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockAuthContext } from './helpers/supabase-mock';
import { mockAIRateLimit } from './helpers/route-mock';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

test('knowledge-base POST should create through transactional rpc', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const membershipModule = require('../lib/user/membership-server') as any;
  const featureGateModule = require('../lib/feature-gate-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetEffectiveMembershipType = membershipModule.getEffectiveMembershipType;
  const originalEnsureFeatureRouteEnabled = featureGateModule.ensureFeatureRouteEnabled;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return {
          data: {
            status: 'ok',
            knowledge_base: { id: 'kb-1', name: 'My KB' },
          },
          error: null,
        };
      },
    },
  });
  membershipModule.getEffectiveMembershipType = async () => 'plus';
  featureGateModule.ensureFeatureRouteEnabled = async () => null;
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    membershipModule.getEffectiveMembershipType = originalGetEffectiveMembershipType;
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
    p_limit: 3,
  });
});

test('knowledge-base POST should return 403 when transactional limit is reached', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const membershipModule = require('../lib/user/membership-server') as any;
  const featureGateModule = require('../lib/feature-gate-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetEffectiveMembershipType = membershipModule.getEffectiveMembershipType;
  const originalEnsureFeatureRouteEnabled = featureGateModule.ensureFeatureRouteEnabled;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc: async () => ({ data: { status: 'limit_reached' }, error: null }),
    },
  });
  membershipModule.getEffectiveMembershipType = async () => 'plus';
  featureGateModule.ensureFeatureRouteEnabled = async () => null;
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    membershipModule.getEffectiveMembershipType = originalGetEffectiveMembershipType;
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
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/community/votes/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { data: { status: 'ok', vote: 'down' }, error: null };
      },
    },
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
    supabase: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return {
          data: {
            status: 'ok',
            record: { id: 'record-1', is_pinned: true },
          },
          error: null,
        };
      },
    },
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
    supabase: {
      rpc: async () => ({ data: { status: 'not_found' }, error: null }),
    },
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
    supabase: {
      from: () => ({
        delete: () => ({
          eq: () => ({
            eq: () => ({
              select: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    },
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
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalEnsureFeatureRouteEnabled = featureGateModule.ensureFeatureRouteEnabled;

  featureGateModule.ensureFeatureRouteEnabled = async () => null;
  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {},
  });
  apiUtilsModule.getSystemAdminClient = () => ({
    from: () => ({
      delete: () => ({
        eq: () => ({
          eq: () => ({
            select: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
  });
  delete require.cache[routePath];

  t.after(() => {
    featureGateModule.ensureFeatureRouteEnabled = originalEnsureFeatureRouteEnabled;
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
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

test('community reports POST should submit and notify via transactional rpc', async (t) => {
  const apiUtils = require('../lib/api-utils') as {
    requireUserContext: typeof import('../lib/api-utils').requireUserContext;
  };
  const originalRequireUserContext = apiUtils.requireUserContext;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtils.requireUserContext = (async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push({ fn, args });
        return Promise.resolve({
          data: {
            status: 'ok',
            report: {
              id: 'report-1',
              reporter_id: 'user-1',
              target_type: 'comment',
              target_id: 'comment-1',
              reason: 'spam',
            },
          },
          error: null,
        });
      },
    },
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
      targetId: 'comment-1',
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
    p_target_id: 'comment-1',
    p_reason: 'spam',
    p_description: 'bad content',
  });
  assert.equal(payload.id, 'report-1');
  assert.equal(payload.reporter_id, 'user-1');
});

test('community reports POST should return 500 when transactional rpc fails', async (t) => {
  const apiUtils = require('../lib/api-utils') as {
    requireUserContext: typeof import('../lib/api-utils').requireUserContext;
  };
  const originalRequireUserContext = apiUtils.requireUserContext;

  apiUtils.requireUserContext = (async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        return Promise.resolve({
          data: null,
          error: { message: 'transaction failed' },
        });
      },
    },
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
      targetId: 'post-1',
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
    supabase: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        assert.equal(fn, 'import_ming_records_and_notes');
        rpcArgs = args;
        return {
          data: {
            recordsImported: 2,
            notesImported: 1,
          },
          error: null,
        };
      },
    },
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
    supabase: {
      rpc: async () => ({
        data: null,
        error: { message: 'transaction failed' },
      }),
    },
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

test('performCheckin should use transactional rpc result', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.getSystemAdminClient = () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({
        data: {
          status: 'ok',
          reward_credits: 2,
          credits: 11,
          credit_limit: 20,
        },
        error: null,
      });
    },
  });

  t.after(() => {
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
  });

  const { performCheckin } = require('../lib/user/checkin') as typeof import('../lib/user/checkin');
  const result = await performCheckin('user-1');

  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'perform_daily_checkin_as_service');
  assert.deepEqual(rpcCall.args, { p_user_id: 'user-1' });
  assert.deepEqual(result, {
    success: true,
    rewardCredits: 2,
    credits: 11,
    creditLimit: 20,
  });
});

test('checkin route should return structured status when the user already checked in', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const checkinModule = require('../lib/user/checkin') as any;
  const routePath = require.resolve('../app/api/checkin/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalRequireBearerUser = apiUtilsModule.requireBearerUser;
  const originalPerformCheckin = checkinModule.performCheckin;

  apiUtilsModule.requireUserContext = async () => ({ user: { id: 'user-1' } });
  apiUtilsModule.requireBearerUser = async () => {
    throw new Error('checkin route should not use requireBearerUser');
  };
  checkinModule.performCheckin = async () => ({
    success: false,
    rewardCredits: 0,
    blockedReason: 'already_checked_in',
    error: '今日已签到',
  });
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.requireBearerUser = originalRequireBearerUser;
    checkinModule.performCheckin = originalPerformCheckin;
    delete require.cache[routePath];
  });

  const { POST } = await import('../app/api/checkin/route');
  const response = await POST(new NextRequest('http://localhost/api/checkin', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token',
    },
  }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, '今日已签到');
  assert.equal(payload.data.result.blockedReason, 'already_checked_in');
});

test('checkin route should not forward the user-scoped db client into the service rpc helper', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const checkinModule = require('../lib/user/checkin') as any;
  const routePath = require.resolve('../app/api/checkin/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalPerformCheckin = checkinModule.performCheckin;

  const authDbSentinel = { tag: 'user-db-client' };
  let performCheckinArgs: unknown[] | null = null;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: authDbSentinel,
  });
  checkinModule.performCheckin = async (...args: unknown[]) => {
    performCheckinArgs = args;
    return {
      success: true,
      rewardCredits: 2,
      credits: 11,
      creditLimit: 20,
    };
  };
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    checkinModule.performCheckin = originalPerformCheckin;
    delete require.cache[routePath];
  });

  const { POST } = await import('../app/api/checkin/route');
  const response = await POST(new NextRequest('http://localhost/api/checkin', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token',
    },
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(performCheckinArgs, ['user-1']);
  assert.equal(payload.data.result.rewardCredits, 2);
});

test('checkin route should return structured cap details when credits are full', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const checkinModule = require('../lib/user/checkin') as any;
  const routePath = require.resolve('../app/api/checkin/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalRequireBearerUser = apiUtilsModule.requireBearerUser;
  const originalPerformCheckin = checkinModule.performCheckin;

  apiUtilsModule.requireUserContext = async () => ({ user: { id: 'user-1' } });
  apiUtilsModule.requireBearerUser = async () => {
    throw new Error('checkin route should not use requireBearerUser');
  };
  checkinModule.performCheckin = async () => ({
    success: false,
    rewardCredits: 0,
    blockedReason: 'credit_cap_reached',
    credits: 20,
    creditLimit: 20,
    error: '当前积分已达上限，消耗后再来签到',
  });
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.requireBearerUser = originalRequireBearerUser;
    checkinModule.performCheckin = originalPerformCheckin;
    delete require.cache[routePath];
  });

  const { POST } = await import('../app/api/checkin/route');
  const response = await POST(new NextRequest('http://localhost/api/checkin', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token',
    },
  }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.data.result.blockedReason, 'credit_cap_reached');
  assert.equal(payload.data.result.credits, 20);
  assert.equal(payload.data.result.creditLimit, 20);
});

test('checkin route should return 500 when performCheckin reports a system failure', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const checkinModule = require('../lib/user/checkin') as any;
  const routePath = require.resolve('../app/api/checkin/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalPerformCheckin = checkinModule.performCheckin;

  apiUtilsModule.requireUserContext = async () => ({ user: { id: 'user-1' } });
  checkinModule.performCheckin = async () => ({
    success: false,
    rewardCredits: 0,
    errorType: 'system',
    error: '签到失败，请稍后重试',
  });
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    checkinModule.performCheckin = originalPerformCheckin;
    delete require.cache[routePath];
  });

  const { POST } = await import('../app/api/checkin/route');
  const response = await POST(new NextRequest('http://localhost/api/checkin', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token',
    },
  }));
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, '签到失败，请稍后重试');
});

test('credits transactions GET should use user context and preserve today spend summary', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/credits/transactions/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalRequireBearerUser = apiUtilsModule.requireBearerUser;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      from(table: string) {
        assert.equal(table, 'credit_transactions');
        return {
          select(columns: string) {
            if (columns === 'amount') {
              return {
                eq() {
                  return this;
                },
                lt(column: string) {
                  if (column === 'created_at') {
                    return Promise.resolve({
                      data: [{ amount: -2 }, { amount: -3 }],
                      error: null,
                    });
                  }
                  return this;
                },
                gte() {
                  return this;
                },
              };
            }

            return {
              eq() {
                return this;
              },
              order() {
                return this;
              },
              limit: async () => ({
                data: [
                  {
                    id: 'txn-1',
                    amount: -2,
                    type: 'spend',
                    source: 'ai_usage',
                    description: 'AI 消费',
                    balance_after: 8,
                    reference_type: null,
                    reference_id: null,
                    metadata: null,
                    created_at: '2026-04-11T00:00:00.000Z',
                  },
                ],
                error: null,
              }),
            };
          },
        };
      },
    },
  });
  apiUtilsModule.requireBearerUser = async () => {
    throw new Error('credits transactions route should not use requireBearerUser');
  };
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.requireBearerUser = originalRequireBearerUser;
    delete require.cache[routePath];
  });

  const { GET } = await import('../app/api/credits/transactions/route');
  const response = await GET(new NextRequest('http://localhost/api/credits/transactions?limit=5'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(payload.items), true);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.summary.todaySpent, 5);
});

test('getCheckinStatus should keep the full reward range while the user is still below the cap', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const creditsModule = require('../lib/user/credits') as any;
  const checkinPath = require.resolve('../lib/user/checkin');
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalGetUserCreditInfo = creditsModule.getUserCreditInfo;

  apiUtilsModule.getSystemAdminClient = () => ({
    from(table: string) {
      if (table !== 'daily_checkins') {
        throw new Error(`unexpected table: ${table}`);
      }

      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: null }),
      };
    },
  });
  creditsModule.getUserCreditInfo = async () => ({
    credits: 19,
    membership: 'plus',
    expiresAt: null,
  });

  delete require.cache[checkinPath];

  t.after(() => {
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    creditsModule.getUserCreditInfo = originalGetUserCreditInfo;
    delete require.cache[checkinPath];
  });

  const { getCheckinStatus } = await import('../lib/user/checkin');
  const status = await getCheckinStatus('user-1');

  assert.equal(status.canCheckin, true);
  assert.deepEqual(status.rewardRange, [2, 6]);
  assert.equal(status.blockedReason, null);
});

test('checkRateLimit should use transactional rpc result', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const rateLimitPath = require.resolve('../lib/rate-limit');
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;

  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.getSystemAdminClient = () => ({
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({
        data: {
          allowed: false,
          remaining: 0,
          reset_at: '2026-04-09T00:10:00.000Z',
        },
        error: null,
      });
    },
  });

  delete require.cache[rateLimitPath];
  const { checkRateLimit } = require('../lib/rate-limit') as typeof import('../lib/rate-limit');

  t.after(() => {
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    delete require.cache[rateLimitPath];
  });

  const result = await checkRateLimit('127.0.0.1', '/api/chat/direct/prepare', {
    maxRequests: 10,
    windowMs: 60_000,
  });

  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'consume_rate_limit_slot_as_admin');
  assert.deepEqual(rpcCall.args, {
    p_identifier: '127.0.0.1',
    p_endpoint: '/api/chat/direct/prepare',
    p_max_requests: 10,
    p_window_ms: 60_000,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.remaining, 0);
  assert.equal(result.resetAt.toISOString(), '2026-04-09T00:10:00.000Z');
});

test('checkRateLimit should fail open when transactional rpc errors', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const rateLimitPath = require.resolve('../lib/rate-limit');
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;

  apiUtilsModule.getSystemAdminClient = () => ({
    rpc() {
      return Promise.resolve({
        data: null,
        error: { message: 'rpc failed' },
      });
    },
  });

  delete require.cache[rateLimitPath];
  const { checkRateLimit } = require('../lib/rate-limit') as typeof import('../lib/rate-limit');

  t.after(() => {
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    delete require.cache[rateLimitPath];
  });

  const result = await checkRateLimit('127.0.0.1', '/api/chat/direct/prepare', {
    maxRequests: 10,
    windowMs: 60_000,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 10);
});

test('mbti save should persist through shared save helper and return reading id', async (t) => {
  mockAIRateLimit(t, async () => assert.fail('save must not consume a rate slot'));
  const apiUtilsModule = require('../lib/api-utils') as any;
  const supabaseServerModule = require('../lib/supabase-server') as any;
  const routePath = require.resolve('../app/api/mbti/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetSystemAdminClient = supabaseServerModule.getSystemAdminClient;

  let insertedPayload: Record<string, unknown> | null = null;

  supabaseServerModule.getSystemAdminClient = () => assert.fail('save must use the caller DB client');
  apiUtilsModule.requireUserContext = async () => createMockAuthContext({
    from: (table: string) => {
      assert.equal(table, 'mbti_readings');
      return {
        insert: (payload: Record<string, unknown>) => {
          insertedPayload = payload;
          return {
            select: () => ({
              single: async () => ({
                data: { id: 'reading-1' },
                error: null,
              }),
            }),
          };
        },
      };
    },
  });
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    supabaseServerModule.getSystemAdminClient = originalGetSystemAdminClient;
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
  const supabaseServerModule = require('../lib/supabase-server') as any;
  const routePath = require.resolve('../app/api/daliuren/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetSystemAdminClient = supabaseServerModule.getSystemAdminClient;
  const { calculateDaliuren } = await import('taibu-core');

  const insertedPayloads: Record<string, unknown>[] = [];

  supabaseServerModule.getSystemAdminClient = () => assert.fail('save must use the caller DB client');
  apiUtilsModule.requireUserContext = async () => createMockAuthContext({
    from: (table: string) => {
      assert.equal(table, 'daliuren_divinations');
      return {
        insert: (payload: Record<string, unknown>) => {
          insertedPayloads.push(payload);
          return {
            select: () => ({
              single: async () => ({
                data: { id: 'divination-1' },
                error: null,
              }),
            }),
          };
        },
      };
    },
  });
  delete require.cache[routePath];

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    supabaseServerModule.getSystemAdminClient = originalGetSystemAdminClient;
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
