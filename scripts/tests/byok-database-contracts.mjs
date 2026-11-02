import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
/** A value as SQL: `{ sql }` passes an expression through. */
const literal = value => value === null ? 'NULL' : typeof value === 'object' ? value.sql : quote(value);
const SEALED = { sql: `'{"v":1,"iv":"x","tag":"y","data":"z"}'::jsonb` };

// user_ai_connections / user_ai_models: a member's own model connections and the models under them belong to that
// member alone, and a model only sits under a connection of the same member. The worker reads them as an
// administrator (a task or a scheduled run opens the key stored here) but writes none of them.
export async function byokDatabaseContracts(t, { sql, asActor, adminId }) {
  const owner = randomUUID(), other = randomUUID();
  await sql(`INSERT INTO identity.users(id) VALUES(${quote(owner)}),(${quote(other)});`);
  const insert = (actor, table, columns) => asActor(actor,
    `INSERT INTO public.${table}(${Object.keys(columns).join(',')}) VALUES(${Object.values(columns).map(literal).join(',')}) RETURNING id;`);
  const connect = (actor, userId, extra = {}) =>
    insert(actor, 'user_ai_connections', { user_id: userId, name: '夹具中转', base_url: 'https://relay.example/v1', ...extra });
  const addModel = (actor, userId, connectionId, extra = {}) =>
    insert(actor, 'user_ai_models', { user_id: userId, connection_id: connectionId, model_id: 'deepseek-chat', display_name: 'DeepSeek', ...extra });
  const listed = actor => asActor(actor, `SELECT coalesce(string_agg(c.name || '/' || coalesce(m.model_id, '-'), ',' ORDER BY c.name, m.model_id), '')
    FROM public.user_ai_connections c LEFT JOIN public.user_ai_models m ON m.connection_id = c.id WHERE c.user_id IN (${quote(owner)}, ${quote(other)});`);

  await t.test('a member\'s connections and their models are theirs alone; the worker reads them without writing', async () => {
    const mine = await connect(owner, owner, { api_key_secret: SEALED, api_key_hint: 'sk-…abcd' });
    await addModel(owner, owner, mine);
    const theirs = await connect(other, other, { name: '他人中转' });
    await assert.rejects(connect(owner, other), /42501/, 'a member cannot add a connection to another account');
    await assert.rejects(connect(adminId, owner), /42501/, 'nor can an administrator');
    await assert.rejects(addModel(owner, owner, theirs), /42501/, 'a model cannot sit under another member\'s connection');
    await assert.rejects(addModel(other, owner, mine), /42501/, 'nor be added for another member');
    await assert.rejects(addModel(adminId, owner, mine), /42501/);

    assert.equal(await listed(owner), '夹具中转/deepseek-chat');
    assert.equal(await listed(other), '他人中转/-');
    assert.equal(await listed(adminId), '他人中转/-,夹具中转/deepseek-chat', 'the worker reads every member\'s');
    assert.equal(await asActor(adminId, `SELECT api_key_secret->>'v' FROM public.user_ai_connections WHERE id=${quote(mine)};`), '1',
      'including the sealed key it opens for a task');
    await assert.rejects(asActor(null, 'SELECT count(*) FROM public.user_ai_connections;', 'anon'), /42501/);
    await assert.rejects(asActor(null, 'SELECT count(*) FROM public.user_ai_models;', 'anon'), /42501/);

    // Neither another member nor an administrator can change or remove them: both touch no row.
    for (const actor of [other, adminId]) {
      assert.equal(await asActor(actor, `UPDATE public.user_ai_connections SET base_url='https://evil.example' WHERE id=${quote(mine)} RETURNING id;`), '');
      assert.equal(await asActor(actor, `UPDATE public.user_ai_models SET model_id='planted' WHERE connection_id=${quote(mine)} RETURNING id;`), '');
      assert.equal(await asActor(actor, `DELETE FROM public.user_ai_models WHERE connection_id=${quote(mine)} RETURNING id;`), '');
      assert.equal(await asActor(actor, `DELETE FROM public.user_ai_connections WHERE id=${quote(mine)} RETURNING id;`), '');
    }
    await assert.rejects(asActor(owner, `UPDATE public.user_ai_connections SET user_id=${quote(other)} WHERE id=${quote(mine)};`), /42501/,
      'a connection cannot be handed to another account');
    await assert.rejects(asActor(owner, `UPDATE public.user_ai_models SET connection_id=${quote(theirs)} WHERE connection_id=${quote(mine)};`), /42501/,
      'nor a model moved under another member\'s connection');

    assert.equal(await asActor(owner, `UPDATE public.user_ai_connections SET name='改名' WHERE id=${quote(mine)} RETURNING updated_at > created_at;`), 't');
    assert.equal(await asActor(owner, `UPDATE public.user_ai_models SET display_name='深度求索' WHERE connection_id=${quote(mine)} RETURNING updated_at > created_at;`), 't');
    assert.equal(await asActor(owner, `DELETE FROM public.user_ai_connections WHERE id=${quote(mine)} RETURNING id;`), mine);
    assert.equal(await asActor(adminId, `SELECT count(*) FROM public.user_ai_models WHERE connection_id=${quote(mine)};`), '0',
      'a removed connection takes its models with it');
    assert.equal(await asActor(other, `DELETE FROM public.user_ai_connections WHERE id=${quote(theirs)} RETURNING id;`), theirs);
  });

  await t.test('the tables reject shapes the application never writes', async () => {
    for (const extra of [
      { base_url: 'http://relay.example/v1' }, { base_url: { sql: "'https://' || repeat('a', 250)" } },
      { name: '   ' }, { name: { sql: "repeat('名', 41)" } }, { protocol: 'gemini' },
      { api_key_secret: SEALED }, { api_key_hint: 'sk-…abcd' }, { api_key_secret: { sql: "'[]'::jsonb" }, api_key_hint: 'sk-…abcd' },
      { api_key_secret: SEALED, api_key_hint: { sql: "repeat('h', 17)" } },
    ]) await assert.rejects(connect(owner, owner, extra), /23514/, JSON.stringify(extra));
    const connection = await connect(owner, owner);

    let next = 0;
    const shaped = extra => addModel(owner, owner, connection, { model_id: `shape-${++next}`, ...extra });
    for (const extra of [
      { usage: 'embedding' }, { model_id: '  ' }, { model_id: { sql: "repeat('m', 129)" } }, { display_name: ' ' },
      { display_name: { sql: "repeat('名', 129)" } }, { thinking_levels: { sql: "ARRAY['turbo']::text[]" } }, { default_effort: 'turbo' },
      { thinking_levels: { sql: "ARRAY['low','high']::text[]" }, default_effort: 'medium' }, { context_window: '512' },
      { context_window: '10000001' }, { max_output: '0' },
    ]) await assert.rejects(shaped(extra), /23514/, JSON.stringify(extra));
    for (const extra of [
      // Known levels bound the default; with none known any level is allowed, as the menu then offers all six.
      { thinking_levels: { sql: "ARRAY['low','high']::text[]" }, default_effort: 'high' },
      { default_effort: 'xhigh' }, { default_effort: 'auto' }, { default_effort: 'off' },
      { context_window: '1024', max_output: '1000000' },
    ]) assert.match(await shaped(extra), /^[0-9a-f-]{36}$/, JSON.stringify(extra));

    await addModel(owner, owner, connection);
    await assert.rejects(addModel(owner, owner, connection), /23505/, 'a model is listed once per use');
    assert.match(await addModel(owner, owner, connection, { usage: 'image' }), /^[0-9a-f-]{36}$/, 'the same ID may also be an image model');
    assert.match(await addModel(owner, owner, await connect(owner, owner)), /^[0-9a-f-]{36}$/, 'and appear under another connection');
  });
}
