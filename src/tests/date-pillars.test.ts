import test from 'node:test';
import assert from 'node:assert/strict';

test('getDatePillars returns year, month, day pillars and the lunar month-day', () => {
  const { getDatePillars } = require('../lib/divination/calendar') as typeof import('../lib/divination/calendar');

  assert.deepEqual(getDatePillars(new Date(2026, 10, 9)), { year: '丙午', month: '己亥', day: '丁亥', lunarMonthDay: '十月初一' });
  assert.deepEqual(getDatePillars(new Date(2026, 10, 10)), { year: '丙午', month: '己亥', day: '戊子', lunarMonthDay: '十月初二' });
  assert.deepEqual(getDatePillars(new Date(2024, 2, 1)), { year: '甲辰', month: '丙寅', day: '甲子', lunarMonthDay: '正月廿一' });
});

test('the pillar year follows 立春 rather than the Gregorian year boundary', () => {
  const { getDatePillars } = require('../lib/divination/calendar') as typeof import('../lib/divination/calendar');
  // 2024-01-15 还在癸卯年，2024-03-01 已进入甲辰年。
  assert.equal(getDatePillars(new Date(2024, 0, 15)).year, '癸卯');
  assert.equal(getDatePillars(new Date(2024, 2, 1)).year, '甲辰');
});
