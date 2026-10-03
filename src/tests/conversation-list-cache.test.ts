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

test('owned optimistic operations preserve concurrent successes and reject same-id overlap', () => {
  const client = new QueryClient();
  try {
    const cache = createConversationListCache(client, 'alice', () => true);
    cache.update([item('a'), item('b'), item('c')]);
    const renameA = cache.beginRename('a', 'pending-a');
    const renameB = cache.beginRename('b', 'saved-b');
    assert.ok(renameA && renameB);
    assert.equal(cache.beginDelete('a'), null, 'same-id writes must not race on the server');
    assert.equal(cache.settle(renameB, true), true);
    cache.update(rows => rows.map(row => row.id === 'a' ? { ...row, updatedAt: 'stream-update' } : row));
    assert.equal(cache.settle(renameA, false), true);
    assert.equal(cache.read()[0].title, 'a');
    assert.equal(cache.read()[0].updatedAt, 'stream-update');
    assert.equal(cache.read()[1].title, 'saved-b');
    assert.equal(cache.settle(renameA, false), false, 'settlement is owned once');

    const deleteA = cache.beginDelete('a');
    const deleteB = cache.beginDelete('b');
    assert.ok(deleteA && deleteB);
    cache.settle(deleteB, true);
    cache.update(rows => [...rows, item('page-2')]);
    cache.settle(deleteA, false);
    assert.deepEqual(cache.read().map(row => row.id), ['a', 'c', 'page-2']);
  } finally { client.clear(); }
});

test('refresh overlays pending mutations and stale settlements cannot resurrect removed or old-account rows', () => {
  const client = new QueryClient();
  let active = true;
  try {
    const cache = createConversationListCache(client, 'alice', () => active);
    cache.update([item('a'), item('b'), item('c')]);
    const renamed = cache.beginRename('a', 'pending');
    const deleted = cache.beginDelete('b');
    assert.ok(renamed && deleted);
    cache.update([item('a', 'server'), item('b'), item('c'), item('d')]);
    assert.deepEqual(cache.read().map(row => [row.id, row.title]), [['a', 'pending'], ['c', 'c'], ['d', 'd']]);
    assert.equal(cache.cancelMutation('b'), deleted, 'external deletion can still notify consumers of an optimistically hidden row');
    assert.equal(cache.settle(deleted, false), false, 'external deletion supersedes a pending rollback');
    active = false;
    cache.clear();
    assert.equal(cache.settle(renamed, false), false);
    assert.equal(client.getQueryData(cache.queryKey), undefined);
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
