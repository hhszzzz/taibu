import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNumber, parseTextArray, parseTimestamp } from '../lib/db/pool.server';

test('timestamptz preserves the API timestamp format', () => {
  assert.equal(parseTimestamp('2026-10-21 03:08:25.25+00'), '2026-10-21T03:08:25.25+00:00');
  assert.equal(parseTimestamp('2026-10-21 03:08:25+08'), '2026-10-21T03:08:25+08:00');
  assert.equal(parseTimestamp('2026-10-21 03:08:25+05:30'), '2026-10-21T03:08:25+05:30');
  assert.equal(parseTimestamp('2026-10-21 03:08:25.253123+00'), '2026-10-21T03:08:25.253123+00:00');
});

test('timestamp without time zone keeps its wall clock', () => {
  assert.equal(parseTimestamp('2026-10-21 03:08:25.5'), '2026-10-21T03:08:25.5');
  assert.equal(parseTimestamp('infinity'), 'infinity');
  assert.equal(parseTimestamp('-infinity'), '-infinity');
});

test('numeric database values become JSON numbers', () => {
  assert.equal(parseNumber('42'), 42);
  assert.equal(parseNumber('1700.25'), 1700.25);
  assert.ok(Number.isNaN(parseNumber('NaN')));
});

test('text arrays preserve quoting, escapes and NULL', () => {
  assert.deepEqual(parseTextArray('{}', parseTimestamp), []);
  assert.deepEqual(
    parseTextArray('{"2026-10-21 03:08:25+00",NULL}', parseTimestamp),
    ['2026-10-21T03:08:25+00:00', null],
  );
  assert.deepEqual(parseTextArray('{a,"b,c"}', (value) => value), ['a', 'b,c']);
  assert.deepEqual(parseTextArray('{"a\\"b","c\\\\d"}', (value) => value), ['a"b', 'c\\d']);
  assert.equal(parseTextArray('not-an-array', (value) => value), null);
});
