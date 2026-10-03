import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { Socket } from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { assertLocalDocker, startLocalAuthStack } from './local-auth-stack.mjs';

// Run after building current Core:
// node --require ./scripts/ts-register.cjs --test scripts/tests/auth-postgrest-acceptance.test.mjs
// No application/auth/database mocks. Only the model inference export is stubbed.
// The bounded repository SQL fixture is NOT an authoritative deployed export.
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '../..');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const claims = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

// Strip inherited application/provider/proxy credentials before loading any app
// modules. This process never reads .env, even when run inside a configured repo.
const retainedEnv = new Set(['PATH', 'HOME', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'NODE_TEST_CONTEXT']);
for (const key of Object.keys(process.env)) if (!retainedEnv.has(key)) delete process.env[key];
process.env.NODE_ENV = 'test';

test('remote Docker is rejected before any server operation', async () => {
  const previousHost = process.env.DOCKER_HOST;
  const previousContext = process.env.DOCKER_CONTEXT;
  process.env.DOCKER_HOST = 'tcp://remote.invalid:2375';
  delete process.env.DOCKER_CONTEXT;
  try { await assert.rejects(assertLocalDocker(), /local Unix-socket/); }
  finally {
    if (previousHost === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = previousHost;
    if (previousContext === undefined) delete process.env.DOCKER_CONTEXT; else process.env.DOCKER_CONTEXT = previousContext;
  }
});

test('real local GoTrue/PostgREST application acceptance', { timeout: 300_000 }, async t => {
  const stack = await startLocalAuthStack(t, repoRoot);
  const forbiddenNetwork = [];
  const ports = new Set([new URL(stack.url).port]);
  const allowedOrigins = new Set([stack.url]);
  const originalConnect = Socket.prototype.connect;
  t.mock.method(Socket.prototype, 'connect', function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = typeof first === 'object' ? first : { port: first, host: args[1] };
    if (options.path || !['127.0.0.1', 'localhost', '::1'].includes(options.host) || !ports.has(String(options.port))) {
      forbiddenNetwork.push('blocked socket');
      throw new Error('Acceptance forbids any network outside the owned local stack');
    }
    return originalConnect.apply(this, args);
  });
  const realFetch = globalThis.fetch;
  const traffic = [];
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const request = new Request(input, options);
    if (!allowedOrigins.has(new URL(request.url).origin)) {
      forbiddenNetwork.push('blocked fetch');
      throw new Error('Acceptance forbids any fetch outside the owned local gateway');
    }
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    let identity = {};
    try { const payload = claims(token); identity = { role: payload.role, sub: payload.sub }; } catch { /* negative JWT cases */ }
    const entry = { path: new URL(request.url).pathname, method: request.method, ...identity, body: await request.clone().text(), status: null };
    traffic.push(entry);
    const response = await realFetch(request);
    entry.status = response.status;
    return response;
  });
  // These are ephemeral local credentials, never printed or written to disk.
  Object.assign(process.env, {
    SUPABASE_URL: stack.url, NEXT_PUBLIC_SUPABASE_URL: stack.url,
    SUPABASE_ANON_KEY: stack.anonKey, NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
  });
  const { createClient } = require('@supabase/supabase-js');
  const { NextRequest } = require('next/server');
  const client = token => createClient(stack.url, stack.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const service = createClient(stack.url, stack.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const trustedSql = statement => stack.sql(`BEGIN; SET LOCAL ROLE taibu_contract_owner; ${statement} COMMIT;`);
  const identities = {};
  for (const [name, membership, admin] of [['owner', 'plus', false], ['other', 'plus', false], ['admin', 'plus', true], ['free', 'free', false]]) {
    const email = `${name}@acceptance.invalid`;
    const password = `T7-${randomBytes(24).toString('hex')}`;
    const result = await service.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { nickname: `fixture-${name}`, is_admin: true, membership: 'pro', ai_chat_count: 999999 },
    });
    assert.ok(!result.error, `GoTrue must create fake ${name} identity`);
    assert.ok(result.data.user?.id);
    identities[name] = { email, password, id: result.data.user.id };
    const profile = await service.from('users').select('is_admin,membership,membership_expires_at,ai_chat_count,nickname').eq('id', result.data.user.id).single();
    assert.ok(!profile.error, 'The active Auth trigger must create the public profile');
    assert.deepEqual(profile.data, { is_admin: false, membership: 'free', membership_expires_at: null, ai_chat_count: 1, nickname: `fixture-${name}` });
    // Test entitlements are privileged fixture state, not a fabricated Auth INSERT.
    await trustedSql(`UPDATE public.users SET membership=${quote(membership)},ai_chat_count=10,is_admin=${admin}
      WHERE id=${quote(result.data.user.id)};`);
  }
  Object.assign(process.env, { SUPABASE_SYSTEM_ADMIN_EMAIL: identities.admin.email, SUPABASE_SYSTEM_ADMIN_PASSWORD: identities.admin.password });
  const api = require('../../src/lib/api-utils.ts');
  const auth = require('../../src/app/api/auth/route.ts');
  const tarot = require('../../src/app/api/tarot/route.ts');
  const history = require('../../src/lib/history/registry.ts');
  const sourceRoute = require('../../src/app/api/data-sources/[type]/[id]/route.ts');
  const ingest = require('../../src/app/api/knowledge-base/ingest/route.ts');
  const search = require('../../src/app/api/knowledge-base/search/route.ts');
  const ai = require('../../src/lib/ai/ai.ts');
  const { createMockUIMessageResult } = require('../../src/tests/helpers/ui-message-result.ts');
  const request = (url, body, session, cookieOnly = false) => new NextRequest(`${stack.url}${url}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(session ? cookieOnly
        ? { cookie: `sb-access-token=${session.access_token}; sb-refresh-token=${session.refresh_token}` }
        : { authorization: `Bearer ${session.access_token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const post = async (handler, url, body, session, cookieOnly = false) => {
    const response = await handler(request(url, body, session, cookieOnly));
    return { response, body: await response.json() };
  };
  const sessions = {};
  await t.test('real password login issues HttpOnly cookies and caller-bound clients', async () => {
    for (const [name, identity] of Object.entries(identities)) {
      const result = await post(auth.POST, '/api/auth', { action: 'signInWithPassword', email: identity.email, password: identity.password });
      assert.equal(result.response.status, 200);
      sessions[name] = result.body.data.session;
      assert.equal(sessions[name].user.id, identity.id);
      assert.equal(claims(sessions[name].access_token).role, 'authenticated');
      const cookies = result.response.headers.getSetCookie();
      assert.ok(cookies.some(value => value.startsWith('sb-access-token=') && /HttpOnly/i.test(value)));
      assert.ok(cookies.some(value => value.startsWith('sb-refresh-token=') && /HttpOnly/i.test(value)));
      const context = await api.requireUserContext(request('/api/tarot', undefined, sessions[name], true));
      assert.ok(!('error' in context));
      assert.equal(context.user.id, identity.id);
      const own = await context.db.from('users').select('id').eq('id', identity.id).single();
      assert.ok(!own.error);
      assert.equal(own.data.id, identity.id);
    }
    const wrong = await post(auth.POST, '/api/auth', { action: 'signInWithPassword', email: identities.owner.email, password: 'invalid-test-password' });
    assert.equal(wrong.response.status, 401);
  });

  await t.test('refresh rotates a real session and api-utils uses refreshed caller identity', async () => {
    const session = sessions.other;
    const result = await auth.GET(request('/api/auth', undefined, { ...session, access_token: 'stale.invalid.jwt' }, true));
    assert.equal(result.status, 200);
    const body = await result.json();
    const refreshed = body.data.session;
    assert.equal(refreshed.user.id, identities.other.id);
    assert.ok(refreshed.refresh_token !== session.refresh_token, 'GoTrue should rotate refresh tokens');
    assert.ok(result.headers.getSetCookie().length >= 2);
    sessions.other = refreshed;
    const written = [];
    const context = await api.getAuthContext(request('/api/tarot', undefined, { ...refreshed, access_token: 'expired.invalid.jwt' }, true), {
      cookieStore: { set: (name, _value, options) => written.push({ name, options }), delete: () => {} },
    });
    assert.equal(context.user.id, identities.other.id);
    assert.ok(written.some(cookie => cookie.name === 'sb-access-token' && cookie.options.httpOnly));
    // Do not reuse the refresh token consumed above. Obtain a fresh real login.
    sessions.other = (await post(auth.POST, '/api/auth', { action: 'signInWithPassword', ...identities.other })).body.data.session;
  });

  await t.test('invalid, tampered and validly signed expired JWTs fail Auth, route guards and PostgREST', async () => {
    const token = sessions.owner.access_token;
    const parts = token.split('.');
    const altered = Buffer.from(JSON.stringify({ ...claims(token), sub: identities.other.id, role: 'service_role' })).toString('base64url');
    const expired = stack.sign({ ...claims(token), iat: 1, exp: 2 });
    for (const invalid of ['not-a-jwt', `${parts[0]}.${altered}.${parts[2]}`, expired]) {
      const candidate = { access_token: invalid, refresh_token: '' };
      const result = await api.requireBearerUser(request('/api/tarot', undefined, candidate));
      assert.ok('error' in result && result.error.status === 401);
      const rest = await client(invalid).from('tarot_readings').select('id');
      assert.ok(rest.error && rest.status === 401, 'PostgREST must reject before RLS');
      const app = await post(tarot.POST, '/api/tarot', { action: 'save', spreadId: 'single', cards: [{}] }, candidate);
      assert.equal(app.response.status, 401);
    }
  });

  await t.test('administrator login remains authenticated, not an Auth service-role credential', async () => {
    const denied = await api.requireAdminContext(request('/api/admin', undefined, sessions.owner));
    assert.ok('error' in denied && denied.error.status === 403);
    const allowed = await api.requireAdminContext(request('/api/admin', undefined, sessions.admin));
    assert.ok(!('error' in allowed));
    assert.equal(allowed.user.id, identities.admin.id);
    const adminAuth = await client(sessions.admin.access_token).auth.admin.listUsers();
    assert.ok(adminAuth.error, 'An app administrator may not call Auth admin APIs');
    const serviceAuth = await service.auth.admin.listUsers();
    assert.ok(!serviceAuth.error);
    assert.equal(serviceAuth.data.users.length, 4);
    const serviceAsUser = await api.requireBearerUser(request('/api/admin', undefined, { access_token: stack.serviceKey }));
    assert.ok('error' in serviceAsUser && serviceAsUser.error.status === 401);
    const deniedRpc = await client(sessions.owner.access_token).rpc('decrement_ai_chat_count', { user_id: identities.other.id });
    assert.ok(['42501', 'P0001'].includes(deniedRpc.error?.code), 'Ordinary users cannot invoke privileged cross-user credit RPCs');
    const systemRows = await api.getSystemAdminClient().from('users').select('id');
    assert.ok(!systemRows.error);
    assert.equal(systemRows.data.length, 4);
  });

  let draw;
  let readingId;
  let managedConversationId;
  const owner = () => client(sessions.owner.access_token);
  const other = () => client(sessions.other.access_token);
  const balance = async () => {
    const result = await owner().from('users').select('ai_chat_count').eq('id', identities.owner.id).single();
    assert.ok(!result.error);
    return result.data.ai_chat_count;
  };
  const conversationCount = async () => {
    const result = await owner().from('conversations').select('id');
    assert.ok(!result.error);
    return result.data.length;
  };
  await t.test('real Tarot draw/save preserves deterministic cards, metadata and ownership', async () => {
    const payload = { action: 'draw-only', spreadId: 'three-card', question: 'acceptance nebula career', seed: 'acceptance-fixed-seed', birthDate: '1990-01-02' };
    const result = await post(tarot.POST, '/api/tarot', payload, sessions.owner);
    assert.equal(result.response.status, 200);
    draw = result.body.data;
    assert.equal(draw.cards.length, 3);
    const repeated = await post(tarot.POST, '/api/tarot', payload, sessions.owner);
    assert.deepEqual(repeated.body.data.cards, draw.cards);
    const saved = await post(tarot.POST, '/api/tarot', { ...payload, ...draw, action: 'save', user_id: identities.other.id }, sessions.owner, true);
    assert.equal(saved.response.status, 200);
    readingId = saved.body.data.readingId;
    assert.ok(readingId);
    const row = await owner().from('tarot_readings').select('*').eq('id', readingId).single();
    assert.ok(!row.error);
    assert.equal(row.data.user_id, identities.owner.id);
    assert.deepEqual(row.data.cards, draw.cards);
    assert.equal(row.data.metadata.birthDate, payload.birthDate);
    const crossRead = await other().from('tarot_readings').select('id').eq('id', readingId);
    assert.deepEqual(crossRead.data, []);
    const crossUpdate = await other().from('tarot_readings').update({ question: 'stolen' }).eq('id', readingId).select('id');
    assert.deepEqual(crossUpdate.data, []);
    const crossInsert = await other().from('tarot_readings').insert({ user_id: identities.owner.id, cards: draw.cards, spread_id: 'single' });
    assert.ok(crossInsert.error?.code === '42501');
  });

  // Configuration is loaded through the actual server adapter and PostgREST.
  // No provider key is present: the sole inference export below is substituted.
  await stack.sql(`INSERT INTO public.ai_models (model_key, display_name, vendor, required_tier) VALUES
    ('acceptance-model', 'Acceptance model', 'deepseek', 'free'),
    ('acceptance-premium', 'Acceptance premium', 'deepseek', 'pro');`);
  let inferenceCalls = 0;
  const model = t.mock.method(ai, 'callAIUIMessageResult', async () => {
    inferenceCalls++;
    return createMockUIMessageResult({ text: 'acceptance nebula career: deterministic model response', reasoning: 'local inference fixture' });
  });
  const analysisBody = () => ({ action: 'interpret', cards: draw.cards, spreadId: 'three-card', readingId, question: 'acceptance nebula career', seed: draw.seed, birthDate: '1990-01-02', numerology: draw.numerology, modelId: 'acceptance-model', stream: true });

  await t.test('managed Tarot stream persists conversation/messages/history and debits once via administrator login', async () => {
    const trafficStart = traffic.length;
    const before = await balance();
    const response = await tarot.POST(request('/api/tarot', analysisBody(), sessions.owner));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const events = await response.text();
    assert.match(events, /deterministic model response/);
    assert.doesNotMatch(events, /"type":"error"/);
    const saved = await owner().from('tarot_readings').select('*').eq('id', readingId).single();
    assert.ok(!saved.error);
    managedConversationId = saved.data.conversation_id;
    assert.ok(managedConversationId);
    const conversation = await owner().from('conversations').select('*').eq('id', managedConversationId).single();
    assert.ok(!conversation.error);
    assert.equal(conversation.data.source_type, 'tarot');
    assert.deepEqual(conversation.data.source_data.cards, draw.cards);
    const messages = await owner().from('conversation_messages').select('*').eq('conversation_id', managedConversationId);
    assert.ok(!messages.error);
    assert.equal(messages.data.length, 1);
    assert.match(JSON.stringify(messages.data), /deterministic model response/);
    assert.equal(await balance(), before - 1);
    assert.equal(inferenceCalls, 1);
    assert.ok(traffic.some(entry => entry.path.endsWith('/rpc/create_analysis_conversation_with_history_as_service') && entry.role === 'authenticated' && entry.sub === identities.admin.id));
    assert.ok(!traffic.slice(trafficStart).some(entry => entry.path.startsWith('/rest/') && entry.role === 'service_role'), 'Application must use real admin session, not service-role bypass');
    const requests = traffic.slice(trafficStart);
    assert.ok(requests.every(entry => entry.status < 400), 'No missing-schema or RPC errors may silently fail open');
    const debitIndex = requests.findIndex(entry => entry.path.endsWith('/rpc/decrement_ai_chat_count'));
    const rateIndex = requests.findIndex(entry => entry.path.endsWith('/rpc/consume_rate_limit_slot_as_admin'));
    const persistIndex = requests.findIndex(entry => entry.path.endsWith('/rpc/create_analysis_conversation_with_history_as_service'));
    assert.ok(debitIndex >= 0 && rateIndex > debitIndex && persistIndex > rateIndex);
  });

  await t.test('model membership denial precedes credit denial and neither starts inference or debit', async () => {
    await trustedSql(`UPDATE public.users SET ai_chat_count = 0 WHERE id = ${quote(identities.free.id)};`);
    const start = traffic.length;
    const calls = inferenceCalls;
    const deniedModel = await post(tarot.POST, '/api/tarot', { ...analysisBody(), modelId: 'acceptance-premium' }, sessions.free);
    assert.equal(deniedModel.response.status, 403);
    const deniedCredit = await post(tarot.POST, '/api/tarot', analysisBody(), sessions.free);
    assert.equal(deniedCredit.response.status, 402);
    assert.equal(inferenceCalls, calls);
    assert.ok(!traffic.slice(start).some(entry => /decrement_ai_chat_count|consume_rate_limit_slot_as_admin/.test(entry.path)));
  });

  await t.test('managed inference failure refunds once and does not persist', async () => {
    const before = await balance();
    const count = await conversationCount();
    model.mock.mockImplementationOnce(async () => { throw new Error('intentional local model failure'); });
    const response = await tarot.POST(request('/api/tarot', analysisBody(), sessions.owner));
    assert.ok(response.status >= 400 || /"type":"error"/.test(await response.text()));
    assert.equal(await balance(), before);
    assert.equal(await conversationCount(), count);
  });

  await t.test('managed foreign-history persistence rolls back and refunds the requesting user', async () => {
    const before = await other().from('users').select('ai_chat_count').eq('id', identities.other.id).single();
    assert.ok(!before.error);
    const response = await tarot.POST(request('/api/tarot', analysisBody(), sessions.other));
    assert.equal(response.status, 200);
    const events = await response.text();
    assert.match(events, /"type":"error"/);
    const after = await other().from('users').select('ai_chat_count').eq('id', identities.other.id).single();
    assert.equal(after.data.ai_chat_count, before.data.ai_chat_count);
    const rows = await other().from('conversations').select('id');
    assert.ok(!rows.error);
    assert.deepEqual(rows.data, [], 'Atomic RPC must not leave a conversation after foreign history rejection');
    const reading = await owner().from('tarot_readings').select('conversation_id').eq('id', readingId).single();
    assert.equal(reading.data.conversation_id, managedConversationId);
  });

  await t.test('BYOK prepare/persist is independently authenticated, unbilled and never sends a key to platform', async () => {
    const byokKey = randomBytes(32).toString('hex'); // stays on the simulated browser side
    const before = await balance();
    const inferenceBefore = inferenceCalls;
    const body = analysisBody();
    const prepared = await post(tarot.POST, '/api/tarot', { ...body, action: 'interpret_prepare' }, sessions.owner);
    assert.equal(prepared.response.status, 200);
    assert.ok(prepared.body.data.userPrompt.includes('acceptance nebula career'));
    const invalid = await post(tarot.POST, '/api/tarot', { ...body, action: 'interpret_persist', content: 'browser model result', customModelId: 'browser-test' });
    assert.equal(invalid.response.status, 401);
    const cross = await post(tarot.POST, '/api/tarot', { ...body, action: 'interpret_persist', content: 'cross-user result', customModelId: 'browser-test' }, sessions.other);
    assert.equal(cross.response.status, 500);
    const direct = require('../../src/lib/ai/direct-analysis-client.ts');
    // A bounded HTTP adapter invokes the actual application handler. It performs
    // no authentication or persistence itself; unlike an HTTP mock, both sides
    // use real HTTP and the handler still calls GoTrue/PostgREST through the SDK.
    const app = http.createServer(async (incoming, outgoing) => {
      if (incoming.url !== '/api/tarot' || incoming.method !== 'POST') { outgoing.writeHead(404).end(); return; }
      try {
        let payload = '';
        for await (const chunk of incoming) {
          payload += chunk.toString();
          if (payload.length > 1024 * 1024) { outgoing.writeHead(413).end(); return; }
        }
        const response = await tarot.POST(new NextRequest(`${stack.url}/api/tarot`, {
          method: 'POST', headers: incoming.headers, body: payload,
        }));
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(await response.text());
      } catch { outgoing.writeHead(500).end(); }
    });
    await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
    const appOrigin = `http://127.0.0.1:${app.address().port}`;
    ports.add(String(app.address().port));
    allowedOrigins.add(appOrigin);
    let saved;
    try {
      saved = await direct.runDirectAnalysisFlow({
        endpoint: `${appOrigin}/api/tarot`,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${sessions.owner.access_token}` },
        provider: { apiUrl: 'https://model.invalid/v1', apiKey: byokKey, modelId: 'browser-test' },
        prepareBody: { ...body, action: 'interpret_prepare' },
        persistBody: { ...body, action: 'interpret_persist' },
        streaming: { startDirectStream: async ({ provider, messages }) => {
          assert.ok(provider.apiKey === byokKey, 'Only the browser inference boundary receives its key');
          assert.match(messages[0].content, /acceptance nebula career/);
          return { content: 'browser nebula career result', reasoning: 'browser reasoning' };
        } },
      });
    } finally {
      app.closeAllConnections();
      await new Promise(resolve => app.close(resolve));
      allowedOrigins.delete(appOrigin);
    }
    assert.ok(!saved.error);
    assert.ok(saved.conversationId);
    const conversation = await owner().from('conversations').select('*').eq('id', saved.conversationId).single();
    assert.ok(!conversation.error);
    assert.equal(conversation.data.source_data.custom_provider, true);
    assert.equal(conversation.data.source_data.custom_provider_model_id, 'browser-test');
    assert.equal(await balance(), before);
    assert.equal(inferenceCalls, inferenceBefore);
    assert.ok(!JSON.stringify(traffic).includes(byokKey));
    assert.ok(!JSON.stringify(conversation.data).includes(byokKey));
    const empty = await post(tarot.POST, '/api/tarot', { ...body, action: 'interpret_persist', content: '  ' }, sessions.owner);
    assert.equal(empty.response.status, 400);
  });

  await t.test('history restores actual owned Tarot record through the source route and production mapper', async () => {
    const response = await sourceRoute.GET(request('/api/data-sources/tarot_reading/test', undefined, sessions.owner), { params: Promise.resolve({ type: 'tarot_reading', id: readingId }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    const restored = await history.buildHistoryRestorePayload('tarot', data.raw, 'UTC');
    assert.deepEqual(restored.sessionData.cards, draw.cards);
    assert.equal(restored.sessionData.readingId, readingId);
    assert.ok(restored.sessionData.conversationId);
    const denied = await sourceRoute.GET(request('/api/data-sources/tarot_reading/test', undefined, sessions.other), { params: Promise.resolve({ type: 'tarot_reading', id: readingId }) });
    assert.equal(denied.status, 404);
  });

  await t.test('KB ingest and FTS/trigram search run as caller with real RLS/RPC boundaries', async () => {
    const kb = await owner().from('knowledge_bases').insert({ user_id: identities.owner.id, name: 'Acceptance KB' }).select('id').single();
    assert.ok(!kb.error);
    const kbId = kb.data.id;
    const ingested = await post(ingest.POST, '/api/knowledge-base/ingest', { kbId, sourceType: 'tarot_reading', sourceId: readingId }, sessions.owner);
    assert.equal(ingested.response.status, 200);
    assert.ok(ingested.body.success);
    const entries = await owner().from('knowledge_entries').select('*').eq('kb_id', kbId);
    assert.ok(!entries.error);
    assert.ok(entries.data.length > 0);
    assert.ok(entries.data.every(entry => entry.source_id === readingId));
    const result = await post(search.POST, '/api/knowledge-base/search', { query: 'nebula', kbIds: [kbId], topK: 5 }, sessions.owner);
    assert.equal(result.response.status, 200);
    assert.ok(result.body.candidates.length > 0);
    assert.ok(result.body.candidates.every(entry => entry.kbId === kbId));
    const denied = await post(ingest.POST, '/api/knowledge-base/ingest', { kbId, sourceType: 'tarot_reading', sourceId: readingId }, sessions.other);
    assert.equal(denied.response.status, 403);
    const hidden = await post(search.POST, '/api/knowledge-base/search', { query: 'nebula', kbIds: [kbId] }, sessions.other);
    assert.equal(hidden.response.status, 200);
    assert.deepEqual(hidden.body.candidates, []);
    const deniedRpc = await other().rpc('kb_replace_source_entries', { p_kb_id: kbId, p_source_type: 'tarot_reading', p_source_id: readingId, p_entries: [] });
    assert.equal(deniedRpc.error?.code, '42501');
    assert.ok(traffic.some(entry => entry.path.endsWith('/rpc/kb_replace_source_entries') && entry.sub === identities.owner.id));
    assert.ok(traffic.some(entry => entry.path.endsWith('/rpc/search_knowledge_fts') && entry.sub === identities.owner.id));
    assert.ok((await stack.sql("SELECT extversion FROM pg_extension WHERE extname = 'vector';")).length > 0);
  });

  const newAccount = async label => {
    const email = `${label}-${randomBytes(6).toString('hex')}@acceptance.invalid`;
    const password = randomBytes(24).toString('hex');
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nickname: label } });
    assert.ok(!created.error, 'Local GoTrue account creation must succeed through the active profile trigger');
    const signedIn = await post(auth.POST, '/api/auth', { action: 'signInWithPassword', email, password });
    assert.equal(signedIn.response.status, 200);
    const session = signedIn.body.data.session;
    return { id: created.data.user.id, session, db: client(session.access_token), user: session.user };
  };
  const accountRow = async account => {
    const result = await account.db.from('users').select('id,nickname,avatar_url,is_admin,membership,membership_expires_at,ai_chat_count,updated_at').eq('id', account.id).single();
    assert.ok(!result.error);
    return result.data;
  };
  const protectedFields = row => ({ id: row.id, is_admin: row.is_admin, membership: row.membership, membership_expires_at: row.membership_expires_at, ai_chat_count: row.ai_chat_count });

  await t.test('real caller account and ledger denials are guard-based with broad CRUD and no TRUNCATE', async () => {
    const account = await newAccount('protected-caller');
    const privileges = JSON.parse(await stack.sql(`SELECT json_build_object(
      'user_insert',has_table_privilege('authenticated','public.users','INSERT'),
      'user_update',has_table_privilege('authenticated','public.users','UPDATE'),
      'ledger_insert',has_table_privilege('authenticated','public.credit_transactions','INSERT'),
      'anon_user_insert',has_table_privilege('anon','public.users','INSERT'),
      'anon_predicate',has_function_privilege('anon','public.is_admin_user()','EXECUTE'),
      'truncate',has_table_privilege('authenticated','public.users','TRUNCATE'),
      'invoker',NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.guard_user_entitlement_writes()'::regprocedure),
      'restrictive',(SELECT permissive='RESTRICTIVE' FROM pg_policies WHERE schemaname='public' AND tablename='credit_transactions' AND policyname='credit_transactions_authenticated_insert_guard'));`));
    assert.deepEqual(privileges, { user_insert: true, user_update: true, ledger_insert: true, anon_user_insert: true, anon_predicate: true, truncate: false, invoker: true, restrictive: true });
    const before = await accountRow(account);
    for (const patch of [
      { is_admin: true }, { is_admin: null }, { membership: 'pro' }, { membership: null },
      { membership_expires_at: '2099-01-01T00:00:00Z' }, { ai_chat_count: 999 }, { ai_chat_count: null },
      { id: identities.other.id }, { nickname: 'atomic-failure', ai_chat_count: 999 },
    ]) {
      const denied = await account.db.from('users').update(patch).eq('id', account.id);
      assert.equal(denied.error?.code, '42501');
      assert.deepEqual(await accountRow(account), before);
    }
    const ledger = await account.db.from('credit_transactions').insert({ user_id: account.id, amount: 999, type: 'earn', source: 'forged-direct' });
    assert.equal(ledger.error?.code, '42501');
    assert.equal((await account.db.rpc('is_admin_user')).data, false);
    const removed = await account.db.from('users').delete().eq('id', account.id).select('id');
    assert.deepEqual(removed.data, []);
    const anonymous = await api.createAnonClient().from('users').insert({ id: account.id });
    assert.equal(anonymous.error?.code, '42501');
    assert.deepEqual(await accountRow(account), before);
    // Effective owner, not original ordinary claims, permits internal writes.
    await trustedSql(`SET LOCAL request.jwt.claims=${quote(JSON.stringify({ role: 'authenticated', sub: account.id }))};
      UPDATE public.users SET ai_chat_count=2 WHERE id=${quote(account.id)};`);
    assert.equal((await accountRow(account)).ai_chat_count, 2);
  });

  await t.test('real safe provisioning paid-profile PATCH and ignoreDuplicates preserve protected fields', async () => {
    const account = await newAccount('profile-compatibility');
    await trustedSql(`DELETE FROM public.users WHERE id=${quote(account.id)};`);
    for (const patch of [{ is_admin: true }, { membership: 'pro' }, { ai_chat_count: null }, { membership_expires_at: '2099-01-01' }]) {
      const denied = await account.db.from('users').insert({ id: account.id, ...patch });
      assert.equal(denied.error?.code, '42501');
    }
    const { ensureUserRecordRow } = require('../../src/lib/user/profile-record.ts');
    assert.equal((await ensureUserRecordRow(account.db, account.user)).ok, true);
    assert.equal((await accountRow(account)).ai_chat_count, 1);
    await trustedSql(`UPDATE public.users SET membership='pro',membership_expires_at='2099-01-01',ai_chat_count=80 WHERE id=${quote(account.id)};`);
    const before = protectedFields(await accountRow(account));
    assert.equal((await ensureUserRecordRow(account.db, account.user)).ok, true);
    assert.deepEqual(protectedFields(await accountRow(account)), before);
    const unsafeConflict = await account.db.from('users').upsert({ id: account.id, membership: 'free', ai_chat_count: 1 }, { onConflict: 'id' });
    assert.equal(unsafeConflict.error?.code, '42501');
    const profileRoute = require('../../src/app/api/user/profile/route.ts');
    const response = await profileRoute.PATCH(new NextRequest(`${stack.url}/api/user/profile`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${account.session.access_token}` },
      body: JSON.stringify({ nickname: 'paid profile edit', avatar_url: null, is_admin: true }),
    }));
    assert.equal(response.status, 200);
    assert.equal((await accountRow(account)).nickname, 'paid profile edit');
    assert.deepEqual(protectedFields(await accountRow(account)), before);
    await trustedSql(`UPDATE public.users SET is_admin=NULL,membership=NULL,membership_expires_at=NULL,ai_chat_count=NULL WHERE id=${quote(account.id)};`);
    const legacy = protectedFields(await accountRow(account));
    const legacyEdit = await account.db.from('users').update({ nickname: 'legacy null profile edit' }).eq('id', account.id);
    assert.ok(!legacyEdit.error);
    assert.deepEqual(protectedFields(await accountRow(account)), legacy);
    const normalizeNull = await account.db.from('users').update({ ai_chat_count: 1 }).eq('id', account.id);
    assert.equal(normalizeNull.error?.code, '42501');
  });

  await t.test('real Auth metadata and email synchronization cannot overwrite entitlements and retains provider uniqueness', async () => {
    const account = await newAccount('auth-sync');
    const providerId = `local-provider-${randomBytes(8).toString('hex')}`;
    await trustedSql(`UPDATE public.users SET membership='plus',membership_expires_at='2099-01-01',ai_chat_count=33 WHERE id=${quote(account.id)};`);
    const before = protectedFields(await accountRow(account));
    const synced = await post(auth.POST, '/api/auth', { action: 'updateUser', attributes: { data: {
      nickname: 'synced nickname', avatar_url: 'https://avatar.invalid/local.png', linuxdo_sub: providerId,
      is_admin: true, membership: 'pro', membership_expires_at: '2199-01-01', ai_chat_count: 999999,
    } } }, account.session);
    assert.equal(synced.response.status, 200);
    assert.equal((await accountRow(account)).nickname, 'synced nickname');
    assert.deepEqual(protectedFields(await accountRow(account)), before);
    const newEmail = `changed-${randomBytes(6).toString('hex')}@acceptance.invalid`;
    const emailUpdate = await service.auth.admin.updateUserById(account.id, { email: newEmail, email_confirm: true });
    assert.ok(!emailUpdate.error, 'Trusted Auth email update must fire the real synchronization trigger');
    const provider = await account.db.from('user_oauth_providers').select('user_id,provider,provider_user_id,provider_email').eq('user_id', account.id).single();
    assert.ok(!provider.error);
    assert.deepEqual(provider.data, { user_id: account.id, provider: 'linuxdo', provider_user_id: providerId, provider_email: newEmail });
    assert.deepEqual(protectedFields(await accountRow(account)), before);
    const otherAccount = await newAccount('auth-sync-conflict');
    const conflict = await post(auth.POST, '/api/auth', { action: 'updateUser', attributes: { data: { nickname: 'must-rollback', linuxdo_sub: providerId } } }, otherAccount.session);
    assert.ok(conflict.response.status >= 400);
    assert.equal((await accountRow(otherAccount)).nickname, 'auth-sync-conflict');
    assert.equal((await account.db.from('user_oauth_providers').select('id').eq('provider_user_id', providerId)).data.length, 1);
  });

  await t.test('real admin and service account ledger and membership RPC writes remain valid; ordinary RPCs stay denied', async () => {
    for (const privileged of [api.getSystemAdminClient(), service]) {
      const account = await newAccount('legitimate-rpc');
      const code = randomBytes(16).toString('hex');
      const membershipCode = randomBytes(16).toString('hex');
      await trustedSql(`INSERT INTO public.activation_keys(key_code,key_type,credits_amount,created_by) VALUES (${quote(code)},'credits',5,${quote(identities.admin.id)});
        INSERT INTO public.activation_keys(key_code,key_type,membership_type,created_by) VALUES (${quote(membershipCode)},'membership','plus',${quote(identities.admin.id)});`);
      const operations = [
        ['decrement_ai_chat_count', { user_id: account.id }],
        ['increment_ai_chat_count', { user_id: account.id, amount: 2 }],
        ['activate_key_as_service', { p_user_id: account.id, p_key_code: code }],
        ['perform_daily_checkin_as_service', { p_user_id: account.id }],
        ['claim_linuxdo_membership_as_service', { p_user_id: account.id, p_plan_id: 'pro', p_trust_level: 3, p_provider_user_id: 'local-provider' }],
      ];
      for (const [name, args] of operations) assert.equal((await account.db.rpc(name, args)).error?.code, '42501');
      assert.equal((await privileged.rpc('decrement_ai_chat_count', { user_id: account.id })).data, 0);
      assert.equal((await privileged.rpc('increment_ai_chat_count', { user_id: account.id, amount: 2 })).data, 2);
      const activated = await privileged.rpc('activate_key_as_service', { p_user_id: account.id, p_key_code: code });
      assert.ok(!activated.error && activated.data[0].success);
      const membership = await privileged.rpc('activate_key_as_service', { p_user_id: account.id, p_key_code: membershipCode });
      assert.ok(!membership.error && membership.data[0].success);
      const checked = await privileged.rpc('perform_daily_checkin_as_service', { p_user_id: account.id });
      assert.ok(!checked.error && checked.data.status === 'ok');
      assert.ok([2,4,6].includes(checked.data.reward_credits));
      const monthlyArgs = { p_user_id: account.id, p_plan_id: 'pro', p_trust_level: 3, p_provider_user_id: 'local-provider' };
      assert.equal((await privileged.rpc('claim_linuxdo_membership_as_service', monthlyArgs)).data.status, 'ok');
      assert.equal((await privileged.rpc('claim_linuxdo_membership_as_service', monthlyArgs)).data.status, 'cooldown');
      const direct = await privileged.from('credit_transactions').insert({ user_id: account.id, amount: 1, type: 'earn', source: 'legitimate-admin-direct' });
      assert.ok(!direct.error);
      const directAccount = await privileged.from('users').update({ ai_chat_count: 42 }).eq('id', account.id);
      assert.ok(!directAccount.error);
      assert.equal((await accountRow(account)).ai_chat_count, 42);
      assert.ok((await account.db.from('credit_transactions').select('id').eq('user_id', account.id)).data.length >= 5);
    }
    for (const db of [client(sessions.owner.access_token), client(sessions.admin.access_token)]) {
      const helper = await db.rpc('record_credit_transaction', { p_user_id: identities.owner.id, p_amount: 99, p_type: 'earn', p_source: 'bare-helper-denied', p_balance_after: 999 });
      assert.equal(helper.error?.code, '42501');
    }
  });

  await t.test('caller-token updateUser persists own metadata via Cookie and Bearer without cross-user mutation', async () => {
    const start = traffic.length;
    for (const cookieOnly of [true, false]) {
      const value = cookieOnly ? 'cookie-local-only' : 'bearer-local-only';
      const result = await post(auth.POST, '/api/auth', {
        action: 'updateUser', userId: identities.other.id,
        attributes: { data: { acceptance_probe: value } },
      }, sessions.free, cookieOnly);
      assert.equal(result.response.status, 200, `updateUser response: ${JSON.stringify(result.body.error)}`);
      const user = await api.createAnonClient().auth.getUser(sessions.free.access_token);
      assert.ok(!user.error);
      assert.equal(user.data.user.user_metadata.acceptance_probe, value);
    }
    const untouched = await api.createAnonClient().auth.getUser(sessions.other.access_token);
    assert.ok(!untouched.error);
    assert.equal(untouched.data.user.user_metadata.acceptance_probe, undefined);
    const writes = traffic.slice(start).filter(entry => entry.method === 'PUT');
    assert.equal(writes.length, 2);
    assert.ok(writes.every(entry => entry.path === '/auth/v1/user' && entry.sub === identities.free.id && entry.role === 'authenticated'));
    const rejected = await post(auth.POST, '/api/auth', { action: 'updateUser', attributes: { password: 'x' } }, {
      ...sessions.free, access_token: 'expired.invalid.jwt',
    }, true);
    assert.equal(rejected.response.status, 400, 'GoTrue should reject a too-short password after refresh');
    const accessCookie = rejected.response.cookies.get('sb-access-token');
    const refreshCookie = rejected.response.cookies.get('sb-refresh-token');
    assert.ok(accessCookie?.value && refreshCookie?.value, 'Rejected updates must still preserve rotated credentials');
    assert.ok(refreshCookie.value !== sessions.free.refresh_token);
    sessions.free = { ...sessions.free, access_token: accessCookie.value, refresh_token: refreshCookie.value };
    const preserved = await api.createAnonClient().auth.getUser(sessions.free.access_token);
    assert.ok(!preserved.error);
    assert.equal(preserved.data.user.id, identities.free.id);
  });

  await t.test('logout revokes the real refresh session rather than only clearing cookies', async () => {
    const result = await post(auth.POST, '/api/auth', { action: 'signOut' }, sessions.free, true);
    assert.equal(result.response.status, 200);
    assert.ok(result.response.headers.getSetCookie().every(value => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(value)));
    const refreshed = await api.createAnonClient().auth.refreshSession({ refresh_token: sessions.free.refresh_token });
    assert.ok(refreshed.error, 'Logout must revoke the server-side refresh token');
    assert.ok(traffic.some(entry => entry.path === '/auth/v1/logout' && entry.sub === identities.free.id && entry.status < 400));
    // PostgREST is stateless: an already-issued JWT remains usable until expiry.
    // This is deliberately NOT asserted as instant access-token revocation.
    const retainedAccess = await client(sessions.free.access_token).from('users').select('id').eq('id', identities.free.id);
    assert.ok(!retainedAccess.error);
    assert.equal(retainedAccess.data.length, 1);
  });
  await t.test('no unexpected network or model-provider requests occurred', () => {
    assert.deepEqual(forbiddenNetwork, []);
    assert.ok(traffic.every(entry => entry.path.startsWith('/auth/v1/') || entry.path.startsWith('/rest/v1/') || entry.path === '/api/tarot'));
  });
});
