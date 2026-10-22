import assert from 'node:assert/strict';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { ROOT, validateConfig, validateProject } from '../selfhost.mjs';

const projectIndex = process.argv.indexOf('--project');
const project = validateProject(projectIndex < 0 ? 'taibu-local' : process.argv[projectIndex + 1]);
const directory = path.join(ROOT, '.taibu-local', project);
const file = path.join(directory, 'config.json');
const stat = await lstat(file);
assert.ok(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077), 'private generated config required');
const config = validateConfig(JSON.parse(await readFile(file, 'utf8')));
assert.equal(config.LOCAL_PROJECT, project);
assert.equal(config.DEMO_ENABLED, 'true', 'live acceptance requires explicit offline demo configuration');
const origin = config.APP_ORIGIN;
const post = (pathname, body, token) => fetch(`${origin}${pathname}`, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const unwrap = async response => {
  assert.equal(response.status, 200, `unexpected HTTP status ${response.status}`);
  return response.json();
};
const client = token => createClient(origin, config.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { Authorization: `Bearer ${token}` } },
});
const noError = result => { assert.equal(result.error?.code ?? null, null, `database code ${result.error?.code}`); return result.data; };

// These are real HTTP requests into the production Next image. Only model inference
// is an explicit local demo service; no handlers, identity or database calls are mocked.
test('persistent self-hosted application contracts', { timeout: 120_000 }, async t => {
  const check = async (name, operation) => {
    let passed = false;
    await t.test(name, async () => { await operation(); passed = true; });
    assert.ok(passed, `stop after failed prerequisite: ${name}`);
  };
  const sessions = {};
  await check('real application password login and caller-bound database clients', async () => {
    for (const [name, prefix] of [['user', 'USER'], ['other', 'USER2'], ['admin', 'ADMIN']]) {
      const response = await post('/api/auth', { action: 'signInWithPassword', email: config[`${prefix}_EMAIL`], password: config[`${prefix}_PASSWORD`] });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
      const body = await response.json();
      assert.ok(body.data?.session?.access_token);
      sessions[name] = body.data.session;
    }
    assert.equal(noError(await client(sessions.user.access_token).rpc('is_admin_user')), false);
    assert.equal(noError(await client(sessions.admin.access_token).rpc('is_admin_user')), true);
  });
  const user = client(sessions.user.access_token);
  const other = client(sessions.other.access_token);
  const admin = client(sessions.admin.access_token);
  const userId = sessions.user.user.id;
  const token = sessions.user.access_token;
  const receiptPath = path.join(directory, 'acceptance.json');
  if (process.argv.includes('--check-persisted')) {
    await check('previous history, avatar and owner isolation survived restart or restore', async () => {
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      const rows = noError(await user.from('tarot_readings').select('conversation_id').eq('id', receipt.readingId));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].conversation_id, receipt.conversationId);
      assert.deepEqual(noError(await other.from('tarot_readings').select('id').eq('id', receipt.readingId)), []);
      const response = await fetch(`${origin}/storage/v1/object/public/avatars/${receipt.avatarPath}`, { redirect: 'error' });
      assert.equal(response.status, 200);
      await response.body?.cancel();
    });
    return;
  }
  let draw;
  let readingId;
  let conversationId;
  let avatarPath;
  await check('Tarot save ignores forged owner and rejects foreign writes', async () => {
    draw = (await unwrap(await post('/api/tarot', { action: 'draw-only', spreadId: 'three-card', question: 'local acceptance nebula', seed: 'docker-demo' }, token))).data;
    assert.equal(draw.cards.length, 3);
    readingId = (await unwrap(await post('/api/tarot', { ...draw, action: 'save', spreadId: 'three-card', question: 'local acceptance nebula', user_id: sessions.other.user.id }, token))).data.readingId;
    assert.ok(readingId);
    assert.equal(noError(await user.from('tarot_readings').select('user_id').eq('id', readingId).single()).user_id, userId);
    assert.deepEqual(noError(await other.from('tarot_readings').select('id').eq('id', readingId)), []);
    assert.ok((await other.from('tarot_readings').insert({ user_id: userId, cards: draw.cards, spread_id: 'single' })).error);
    assert.ok((await user.from('users').update({ is_admin: true, ai_chat_count: 99999 }).eq('id', userId)).error);
  });
  await check('real SSE arrives incrementally, persists atomically and debits once', async () => {
    const before = noError(await user.from('users').select('ai_chat_count').eq('id', userId).single()).ai_chat_count;
    const response = await post('/api/tarot', { ...draw, action: 'interpret', spreadId: 'three-card', readingId, question: 'local acceptance nebula', modelId: 'taibu-demo', stream: true }, token);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    let text = ''; let firstTextAt; let endedAt;
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) { endedAt = Date.now(); break; }
      text += decoder.decode(part.value, { stream: true });
      if (text.includes('text-delta')) firstTextAt ??= Date.now();
    }
    assert.doesNotMatch(text, /"type":"error"/);
    assert.match(text, /本地离线演示/);
    assert.ok(endedAt - firstTextAt >= 100, 'text must arrive before stream completion');
    conversationId = noError(await user.from('tarot_readings').select('conversation_id').eq('id', readingId).single()).conversation_id;
    assert.ok(conversationId);
    assert.equal(noError(await user.from('conversations_with_archive_status').select('id').eq('id', conversationId)).length, 1);
    assert.deepEqual(noError(await other.from('conversations_with_archive_status').select('id').eq('id', conversationId)), []);
    assert.equal(noError(await user.from('conversation_messages').select('id').eq('conversation_id', conversationId)).length, 1);
    assert.equal(noError(await user.from('users').select('ai_chat_count').eq('id', userId).single()).ai_chat_count, before - 1);
  });
  await check('avatar files use public origin and cross-user Storage replacement is denied', async () => {
    avatarPath = `${userId}-${randomUUID()}.png`;
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN5kAAAAASUVORK5CYII=', 'base64');
    const form = new FormData();
    form.set('bucket', 'avatars'); form.set('path', avatarPath); form.set('file', new Blob([bytes], { type: 'image/png' }), 'avatar.png');
    const response = await fetch(`${origin}/api/supabase/storage`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, redirect: 'error' });
    const body = await unwrap(response);
    assert.ok(body.data.publicUrl.startsWith(`${origin}/storage/v1/object/public/avatars/`));
    const downloaded = await fetch(body.data.publicUrl, { redirect: 'error' });
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    assert.ok((await other.storage.from('avatars').upload(avatarPath, bytes, { contentType: 'image/png', upsert: true })).error);
  });
  await check('real FTS and exact-distance vector retrieval retain caller isolation', async () => {
    const kb = noError(await user.from('knowledge_bases').insert({ user_id: userId, name: 'Local acceptance' }).select('id').single());
    const vector = [1, ...Array(767).fill(0)];
    noError(await user.from('knowledge_entries').insert({ kb_id: kb.id, content: 'nebula local acceptance', source_type: 'test', source_id: randomUUID(), content_vector: JSON.stringify(vector), metadata: { embedding_dim: 768, embedding_model: 'local-deterministic' } }));
    assert.equal(noError(await user.rpc('search_knowledge_fts', { p_query: 'nebula', p_kb_ids: [kb.id] })).length, 1);
    assert.equal(noError(await user.rpc('search_knowledge_vector', { p_query_vector: vector, p_kb_ids: [kb.id], p_dim: 768 }))[0].distance, 0);
    assert.deepEqual(noError(await other.rpc('search_knowledge_vector', { p_query_vector: vector, p_kb_ids: [kb.id], p_dim: 768 })), []);
    const denied = await post('/functions/v1/create-vector-index', { dimension: 768 });
    assert.equal(denied.status, 401);
    await denied.body?.cancel();
    const maintained = await fetch(`${origin}/functions/v1/create-vector-index`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-api-secret': config.INTERNAL_API_SECRET }, body: JSON.stringify({ dimension: 768 }), signal: AbortSignal.timeout(30_000) });
    const result = await unwrap(maintained);
    assert.ok(result.results.every(row => ['created', 'already_exists'].includes(row.status)));
    assert.equal(noError(await admin.rpc('check_vector_index_exists')), true);
  });
  await check('readiness reports database and redis while the legacy cron route is gone', async () => {
    const ready = await fetch(`${origin}/api/health/ready`);
    const body = await ready.json();
    assert.equal(ready.status, 200, JSON.stringify(body));
    assert.equal(body.database, true);
    assert.equal(body.redis, true);
    const legacy = await fetch(`${origin}/api/cron/process-reminders`);
    assert.equal(legacy.status, 404);
    await legacy.body?.cancel();
  });
  assert.ok(readingId && conversationId && avatarPath, 'do not persist an incomplete acceptance receipt');
  await writeFile(receiptPath, `${JSON.stringify({ readingId, conversationId, avatarPath }, null, 2)}\n`, { mode: 0o600 });
});
