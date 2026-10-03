import test from 'node:test';
import assert from 'node:assert/strict';

test('searchKnowledge should honor explicit membershipType without env', async (t) => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_ANON_KEY;

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;

  t.after(() => {
    if (prevUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = prevUrl;
    }
    if (prevKey === undefined) {
      delete process.env.SUPABASE_ANON_KEY;
    } else {
      process.env.SUPABASE_ANON_KEY = prevKey;
    }
  });

  const modulePath = require.resolve('../lib/knowledge-base/search');
  delete require.cache[modulePath];
  const { searchKnowledge } = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');

  const results = await searchKnowledge('test', { membershipType: 'free' });
  assert.deepEqual(results, []);
});

test('searchKnowledge should bind caller token for RPCs and weights while reusing an authorized userId', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const originalGetSystemAdminClient = apiUtilsModule.getSystemAdminClient;
  const originalCreateAuthedClient = apiUtilsModule.createAuthedClient;
  const modulePath = require.resolve('../lib/knowledge-base/search');

  const callerClient = {
    rpc(fn: string) {
      if (fn === 'search_knowledge_fts') {
        return Promise.resolve({
          data: [
            {
              id: 'entry-1',
              kb_id: 'kb-1',
              content: '命理知识',
              metadata: {},
              rank: 0.9,
            },
          ],
          error: null,
        });
      }

      throw new Error(`Unexpected rpc: ${fn}`);
    },
    from(table: string) {
      assert.equal(table, 'knowledge_bases');
      return {
        select() {
          return {
            eq() {
              return {
                in: async () => ({
                  data: [{ id: 'kb-1', weight: 'normal' }],
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  } as unknown as ReturnType<typeof apiUtilsModule.createAuthedClient>;

  const tokens: string[] = [];
  apiUtilsModule.createAuthedClient = (token) => {
    tokens.push(token);
    return callerClient;
  };
  apiUtilsModule.getSystemAdminClient = () => {
    throw new Error('user knowledge search must not fall back to system-admin');
  };

  t.after(() => {
    apiUtilsModule.getSystemAdminClient = originalGetSystemAdminClient;
    apiUtilsModule.createAuthedClient = originalCreateAuthedClient;
    delete require.cache[modulePath];
  });

  delete require.cache[modulePath];
  const { searchKnowledge } = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
  const results = await searchKnowledge('test', {
    membershipType: 'pro',
    userId: 'user-1',
    accessToken: 'caller-token',
    useVector: false,
    searchConfig: {
      enableTrigram: false,
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.kbId, 'kb-1');
  assert.deepEqual(tokens, ['caller-token', 'caller-token']);
});
