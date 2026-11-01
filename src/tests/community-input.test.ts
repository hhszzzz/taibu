import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMUNITY_LIMITS, isReportReason, normalizePostInput } from '../lib/community';

test('post input is capped at the length and tag limits the editor shows', () => {
  assert.ok('error' in normalizePostInput({ title: 'x'.repeat(COMMUNITY_LIMITS.title + 1), content: '正文' }, 'create'));
  assert.ok('error' in normalizePostInput({ title: '标题', content: 'x'.repeat(COMMUNITY_LIMITS.content + 1) }, 'create'));
  assert.ok('error' in normalizePostInput({ title: '标题', content: '正文', tags: Array.from({ length: COMMUNITY_LIMITS.tags + 1 }, (_, i) => `t${i}`) }, 'create'));
  assert.ok('error' in normalizePostInput({ title: '标题', content: '正文', tags: ['x'.repeat(COMMUNITY_LIMITS.tag + 1)] }, 'create'));

  const ok = normalizePostInput({ title: ' 标题 ', content: ' 正文 ' }, 'create');
  assert.deepEqual(ok, { data: { title: '标题', content: '正文', category: 'general', tags: [] } });
});

test('report reasons are the four the dialog offers', () => {
  for (const reason of ['spam', 'abuse', 'inappropriate', 'other']) assert.equal(isReportReason(reason), true, reason);
  for (const reason of ['bogus', '', null, 1]) assert.equal(isReportReason(reason), false, String(reason));
});
