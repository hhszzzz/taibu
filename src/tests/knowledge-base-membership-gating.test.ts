import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';

test('searchKnowledge should honor explicit free membership without touching the database', async (t) => {
  const searchModule = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
  const scoped = createMockScopedDb();
  t.mock.method(scoped, 'rpc', async () => { throw new Error('free membership must not query'); });
  t.mock.method(scoped, 'tx', async () => { throw new Error('free membership must not query'); });

  const results = await searchModule.searchKnowledge('test', { membershipType: 'free', db: scoped });
  assert.deepEqual(results, []);
});

test('searchKnowledge keeps RPCs and weights bound to the caller-scoped database', async () => {
  const searchModule = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
  const rpcCalls: string[] = [];
  const ownerFilters: Array<[string, unknown]> = [];
  const scoped = createMockScopedDb({
    rpc: async (name) => {
      rpcCalls.push(name);
      if (name === 'search_knowledge_fts') {
        return [{
          id: 'entry-1',
          kb_id: 'kb-1',
          content: '命理知识',
          metadata: {},
          rank: 0.9,
        }];
      }
      throw new Error(`Unexpected rpc: ${name}`);
    },
    tx: async (work) => work({
      selectFrom(table: string) {
        assert.equal(table, 'knowledge_bases');
        const query = {
          select() { return query; },
          where(column: string, _operator: string, value: unknown) {
            if (column === 'user_id') ownerFilters.push([column, value]);
            return query;
          },
          async execute() { return [{ id: 'kb-1', weight: 'normal' }]; },
        };
        return query;
      },
    } as never),
  });

  const results = await searchModule.searchKnowledge('test', {
    membershipType: 'pro',
    userId: 'user-1',
    db: scoped,
    useVector: false,
    searchConfig: {
      enableTrigram: false,
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.kbId, 'kb-1');
  assert.deepEqual(rpcCalls, ['search_knowledge_fts']);
  assert.deepEqual(ownerFilters, [['user_id', 'user-1']]);
});
