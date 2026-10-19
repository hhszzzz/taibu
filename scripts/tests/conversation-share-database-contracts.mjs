import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const token = () => randomBytes(32).toString('base64url');

/** Public share table, RLS and RPC contracts; runs inside the disposable PostgreSQL fixture only. */
export async function conversationShareDatabaseContracts(t, { sql, asActor }) {
  const owner = randomUUID(), other = randomUUID();
  await sql(`INSERT INTO auth.users(id) VALUES (${quote(owner)}),(${quote(other)});`);
  const createConversation = async () => (await asActor(owner,
    `SELECT public.create_conversation_with_messages(${quote(owner)},'分享夹具','general','chat','{}',${json([{ id: 'u', role: 'user', content: '问题', createdAt: '2026-10-19T00:00:00Z' }])});`)).trim();
  const version = conversation => `(SELECT updated_at FROM public.conversations WHERE id=${quote(conversation)})`;
  const upsert = (actor, conversation, candidate, snapshot = [{ role: 'user', content: '问题' }], includeCharts = false, sourceVersion = version(conversation)) => asActor(actor,
    `SELECT row_to_json(s) FROM public.upsert_conversation_share(${quote(conversation)},${quote(candidate)},'分享夹具',${json(snapshot)},${includeCharts},${sourceVersion}) s;`);
  const lookup = async (value, role = 'anon') => {
    const rows = await asActor(null, `SELECT coalesce(json_agg(row_to_json(s)),'[]'::json) FROM public.get_conversation_share(${quote(value)}) s;`, role);
    return JSON.parse(rows);
  };

  await t.test('share rows are owner-readable only and never directly writable by API roles', async () => {
    const conversation = await createConversation();
    const created = JSON.parse(await upsert(owner, conversation, token()));
    const ownRows = JSON.parse(await asActor(owner, `SELECT coalesce(json_agg(token),'[]'::json) FROM public.conversation_shares;`));
    assert.deepEqual(ownRows, [created.token]);
    assert.equal(await asActor(other, 'SELECT count(*) FROM public.conversation_shares;'), '0');
    await assert.rejects(asActor(null, 'SELECT count(*) FROM public.conversation_shares;', 'anon'), /42501/);
    for (const statement of [
      `INSERT INTO public.conversation_shares(token,user_id,conversation_id) VALUES (${quote(token())},${quote(owner)},${quote(conversation)});`,
      `UPDATE public.conversation_shares SET revoked_at=NULL, title='篡改' WHERE conversation_id=${quote(conversation)};`,
      `DELETE FROM public.conversation_shares WHERE conversation_id=${quote(conversation)};`,
    ]) {
      await assert.rejects(asActor(owner, statement), /42501/);
      await assert.rejects(asActor(null, statement, 'anon'), /42501/);
    }
    for (const call of [`upsert_conversation_share(${quote(conversation)},${quote(token())},'x','[]'::jsonb,false,now())`, `revoke_conversation_share(${quote(conversation)})`]) {
      await assert.rejects(asActor(null, `SELECT public.${call};`, 'anon'), /42501:[\s\S]*permission denied for function/);
    }
  });

  await t.test('refresh keeps the active token while foreign, busy and stale writes are refused', async () => {
    const conversation = await createConversation();
    const first = JSON.parse(await upsert(owner, conversation, token()));
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
    const refreshed = JSON.parse(await upsert(owner, conversation, token(), [{ role: 'assistant', content: '新回答' }], true));
    assert.equal(refreshed.token, first.token);
    assert.equal(refreshed.id, first.id);
    assert.equal(refreshed.include_charts, true);
    assert.deepEqual(refreshed.snapshot, [{ role: 'assistant', content: '新回答' }]);

    await assert.rejects(upsert(other, conversation, token()), /42501:[\s\S]*CONVERSATION_NOT_FOUND/);
    await assert.rejects(upsert(owner, conversation, token(), undefined, false, "'2000-01-01T00:00:00Z'::timestamptz"), /40001:[\s\S]*SHARE_SOURCE_CHANGED/);
    await assert.rejects(upsert(owner, conversation, token(), { role: 'user' }), /22023:[\s\S]*SHARE_SNAPSHOT_INVALID/);
    await assert.rejects(upsert(owner, conversation, token(), [{ role: 'user', content: 'x'.repeat(1_048_600) }]), /22023:[\s\S]*SHARE_SNAPSHOT_INVALID/);

    const run = randomUUID();
    await sql(`INSERT INTO public.agent_runs(id,user_id,conversation_id,request_id,request_hash,status,input,checkpoint,public_message,billing)
      VALUES (${quote(run)},${quote(owner)},${quote(conversation)},${quote(randomUUID())},'fixture','running','{}','{}','{}','exempt');`);
    await assert.rejects(upsert(owner, conversation, token()), /55006:[\s\S]*CONVERSATION_BUSY/);
    await sql(`UPDATE public.agent_runs SET status='completed' WHERE id=${quote(run)};`);
    assert.equal(JSON.parse(await upsert(owner, conversation, token())).token, first.token);

    const conversationFresh = await createConversation();
    await assert.rejects(upsert(owner, conversationFresh, 'not-a-token'), /23514/);
  });

  await t.test('anonymous lookup exposes only presentation fields of active links', async () => {
    const conversation = await createConversation();
    const share = JSON.parse(await upsert(owner, conversation, token(), [{ role: 'user', content: '公开内容' }]));
    for (const role of ['anon', 'authenticated']) {
      const rows = await lookup(share.token, role);
      assert.equal(rows.length, 1);
      assert.deepEqual(Object.keys(rows[0]).sort(), ['created_at', 'include_charts', 'snapshot', 'title', 'updated_at']);
      assert.deepEqual(rows[0].snapshot, [{ role: 'user', content: '公开内容' }]);
    }
    for (const value of ['', 'short', `${share.token}x`, `${share.token.slice(0, 42)}%`, token()]) assert.deepEqual(await lookup(value), []);
  });

  await t.test('revocation is owner-only, purges the snapshot and never resurrects the old token', async () => {
    const conversation = await createConversation();
    const share = JSON.parse(await upsert(owner, conversation, token(), [{ role: 'user', content: '待删除' }]));
    await assert.rejects(asActor(other, `SELECT public.revoke_conversation_share(${quote(conversation)});`), /42501:[\s\S]*CONVERSATION_NOT_FOUND/);
    assert.equal((await lookup(share.token)).length, 1);
    assert.equal(await asActor(owner, `SELECT public.revoke_conversation_share(${quote(conversation)});`), 't');
    assert.equal(await asActor(owner, `SELECT public.revoke_conversation_share(${quote(conversation)});`), 'f');
    assert.deepEqual(await lookup(share.token), []);
    const purged = JSON.parse(await sql(`SELECT json_build_object('title',title,'snapshot',snapshot,'revoked',revoked_at IS NOT NULL) FROM public.conversation_shares WHERE token=${quote(share.token)};`));
    assert.deepEqual(purged, { title: '', snapshot: [], revoked: true });

    const recreated = JSON.parse(await upsert(owner, conversation, token()));
    assert.notEqual(recreated.token, share.token);
    assert.deepEqual(await lookup(share.token), []);
    assert.equal((await lookup(recreated.token)).length, 1);

    await sql(`DELETE FROM public.conversations WHERE id=${quote(conversation)};`);
    assert.equal(await sql(`SELECT count(*) FROM public.conversation_shares WHERE conversation_id=${quote(conversation)};`), '0');
    assert.deepEqual(await lookup(recreated.token), []);
  });
}
