import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNotificationTime, groupNotificationsByDay } from '../lib/notification-view';
import type { Notification } from '../lib/notification';

const NOW = new Date(2026, 9, 14, 12, 0);

test('formatNotificationTime uses relative time within a week and a month-day date after that', () => {
  assert.equal(formatNotificationTime(new Date(2026, 9, 14, 11, 59, 40).toISOString(), NOW), '刚刚');
  assert.equal(formatNotificationTime(new Date(2026, 9, 14, 11, 15).toISOString(), NOW), '45 分钟前');
  assert.equal(formatNotificationTime(new Date(2026, 9, 14, 7, 0).toISOString(), NOW), '5 小时前');
  assert.equal(formatNotificationTime(new Date(2026, 9, 11, 12, 0).toISOString(), NOW), '3 天前');
  assert.equal(formatNotificationTime(new Date(2026, 8, 28, 9, 0).toISOString(), NOW), '9 月 28 日');
});

test('formatNotificationTime hides invalid timestamps and clamps clock skew to 刚刚', () => {
  assert.equal(formatNotificationTime('', NOW), '');
  assert.equal(formatNotificationTime('not-a-date', NOW), '');
  assert.equal(formatNotificationTime(new Date(2026, 9, 14, 12, 5).toISOString(), NOW), '刚刚');
});

test('groupNotificationsByDay keeps the 今天 / 近 7 天 / 更早 order', () => {
  const item = (id: string, date: Date): Notification => ({
    id, user_id: 'u', type: 'system', title: id, content: null, is_read: false, link: null, created_at: date.toISOString(),
  });
  const groups = groupNotificationsByDay([
    item('old', new Date(2026, 8, 1)),
    item('today', new Date(2026, 9, 14, 8)),
    item('recent', new Date(2026, 9, 10)),
  ], NOW.toISOString());

  assert.deepEqual(groups.map(group => [group.label, group.items.map(entry => entry.id)]), [
    ['今天', ['today']], ['近 7 天', ['recent']], ['更早', ['old']],
  ]);
});
