import test from 'node:test';
import assert from 'node:assert/strict';
import { browserTimeZone, checkLocalTime, isValidTimeZone, timeZoneOptions } from '../lib/timezones';

test('time zone options lead with the current value and still offer the IANA list', () => {
  const options = timeZoneOptions('America/New_York');
  assert.equal(options[0], 'America/New_York');
  assert.ok(options.includes('Asia/Shanghai'));
  assert.ok(options.includes('UTC'));
  assert.equal(new Set(options).size, options.length);
  assert.ok(options.length > 100, 'supportedValuesOf contributes the full list');
});

test('an unknown stored value stays visible so it can be corrected', () => {
  const options = timeZoneOptions('invalid/timezone');
  assert.equal(options[0], 'invalid/timezone');
});

test('the browser zone always formats and never returns an empty string', () => {
  const zone = browserTimeZone();
  assert.ok(zone.length > 0);
  assert.equal(isValidTimeZone(zone), true);
});

test('zone names are validated through Intl instead of a shape check', () => {
  assert.equal(isValidTimeZone('Asia/Shanghai'), true);
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('invalid/timezone'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(null), false);
});

test('a wall clock in a daylight-saving gap reports the adjusted time', () => {
  const result = checkLocalTime({ year: 2024, month: 3, day: 10, hour: 2, minute: 30 }, 'America/New_York');
  assert.equal(result.issue, 'nonexistent');
  assert.equal(result.adjusted, '03:30');
});

test('a repeated wall clock is reported as ambiguous', () => {
  const result = checkLocalTime({ year: 2024, month: 11, day: 3, hour: 1, minute: 30 }, 'America/New_York');
  assert.equal(result.issue, 'ambiguous');
});

test('an ordinary wall clock and an empty date have no issue', () => {
  assert.deepEqual(checkLocalTime({ year: 2024, month: 6, day: 1, hour: 12, minute: 0 }, 'Asia/Shanghai'), { issue: null });
  assert.deepEqual(checkLocalTime({ year: 0, month: 0, day: 0, hour: 12, minute: 0 }, 'Asia/Shanghai'), { issue: null });
});
