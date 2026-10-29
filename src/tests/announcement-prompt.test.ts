import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAnnouncementPromptIdentity,
  shouldPromptLatestAnnouncement,
} from '../lib/announcement';

const latest = { id: 'announcement-1', publishedAt: '2026-10-01T08:00:00.000Z' };

test('an announcement is identified by when it was published, not when it was edited', () => {
  assert.equal(getAnnouncementPromptIdentity(latest), 'announcement-1:2026-10-01T08:00:00.000Z');
  assert.equal(
    getAnnouncementPromptIdentity({ ...latest, updatedAt: '2026-10-02T08:00:00.000Z' } as typeof latest),
    getAnnouncementPromptIdentity(latest),
  );
  assert.equal(getAnnouncementPromptIdentity(null), null);
  assert.equal(getAnnouncementPromptIdentity({ id: 'x', publishedAt: '' }), null);
});

test('a new announcement prompts once and never again after it was shown', () => {
  const key = getAnnouncementPromptIdentity(latest);
  assert.equal(shouldPromptLatestAnnouncement({ announcementKey: null, state: {} }), false);
  assert.equal(shouldPromptLatestAnnouncement({ announcementKey: key, state: {} }), true);
  assert.equal(shouldPromptLatestAnnouncement({ announcementKey: key, state: null }), true);

  const seen = { seenAnnouncementKey: key! };
  assert.equal(shouldPromptLatestAnnouncement({ announcementKey: key, state: seen }), false);

  // 隔天、刷新都仍按已看处理：状态里没有日期，不存在“第二天重新弹”。
  assert.equal(shouldPromptLatestAnnouncement({ announcementKey: key, state: { ...seen } }), false);
});

test('only a newer announcement opens the prompt again', () => {
  const next = { id: 'announcement-2', publishedAt: '2026-10-03T08:00:00.000Z' };
  const state = { seenAnnouncementKey: getAnnouncementPromptIdentity(latest)! };
  assert.equal(shouldPromptLatestAnnouncement({ announcementKey: getAnnouncementPromptIdentity(next), state }), true);
});

test('editing an already seen announcement does not prompt again', () => {
  const state = { seenAnnouncementKey: getAnnouncementPromptIdentity(latest)! };
  const edited = { ...latest, updatedAt: '2026-10-09T08:00:00.000Z' } as typeof latest;
  assert.equal(shouldPromptLatestAnnouncement({ announcementKey: getAnnouncementPromptIdentity(edited), state }), false);
});
