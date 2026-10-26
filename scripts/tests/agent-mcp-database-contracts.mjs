import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const literal = value => value === null ? 'NULL' : typeof value === 'object' ? json(value) : quote(value);

// agent_mcp_servers: a platform server (no owner) is the administrators', a connector belongs to the user who added it.
// The worker reads both as an administrator but writes only platform rows, so no one but its owner can point a
// connector's saved secrets at another address.
export async function agentMcpDatabaseContracts(t, { sql, asActor, asOwner, adminId }) {
  const owner = randomUUID(), other = randomUUID(), leaving = randomUUID();
  await sql(`INSERT INTO identity.users(id) VALUES(${quote(owner)}),(${quote(other)}),(${quote(leaving)});`);
  const add = (actor, ownerId, name, extra = {}) => {
    const columns = { owner_id: ownerId, name, display_name: name, url: `https://${name.replaceAll('_', '-')}.example.com/mcp`, ...extra };
    return asActor(actor, `INSERT INTO public.agent_mcp_servers(${Object.keys(columns).join(',')})
      VALUES(${Object.values(columns).map(literal).join(',')}) RETURNING id;`);
  };
  const names = actor => asActor(actor, "SELECT coalesce(string_agg(name || ':' || coalesce(owner_id::text, 'platform'), ',' ORDER BY owner_id NULLS FIRST, name), '') FROM public.agent_mcp_servers;");
  const sealed = { 'x-api-key': { version: 1, iv: 'aXY=', tag: 'dGFn', data: 'c2VhbGVk' } };

  await t.test('platform MCP servers are administrators\' and a connector is only its owner\'s', async () => {
    const platform = await add(adminId, null, 'exa', { secret_headers: sealed, exposure: 'hidden', search_tool: 'web_search_exa', result_adapter: 'exa' });
    await assert.rejects(add(owner, null, 'forged'), /42501/, 'a member cannot add a platform server');
    await assert.rejects(add(owner, other, 'planted'), /42501/, 'nor a connector in another account');
    await assert.rejects(add(adminId, owner, 'planted'), /42501/, 'nor can an administrator');
    const own = await add(owner, owner, 'exa', { secret_headers: sealed });

    assert.equal(await names(owner), `exa:${owner}`, 'a member sees only their own connectors, not the platform\'s');
    assert.equal(await names(other), '');
    assert.equal(await names(adminId), `exa:platform,exa:${owner}`, 'the worker reads every server');
    await assert.rejects(asActor(null, 'SELECT count(*) FROM public.agent_mcp_servers;', 'anon'), /42501/);

    // Neither another member nor an administrator can change or remove a connector: both touch no row.
    for (const actor of [other, adminId]) {
      assert.equal(await asActor(actor, `UPDATE public.agent_mcp_servers SET url='https://evil.example.com/mcp' WHERE id=${quote(own)} RETURNING id;`), '');
      assert.equal(await asActor(actor, `DELETE FROM public.agent_mcp_servers WHERE id=${quote(own)} RETURNING id;`), '');
    }
    assert.equal(await asActor(owner, `UPDATE public.agent_mcp_servers SET url='https://evil.example.com/mcp' WHERE id=${quote(platform)} RETURNING id;`), '');
    await assert.rejects(asActor(owner, `UPDATE public.agent_mcp_servers SET owner_id=${quote(other)} WHERE id=${quote(own)};`), /42501/);
    await assert.rejects(asActor(owner, `UPDATE public.agent_mcp_servers SET owner_id=NULL WHERE id=${quote(own)};`), /42501/,
      'a connector cannot become a platform server');
    assert.equal(await asActor(adminId, `SELECT url FROM public.agent_mcp_servers WHERE id=${quote(own)};`), 'https://exa.example.com/mcp');

    assert.equal(await asActor(owner, `UPDATE public.agent_mcp_servers SET display_name='我的 Exa' WHERE id=${quote(own)} RETURNING updated_at > created_at;`), 't');
    assert.equal(await asActor(adminId, `UPDATE public.agent_mcp_servers SET is_enabled=false WHERE id=${quote(platform)} RETURNING is_enabled;`), 'f');
    assert.equal(await asActor(owner, `DELETE FROM public.agent_mcp_servers WHERE id=${quote(own)} RETURNING id;`), own);
  });

  await t.test('the server table rejects shapes the application never writes', async () => {
    for (const extra of [
      { exposure: 'hidden' }, { exposure: 'codemode' }, { search_tool: 'web_search_exa' }, { fetch_tool: 'web_fetch_exa' },
      { url: 'http://plain.example.com/mcp' }, { timeout_ms: 1000 }, { max_result_chars: 1000 }, { headers: [] },
      { required_tier: 'gold' }, { display_name: '   ' },
    ]) await assert.rejects(add(owner, owner, 'shape', extra), /23514/, JSON.stringify(extra));
    await assert.rejects(add(owner, owner, 'Bad-Name'), /23514/);
    await add(owner, owner, 'notes');
    await assert.rejects(add(owner, owner, 'notes'), /23505/);
    await assert.rejects(add(adminId, null, 'exa'), /23505/, 'platform names are unique although their owner is NULL');
    assert.match(await add(other, other, 'notes'), /^[0-9a-f-]{36}$/, 'another member may use the same name');
  });

  await t.test('a deleted account takes its connectors with it', async () => {
    await add(leaving, leaving, 'diary');
    await asOwner(`DELETE FROM public.users WHERE id=${quote(leaving)};`);
    assert.equal(await asActor(adminId, `SELECT count(*) FROM public.agent_mcp_servers WHERE owner_id=${quote(leaving)};`), '0');
  });

  await t.test('app settings hold JSON: the extensions policy object beside the boolean switches', async () => {
    const policy = { connectors: { enabled: false, tiers: ['pro'], limits: { free: 0, plus: 0, pro: 5 } } };
    await asActor(adminId, `INSERT INTO public.app_settings(setting_key, setting_value) VALUES('agent_extensions_policy', ${json(policy)})
      ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value;`);
    await asActor(adminId, "INSERT INTO public.app_settings(setting_key) VALUES('fixture_switch') ON CONFLICT(setting_key) DO NOTHING;");
    const stored = JSON.parse(await asActor(adminId, `SELECT json_object_agg(setting_key, setting_value)
      FROM public.app_settings WHERE setting_key IN ('agent_extensions_policy', 'fixture_switch');`));
    assert.deepEqual(stored, { agent_extensions_policy: policy, fixture_switch: false });
    assert.equal(await asActor(owner, 'SELECT count(*) FROM public.app_settings;'), '0', 'members read no settings directly');
    assert.equal(await asActor(owner, "UPDATE public.app_settings SET setting_value='true' WHERE setting_key='fixture_switch' RETURNING 1;"), '',
      'nor change them');
  });
}
