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
    assert.equal(await asOwner(mine.sql), mine.id);
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

  await t.test('per-image credits decrement only for administrators and never below zero', async () => {
    await asOwner(`UPDATE public.users SET ai_chat_count=10 WHERE id=${quote(owner)};`);
    await assert.rejects(asActor(owner, `SELECT public.decrement_ai_chat_count_by(${quote(owner)}, 3);`), /42501/);
    assert.equal(await asActor(adminId, `SELECT public.decrement_ai_chat_count_by(${quote(owner)}, 3);`), '7');
    assert.equal(await asActor(adminId, `SELECT public.decrement_ai_chat_count_by(${quote(owner)}, 8);`), '', 'a charge larger than the balance deducts nothing');
    assert.equal(await asActor(adminId, `SELECT ai_chat_count FROM public.users WHERE id=${quote(owner)};`), '7');
    const ledger = JSON.parse(await asActor(adminId, `SELECT json_agg(json_build_object('amount', amount, 'balance', balance_after))
      FROM public.credit_transactions WHERE user_id=${quote(owner)};`));
    assert.deepEqual(ledger, [{ amount: -3, balance: 7 }]);
    await assert.rejects(asActor(adminId, `SELECT public.decrement_ai_chat_count_by(${quote(owner)}, 0);`), /22023/);
  });
}
