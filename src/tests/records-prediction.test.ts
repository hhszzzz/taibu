import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREDICTION_VERDICT_TAGS,
  daysBetweenDateKeys,
  getMonthDayLabel,
  getPlainTags,
  getPredictionStatus,
  getPredictionStatusText,
  getRecordCategory,
  getRecordCategoryLabel,
  getRecordDateKey,
  getRecordDateLabel,
  getShortDateLabel,
  getWeekdayChar,
  getWeekdayLabel,
  groupNotesByDay,
  setRecordVerdict,
  shiftDateKey,
  type MingNote,
  type MingRecord,
} from '../lib/records';

const TODAY = '2026-11-10';

const record = (overrides: Partial<MingRecord> = {}): MingRecord => ({
  id: 'record-1',
  user_id: 'user-1',
  title: '年底前会有一次岗位调动',
  content: null,
  category: 'prediction',
  tags: [],
  event_date: null,
  related_chart_type: null,
  related_chart_id: null,
  is_pinned: false,
  created_at: new Date(2026, 9, 1, 21, 10).toISOString(),
  updated_at: new Date(2026, 9, 1, 21, 10).toISOString(),
  ...overrides,
});

const note = (overrides: Partial<MingNote> = {}): MingNote => ({
  id: 'note-1',
  user_id: 'user-1',
  note_date: '2026-11-09',
  content: '睡得晚，但早上还是按计划起来了。',
  mood: 'neutral',
  created_at: new Date(2026, 10, 9, 23, 5).toISOString(),
  updated_at: new Date(2026, 10, 9, 23, 5).toISOString(),
  ...overrides,
});

test('a prediction without a verdict counts the days to its due date', () => {
  assert.deepEqual(getPredictionStatus(record({ event_date: '2026-11-22' }), TODAY), { kind: 'upcoming', days: 12 });
  assert.deepEqual(getPredictionStatus(record({ event_date: '2026-11-08' }), TODAY), { kind: 'due', days: 2 });
  assert.deepEqual(getPredictionStatus(record({ event_date: TODAY }), TODAY), { kind: 'due', days: 0 });
  assert.deepEqual(getPredictionStatus(record(), TODAY), { kind: 'open' });
});

test('verdict tags turn a prediction into hit or miss, and only predictions have a status', () => {
  assert.deepEqual(getPredictionStatus(record({ tags: [PREDICTION_VERDICT_TAGS.hit] }), TODAY), { kind: 'hit' });
  assert.deepEqual(getPredictionStatus(record({ tags: ['事业', PREDICTION_VERDICT_TAGS.miss] }), TODAY), { kind: 'miss' });
  assert.deepEqual(getPredictionStatus(record({ tags: [PREDICTION_VERDICT_TAGS.miss, PREDICTION_VERDICT_TAGS.hit] }), TODAY), { kind: 'hit' });
  assert.equal(getPredictionStatus(record({ category: 'event', event_date: '2026-11-22' }), TODAY), null);
  assert.equal(getPredictionStatus(record({ category: 'life' as MingRecord['category'] }), TODAY), null);
});

test('prediction status text reads as a countdown or a due reminder', () => {
  assert.equal(getPredictionStatusText({ kind: 'upcoming', days: 1 }), '明天到期');
  assert.equal(getPredictionStatusText({ kind: 'upcoming', days: 12 }), '还有 12 天');
  assert.equal(getPredictionStatusText({ kind: 'due', days: 0 }), '今天到应验日');
  assert.equal(getPredictionStatusText({ kind: 'due', days: 2 }), '已到应验日 · 2 天前');
  assert.equal(getPredictionStatusText({ kind: 'open' }), '未定应验日');
  assert.equal(getPredictionStatusText({ kind: 'hit' }), '已应验');
  assert.equal(getPredictionStatusText({ kind: 'miss' }), '未应验');
});

test('the date label follows the category', () => {
  assert.equal(getRecordDateLabel(record()), '预计应验');
  assert.equal(getRecordDateLabel(record({ category: 'event' })), '发生于');
  assert.equal(getRecordDateLabel(record({ category: 'reflection' })), '记于');
  assert.equal(getRecordDateLabel(record({ category: 'general' })), '记于');
});

test('a record sits on its event date, else the local day it was written', () => {
  assert.equal(getRecordDateKey(record({ event_date: '2026-11-22' })), '2026-11-22');
  assert.equal(getRecordDateKey(record({ event_date: 'not-a-date' })), '2026-10-01');
  assert.equal(getRecordDateKey(record({ event_date: null })), '2026-10-01');
});

test('plain tags hide the verdict tags', () => {
  assert.deepEqual(getPlainTags(record({ tags: ['事业', PREDICTION_VERDICT_TAGS.hit, '八字', PREDICTION_VERDICT_TAGS.miss] })), ['事业', '八字']);
  assert.deepEqual(getPlainTags(record({ tags: [] })), []);
});

test('unknown legacy categories read as 通用', () => {
  assert.equal(getRecordCategory(record({ category: 'life' as MingRecord['category'] })), 'general');
  assert.equal(getRecordCategory(record({ category: 'event' })), 'event');
  assert.equal(getRecordCategoryLabel(record({ category: 'work' as MingRecord['category'] })), '通用');
  assert.equal(getRecordCategoryLabel(record({ category: 'prediction' })), '预测验证');
});

test('local date keys shift across month and year boundaries', () => {
  assert.equal(shiftDateKey('2026-11-10', -34), '2026-10-07');
  assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetweenDateKeys('2026-11-10', '2026-11-22'), 12);
  assert.equal(daysBetweenDateKeys('2026-11-10', '2026-11-08'), -2);
  assert.equal(getMonthDayLabel('2026-11-09'), '11月9日');
  assert.equal(getShortDateLabel('2026-11-09', TODAY), '11月9日');
  assert.equal(getShortDateLabel('2024-03-01', TODAY), '2024年3月1日');
  assert.equal(getWeekdayLabel('2026-11-10'), '周二');
  assert.equal(getWeekdayChar('2026-11-10'), '二');
});

test('notes group by day, newest first inside each day', () => {
  const groups = groupNotesByDay([
    note({ id: 'a', note_date: '2026-11-09', created_at: new Date(2026, 10, 9, 8, 5).toISOString() }),
    note({ id: 'b', note_date: '2026-11-09', created_at: new Date(2026, 10, 9, 22, 10).toISOString() }),
    note({ id: 'c', note_date: '2026-11-08', created_at: new Date(2026, 10, 8, 19, 30).toISOString() }),
  ]);
  assert.deepEqual([...groups.keys()], ['2026-11-09', '2026-11-08']);
  assert.deepEqual(groups.get('2026-11-09')!.map(item => item.id), ['b', 'a']);
  assert.deepEqual(groups.get('2026-11-08')!.map(item => item.id), ['c']);
});

test('writing a verdict only rewrites the tags', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const requests: { method?: string; body?: unknown }[] = [];
  global.fetch = async (_input, init) => {
    requests.push({ method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(record({ tags: ['事业', PREDICTION_VERDICT_TAGS.miss] })), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const updated = await setRecordVerdict(record({ tags: ['事业', PREDICTION_VERDICT_TAGS.hit] }), 'miss');
  assert.deepEqual(requests[0]?.body, { tags: ['事业', PREDICTION_VERDICT_TAGS.miss] });
  assert.equal(requests[0]?.method, 'PUT');
  assert.deepEqual(updated.tags, ['事业', PREDICTION_VERDICT_TAGS.miss]);

  await setRecordVerdict(record({ tags: ['事业', PREDICTION_VERDICT_TAGS.miss] }), null);
  assert.deepEqual(requests[1]?.body, { tags: ['事业'] }, '撤销印证只去掉结果标签');
});
