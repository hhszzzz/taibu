import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function communityReportDatabaseContracts(t, { sql, asActor, asOwner, ownerId, adminId }) {
  await t.test('concurrent reports for one target create one pending row and one admin notice', async () => {
    const postId = randomUUID();
    await asOwner(`INSERT INTO public.community_posts (id, user_id, title, content, category)
      VALUES ('${postId}', '${ownerId}', '举报并发验收', 'fixture', 'general');`);
    const call = `SELECT public.submit_community_report_and_notify('post', '${postId}'::uuid, 'spam', 'fixture');`;
    const results = await Promise.allSettled([asActor(ownerId, call), asActor(ownerId, call)]);

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.ok(rejected);
    assert.match(rejected.reason.message, /already reported|23505/u);
    assert.equal(await asActor(ownerId, `SELECT count(*) FROM public.community_reports
      WHERE reporter_id = '${ownerId}' AND target_type = 'post' AND target_id = '${postId}' AND status = 'pending';`), '1');
    assert.equal(await asActor(adminId, `SELECT count(*) FROM public.notifications
      WHERE user_id = '${adminId}' AND title = '有新的社区举报' AND link = '/community/${postId}';`), '1');
    assert.equal(await sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
      AND indexname = 'community_reports_pending_target_unique';`), '1');
  });
}
