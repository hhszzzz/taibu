import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const hex = value => value.repeat(64).slice(0, 64);

// generated_images: owner-only reads and deletes, admin/worker writes, and the share token's read function.
export async function generatedImagesDatabaseContracts(t, { sql, asActor, asOwner, adminId }) {
  const owner = randomUUID(), other = randomUUID();
  await sql(`INSERT INTO identity.users(id) VALUES(${quote(owner)}),(${quote(other)});`);
  const conversation = randomUUID(), foreignConversation = randomUUID();
  await asOwner(`INSERT INTO public.conversations(id,user_id,title) VALUES
    (${quote(conversation)},${quote(owner)},'images'),(${quote(foreignConversation)},${quote(other)},'other');`);
  const token = 'A'.repeat(43);
  const image = (userId, conv = conversation, extra = {}) => {
    const id = extra.id ?? randomUUID();
    const row = { id, user_id: userId, conversation_id: conv, model_id: 'image-fixture', prompt: '水墨山居', size: '1024x1024',
      object_path: `${userId}/${id}.png`, mime_type: 'image/png', bytes: 1024, sha256: hex('a'), ...extra };
    return { id, sql: `INSERT INTO public.generated_images(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(value => value === null ? 'NULL' : quote(value)).join(',')}) RETURNING id;` };
  };

  await t.test('images are the owner\'s to read and delete, and the backend writes them', async () => {
    const mine = image(owner);
    // The service writes through systemDb(), which runs as the authenticated
    // role with the system principal's claims; insert as that role, not the owner.
    assert.equal(await asActor(adminId, mine.sql), mine.id);
    await assert.rejects(asActor(owner, image(owner, conversation, { id: randomUUID() }).sql), /42501|permission denied/u,
      'a member cannot insert an image row, not even their own');
    assert.equal(await asActor(owner, `SELECT count(*) FROM public.generated_images WHERE id=${quote(mine.id)};`), '1');
    assert.equal(await asActor(other, `SELECT count(*) FROM public.generated_images WHERE id=${quote(mine.id)};`), '0');
    assert.equal(await asActor(adminId, `SELECT count(*) FROM public.generated_images WHERE id=${quote(mine.id)};`), '1', 'the backend reads every image');
    await assert.rejects(asActor(null, 'SELECT count(*) FROM public.generated_images;', 'anon'), /42501/);

    assert.equal(await asActor(other, `DELETE FROM public.generated_images WHERE id=${quote(mine.id)} RETURNING id;`), '', 'another account deletes nothing');
    assert.equal(await asActor(owner, `DELETE FROM public.generated_images WHERE id=${quote(mine.id)} RETURNING id;`), mine.id);
  });

  await t.test('the image table rejects shapes the application never writes', async () => {
    for (const extra of [
      { size: '10x10' }, { mime_type: 'image/gif' }, { sha256: 'not-a-digest' }, { prompt: '   ' }, { bytes: 0 }, { bytes: 52_428_801 },
    ]) await assert.rejects(asOwner(image(owner, conversation, extra).sql), /23514/, JSON.stringify(extra));
    const first = image(owner);
    await asOwner(first.sql);
    await assert.rejects(asOwner(image(owner, conversation, { id: first.id }).sql), /23505/, 'the object path is unique');
  });

  await t.test('an active share reads only its conversation\'s images', async () => {
    const shared = image(owner), foreign = image(other, foreignConversation);
    await asOwner(shared.sql);
    await asOwner(foreign.sql);
    await asOwner(`INSERT INTO public.conversation_shares(token,user_id,conversation_id,title)
      VALUES(${quote(token)},${quote(owner)},${quote(conversation)},'images');`);
    const read = (id, actor = 'anon') => asActor(null, `SELECT object_path FROM public.get_shared_generated_image(${quote(token)},${quote(id)});`, actor);
    assert.equal(await read(shared.id), `${owner}/${shared.id}.png`);
    assert.equal(await read(foreign.id), '', 'a share never exposes another conversation');
    assert.equal(await asActor(null, `SELECT object_path FROM public.get_shared_generated_image(${quote('B'.repeat(43))},${quote(shared.id)});`, 'anon'), '');
    await asOwner(`UPDATE public.conversation_shares SET revoked_at=now() WHERE token=${quote(token)};`);
    assert.equal(await read(shared.id), '');
  });
}
