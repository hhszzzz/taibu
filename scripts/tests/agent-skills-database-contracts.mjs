import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
/** A value as SQL: `{ sql }` passes an expression through, for contents too long to write out. */
const literal = value => value === null ? 'NULL' : typeof value === 'object' ? value.sql : quote(value);
const SKILL = '---\nname: fixture\ndescription: 夹具技能\n---\n先读命盘。';

// agent_skills: a platform skill (no owner) is the administrators', a user's skill belongs to the user who added it,
// and agent_skill_files follow the skill they belong to. The worker reads all of them as an administrator but writes
// only platform rows.
export async function agentSkillsDatabaseContracts(t, { sql, asActor, asOwner, adminId }) {
  const owner = randomUUID(), other = randomUUID(), leaving = randomUUID();
  await sql(`INSERT INTO identity.users(id) VALUES(${quote(owner)}),(${quote(other)}),(${quote(leaving)});`);
  const add = (actor, ownerId, name, extra = {}) => {
    const columns = { owner_id: ownerId, name, description: '夹具技能', content: SKILL, ...extra };
    return asActor(actor, `INSERT INTO public.agent_skills(${Object.keys(columns).join(',')})
      VALUES(${Object.values(columns).map(literal).join(',')}) RETURNING id;`);
  };
  const addFile = (actor, skillId, path, content = '术语表') =>
    asActor(actor, `INSERT INTO public.agent_skill_files(skill_id, path, content) VALUES(${quote(skillId)}, ${literal(path)}, ${literal(content)}) RETURNING path;`);
  const names = actor => asActor(actor, "SELECT coalesce(string_agg(name || ':' || coalesce(owner_id::text, 'platform'), ',' ORDER BY owner_id NULLS FIRST, name), '') FROM public.agent_skills;");
  const files = actor => asActor(actor, "SELECT coalesce(string_agg(s.name || '/' || f.path, ',' ORDER BY s.owner_id NULLS FIRST, f.path), '') FROM public.agent_skill_files f JOIN public.agent_skills s ON s.id = f.skill_id;");

  await t.test('platform skills are administrators\' and a user\'s skill, files included, is only its owner\'s', async () => {
    const platform = await add(adminId, null, 'case-review', { required_tier: 'pro' });
    await assert.rejects(add(owner, null, 'forged'), /42501/, 'a member cannot add a platform skill');
    await assert.rejects(add(owner, other, 'planted'), /42501/, 'nor a skill in another account');
    await assert.rejects(add(adminId, owner, 'planted'), /42501/, 'nor can an administrator');
    const own = await add(owner, owner, 'case-review');

    assert.equal(await names(owner), `case-review:${owner}`, 'a member sees only their own skills, not the platform\'s');
    assert.equal(await names(other), '');
    assert.equal(await names(adminId), `case-review:platform,case-review:${owner}`, 'the worker reads every skill');
    await assert.rejects(asActor(null, 'SELECT count(*) FROM public.agent_skills;', 'anon'), /42501/);
    await assert.rejects(asActor(null, 'SELECT count(*) FROM public.agent_skill_files;', 'anon'), /42501/);

    assert.equal(await addFile(adminId, platform, 'refs/terms.md'), 'refs/terms.md');
    assert.equal(await addFile(owner, own, 'notes.md'), 'notes.md');
    await assert.rejects(addFile(owner, platform, 'planted.md'), /42501/, 'a member cannot add a file to a platform skill');
    await assert.rejects(addFile(other, own, 'planted.md'), /42501/, 'nor to another member\'s skill');
    await assert.rejects(addFile(adminId, own, 'planted.md'), /42501/, 'nor can an administrator');
    assert.equal(await files(owner), 'case-review/notes.md');
    assert.equal(await files(other), '');
    assert.equal(await files(adminId), 'case-review/refs/terms.md,case-review/notes.md', 'the worker reads every file');

    // Neither another member nor an administrator can change or remove a user's skill or its files: both touch no row.
    for (const actor of [other, adminId]) {
      assert.equal(await asActor(actor, `UPDATE public.agent_skills SET content=${quote(SKILL.replace('先读命盘。', '改写'))} WHERE id=${quote(own)} RETURNING id;`), '');
      assert.equal(await asActor(actor, `UPDATE public.agent_skill_files SET content='改写' WHERE skill_id=${quote(own)} RETURNING path;`), '');
      assert.equal(await asActor(actor, `DELETE FROM public.agent_skill_files WHERE skill_id=${quote(own)} RETURNING path;`), '');
      assert.equal(await asActor(actor, `DELETE FROM public.agent_skills WHERE id=${quote(own)} RETURNING id;`), '');
    }
    assert.equal(await asActor(owner, `UPDATE public.agent_skills SET is_enabled=false WHERE id=${quote(platform)} RETURNING id;`), '');
    assert.equal(await asActor(owner, `DELETE FROM public.agent_skill_files WHERE skill_id=${quote(platform)} RETURNING path;`), '');
    await assert.rejects(asActor(owner, `UPDATE public.agent_skills SET owner_id=${quote(other)} WHERE id=${quote(own)};`), /42501/);
    await assert.rejects(asActor(owner, `UPDATE public.agent_skills SET owner_id=NULL WHERE id=${quote(own)};`), /42501/,
      'a user\'s skill cannot become a platform skill');
    await assert.rejects(asActor(owner, `UPDATE public.agent_skill_files SET skill_id=${quote(platform)} WHERE skill_id=${quote(own)};`), /42501/,
      'nor can its file move to one');

    assert.equal(await asActor(owner, `UPDATE public.agent_skills SET version=version+1 WHERE id=${quote(own)} RETURNING updated_at > created_at;`), 't');
    assert.equal(await asActor(owner, `UPDATE public.agent_skill_files SET content='新术语表' WHERE skill_id=${quote(own)} RETURNING content;`), '新术语表');
    assert.equal(await asActor(adminId, `UPDATE public.agent_skills SET is_enabled=false WHERE id=${quote(platform)} RETURNING is_enabled;`), 'f');
    assert.equal(await asActor(owner, `DELETE FROM public.agent_skills WHERE id=${quote(own)} RETURNING id;`), own);
    assert.equal(await files(adminId), 'case-review/refs/terms.md', 'a removed skill takes its files with it');
  });

  await t.test('the skill tables reject shapes the application never writes', async () => {
    for (const extra of [
      { description: '   ' }, { description: { sql: "repeat('述', 1025)" } }, { content: { sql: "repeat('x', 131073)" } },
      { required_tier: 'gold' }, { required_tier: 'pro' }, { version: '0' },
    ]) await assert.rejects(add(owner, owner, 'shape', extra), /23514/, JSON.stringify(extra));
    for (const name of ['Bad-Name', 'a--b', '-a', 'a-', 'a_b', 'a'.repeat(65)]) await assert.rejects(add(owner, owner, name), /23514/, name);
    const skill = await add(owner, owner, 'notes');
    await assert.rejects(add(owner, owner, 'notes'), /23505/);
    await add(adminId, null, 'platform-notes');
    await assert.rejects(add(adminId, null, 'platform-notes'), /23505/, 'platform names are unique although their owner is NULL');
    assert.match(await add(other, other, 'notes'), /^[0-9a-f-]{36}$/, 'another member may use the same name');

    for (const path of ['../secret', 'a/../b', 'a/./b', '/etc/passwd', 'a//b', 'a/', 'a\\b', { sql: "'a' || chr(10) || 'b'" }, { sql: "repeat('p', 257)" }])
      await assert.rejects(addFile(owner, skill, path), /23514/, JSON.stringify(path));
    await assert.rejects(addFile(owner, skill, 'big.md', { sql: "repeat('x', 1048577)" }), /23514/);
    assert.equal(await addFile(owner, skill, '.hidden/说明 1.md'), '.hidden/说明 1.md');
    await assert.rejects(addFile(owner, skill, '.hidden/说明 1.md'), /23505/);
  });

  await t.test('a deleted account takes its skills and their files with it', async () => {
    const skill = await add(leaving, leaving, 'diary');
    await addFile(leaving, skill, 'notes.md');
    await asOwner(`DELETE FROM public.users WHERE id=${quote(leaving)};`);
    assert.equal(await asActor(adminId, `SELECT count(*) FROM public.agent_skills WHERE owner_id=${quote(leaving)};`), '0');
    assert.equal(await asActor(adminId, `SELECT count(*) FROM public.agent_skill_files WHERE skill_id=${quote(skill)};`), '0');
  });
}
