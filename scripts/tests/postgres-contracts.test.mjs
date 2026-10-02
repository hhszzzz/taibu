import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildPostgresFixture } from './postgres-fixture.mjs';

// Real PostgreSQL/RLS contracts against a disposable local container. This does
// NOT validate Supabase Auth, JWT signatures, PostgREST, or production parity.
// Run: node --test scripts/tests/postgres-contracts.test.mjs
// Missing Docker/SQL inputs are failures, never skips. Known SQL defects remain
// failing tests until an independently reviewed corrective migration fixes them.
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const image = 'pgvector/pgvector:0.8.6-pg16';
const runLabel = 'io.taibu.postgres-contracts.run';
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const ids = {
  owner: uuid(1), other: uuid(2), admin: uuid(3), concurrent: uuid(4), rollback: uuid(5),
  kb: uuid(10), otherKb: uuid(11), mbti: uuid(100), meihua: uuid(101), xiaoliuren: uuid(102),
  tarot: uuid(103), otherTarot: uuid(104), source: uuid(200), searchSource: uuid(201),
};
// Persisted shape follows DrawnCard and tarot route buildSourceData/historyBinding;
// no rendering, random draw, AI call or application-module loading is required.
/** @type {import('../../src/lib/divination/tarot').DrawnCard[]} */
const tarotCards = [{
  card: {
    id: 0, name: 'The Fool', nameChinese: '愚者', suit: 'major', number: 0,
    image: '/fixture-tarot-card.svg', keywords: ['beginnings'],
    uprightMeaning: 'fixture upright meaning', reversedMeaning: 'fixture reversed meaning',
  },
  orientation: 'upright', position: '当前指引',
}];
const tarotSourceData = {
  cards: tarotCards, spread_id: 'single', question: 'Tarot pilot',
  model_id: 'fixture-model', reasoning: false, seed: null, birth_date: null, numerology: null,
};
const tarotMessages = [{
  id: 'tarot-analysis-1', role: 'assistant', content: 'tarot analysis',
  model: 'fixture-model', createdAt: '2026-01-01T00:00:00.000Z',
}];
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;

function docker(args, { input = '', timeout = 30_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, env }, (error, stdout, stderr) => {
      if (error) {
        // Never print environment values or container inspect JSON: the random
        // password is passed through the subprocess environment, not argv.
        reject(new Error(`docker ${args[0]} failed: ${stderr.trim() || error.code || error.message}`));
      } else {
        resolve(stdout.trim());
      }
    });
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(input);
  });
}

async function assertLocalDocker() {
  const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
    ? process.env.DOCKER_HOST
    : await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  assert.ok(endpoint.startsWith('unix://'), 'Contract tests require a local Unix-socket Docker endpoint; remote Docker is forbidden');
  try {
    await docker(['version', '--format', '{{.Server.Version}}']);
  } catch (error) {
    throw new Error(`Local Docker is required and must already be running; this test cannot be skipped. ${error.message}`);
  }
}

test('disposable PostgreSQL contracts (not Supabase Auth/PostgREST)', { timeout: 300_000 }, async t => {
  const fixture = await buildPostgresFixture(repoRoot);
  await assertLocalDocker();

  const runId = randomUUID();
  const containerName = `taibu-pg-contracts-${runId}`;
  let containerId;
  let creation;
  let cleanupPromise;
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      if (!creation) return;
      // A signal during image pull/create must not race a later container
      // creation and leave an orphan after an early "not found" inspection.
      await creation.catch(() => {});
      const ownContainer = containerId || containerName;
      let label;
      try {
        label = await docker(['inspect', '--format', `{{ index .Config.Labels "${runLabel}" }}`, ownContainer]);
      } catch (error) {
        if (/No such (object|container)/i.test(error.message)) return;
        throw error;
      }
      assert.equal(label, runId, 'Refusing to remove a container not owned by this test run');
      await docker(['rm', '--force', '--volumes', ownContainer]);
    })();
    return cleanupPromise;
  };
  const onInterrupt = () => { void cleanup().then(() => process.exit(130), error => { console.error(error.message); process.exit(1); }); };
  const onTerminate = () => { void cleanup().then(() => process.exit(143), error => { console.error(error.message); process.exit(1); }); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  t.after(async () => {
    try {
      await cleanup();
    } finally {
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
    }
  });

  creation = docker([
    'create', '--name', containerName, '--label', `${runLabel}=${runId}`,
    '--network', 'none', '--tmpfs', '/var/lib/postgresql/data:rw',
    '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=taibu_contracts',
    image, 'postgres', '-c', 'listen_addresses=',
  ], { timeout: 180_000, env: { ...process.env, POSTGRES_PASSWORD: randomBytes(32).toString('hex') } });
  containerId = await creation;
  assert.match(containerId, /^[a-f0-9]{64}$/);
  await docker(['start', containerId]);

  let ready = false;
  const readinessDeadline = Date.now() + 30_000;
  while (Date.now() < readinessDeadline) {
    try {
      // The entrypoint starts a temporary bootstrap server. Wait for PID 1 to
      // become the final postgres process, not just for that temporary socket.
      await docker(['exec', containerId, 'sh', '-c', 'read -r name < /proc/1/comm; test "$name" = postgres'], { timeout: 2_000 });
      await docker(['exec', containerId, 'pg_isready', '-U', 'postgres', '-d', 'taibu_contracts'], { timeout: 2_000 });
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  assert.ok(ready, 'Owned PostgreSQL container did not become ready within 30 seconds');

  const sql = statement => docker([
    'exec', '-i', containerId, 'psql', '-X', '--quiet', '--tuples-only', '--no-align',
    '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose',
    '-U', 'postgres', '-d', 'taibu_contracts',
  ], { input: statement });
  const asActor = (userId, statement, role = 'authenticated') => {
    assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
    return sql(`BEGIN;
SET LOCAL ROLE ${role};
SET LOCAL request.jwt.claims = ${quote(JSON.stringify({ role, ...(userId ? { sub: userId } : {}) }))};
${statement}
COMMIT;`);
  };
  const createConversation = (userId, messages = [], title = 'fixture') => asActor(userId,
    `SELECT public.create_conversation_with_messages(${quote(userId)}, ${quote(title)}, 'general', 'chat', '{}'::jsonb, ${json(messages)});`);
  const historyCall = (userId, type, payload) => `SELECT public.create_analysis_conversation_with_history_as_service(
    ${quote(userId)}, ${quote(type)}, '{}'::jsonb, 'history fixture', 'general',
    ${json([{ id: 'analysis-1', role: 'assistant', content: 'analysis' }])}, ${quote(type)}, ${json(payload)});`;
  const tarotHistoryCall = (userId, payload, sourceData = tarotSourceData) => `SELECT public.create_analysis_conversation_with_history_as_service(
    ${quote(userId)}, 'tarot', ${json(sourceData)}, 'Tarot pilot - 单牌', 'tarot',
    ${json(tarotMessages)}, 'tarot', ${json(payload)});`;
  const assertTarotRelation = async (readingId, conversation, sourceData, metadata) => {
    const stored = JSON.parse(await asActor(ids.owner, `SELECT json_build_object(
      'reading', r.id, 'owner', r.user_id, 'conversation', r.conversation_id,
      'spread', r.spread_id, 'question', r.question, 'cards', r.cards, 'metadata', r.metadata,
      'conversationOwner', c.user_id, 'sourceType', c.source_type, 'sourceData', c.source_data,
      'personality', c.personality, 'messages', c.messages,
      'messageRows', (SELECT json_agg(json_build_object('id', message_id, 'sequence', sequence,
        'role', role, 'content', content, 'metadata', metadata) ORDER BY sequence)
        FROM public.conversation_messages WHERE conversation_id = c.id))
      FROM public.tarot_readings r JOIN public.conversations c ON c.id = r.conversation_id
      WHERE r.id = ${quote(readingId)};`));
    assert.deepEqual(stored, {
      reading: readingId, owner: ids.owner, conversation, spread: 'single', question: 'Tarot pilot',
      cards: tarotCards, metadata, conversationOwner: ids.owner, sourceType: 'tarot', sourceData,
      personality: 'tarot', messages: tarotMessages,
      messageRows: [{ id: 'tarot-analysis-1', sequence: 0, role: 'assistant', content: 'tarot analysis', metadata: { model: 'fixture-model' } }],
    });
  };
  const replaceEntries = (entries, archive = false, userId = null) => `SELECT public.kb_replace_source_entries(
    ${quote(ids.kb)}, 'record', ${quote(ids.source)}, ${json(entries)}, ${archive}, ${userId ? quote(userId) : 'NULL'});`;

  await sql(fixture);
  await sql(`
INSERT INTO auth.users(id) VALUES ${[ids.owner, ids.other, ids.admin, ids.concurrent, ids.rollback].map(id => `(${quote(id)})`).join(',')};
INSERT INTO public.users(id, is_admin, ai_chat_count)
SELECT id, id = ${quote(ids.admin)}::uuid, CASE WHEN id = ${quote(ids.concurrent)}::uuid THEN 4 ELSE 10 END FROM auth.users;
INSERT INTO public.knowledge_bases(id, user_id, name) VALUES
  (${quote(ids.kb)}, ${quote(ids.owner)}, 'owner KB'), (${quote(ids.otherKb)}, ${quote(ids.other)}, 'other KB');
INSERT INTO public.knowledge_entries(kb_id, content, source_type, source_id, content_vector, metadata) VALUES
  (${quote(ids.kb)}, 'alpha galaxy', 'record', ${quote(ids.searchSource)}, '[1,0,0]'::extensions.vector, '{"embedding_model":"fixture","embedding_dim":3}'),
  (${quote(ids.otherKb)}, 'alpha galaxy', 'record', ${quote(ids.searchSource)}, '[1,0,0]'::extensions.vector, '{"embedding_model":"fixture","embedding_dim":3}');
INSERT INTO public.mbti_readings(id, user_id, mbti_type) VALUES (${quote(ids.mbti)}, ${quote(ids.owner)}, 'INTJ');
INSERT INTO public.tarot_readings(id, user_id, spread_id, question, cards, metadata) VALUES
  (${quote(ids.tarot)}, ${quote(ids.owner)}, 'single', 'Tarot pilot', ${json(tarotCards)}, '{"seed":"draw-seed"}'),
  (${quote(ids.otherTarot)}, ${quote(ids.other)}, 'single', 'Tarot pilot', ${json(tarotCards)}, '{}');
INSERT INTO public.meihua_divinations(id, user_id, question, method, cast_datetime, main_hexagram, input_data, result_data)
VALUES (${quote(ids.meihua)}, ${quote(ids.owner)}, 'fixture', 'time', '2026-01-01', '乾', '{}', '{}');
INSERT INTO public.xiaoliuren_divinations(id, user_id, solar_datetime, lunar_month, lunar_day, shichen, final_status, input_data, result_data)
VALUES (${quote(ids.xiaoliuren)}, ${quote(ids.owner)}, '2026-01-01', 1, 1, '子', '大安', '{}', '{}');`);

  await t.test('real vector extension, non-owner roles and administrator predicate', async () => {
    const isolation = JSON.parse(await docker(['inspect', '--format',
      '{"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},"binds":{{json .HostConfig.Binds}},"mounts":{{json .Mounts}},"tmpfs":{{json .HostConfig.Tmpfs}}}',
      containerId]));
    assert.equal(isolation.network, 'none');
    assert.deepEqual(isolation.ports || {}, {});
    assert.deepEqual(isolation.binds || [], []);
    assert.ok(isolation.mounts.every(mount => mount.Type === 'tmpfs'));
    assert.equal(isolation.tmpfs['/var/lib/postgresql/data'], 'rw');
    assert.equal(await sql("SELECT extversion FROM pg_extension WHERE extname = 'vector';"), '0.8.6');
    const privileges = JSON.parse(await asActor(ids.owner, `SELECT json_build_object(
      'role', current_user, 'superuser', rolsuper, 'bypass', rolbypassrls,
      'table_owner', (SELECT relowner::regrole::text FROM pg_class WHERE oid = 'public.conversations'::regclass))
      FROM pg_roles WHERE rolname = current_user;`));
    assert.deepEqual(privileges, { role: 'authenticated', superuser: false, bypass: false, table_owner: 'taibu_contract_owner' });
    assert.equal(await asActor(ids.owner, 'SELECT public.is_admin_user();'), 'f');
    assert.equal(await asActor(ids.other, 'SELECT public.is_admin_user();'), 'f');
    assert.equal(await asActor(ids.admin, 'SELECT public.is_admin_user();'), 't');
    await assert.rejects(asActor(null, 'SELECT public.is_admin_user();', 'anon'), /42501/);
  });

  await t.test('credit mutations deny ordinary users and accept admin/service claims', async () => {
    for (const actor of [ids.owner, ids.other]) {
      await assert.rejects(asActor(actor, `SELECT public.decrement_ai_chat_count(${quote(ids.owner)});`), /42501/);
      await assert.rejects(asActor(actor, `SELECT public.increment_ai_chat_count(${quote(ids.owner)}, 1);`), /42501/);
    }
    assert.equal(await asActor(ids.admin, `SELECT public.decrement_ai_chat_count(${quote(ids.owner)});`), '9');
    assert.equal(await asActor(null, `SELECT public.increment_ai_chat_count(${quote(ids.owner)}, 1);`, 'service_role'), '10');
    assert.equal(await asActor(ids.owner, `SELECT count(*) FROM public.credit_transactions WHERE user_id = ${quote(ids.owner)};`), '2');
    assert.equal(await asActor(ids.other, `SELECT count(*) FROM public.credit_transactions WHERE user_id = ${quote(ids.owner)};`), '0');
  });

  await t.test('authenticated sessions cannot forge another user ledger entry', async () => {
    // Roll back even an incorrectly accepted call: this negative authorization
    // probe must not change balances/ledger fixtures used by the other tests.
    for (const actor of [ids.owner, ids.admin]) {
      await assert.rejects(sql(`BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = ${quote(JSON.stringify({ role: 'authenticated', sub: actor }))};
SELECT public.record_credit_transaction(${quote(ids.other)}, 100, 'earn', 'fixture_unauthorized', 1000);
ROLLBACK;`), /42501/, 'record_credit_transaction must reject direct authenticated callers, including admin sessions');
    }
  });

  await t.test('admin and service business debit/refund still append the restricted ledger', async () => {
    const helperSignature = 'public.record_credit_transaction(uuid,integer,text,text,integer,text,text,text,jsonb)';
    assert.equal(await asActor(ids.admin, `SELECT has_function_privilege(current_user, ${quote(helperSignature)}, 'EXECUTE');`), 'f');
    assert.equal(await asActor(null, `SELECT has_function_privilege(current_user, ${quote(helperSignature)}, 'EXECUTE');`, 'service_role'), 't');
    for (const [actor, role] of [[ids.admin, 'authenticated'], [null, 'service_role']]) {
      assert.equal(await asActor(actor, `SELECT public.decrement_ai_chat_count(${quote(ids.other)});`, role), '9');
      assert.equal(await asActor(actor, `SELECT public.increment_ai_chat_count(${quote(ids.other)}, 1);`, role), '10');
    }
    const ledger = JSON.parse(await asActor(ids.other, `SELECT json_agg(json_build_object(
      'amount', amount, 'type', type, 'source', source, 'balance', balance_after) ORDER BY amount)
      FROM public.credit_transactions WHERE user_id = ${quote(ids.other)};`));
    assert.deepEqual(ledger, [
      { amount: -1, type: 'spend', source: 'ai_usage', balance: 9 },
      { amount: -1, type: 'spend', source: 'ai_usage', balance: 9 },
      { amount: 1, type: 'refund', source: 'ai_refund', balance: 10 },
      { amount: 1, type: 'refund', source: 'ai_refund', balance: 10 },
    ]);
  });

  await t.test('concurrent decrements cannot overspend and ledger balances match', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => asActor(ids.admin,
      `SELECT public.decrement_ai_chat_count(${quote(ids.concurrent)});`)));
    assert.deepEqual(results.filter(Boolean).map(Number).sort(), [0, 1, 2, 3]);
    assert.equal(results.filter(value => !value).length, 4);
    assert.equal(await sql(`SELECT ai_chat_count FROM public.users WHERE id = ${quote(ids.concurrent)};`), '0');
    const ledger = JSON.parse(await sql(`SELECT json_build_object('count', count(*), 'amount', sum(amount),
      'balances', array_agg(balance_after ORDER BY balance_after)) FROM public.credit_transactions WHERE user_id = ${quote(ids.concurrent)};`));
    assert.deepEqual(ledger, { count: 4, amount: -4, balances: [0, 1, 2, 3] });
    assert.equal(await asActor(ids.admin, `SELECT public.increment_ai_chat_count(${quote(ids.concurrent)}, 3);`), '3');
    for (const amount of ['0', '-1', 'NULL']) {
      await assert.rejects(asActor(ids.admin, `SELECT public.increment_ai_chat_count(${quote(ids.concurrent)}, ${amount});`), /22023/);
    }
    assert.equal(await sql(`SELECT count(*) FROM public.credit_transactions WHERE user_id = ${quote(ids.concurrent)};`), '5');
  });

  await t.test('ledger failure rolls back both decrement and refund balance changes', async () => {
    // Deliberate local fault injection, not a replacement production constraint.
    await sql(`ALTER TABLE public.credit_transactions ADD CONSTRAINT fixture_reject_ledger CHECK (user_id <> ${quote(ids.rollback)}::uuid) NOT VALID;`);
    try {
      await assert.rejects(asActor(ids.admin, `SELECT public.decrement_ai_chat_count(${quote(ids.rollback)});`), /23514/);
      await assert.rejects(asActor(ids.admin, `SELECT public.increment_ai_chat_count(${quote(ids.rollback)}, 3);`), /23514/);
      assert.equal(await sql(`SELECT ai_chat_count FROM public.users WHERE id = ${quote(ids.rollback)};`), '10');
      assert.equal(await sql(`SELECT count(*) FROM public.credit_transactions WHERE user_id = ${quote(ids.rollback)};`), '0');
    } finally {
      await sql('ALTER TABLE public.credit_transactions DROP CONSTRAINT fixture_reject_ledger;');
    }
  });

  await t.test('conversation create/update keep JSON and normalized messages synchronized', async () => {
    const initial = [{ id: 'm1', role: 'user', content: 'first', createdAt: '2026-01-01T00:00:00.000Z' }];
    const conversation = await createConversation(ids.owner, initial);
    assert.deepEqual(JSON.parse(await sql(`SELECT messages FROM public.conversations WHERE id = ${quote(conversation)};`)), initial);
    assert.equal(await sql(`SELECT content FROM public.conversation_messages WHERE conversation_id = ${quote(conversation)};`), 'first');
    const replacement = [{ id: 'm2', role: 'assistant', content: 'second', model: 'fixture-model', createdAt: '2026-01-02T00:00:00.000Z' }];
    assert.deepEqual(JSON.parse(await asActor(ids.owner, `SELECT public.update_conversation_with_messages(
      ${quote(conversation)}, 'updated', true, NULL, false, ${json(replacement)}, true);`)), { status: 'ok' });
    const stored = JSON.parse(await sql(`SELECT json_build_object('messages', c.messages, 'title', c.title,
      'rows', (SELECT json_agg(json_build_object('id', message_id, 'sequence', sequence, 'content', content, 'metadata', metadata))
      FROM public.conversation_messages WHERE conversation_id = c.id)) FROM public.conversations c WHERE id = ${quote(conversation)};`));
    assert.deepEqual(stored, { messages: replacement, title: 'updated', rows: [{ id: 'm2', sequence: 0, content: 'second', metadata: { model: 'fixture-model' } }] });
  });

  await t.test('conversation ownership, administrator access and non-owner RLS', async () => {
    const conversation = await createConversation(ids.owner);
    await assert.rejects(asActor(ids.other, `SELECT public.create_conversation_with_messages(${quote(ids.owner)}, 'forbidden');`), /42501/);
    await assert.rejects(asActor(ids.other, `SELECT public.update_conversation_with_messages(${quote(conversation)}, 'forbidden', true);`), /42501/);
    await assert.rejects(asActor(null, `SELECT public.create_conversation_with_messages(${quote(ids.owner)}, 'forbidden');`, 'anon'), /42501/);
    assert.equal(await asActor(ids.other, `SELECT count(*) FROM public.conversations WHERE id = ${quote(conversation)};`), '0');
    assert.equal(await asActor(ids.owner, `SELECT count(*) FROM public.conversations WHERE id = ${quote(conversation)};`), '1');
    assert.equal(await asActor(ids.admin, `SELECT count(*) FROM public.conversations WHERE id = ${quote(conversation)};`), '1');
    assert.deepEqual(JSON.parse(await asActor(ids.admin, `SELECT public.update_conversation_with_messages(${quote(conversation)}, 'admin updated', true);`)), { status: 'ok' });
  });

  await t.test('invalid conversation messages roll back header and message writes', async () => {
    const initial = [{ id: 'm1', role: 'assistant', content: 'preserved' }];
    const conversation = await createConversation(ids.owner, initial, 'preserved');
    const beforeCount = await sql('SELECT count(*) FROM public.conversations;');
    await assert.rejects(asActor(ids.owner, `SELECT public.create_conversation_with_messages(${quote(ids.owner)}, 'bad', 'general', 'chat', '{}', '{}');`), /22023/);
    await assert.rejects(asActor(ids.owner, `SELECT public.update_conversation_with_messages(${quote(conversation)}, 'bad', true, NULL, false,
      ${json([{ id: 'bad', role: 'assistant', content: 'bad', createdAt: 'not-a-date' }])}, true);`), /22007/);
    assert.equal(await sql('SELECT count(*) FROM public.conversations;'), beforeCount);
    assert.equal(await sql(`SELECT title FROM public.conversations WHERE id = ${quote(conversation)};`), 'preserved');
    assert.deepEqual(JSON.parse(await sql(`SELECT messages FROM public.conversations WHERE id = ${quote(conversation)};`)), initial);
    assert.equal(await sql(`SELECT content FROM public.conversation_messages WHERE conversation_id = ${quote(conversation)};`), 'preserved');
  });

  await t.test('Tarot admin-session binding preserves an owned reading and conversation/message relations', async () => {
    const payload = { reading_id: ids.tarot, metadata: null };
    await assert.rejects(asActor(ids.owner, tarotHistoryCall(ids.owner, payload)), /42501/);
    const conversation = await asActor(ids.admin, tarotHistoryCall(ids.owner, payload));
    await assertTarotRelation(ids.tarot, conversation, tarotSourceData, { seed: 'draw-seed' });
    assert.equal(await asActor(ids.owner, `SELECT count(*) FROM public.tarot_readings WHERE id = ${quote(ids.tarot)};`), '1');
    assert.equal(await asActor(ids.other, `SELECT count(*) FROM public.tarot_readings WHERE id = ${quote(ids.tarot)};`), '0');
    assert.equal(await asActor(ids.admin, `SELECT count(*) FROM public.tarot_readings WHERE id = ${quote(ids.tarot)};`), '1');
  });

  await t.test('Tarot binding rejects another user reading without orphan conversations/messages', async () => {
    const beforeConversations = await sql('SELECT count(*) FROM public.conversations;');
    const beforeMessages = await sql('SELECT count(*) FROM public.conversation_messages;');
    await assert.rejects(asActor(ids.admin, tarotHistoryCall(ids.owner,
      { reading_id: ids.otherTarot, metadata: { seed: 'cross-user' } })), /P0001:[\s\S]*tarot reading not found/);
    assert.equal(await sql('SELECT count(*) FROM public.conversations;'), beforeConversations);
    assert.equal(await sql('SELECT count(*) FROM public.conversation_messages;'), beforeMessages);
    assert.deepEqual(JSON.parse(await asActor(ids.other, `SELECT json_build_object('conversation', conversation_id, 'metadata', metadata)
      FROM public.tarot_readings WHERE id = ${quote(ids.otherTarot)};`)), { conversation: null, metadata: {} });
  });

  await t.test('Tarot creates and binds a new reading with route-compatible cards and source data', async () => {
    const metadata = { seed: 'tarot-contract-seed' };
    const sourceData = { ...tarotSourceData, seed: metadata.seed };
    const payload = { spread_id: 'single', question: 'Tarot pilot', cards: tarotCards, metadata };
    const beforeReadings = Number(await sql('SELECT count(*) FROM public.tarot_readings;'));
    const conversation = await asActor(ids.admin, tarotHistoryCall(ids.owner, payload, sourceData));
    const reading = await asActor(ids.owner, `SELECT id FROM public.tarot_readings WHERE conversation_id = ${quote(conversation)};`);
    assert.match(reading, /^[a-f0-9-]{36}$/);
    assert.equal(Number(await sql('SELECT count(*) FROM public.tarot_readings;')), beforeReadings + 1);
    await assertTarotRelation(reading, conversation, sourceData, metadata);
  });

  await t.test('Tarot history insert failure rolls back its conversation and normalized messages', async () => {
    const beforeCounts = await sql(`SELECT json_build_object('readings', (SELECT count(*) FROM public.tarot_readings),
      'conversations', (SELECT count(*) FROM public.conversations), 'messages', (SELECT count(*) FROM public.conversation_messages));`);
    // A local-only fault injection after conversation/message creation; the
    // unchanged legacy RPC must roll back all three related writes atomically.
    await sql(`ALTER TABLE public.tarot_readings ADD CONSTRAINT fixture_reject_tarot_history
      CHECK (metadata->>'seed' IS DISTINCT FROM 'force-tarot-rollback') NOT VALID;`);
    try {
      const metadata = { seed: 'force-tarot-rollback' };
      const payload = { spread_id: 'single', question: 'Tarot pilot', cards: tarotCards, metadata };
      await assert.rejects(asActor(ids.admin, tarotHistoryCall(ids.owner, payload,
        { ...tarotSourceData, seed: metadata.seed })), /23514:[\s\S]*fixture_reject_tarot_history/);
      assert.equal(await sql(`SELECT json_build_object('readings', (SELECT count(*) FROM public.tarot_readings),
        'conversations', (SELECT count(*) FROM public.conversations), 'messages', (SELECT count(*) FROM public.conversation_messages));`), beforeCounts);
    } finally {
      await sql('ALTER TABLE public.tarot_readings DROP CONSTRAINT fixture_reject_tarot_history;');
    }
  });

  await t.test('legacy MBTI history binding preserves admin and ownership guards', async () => {
    await assert.rejects(asActor(ids.owner, historyCall(ids.owner, 'mbti', { reading_id: ids.mbti })), /42501/);
    const beforeCount = await sql('SELECT count(*) FROM public.conversations;');
    await assert.rejects(asActor(ids.admin, historyCall(ids.other, 'mbti', { reading_id: ids.mbti })), /mbti reading not found/);
    assert.equal(await sql('SELECT count(*) FROM public.conversations;'), beforeCount);
    const conversation = await asActor(ids.admin, historyCall(ids.owner, 'mbti', { reading_id: ids.mbti }));
    assert.equal(await sql(`SELECT conversation_id FROM public.mbti_readings WHERE id = ${quote(ids.mbti)};`), conversation);
    assert.equal(await sql(`SELECT count(*) FROM public.conversation_messages WHERE conversation_id = ${quote(conversation)};`), '1');
    await assert.rejects(asActor(ids.admin, `SELECT public.create_analysis_conversation_with_history_legacy_as_service(
      ${quote(ids.owner)}, 'mbti', '{}', 'bypass', 'general', '[]', 'mbti', '{}');`), /42501/);
  });

  await t.test('July meihua/xiaoliuren bindings are owner-checked and atomic', async () => {
    for (const type of ['meihua', 'xiaoliuren']) {
      const beforeCount = await sql('SELECT count(*) FROM public.conversations;');
      await assert.rejects(asActor(ids.admin, historyCall(ids.other, type, { divination_id: ids[type] })), /divination not found/);
      assert.equal(await sql('SELECT count(*) FROM public.conversations;'), beforeCount);
      const conversation = await asActor(ids.admin, historyCall(ids.owner, type, { divination_id: ids[type] }));
      assert.equal(await sql(`SELECT conversation_id FROM public.${type}_divinations WHERE id = ${quote(ids[type])};`), conversation);
    }
  });

  await t.test('KB replace enforces caller ownership, chunk uniqueness and real vector reset', async () => {
    const entries = [0, 1, 2].map(chunk_index => ({ chunk_index, content: `chunk ${chunk_index}`, metadata: {} }));
    await assert.rejects(asActor(ids.other, replaceEntries(entries)), /42501/);
    // p_user_id is an override only for the service-role branch, not admin claims.
    await assert.rejects(asActor(ids.admin, replaceEntries(entries, false, ids.owner)), /42501/);
    assert.equal(await asActor(ids.owner, replaceEntries(entries, true)), '3');
    await sql(`UPDATE public.knowledge_entries SET content_vector = '[1,2,3]'::extensions.vector,
      metadata = '{"embedding_model":"fixture","embedding_dim":3}' WHERE kb_id = ${quote(ids.kb)} AND source_id = ${quote(ids.source)};`);
    assert.equal(await asActor(null, replaceEntries(entries.slice(0, 1), true, ids.owner), 'service_role'), '1');
    const rows = JSON.parse(await asActor(ids.owner, `SELECT json_agg(json_build_object('chunk', chunk_index, 'vector', content_vector))
      FROM public.knowledge_entries WHERE kb_id = ${quote(ids.kb)} AND source_id = ${quote(ids.source)};`));
    assert.deepEqual(rows, [{ chunk: 0, vector: null }]);
    assert.equal(await sql(`SELECT count(*) FROM public.archived_sources WHERE kb_id = ${quote(ids.kb)} AND source_id = ${quote(ids.source)};`), '1');
    assert.equal(await asActor(ids.other, `SELECT count(*) FROM public.knowledge_entries WHERE kb_id = ${quote(ids.kb)};`), '0');
  });

  await t.test('KB replacement failure restores chunks deleted earlier in the transaction', async () => {
    const entries = [0, 1, 2].map(chunk_index => ({ chunk_index, content: `preserved ${chunk_index}`, metadata: {} }));
    await asActor(ids.owner, replaceEntries(entries));
    await assert.rejects(asActor(ids.owner, replaceEntries([{ chunk_index: 0, content: null }])), /23502/);
    const rows = JSON.parse(await asActor(ids.owner, `SELECT json_agg(content ORDER BY chunk_index)
      FROM public.knowledge_entries WHERE kb_id = ${quote(ids.kb)} AND source_id = ${quote(ids.source)};`));
    assert.deepEqual(rows, entries.map(entry => entry.content));
  });

  await t.test('FTS returns only owner KB matches through the unchanged SQL RPC', async () => {
    const rows = JSON.parse(await asActor(ids.owner, `SELECT coalesce(json_agg(kb_id), '[]'::json)
      FROM public.search_knowledge_fts('alpha', NULL, 10, 'simple');`));
    assert.deepEqual(rows, [ids.kb]);
  });

  await t.test('trigram resolves the real relocated extension and filters ownership', async () => {
    const rows = JSON.parse(await asActor(ids.owner, `SELECT coalesce(json_agg(kb_id), '[]'::json)
      FROM public.search_knowledge_trigram('alpha galaxy', NULL, 10, 0.1);`));
    assert.deepEqual(rows, [ids.kb]);
  });

  await t.test('vector RPC resolves real vector casts/operators and filters ownership', async () => {
    const rows = JSON.parse(await asActor(ids.owner, `SELECT coalesce(json_agg(json_build_object('kb', kb_id, 'distance', distance)), '[]'::json)
      FROM public.search_knowledge_vector(ARRAY[1,0,0]::float8[], NULL, 10, 3);`));
    assert.deepEqual(rows, [{ kb: ids.kb, distance: 0 }]);
  });

  await t.test('search denies anonymous execution and authenticated sessions without identity', async () => {
    for (const call of ["search_knowledge_fts('alpha')", "search_knowledge_trigram('alpha')", 'search_knowledge_vector(ARRAY[1,0,0]::float8[], NULL, 10, 3)']) {
      await assert.rejects(asActor(null, `SELECT * FROM public.${call};`, 'anon'), /42501:[\s\S]*permission denied for function search_knowledge_/);
      await assert.rejects(asActor(null, `SELECT * FROM public.${call};`), /P0001:[\s\S]*Not authenticated/);
    }
  });
});
