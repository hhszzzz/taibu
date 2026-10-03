import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

test('knowledge-base archive route should page merged archive rows and virtual chat messages', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const featureUtilsModule = require('../lib/feature-gate-utils') as any;
  const routePath = require.resolve('../app/api/knowledge-base/archive/route');

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
                        },
                      };
                    },
                  };
                },
              };
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
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        order() {
                          return {
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
                        },
                      };
                    },
                  };
                },
              };
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
