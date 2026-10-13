import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateZiwei,
  calculateZiweiHoroscope,
  toZiweiHoroscopeJson,
  toZiweiHoroscopeText,
} from 'taibu-core';

const BASE_INPUT = {
  gender: 'male',
  birthYear: 1990,
  birthMonth: 6,
  birthDay: 15,
  birthHour: 10,
  calendarType: 'solar',
};

test('calculateZiweiHoroscope should return all period layers', () => {
  const result = calculateZiweiHoroscope({
    ...BASE_INPUT,
    targetDate: '2026-04-10',
  });

  assert.ok(result.decadal, 'decadal required');
  assert.ok(result.yearly, 'yearly required');
  assert.ok(result.monthly, 'monthly required');
  assert.ok(result.daily, 'daily required');
  assert.ok(result.hourly, 'hourly required');
  assert.ok(result.age, 'age required');
  assert.ok(result.solarDate, 'solarDate required');
  assert.ok(result.lunarDate, 'lunarDate required');
  assert.equal(result.targetDate, '2026-04-10', 'targetDate should echo input');
});

test('calculateZiweiHoroscope period entries should have required fields', () => {
  const result = calculateZiweiHoroscope({
    ...BASE_INPUT,
    targetDate: '2026-04-10',
  });

  for (const key of ['decadal', 'yearly', 'monthly', 'daily', 'hourly']) {
    const period = result[key];
    assert.ok(typeof period.index === 'number', `${key}.index should be a number`);
    assert.ok(typeof period.name === 'string', `${key}.name should be a string`);
    assert.ok(typeof period.heavenlyStem === 'string', `${key}.heavenlyStem should be a string`);
    assert.ok(typeof period.earthlyBranch === 'string', `${key}.earthlyBranch should be a string`);
    assert.ok(Array.isArray(period.palaceNames), `${key}.palaceNames should be an array`);
    assert.ok(Array.isArray(period.mutagen), `${key}.mutagen should be an array`);
  }
});

test('calculateZiweiHoroscope age should include nominalAge', () => {
  const result = calculateZiweiHoroscope({
    ...BASE_INPUT,
    targetDate: '2026-04-10',
  });

  assert.ok(typeof result.age.nominalAge === 'number', 'age.nominalAge should be a number');
  assert.ok(result.age.nominalAge > 0, 'nominalAge should be positive');
});

test('calculateZiweiHoroscope should include transit stars for the flow year', () => {
  const result = calculateZiweiHoroscope({
    ...BASE_INPUT,
    targetDate: '2026-04-10',
  });

  assert.ok(Array.isArray(result.transitStars), 'transitStars should be an array');
  assert.ok(result.transitStars.length > 0, 'transitStars should not be empty');

  for (const star of result.transitStars) {
    assert.ok(typeof star.starName === 'string', 'each transit star should have starName');
    assert.ok(typeof star.palaceName === 'string', 'each transit star should have palaceName');
}
});

test('calculateZiweiHoroscope should reflect hasExplicitTargetTime correctly', () => {
  const withoutTime = calculateZiweiHoroscope({
    ...BASE_INPUT,
    targetDate: '2026-04-10',
  });
  assert.equal(withoutTime.hasExplicitTargetTime, false, 'should be false without targetTimeIndex');

  const withTime = calculateZiweiHoroscope({
    ...BASE_INPUT,
    targetDate: '2026-04-10',
    targetTimeIndex:5,
  });
  assert.equal(withTime.hasExplicitTargetTime, true, 'should be true with targetTimeIndex');
});

test('toZiweiHoroscopeJson should return well-formed canonical JSON', () => {
  const result = calculateZiweiHoroscope({
    ...BASE_INPUT,
    targetDate: '2026-04-10',
  });
  const json = toZiweiHoroscopeJson(result);

  assert.ok(json.基本信息, 'JSON should have 基本信息');
  assert.ok(typeof json.基本信息.目标日期 === 'string', '基本信息.目标日期 should be a string');
  assert.ok(typeof json.基本信息.五行局 === 'string', '基本信息.五行局 should be a string');
assert.ok(Array.isArray(json.运限叠宫), '运限叠宫 should be an array');
  assert.ok(json.运限叠宫.length >= 5, '运限叠宫 should have at least 5 layers');

  for (const entry of json.运限叠宫) {
    assert.ok(typeof entry.层次 === 'string', '层次 should be a string');
    assert.ok(typeof entry.干支 === 'string', '干支 should be a string');
    assert.ok(Array.isArray(entry.运限四化), '运限四化 should be an array');
  }
});

test('toZiweiHoroscopeJson full detail should include extra basic info fields', () => {
  const result = calculateZiweiHoroscope({
    ...BASE_INPUT,
    targetDate: '2026-04-10',
  });
  const json = toZiweiHoroscopeJson(result, { detailLevel: 'full' });

  assert.ok(json.基本信息.阳历, 'full detail should include 阳历');
  assert.ok(json.基本信息.农历, 'full detail should include 农历');
  assert.ok(json.基本信息.命主, 'full detail should include 命主');
  assert.ok(json.基本信息.身主, 'full detail should include 身主');
});

test('toZiweiHoroscopeText should return a non-empty markdown string', () => {
  const result = calculateZiweiHoroscope({
    ...BASE_INPUT,
    targetDate: '2026-04-10',
  });
  const text = toZiweiHoroscopeText(result);

  assert.ok(typeof text === 'string', 'text output should be a string');
  assert.ok(text.length > 100, 'text output should be substantial');
});

test('落入本命宫位 names the natal palace at each layer\'s 宫位索引, not the first rearranged palace', () => {
  const input = { ...BASE_INPUT, targetDate: '2026-04-10', targetTimeIndex: 6 };
  const natal = calculateZiwei(input);
  const result = calculateZiweiHoroscope(input);
  const json = toZiweiHoroscopeJson(result, { detailLevel: 'full' });
  const text = toZiweiHoroscopeText(result, { detailLevel: 'full' });
  const natalAt = (index) => natal.palaces.find((palace, position) => (palace.index ?? position) === index);
  const asPalace = (name) => name.endsWith('宫') ? name : `${name}宫`;

  assert.equal(json.运限叠宫.length, 6);
  for (const layer of json.运限叠宫) {
    const palace = natalAt(layer.宫位索引);
    assert.ok(palace, `${layer.层次} should land on a natal palace`);
    assert.equal(layer.落入本命宫位, asPalace(palace.name), layer.层次);
    assert.equal(layer.十二宫重排[layer.宫位索引], '命宫', `${layer.层次} rearranges its own 命宫 onto that palace`);
    assert.match(text, new RegExp(`\\| ${layer.层次} \\|[^\\n]*\\| ${asPalace(palace.name)} \\|`, 'u'));
  }
  // 大限命宫即本命该宫（同干支）；流年命宫落在与流年同支的本命宫
  const decadal = json.运限叠宫.find((layer) => layer.层次 === '大限');
  const yearly = json.运限叠宫.find((layer) => layer.层次 === '流年');
  const decadalPalace = natalAt(decadal.宫位索引);
  assert.equal(decadal.干支, `${decadalPalace.heavenlyStem}${decadalPalace.earthlyBranch}`);
  assert.equal(natalAt(yearly.宫位索引).earthlyBranch, yearly.干支.charAt(1));
  assert.doesNotMatch(text, /宫宫/u);
});

test('落入本命宫位 falls back to "-" when the layer index is outside the natal chart', () => {
  const result = calculateZiweiHoroscope({ ...BASE_INPUT, targetDate: '2026-04-10' });
  const outOfRange = { ...result, decadal: { ...result.decadal, index: -1, natalPalaceName: undefined } };
  const json = toZiweiHoroscopeJson(outOfRange);
  assert.equal(json.运限叠宫.find((layer) => layer.层次 === '大限').落入本命宫位, '-');
  assert.match(toZiweiHoroscopeText(outOfRange), /\| 大限 \|[^\n]*\| - \|/u);
});
