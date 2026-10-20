import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateXiaoliurenData, toXiaoliurenJson, toXiaoliurenText } from 'taibu-core';

test('xiaoliuren basic calculation - month 1, day 1, hour 1 (子时)', () => {
  const result = calculateXiaoliurenData({ lunarMonth: 1, lunarDay: 1, hour: 1 });
  // 月上起大安: month=1 -> idx=0 -> 大安
  assert.equal(result.monthStatus, '大安');
  // 日上: (0 + 1- 1) % 6 = 0 -> 大安
  assert.equal(result.dayStatus, '大安');
  // 时上: (0 + 1 - 1) % 6= 0 -> 大安
  assert.equal(result.hourStatus, '大安');
  assert.equal(result.result.name, '大安');
  assert.equal(result.result.element, '木');
  assert.equal(result.result.nature, '吉');
});

test('xiaoliuren month 3, day 5, hour 3 (寅时)', () => {
  const result = calculateXiaoliurenData({ lunarMonth: 3, lunarDay: 5, hour: 3 });
  // 月: (3-1) % 6 = 2 -> 速喜
  assert.equal(result.monthStatus, '速喜');
  // 日: (2 + 5 - 1) % 6 = 0 -> 大安
  assert.equal(result.dayStatus, '大安');
  // 时: (0 + 3 - 1) % 6 = 2 -> 速喜
  assert.equal(result.hourStatus, '速喜');
  assert.equal(result.result.element, '火');
  assert.equal(result.result.direction, '南方');
});

test('xiaoliuren wraps around correctly - month 7 maps to index 0', () => {
  const result = calculateXiaoliurenData({ lunarMonth: 7, lunarDay: 1, hour: 1});
  // (7-1) % 6 = 0 -> 大安
  assert.equal(result.monthStatus, '大安');
});

test('xiaoliuren all 6 statuses are reachable', () => {
  const statuses = new Set();
  for (let m = 1; m <= 6; m++) {
    const result = calculateXiaoliurenData({ lunarMonth: m, lunarDay: 1, hour: 1 });
    statuses.add(result.hourStatus);
  }
  assert.equal(statuses.size, 6, 'all 6 statuses should be reachable');
});

test('xiaoliuren question field is passed through', () => {
  const result = calculateXiaoliurenData({ lunarMonth: 1, lunarDay: 1, hour: 1, question: '今日运势' });
  assert.equal(result.question, '今日运势');
});

test('xiaoliuren result info has all required fields', () => {
  const result = calculateXiaoliurenData({ lunarMonth: 5, lunarDay: 10, hour: 8 });
  assert.ok(result.result.name);
  assert.ok(result.result.element);
  assert.ok(result.result.direction);
  assert.ok(result.result.nature);
  assert.ok(result.result.description);
  assert.ok(result.result.poem);
});

test('xiaoliuren toJson produces valid JSON structure', () => {
  const output = calculateXiaoliurenData({ lunarMonth: 2, lunarDay: 15, hour: 6 });
  const json = toXiaoliurenJson(output);
  assert.equal(typeof json.推演链.月上起, 'string');
  assert.equal(typeof json.推演链.日上落, 'string');
  assert.equal(typeof json.推演链.时上落, 'string');
  assert.equal(typeof json.结果.落宫, 'string');
  assert.equal(typeof json.起课信息.农历月, 'number');
  assert.equal(json.结果.释义, undefined);
  assert.equal(json.结果.诗诀, undefined);
});

test('xiaoliuren toJson full should append description and poem', () => {
  const output = calculateXiaoliurenData({ lunarMonth: 2, lunarDay: 15, hour: 6 });
  const json = toXiaoliurenJson(output, { detailLevel: 'full' });
  assert.equal(typeof json.结果.释义, 'string');
  assert.equal(typeof json.结果.诗诀, 'string');
});

test('xiaoliuren toText default should keep only main evidence', () => {
  const output = calculateXiaoliurenData({ lunarMonth:4, lunarDay: 8, hour: 10 });
  const text = toXiaoliurenText(output);
  assert.ok(text.includes('小六壬主证据'));
  assert.ok(text.includes('## 推演链'));
  assert.ok(text.includes(output.result.name));
  assert.ok(!text.includes('诗诀'));
  assert.ok(!text.includes('参考释义'));
});

test('xiaoliuren toText full should include poem and description', () => {
  const output = calculateXiaoliurenData({ lunarMonth: 4, lunarDay: 8, hour: 10 });
  const text = toXiaoliurenText(output, { detailLevel: 'full' });
  assert.ok(text.includes('诗诀'));
  assert.ok(text.includes('参考释义'));
});

test('xiaoliuren toText should still allow explicitly hiding poem in full mode', () => {
  const output = calculateXiaoliurenData({ lunarMonth: 4, lunarDay: 8, hour: 10 });
  const text = toXiaoliurenText(output, { detailLevel: 'full', showPoem: false });
  assert.ok(!text.includes('诗诀'));
});

test('xiaoliuren hour conversion from 24h to shichen', () => {
  // 14点 -> 未时 (idx 8) -> shichen = 8
  const result = calculateXiaoliurenData({ lunarMonth: 1, lunarDay: 1, hour: 14 });
  assert.equal(result.input.shichen, '未时');
});

test('xiaoliuren accepts a Gregorian date with schema defaults filled in', () => {
  // MCP and Agent callers validate against the tool schema, which declares `isLeapMonth: false` and
  // `leapMonthStrategy: 'repeat'` as defaults; those must not read as manual lunar input.
  const dated = calculateXiaoliurenData({ date: '2026-02-14', hour: 9, isLeapMonth: false, leapMonthStrategy: 'repeat' });
  const lunar = calculateXiaoliurenData({ lunarMonth: dated.input.lunarMonth, lunarDay: dated.input.lunarDay, hour: 9, hourType: 'clock', isLeapMonth: dated.input.isLeapMonth });
  assert.equal(dated.monthStatus, lunar.monthStatus);
  assert.equal(dated.dayStatus, lunar.dayStatus);
  assert.equal(dated.result.name, lunar.result.name);
  assert.equal(dated.input.isLeapMonth, false);
});

test('xiaoliuren rejects lunar fields and a contradictory leap flag beside a Gregorian date', () => {
  assert.throws(() => calculateXiaoliurenData({ date: '2026-02-14', hour: 9, lunarMonth: 1 }), /不能同时提供/);
  assert.throws(() => calculateXiaoliurenData({ date: '2026-02-14', hour: 9, lunarDay: 1 }), /不能同时提供/);
  assert.throws(() => calculateXiaoliurenData({ date: '2026-02-14', hour: 9, isLeapMonth: true }), /不是闰月/);
});
