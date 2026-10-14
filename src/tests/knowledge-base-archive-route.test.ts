import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

test('knowledge-base archive route should page merged archive rows and virtual chat messages', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const featureUtilsModule = require('../lib/feature-gate-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/archive/route');
  const virtualFilters: Array<[string, string, unknown]> = [];

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalJsonError = apiUtilsModule.jsonError;
  const originalEnsureFeatureRouteEnabled = featureUtilsModule.ensureFeatureRouteEnabled;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: apiUtilsModule.getSystemAdminClient(),
    supabase: apiUtilsModule.getSystemAdminClient(),
  });
  featureUtilsModule.ensureFeatureRouteEnabled = async () => null;
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  apiUtilsModule.jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

  apiUtilsModule.getSystemAdminClient = () => ({
    from(table: string) {
      if (table === 'knowledge_bases') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle: async () => ({ data: { id: 'kb-1' }, error: null }),
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'archived_sources') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      order() {
                        return {
                          range: async () => ({
                            data: [
                              {
                                id: 'archived-chat',
                                kb_id: 'kb-1',
                                source_type: 'chat_message',
                                source_id: 'm-1',
                                created_at: '2026-03-27T03:00:00.000Z',
                              },
                              {
                                id: 'archived-record',
                                kb_id: 'kb-1',
                                source_type: 'record',
                                source_id: 'record-1',
                                created_at: '2026-03-27T01:00:00.000Z',
                              },
                            ],
                            error: null,
                          }),
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'knowledge_entries') {
        return {
          select(columns: string) {
            if (columns === 'source_type, source_id, created_at') {
              const query = {
                eq(column: string, value: unknown) {
                  virtualFilters.push(['eq', column, value]);
                  return query;
                },
                in(column: string, values: unknown) {
                  virtualFilters.push(['in', column, values]);
                  return query;
                },
                order() {
                  return query;
                },
                range: async () => ({
                  data: [
                    {
                      source_type: 'chat_message',
                      source_id: 'm-1',
                      created_at: '2026-03-27T03:00:00.000Z',
                    },
                    {
                      source_type: 'chat_message',
                      source_id: 'm-2',
                      created_at: '2026-03-27T02:00:00.000Z',
                    },
                  ],
                  error: null,
                }),
              };
              return query;
            }

            return {
              eq() {
                return {
                  in() {
                    return {
                      in() {
                        return {
                          eq() {
                            return {
                              limit: async () => ({
                                data: [
                                  {
                                    source_type: 'chat_message',
                                    source_id: 'm-1',
                                    content: 'AI：已归档聊天内容',
                                  },
                                  {
                                    source_type: 'chat_message',
                                    source_id: 'm-2',
                                    content: 'AI：虚拟聊天内容',
                                  },
                                ],
                                error: null,
                              }),
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    apiUtilsModule.jsonOk = originalJsonOk;
    apiUtilsModule.jsonError = originalJsonError;
    featureUtilsModule.ensureFeatureRouteEnabled = originalEnsureFeatureRouteEnabled;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
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
    ['eq', 'kb_id', 'kb-1'],
    ['in', 'source_type', ['chat_message', 'file']],
    ['eq', 'chunk_index', 0],
  ]);
});

test('knowledge-base archive route should continue fetching batches for deep offsets', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const featureUtilsModule = require('../lib/feature-gate-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/archive/route');

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalJsonError = apiUtilsModule.jsonError;
  const originalEnsureFeatureRouteEnabled = featureUtilsModule.ensureFeatureRouteEnabled;

  const archivedCalls: Array<[number, number]> = [];
  const virtualCalls: Array<[number, number]> = [];

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: apiUtilsModule.getSystemAdminClient(),
    supabase: apiUtilsModule.getSystemAdminClient(),
  });
  featureUtilsModule.ensureFeatureRouteEnabled = async () => null;
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  apiUtilsModule.jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

  apiUtilsModule.getSystemAdminClient = () => ({
    from(table: string) {
      if (table === 'knowledge_bases') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle: async () => ({ data: { id: 'kb-1' }, error: null }),
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'archived_sources') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      order() {
                        return {
                          range: async (start: number, end: number) => {
                            archivedCalls.push([start, end]);
                            const size = end - start + 1;
                            if (start === 0) {
                              return {
                                data: Array.from({ length: size }, (_, index) => ({
                                  id: `archived-${index + 1}`,
                                  kb_id: 'kb-1',
                                  source_type: 'record',
                                  source_id: `record-${index + 1}`,
                                  created_at: new Date(2026, 2, 27, 12, 0, 0 - (index + 1)).toISOString(),
                                })),
                                error: null,
                              };
                            }

                            return {
                              data: [
                                {
                                  id: 'archived-71',
                                  kb_id: 'kb-1',
                                  source_type: 'record',
                                  source_id: 'record-71',
                                  created_at: new Date(2026, 2, 27, 11, 0, 0).toISOString(),
                                },
                              ],
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'knowledge_entries') {
        return {
          select(columns: string) {
            if (columns === 'source_type, source_id, created_at') {
              const query = {
                eq() {
                  return query;
                },
                in() {
                  return query;
                },
                order() {
                  return query;
                },
                range: async (start: number, end: number) => {
                  virtualCalls.push([start, end]);
                  const size = end - start + 1;
                  if (start === 0) {
                    return {
                      data: Array.from({ length: size }, (_, index) => ({
                        source_type: 'chat_message',
                        source_id: `m-${index + 1}`,
                        created_at: new Date(2026, 2, 27, 10, 0, 0 - (index + 1)).toISOString(),
                      })),
                      error: null,
                    };
                  }

                  return {
                    data: [],
                    error: null,
                  };
                },
              };
              return query;
            }

            return {
              eq() {
                return {
                  in() {
                    return {
                      in() {
                        return {
                          eq() {
                            return {
                              limit: async () => ({
                                data: [
                                  {
                                    source_type: 'record',
                                    source_id: 'record-71',
                                    content: '深分页记录内容',
                                  },
                                ],
                                error: null,
                              }),
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    apiUtilsModule.jsonOk = originalJsonOk;
    apiUtilsModule.jsonError = originalJsonError;
    featureUtilsModule.ensureFeatureRouteEnabled = originalEnsureFeatureRouteEnabled;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
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

test('knowledge-base archive delete route should return kb/source metadata for client-side sync events', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/archive/[id]/route');

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalJsonError = apiUtilsModule.jsonError;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: apiUtilsModule.getSystemAdminClient(),
    supabase: apiUtilsModule.getSystemAdminClient(),
  });
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  apiUtilsModule.jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });
  apiUtilsModule.getSystemAdminClient = () => ({
    from(table: string) {
      if (table !== 'archived_sources') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        id: 'archive-1',
                        kb_id: 'kb-1',
                        source_type: 'conversation',
                        source_id: 'conv-1',
                      },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      assert.equal(fn, 'kb_unarchive_source_as_service');
      assert.deepEqual(args, {
        p_user_id: 'user-1',
        p_kb_id: 'kb-1',
        p_source_type: 'conversation',
        p_source_id: 'conv-1',
      });
      return Promise.resolve({ data: true, error: null });
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    apiUtilsModule.jsonOk = originalJsonOk;
    apiUtilsModule.jsonError = originalJsonError;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/knowledge-base/archive/[id]/route') as typeof import('../app/api/knowledge-base/archive/[id]/route');
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
});

test('knowledge-base archive DELETE should unarchive through transactional rpc', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;

  const capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null } = { rpcCall: null };

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: apiUtilsModule.getSystemAdminClient(),
    supabase: apiUtilsModule.getSystemAdminClient(),
  });
  apiUtilsModule.getSystemAdminClient = () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      capture.rpcCall = { fn, args };
      return Promise.resolve({ data: true, error: null });
    },
    from: (table: string) => {
      if (table === 'knowledge_bases') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'kb-1' }, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
  });

  const { DELETE } = await import('../app/api/knowledge-base/archive/[id]/route');
  const response = await DELETE(new NextRequest('http://localhost/api/knowledge-base/archive/chat_message:kb-1:msg-1', {
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
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/archive/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;

  const capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null } = { rpcCall: null };
  const authDb = {
    from(table: string) {
      if (table !== 'archived_sources') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        id: 'archive-1',
                        kb_id: 'kb-1',
                        source_type: 'conversation',
                        source_id: 'conv-1',
                      },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
      };
    },
    rpc() {
      throw new Error('knowledge-base archive DELETE should not call rpc on auth.db');
    },
  };

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    db: authDb,
    supabase: authDb,
  });
  apiUtilsModule.getSystemAdminClient = () => ({
    rpc(fn: string, args: Record<string, unknown>) {
      capture.rpcCall = { fn, args };
      return Promise.resolve({ data: true, error: null });
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/knowledge-base/archive/[id]/route') as typeof import('../app/api/knowledge-base/archive/[id]/route');
  const response = await routeModule.DELETE(
    new NextRequest('http://localhost/api/knowledge-base/archive/archive-1', {
      method: 'DELETE',
    }),
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
  const apiUtilsModule = require('../lib/api-utils') as any;
  const featureUtilsModule = require('../lib/feature-gate-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/archive/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalJsonError = apiUtilsModule.jsonError;
  const originalEnsureFeatureRouteEnabled = featureUtilsModule.ensureFeatureRouteEnabled;
  const fileName = '命理/笔记:v2.md';

  // 只覆盖本路由用到的链式调用；未列出的表直接报错，避免静默走到其他查询。
  const chain = (result: unknown) => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'order']) query[method] = () => query;
    query.maybeSingle = async () => result;
    query.range = async () => result;
    query.limit = async () => result;
    return query;
  };
  const db = {
    from(table: string) {
      if (table === 'knowledge_bases') return chain({ data: { id: 'kb-1' }, error: null });
      if (table === 'archived_sources') return chain({ data: [], error: null });
      if (table === 'knowledge_entries') {
        return {
          select(columns: string) {
            return columns === 'source_type, source_id, created_at'
              ? chain({ data: [{ source_type: 'file', source_id: fileName, created_at: '2026-03-27T03:00:00.000Z' }], error: null })
              : chain({ data: [{ source_type: 'file', source_id: fileName, content: '日主甲木生于寅月。\n\n第二段' }], error: null });
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  apiUtilsModule.requireUserContext = async () => ({ user: { id: 'user-1' }, db, supabase: db });
  featureUtilsModule.ensureFeatureRouteEnabled = async () => null;
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  apiUtilsModule.jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.jsonOk = originalJsonOk;
    apiUtilsModule.jsonError = originalJsonError;
    featureUtilsModule.ensureFeatureRouteEnabled = originalEnsureFeatureRouteEnabled;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
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
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/archive/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalJsonError = apiUtilsModule.jsonError;
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const ownerFilters: Array<[string, unknown]> = [];

  const authDb = {
    from(table: string) {
      assert.equal(table, 'knowledge_bases');
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          ownerFilters.push([column, value]);
          return query;
        },
        maybeSingle: async () => ({ data: { id: 'kb-1' }, error: null }),
      };
      return query;
    },
  };
  apiUtilsModule.requireUserContext = async () => ({ user: { id: 'user-1' }, db: authDb, supabase: authDb });
  apiUtilsModule.getSystemAdminClient = () => ({
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: true, error: null });
    },
  });
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  apiUtilsModule.jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    apiUtilsModule.jsonOk = originalJsonOk;
    apiUtilsModule.jsonError = originalJsonError;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/knowledge-base/archive/[id]/route') as typeof import('../app/api/knowledge-base/archive/[id]/route');
  const id = 'file:kb-1:命理/笔记:v2.md';
  const response = await routeModule.DELETE(
    new NextRequest(`http://localhost/api/knowledge-base/archive/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(ownerFilters, [['id', 'kb-1'], ['user_id', 'user-1']]);
  assert.deepEqual(rpcCalls, [{
    fn: 'kb_unarchive_source_as_service',
    args: { p_user_id: 'user-1', p_kb_id: 'kb-1', p_source_type: 'file', p_source_id: '命理/笔记:v2.md' },
  }]);
  assert.deepEqual(payload, { success: true, kbId: 'kb-1', sourceType: 'file', sourceId: '命理/笔记:v2.md' });
});

test('knowledge-base archive DELETE should reject malformed ids before any lookup or rpc', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/archive/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalJsonOk = apiUtilsModule.jsonOk;
  const originalJsonError = apiUtilsModule.jsonError;
  const untouchable = {
    from() { throw new Error('malformed ids must not reach the database'); },
    rpc() { throw new Error('malformed ids must not reach the rpc'); },
  };

  apiUtilsModule.requireUserContext = async () => ({ user: { id: 'user-1' }, db: untouchable, supabase: untouchable });
  apiUtilsModule.getSystemAdminClient = () => untouchable;
  apiUtilsModule.jsonOk = (payload: unknown, status = 200) => Response.json(payload, { status });
  apiUtilsModule.jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    apiUtilsModule.jsonOk = originalJsonOk;
    apiUtilsModule.jsonError = originalJsonError;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/knowledge-base/archive/[id]/route') as typeof import('../app/api/knowledge-base/archive/[id]/route');
  for (const id of ['file:kb-1:', 'chat_message:kb-1', 'chat_message::msg-1', 'conversation:conv-1']) {
    const response = await routeModule.DELETE(
      new NextRequest(`http://localhost/api/knowledge-base/archive/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(response.status, 400, id);
  }
});

test('archive ids round-trip virtual sources and only split on the first two colons', () => {
  const { buildVirtualArchiveId, parseArchiveId } = require('../lib/knowledge-base/archive-ids') as typeof import('../lib/knowledge-base/archive-ids');

  assert.deepEqual(parseArchiveId(buildVirtualArchiveId('file', 'kb-1', 'a:b:c.md')), {
    kind: 'virtual', sourceType: 'file', kbId: 'kb-1', sourceId: 'a:b:c.md',
  });
  assert.deepEqual(parseArchiveId('chat_message:kb-1:msg-1'), {
    kind: 'virtual', sourceType: 'chat_message', kbId: 'kb-1', sourceId: 'msg-1',
  });
  assert.deepEqual(parseArchiveId('7f0c2b0e-8d4b-4a1e-9c51-2f1d3c4b5a69'), {
    kind: 'stored', id: '7f0c2b0e-8d4b-4a1e-9c51-2f1d3c4b5a69',
  });
  for (const id of ['', 'file:', 'file:kb-1', 'file::name.md', 'file:kb-1:', 'record:kb-1:r-1']) {
    assert.deepEqual(parseArchiveId(id), { kind: 'malformed' }, id);
  }
});
