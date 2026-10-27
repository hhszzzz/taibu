import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
/** A value as SQL: `{ sql }` passes an expression through, for arrays, JSON and contents too long to write out. */
const literal = value => value === null ? 'NULL' : typeof value === 'object' ? value.sql : quote(value);

// agent_profiles: Agent roles are the administrators' alone. Members never read them; the server lists the roles a
// member may choose through the system identity, which reads as an administrator.
export async function agentProfilesDatabaseContracts(t, { sql, asActor, adminId }) {
  const member = randomUUID();
  await sql(`INSERT INTO identity.users(id) VALUES(${quote(member)});`);
  const add = (actor, name, extra = {}) => {
    const columns = { name, display_name: '档案员', ...extra };
    return asActor(actor, `INSERT INTO public.agent_profiles(${Object.keys(columns).join(',')})
      VALUES(${Object.values(columns).map(literal).join(',')}) RETURNING name;`);
  };

  await t.test('roles are read and written by administrators only', async () => {
    assert.equal(await add(adminId, 'archivist', {
      tools: { sql: `'{"inherit": false, "allow": ["web", "mcp:exa"], "deny": []}'::jsonb` }, skills: { sql: "ARRAY['case-review']" },
      modes: { sql: "ARRAY['parallel']" }, model: 'fixture-model', reasoning_effort: 'high', required_tier: 'plus',
    }), 'archivist');
    await assert.rejects(add(member, 'forged'), /42501/, 'a member cannot add a role');
    assert.equal(await asActor(member, 'SELECT count(*) FROM public.agent_profiles;'), '0', 'nor read one');
    assert.equal(await asActor(member, "UPDATE public.agent_profiles SET is_enabled=false WHERE name='archivist' RETURNING name;"), '');
    assert.equal(await asActor(member, "DELETE FROM public.agent_profiles WHERE name='archivist' RETURNING name;"), '');
    await assert.rejects(asActor(null, 'SELECT count(*) FROM public.agent_profiles;', 'anon'), /42501/);

    assert.equal(await asActor(adminId, "SELECT name || ':' || array_to_string(modes, '+') || ':' || (tools->'allow'->>1) || ':' || required_tier FROM public.agent_profiles;"),
      'archivist:parallel:mcp:exa:plus');
    assert.equal(await asActor(adminId, "UPDATE public.agent_profiles SET description='整理资料' WHERE name='archivist' RETURNING updated_at > created_at;"), 't');
    assert.equal(await asActor(adminId, "DELETE FROM public.agent_profiles WHERE name='archivist' RETURNING name;"), 'archivist');
  });

  await t.test('the roles table rejects shapes the application never writes', async () => {
    for (const name of ['specialist', 'researcher', 'verifier', 'Bad', 'a', '1abc', 'a_b', 'a'.repeat(33)])
      await assert.rejects(add(adminId, name), /23514/, `${name}: built-in names are reserved`);
    for (const extra of [
      { display_name: '   ' }, { display_name: '一二三四五六七八九十一二三' }, { description: { sql: "repeat('述', 301)" } },
      { instructions: { sql: "repeat('令', 8001)" } }, { tools: { sql: "'[]'::jsonb" } }, { skills: { sql: "ARRAY['a','b','c','d','e']" } },
      { model: '' }, { reasoning_effort: 'extreme' }, { modes: { sql: 'ARRAY[]::text[]' } }, { modes: { sql: "ARRAY['solo']" } },
      { required_tier: 'gold' },
    ]) await assert.rejects(add(adminId, 'shape', extra), /23514/, JSON.stringify(extra));
    assert.equal(await add(adminId, 'scribe'), 'scribe');
    await assert.rejects(add(adminId, 'scribe'), /23505/);
    assert.equal(await asActor(adminId, "SELECT tools::text || ':' || array_to_string(modes, '+') || ':' || required_tier FROM public.agent_profiles WHERE name='scribe';"),
      '{"deny": [], "allow": [], "inherit": false}:parallel+background:free', 'a role defaults to no tools, both modes and every member');
    await asActor(adminId, "DELETE FROM public.agent_profiles WHERE name='scribe';");
  });
}
