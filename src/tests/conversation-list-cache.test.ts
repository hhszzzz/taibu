import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { createConversationListCache } from '../lib/query/conversation-list-cache';
import { queryKeys } from '../lib/query/keys';
import type { ConversationListItem } from '../types';

function item(id: string, title = id): ConversationListItem {
  return { id, title, personality: 'general', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
}

test('conversation ref, functional updates and external stream writes share one Query-owned list', () => {
  const client = new QueryClient();
  try {
    const cache = createConversationListCache(client, 'alice', () => true);
    cache.update([item('first')]);
    const first = client.getQueryData(cache.queryKey);
    assert.equal(cache.read(), first);
    assert.equal(cache.ref.current, first);
    cache.update(current => [...current, item('second')]);
    assert.deepEqual(cache.ref.current.map(row => row.id), ['first', 'second']);
    client.setQueryData<ConversationListItem[]>(cache.queryKey, current => (
      current?.map(row => row.id === 'second' ? { ...row, title: 'stream title' } : row)
    ));
    assert.equal(cache.ref.current[1].title, 'stream title');
    cache.ref.current = [item('replacement')];
    assert.equal(cache.ref.current, client.getQueryData(cache.queryKey));
    assert.deepEqual(cache.read().map(row => row.id), ['replacement']);
  } finally { client.clear(); }
});

test('conversation optimistic rename/delete can roll back through the same cache', () => {
  const client = new QueryClient();
  try {
    const cache = createConversationListCache(client, 'alice', () => true);
    cache.update([item('a'), item('b')]);
    const beforeRename = cache.read();
    cache.update(current => current.map(row => row.id === 'a' ? { ...row, title: 'renamed' } : row));
    assert.equal(cache.ref.current[0].title, 'renamed');
    cache.update(beforeRename);
    assert.deepEqual(cache.read(), beforeRename);
    const beforeDelete = cache.read();
    cache.update(current => current.filter(row => row.id !== 'a'));
    assert.deepEqual(cache.read().map(row => row.id), ['b']);
    cache.update(beforeDelete);
    assert.deepEqual(client.getQueryData(cache.queryKey), beforeDelete);
  } finally { client.clear(); }
});

test('account scope rejects stale reads, late updater/rollback writes, and old-user cache recreation', () => {
  const client = new QueryClient();
  let scope = 'alice-session-1';
  try {
    const alice = createConversationListCache(client, 'alice', () => scope === 'alice-session-1');
    alice.update([item('private-a')]);
    const rollback = alice.read();
    scope = 'bob-session';
    alice.clear();
    const bob = createConversationListCache(client, 'bob', () => scope === 'bob-session');
    bob.update([item('private-b')]);
    let updaterRan = false;
    alice.update(() => { updaterRan = true; return rollback; });
    alice.ref.current = rollback;
    assert.equal(updaterRan, false);
    assert.deepEqual(alice.read(), []);
    assert.equal(client.getQueryData(queryKeys.conversationList('alice')), undefined);
    assert.deepEqual(bob.read().map(row => row.id), ['private-b']);
    scope = 'alice-session-2';
    bob.clear();
    const nextAlice = createConversationListCache(client, 'alice', () => scope === 'alice-session-2');
    alice.update(rollback);
    assert.deepEqual(nextAlice.read(), []);
    assert.equal(client.getQueryData(queryKeys.conversationList('bob')), undefined);
    const visitor = createConversationListCache(client, null, () => true);
    visitor.update(rollback);
    assert.deepEqual(visitor.read(), []);
    assert.equal(client.getQueryData(visitor.queryKey), undefined);
  } finally { client.clear(); }
});
