import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertObjectKey,
  createLocalObjectStore,
  isStorageBucket,
} from '../lib/storage/local-fs.server';

async function tempRoot(t: import('node:test').TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'taibu-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function bodyOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

test('local object store round-trips nested keys and reports missing objects', async (t) => {
  const store = createLocalObjectStore(await tempRoot(t));
  const payload = new TextEncoder().encode('avatar-bytes');

  await store.put('avatars', 'user-1/one.png', payload, { contentType: 'image/png' });
  const stored = await store.get('avatars', 'user-1/one.png');
  assert.ok(stored);
  assert.equal(stored.size, payload.byteLength);
  assert.deepEqual(await bodyOf(stored.stream), payload);

  assert.equal(await store.get('avatars', 'user-1/missing.png'), null);
});

test('local object store rejects traversal, absolute and empty keys', async (t) => {
  const store = createLocalObjectStore(await tempRoot(t));
  for (const key of ['../escape.png', 'a/../b.png', '/etc/passwd', './a.png', '', 'a//b.png']) {
    assert.throws(() => assertObjectKey(key), `expected ${JSON.stringify(key)} to be rejected`);
  }
  await assert.rejects(store.put('avatars', '../escape.png', new Uint8Array([1])));
  await assert.rejects(store.get('avatars', '/etc/passwd'));
});

test('local object store rejects unknown buckets', async (t) => {
  const store = createLocalObjectStore(await tempRoot(t));
  assert.equal(isStorageBucket('avatars'), true);
  assert.equal(isStorageBucket('agent-attachments'), true);
  assert.equal(isStorageBucket('public'), false);
  await assert.rejects(store.get('public' as never, 'x.png'));
  await assert.rejects(store.put('public' as never, 'x.png', new Uint8Array([1])));
});

test('local object store lists by prefix and age, and deletes idempotently', async (t) => {
  const root = await tempRoot(t);
  const store = createLocalObjectStore(root);
  await store.put('agent-attachments', 'user-1/old.txt', new TextEncoder().encode('old'));
  await store.put('agent-attachments', 'user-1/new.txt', new TextEncoder().encode('new'));
  await store.put('agent-attachments', 'user-2/other.txt', new TextEncoder().encode('other'));

  const oldPath = path.join(root, 'agent-attachments', 'user-1', 'old.txt');
  await utimes(oldPath, new Date('2001-01-01T00:00:00Z'), new Date('2001-01-01T00:00:00Z'));

  const listed = await store.list('agent-attachments');
  assert.deepEqual(listed.map((entry) => entry.key), ['user-1/new.txt', 'user-1/old.txt', 'user-2/other.txt']);

  const filtered = await store.list('agent-attachments', { prefix: 'user-1/' });
  assert.deepEqual(filtered.map((entry) => entry.key), ['user-1/new.txt', 'user-1/old.txt']);

  const aged = await store.list('agent-attachments', { olderThan: new Date('2020-01-01T00:00:00Z') });
  assert.deepEqual(aged.map((entry) => entry.key), ['user-1/old.txt']);

  await store.delete('agent-attachments', ['user-1/old.txt', 'user-1/new.txt']);
  assert.equal(await store.get('agent-attachments', 'user-1/old.txt'), null);
  assert.equal(await store.get('agent-attachments', 'user-1/new.txt'), null);
  await store.delete('agent-attachments', ['user-1/old.txt']);
  await assert.rejects(store.list('agent-attachments', { prefix: '../' }));
});

test('local object store writes files atomically with restrictive modes', async (t) => {
  const root = await tempRoot(t);
  const store = createLocalObjectStore(root);
  await writeFile(path.join(root, 'placeholder.txt'), 'x');
  await store.put('avatars', 'user-1/file.png', new Uint8Array([1, 2, 3]));

  const file = await stat(path.join(root, 'avatars', 'user-1', 'file.png'));
  assert.equal(file.isFile(), true);
  assert.equal(file.mode & 0o777, 0o640);
  const directory = await stat(path.join(root, 'avatars', 'user-1'));
  assert.equal(directory.mode & 0o777, 0o750);
});
