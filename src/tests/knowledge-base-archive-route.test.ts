import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';


type Row = Record<string, unknown>;

function archiveScope(options: {
  archived?: (offset: number, limit: number) => Row[];
  virtual?: (offset: number, limit: number) => Row[];
  ownership?: boolean;
  virtualFilters?: Array<[string, unknown]>;
  archivedCalls?: Array<[number, number]>;
  virtualCalls?: Array<[number, number]>;
}) {
  return createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        let columns: string[] = [];
        let offset = 0;
        let limit = Number.POSITIVE_INFINITY;
        const filters: Array<[string, unknown]> = [];
        const query = {
          select(selection: unknown) {
            columns = Array.isArray(selection) ? selection as string[] : [];
            return query;
          },
          where(column: string, _operator: string, value: unknown) {
            filters.push([column, value]);
            if (table === 'knowledge_entries' && columns.includes('created_at')) {
              options.virtualFilters?.push([column, value]);
            }
            return query;
          },
          orderBy() { return query; },
          offset(value: number) { offset = value; return query; },
          limit(value: number) { limit = value; return query; },
          async execute() {
            if (table === 'archived_sources') {
              options.archivedCalls?.push([offset, offset + limit - 1]);
              return options.archived?.(offset, limit) ?? [];
            }
            if (table === 'knowledge_entries') {
              if (columns.includes('created_at')) {
                options.virtualCalls?.push([offset, offset + limit - 1]);
                return options.virtual?.(offset, limit) ?? [];
              }
              return [{
                source_type: 'chat_message',
                source_id: 'm-1',
                content: 'AI：已归档聊天内容',
              }, {
                source_type: 'chat_message',
                source_id: 'm-2',
                content: 'AI：虚拟聊天内容',
              }];
            }
            return [];
          },
          async executeTakeFirst() {
            if (table === 'knowledge_bases') return options.ownership === false ? undefined : { id: 'kb-1' };
            if (table === 'archived_sources') {
              return { id: 'archive-1', kb_id: 'kb-1', source_type: 'conversation', source_id: 'conv-1' };
            }
            return undefined;
          },
        };
        return query;
      },
    } as never),
  });
}

async function loadArchiveRoute(t: import('node:test').TestContext) {
  const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const featureGate = require('../lib/feature-gate-utils') as typeof import('../lib/feature-gate-utils');
  t.mock.method(featureGate, 'ensureFeatureRouteEnabled', async () => null);
  return { apiUtils };
}

test('knowledge-base archive route should page merged archive rows and virtual chat messages', async (t) => {
  const virtualFilters: Array<[string, unknown]> = [];
  const scoped = archiveScope({
    virtualFilters,
    archived: () => [
      { id: 'archived-chat', kb_id: 'kb-1', source_type: 'chat_message', source_id: 'm-1', created_at: '2026-03-27T03:00:00.000Z' },
      { id: 'archived-record', kb_id: 'kb-1', source_type: 'record', source_id: 'record-1', created_at: '2026-03-27T01:00:00.000Z' },
    ],
    virtual: () => [
      { source_type: 'chat_message', source_id: 'm-1', created_at: '2026-03-27T03:00:00.000Z' },
      { source_type: 'chat_message', source_id: 'm-2', created_at: '2026-03-27T02:00:00.000Z' },
    ],
  });
  const { apiUtils } = await loadArchiveRoute(t);
  t.mock.method(apiUtils, 'requireUserContext', async () => ({ user: { id: 'user-1' }, db: scoped }));
  delete require.cache[require.resolve('../app/api/knowledge-base/archive/route')];
  const routeModule = require('../app/api/knowledge-base/archive/route') as typeof import('../app/api/knowledge-base/archive/route');
  const response = await routeModule.GET(
    new NextRequest('http://localhost/api/knowledge-base/archive?kbId=kb-1&limit=2&offset=0'),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.archivedSources.map((item: { id: string }) => item.id), [
    'archived-chat',
    'chat_message:kb-1:m-2',
  ]);
  assert.equal(payload.archivedSources[0]?.preview, '已归档聊天内容');
  assert.equal(payload.archivedSources[1]?.preview, '虚拟聊天内容');
  assert.equal(payload.pagination.hasMore, true);
  assert.equal(payload.pagination.nextOffset, 2);
  // 虚拟归档只取每个来源的首块，分页偏移按来源而不是按分块计数。
  assert.deepEqual(virtualFilters, [
    ['kb_id', 'kb-1'],
    ['source_type', ['chat_message', 'file']],
    ['chunk_index', 0],
  ]);
});

test('knowledge-base archive route should continue fetching batches for deep offsets', async (t) => {
  const archivedCalls: Array<[number, number]> = [];
  const virtualCalls: Array<[number, number]> = [];
  const scoped = archiveScope({
    archivedCalls,
    virtualCalls,
    archived: (offset, limit) => {
      if (offset === 0) {
        return Array.from({ length: limit }, (_, index) => ({
          id: `archived-${index + 1}`,
          kb_id: 'kb-1',
          source_type: 'record',
          source_id: `record-${index + 1}`,
          created_at: new Date(2026, 2, 27, 12, 0, 0 - (index + 1)).toISOString(),
        }));
      }
      return [{
        id: 'archived-71',
        kb_id: 'kb-1',
        source_type: 'record',
        source_id: 'record-71',
        created_at: new Date(2026, 2, 27, 11, 0, 0).toISOString(),
      }];
    },
    virtual: (offset, limit) => offset === 0
      ? Array.from({ length: limit }, (_, index) => ({
        source_type: 'chat_message',
        source_id: `m-${index + 1}`,
        created_at: new Date(2026, 2, 27, 10, 0, 0 - (index + 1)).toISOString(),
      }))
      : [],
  });
  const { apiUtils } = await loadArchiveRoute(t);
  t.mock.method(apiUtils, 'requireUserContext', async () => ({ user: { id: 'user-1' }, db: scoped }));
  delete require.cache[require.resolve('../app/api/knowledge-base/archive/route')];
  const routeModule = require('../app/api/knowledge-base/archive/route') as typeof import('../app/api/knowledge-base/archive/route');
  const response = await routeModule.GET(
    new NextRequest('http://localhost/api/knowledge-base/archive?kbId=kb-1&limit=20&offset=70'),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.archivedSources.length, 20);
  assert.equal(payload.archivedSources[0]?.source_id, 'record-71');
  assert.ok(archivedCalls.length >= 2);
  assert.ok(virtualCalls.length >= 1);
});

async function loadDeleteRoute(t: import('node:test').TestContext, scoped: unknown, serviceScoped: unknown) {
  const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const contextModule = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  t.mock.method(apiUtils, 'requireUserContext', async () => ({ user: { id: 'user-1' }, db: scoped }));
  t.mock.method(contextModule, 'systemDb', () => serviceScoped);
  delete require.cache[require.resolve('../app/api/knowledge-base/archive/[id]/route')];
  return require('../app/api/knowledge-base/archive/[id]/route') as typeof import('../app/api/knowledge-base/archive/[id]/route');
}

test('knowledge-base archive delete route should return kb/source metadata for client-side sync events', async (t) => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const scoped = archiveScope({});
  const serviceScoped = createMockScopedDb({
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return true;
    },
  });
  const routeModule = await loadDeleteRoute(t, scoped, serviceScoped);
  const response = await routeModule.DELETE(
    new NextRequest('http://localhost/api/knowledge-base/archive/archive-1'),
    { params: Promise.resolve({ id: 'archive-1' }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.kbId, 'kb-1');
  assert.equal(payload.sourceType, 'conversation');
  assert.equal(payload.sourceId, 'conv-1');
  assert.deepEqual(calls, [{
    fn: 'kb_unarchive_source_as_service',
    args: { p_user_id: 'user-1', p_kb_id: 'kb-1', p_source_type: 'conversation', p_source_id: 'conv-1' },
  }]);
});

test('knowledge-base archive DELETE should unarchive through transactional rpc', async (t) => {
  const capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null } = { rpcCall: null };
  const scoped = createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        assert.equal(table, 'knowledge_bases');
        const query = {
          select() { return query; },
          where() { return query; },
          async executeTakeFirst() { return { id: 'kb-1' }; },
        };
        return query;
      },
    } as never),
  });
  const serviceScoped = createMockScopedDb({
    rpc: async (fn, args) => {
      capture.rpcCall = { fn, args };
      return true;
    },
  });
  const routeModule = await loadDeleteRoute(t, scoped, serviceScoped);
  const response = await routeModule.DELETE(new NextRequest('http://localhost/api/knowledge-base/archive/chat_message:kb-1:msg-1', {
    method: 'DELETE',
  }), {
    params: Promise.resolve({ id: 'chat_message:kb-1:msg-1' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(capture.rpcCall?.fn, 'kb_unarchive_source_as_service');
  assert.deepEqual(capture.rpcCall?.args, {
    p_user_id: 'user-1',
    p_kb_id: 'kb-1',
    p_source_type: 'chat_message',
    p_source_id: 'msg-1',
  });
  assert.equal(payload.success, true);
});

test('knowledge-base archive DELETE should use the privileged rpc client instead of auth.db', async (t) => {
  const capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null } = { rpcCall: null };
  const scoped = archiveScope({});
  const serviceScoped = createMockScopedDb({
    rpc: async (fn, args) => {
      capture.rpcCall = { fn, args };
      return true;
    },
  });
  const routeModule = await loadDeleteRoute(t, scoped, serviceScoped);
  const response = await routeModule.DELETE(
    new NextRequest('http://localhost/api/knowledge-base/archive/archive-1', { method: 'DELETE' }),
    { params: Promise.resolve({ id: 'archive-1' }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(capture.rpcCall?.fn, 'kb_unarchive_source_as_service');
  assert.deepEqual(capture.rpcCall?.args, {
    p_user_id: 'user-1',
    p_kb_id: 'kb-1',
    p_source_type: 'conversation',
    p_source_id: 'conv-1',
  });
  assert.equal(payload.success, true);
});

test('knowledge-base archive route should list uploaded files as removable virtual rows', async (t) => {
  const fileName = '命理/笔记:v2.md';
  const scoped = createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        let columns: string[] = [];
        const query = {
          select(selection: unknown) {
            columns = Array.isArray(selection) ? selection as string[] : [];
            return query;
          },
          where() { return query; },
          orderBy() { return query; },
          offset() { return query; },
          limit() { return query; },
          async execute() {
            if (table === 'archived_sources') return [];
            if (table === 'knowledge_entries') {
              if (columns.includes('created_at')) {
                return [{ source_type: 'file', source_id: fileName, created_at: '2026-03-27T03:00:00.000Z' }];
              }
              return [{ source_type: 'file', source_id: fileName, content: '日主甲木生于寅月。\n\n第二段' }];
            }
            return [];
          },
          async executeTakeFirst() {
            if (table === 'knowledge_bases') return { id: 'kb-1' };
            return undefined;
          },
        };
        return query;
      },
    } as never),
  });
  const { apiUtils } = await loadArchiveRoute(t);
  t.mock.method(apiUtils, 'requireUserContext', async () => ({ user: { id: 'user-1' }, db: scoped }));
  delete require.cache[require.resolve('../app/api/knowledge-base/archive/route')];
  const routeModule = require('../app/api/knowledge-base/archive/route') as typeof import('../app/api/knowledge-base/archive/route');
  const response = await routeModule.GET(
    new NextRequest('http://localhost/api/knowledge-base/archive?kbId=kb-1&limit=20&offset=0'),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.archivedSources, [{
    id: `file:kb-1:${fileName}`,
    kb_id: 'kb-1',
    source_type: 'file',
    source_id: fileName,
    created_at: '2026-03-27T03:00:00.000Z',
    preview: '日主甲木生于寅月。',
  }]);
  assert.equal(payload.pagination.hasMore, false);
});

test('knowledge-base archive DELETE should remove an uploaded file whose name contains colons and slashes', async (t) => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const ownerFilters: Array<[string, unknown]> = [];
  const scoped = createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        assert.equal(table, 'knowledge_bases');
        const query = {
          select() { return query; },
          where(column: string, _operator: string, value: unknown) {
            ownerFilters.push([column, value]);
            return query;
          },
          async executeTakeFirst() { return { id: 'kb-1' }; },
        };
        return query;
      },
    } as never),
  });
  const serviceScoped = createMockScopedDb({
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      return true;
    },
  });
  const routeModule = await loadDeleteRoute(t, scoped, serviceScoped);
  const id = 'file:kb-1:命理/笔记:v2.md';
  const response = await routeModule.DELETE(
    new NextRequest(`http://localhost/api/knowledge-base/archive/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.deepEqual(rpcCalls, [{
    fn: 'kb_unarchive_source_as_service',
    args: { p_user_id: 'user-1', p_kb_id: 'kb-1', p_source_type: 'file', p_source_id: '命理/笔记:v2.md' },
  }]);
  assert.ok(ownerFilters.some(([column, value]) => column === 'user_id' && value === 'user-1'));
});
