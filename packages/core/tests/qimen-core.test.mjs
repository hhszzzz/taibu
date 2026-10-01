import test from 'node:test';
import assert from 'node:assert/strict';
import { Solar } from 'lunar-javascript';

import { calculateQimen, toQimenJson, toQimenText } from 'taibu-core';

async function assertMonthPillar(year, month, day, expectedYear, expectedMonth) {
  const result = await calculateQimen({
    year, month, day, hour: 7, minute: 0, timezone: 'Asia/Shanghai',
  });
  assert.equal(result.siZhu.year, expectedYear);
  assert.equal(result.siZhu.month, expectedMonth);

  // Independent calendar oracle: bazi uses the same EightChar getters.
  const eightChar = Solar.fromYmdHms(year, month, day, 7, 0, 0).getLunar().getEightChar();
  assert.equal(result.siZhu.year, eightChar.getYear());
  assert.equal(result.siZhu.month, eightChar.getMonth());

  for (const detailLevel of ['default', 'full']) {
    const json = toQimenJson(result, { detailLevel });
    assert.equal(json.基本信息.四柱.split(' ')[1], expectedMonth);
    assert.ok(toQimenText(result, { detailLevel }).includes(
      `- 四柱: ${expectedYear} ${expectedMonth} `,
    ));
  }
}

// Issue #14 fixtures, including its June control cases.
for (const [year, month, day, yearPillar, monthPillar] of [
  [2024, 12, 15, '甲辰', '丙子'],
  [2024, 12, 29, '甲辰', '丙子'],
  [2025, 12, 15, '乙巳', '戊子'],
  [2026, 12, 15, '丙午', '庚子'],
  [2025, 1, 15, '甲辰', '丁丑'],
  [2024, 6, 15, '甲辰', '庚午'],
  [2025, 6, 15, '乙巳', '壬午'],
  [2026, 6, 15, '丙午', '甲午'],
]) {
  test(`qimen issue #14: ${year}-${month}-${day} should have month pillar ${monthPillar}`, async () => {
    await assertMonthPillar(year, month, day, yearPillar, monthPillar);
  });
}

// Cover all ten year stems with literal Five Tigers month sequences.
// Each row runs February–December and January of the following civil year.
const monthSequences = [
  ['甲辰', '丙寅 丁卯 戊辰 己巳 庚午 辛未 壬申 癸酉 甲戌 乙亥 丙子 丁丑'],
  ['乙巳', '戊寅 己卯 庚辰 辛巳 壬午 癸未 甲申 乙酉 丙戌 丁亥 戊子 己丑'],
  ['丙午', '庚寅 辛卯 壬辰 癸巳 甲午 乙未 丙申 丁酉 戊戌 己亥 庚子 辛丑'],
  ['丁未', '壬寅 癸卯 甲辰 乙巳 丙午 丁未 戊申 己酉 庚戌 辛亥 壬子 癸丑'],
  ['戊申', '甲寅 乙卯 丙辰 丁巳 戊午 己未 庚申 辛酉 壬戌 癸亥 甲子 乙丑'],
  ['己酉', '丙寅 丁卯 戊辰 己巳 庚午 辛未 壬申 癸酉 甲戌 乙亥 丙子 丁丑'],
  ['庚戌', '戊寅 己卯 庚辰 辛巳 壬午 癸未 甲申 乙酉 丙戌 丁亥 戊子 己丑'],
  ['辛亥', '庚寅 辛卯 壬辰 癸巳 甲午 乙未 丙申 丁酉 戊戌 己亥 庚子 辛丑'],
  ['壬子', '壬寅 癸卯 甲辰 乙巳 丙午 丁未 戊申 己酉 庚戌 辛亥 壬子 癸丑'],
  ['癸丑', '甲寅 乙卯 丙辰 丁巳 戊午 己未 庚申 辛酉 壬戌 癸亥 甲子 乙丑'],
];

for (const [yearOffset, [yearPillar, sequence]] of monthSequences.entries()) {
  for (const [monthOffset, monthPillar] of sequence.split(' ').entries()) {
    const year = 2024 + yearOffset + (monthOffset === 11 ? 1 : 0);
    const month = monthOffset === 11 ? 1 : monthOffset + 2;
    test(`qimen month cycle: ${year}-${month}-15 should be ${yearPillar} ${monthPillar}`, async () => {
      await assertMonthPillar(year, month, 15, yearPillar, monthPillar);
    });
  }
}

// Dates on either side of 大雪/小寒/立春, including the reported transition-day failure.
for (const [year, month, day, yearPillar, monthPillar] of [
  [2024, 12, 5, '甲辰', '乙亥'],
  [2024, 12, 6, '甲辰', '乙亥'],
  [2024, 12, 8, '甲辰', '丙子'],
  [2025, 1, 4, '甲辰', '丙子'],
  [2025, 1, 6, '甲辰', '丁丑'],
  [2025, 2, 2, '甲辰', '丁丑'],
  [2025, 2, 4, '乙巳', '戊寅'],
]) {
  test(`qimen solar month boundary: ${year}-${month}-${day} should be ${yearPillar} ${monthPillar}`, async () => {
    await assertMonthPillar(year, month, day, yearPillar, monthPillar);
  });
}

// Minute-resolution inputs immediately before/after the astronomical transition.
// The same instant must have the same year/month pillars in every input timezone.
for (const [year, termName, beforeYear, beforeMonth, afterYear, afterMonth] of [
  [2024, '大雪', '甲辰', '乙亥', '甲辰', '丙子'],
  [2025, '小寒', '甲辰', '丙子', '甲辰', '丁丑'],
  [2025, '立春', '甲辰', '丁丑', '乙巳', '戊寅'],
]) {
  const term = Solar.fromYmd(year, 6, 15).getLunar().getJieQiTable()[termName];
  const transition = Date.UTC(
    term.getYear(), term.getMonth() - 1, term.getDay(),
    term.getHour() - 8, term.getMinute(), term.getSecond(),
  );
  const firstMinuteAfter = Math.ceil(transition / 60000) * 60000;
  for (const [instant, expectedYear, expectedMonth] of [
    [firstMinuteAfter - 60000, beforeYear, beforeMonth],
    [firstMinuteAfter, afterYear, afterMonth],
  ]) {
    for (const timezone of ['Asia/Shanghai', 'UTC', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney']) {
      test(`qimen exact ${year} ${termName} boundary: ${new Date(instant).toISOString()} in ${timezone}`, async () => {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: timezone, hourCycle: 'h23',
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }).formatToParts(new Date(instant));
        const input = Object.fromEntries(parts
          .filter(part => part.type !== 'literal')
          .map(part => [part.type, Number(part.value)]));
        const result = await calculateQimen({ ...input, timezone });
        assert.equal(result.siZhu.year, expectedYear);
        assert.equal(result.siZhu.month, expectedMonth);
        // At 立春 the corrected month branch must also change the season used for 旺衰.
        assert.equal(result.monthPhase.甲, expectedMonth.endsWith('寅') ? '旺'
          : expectedMonth.endsWith('丑') ? '囚' : '相');
        for (const detailLevel of ['default', 'full']) {
          assert.equal(toQimenJson(result, { detailLevel }).基本信息.四柱.split(' ')[1], expectedMonth);
          assert.ok(toQimenText(result, { detailLevel }).includes(`- 四柱: ${expectedYear} ${expectedMonth} `));
        }
      });
    }
  }
}

test('qimen basic output should have correct structure and field types', async () => {
  const result = await calculateQimen({
    year: 2026,
    month: 4,
    day: 10,
    hour: 14,
    minute: 30,
  });

  // dunType
  assert.ok(
    result.dunType === 'yang' || result.dunType === 'yin',
    `dunType should be 'yang' or 'yin', got '${result.dunType}'`,
  );

  // juNumber
  assert.ok(
    Number.isInteger(result.juNumber) && result.juNumber >= 1 && result.juNumber <= 9,
    `juNumber should be 1-9, got ${result.juNumber}`,
  );

  // palaces
  assert.equal(Array.isArray(result.palaces), true);
  assert.equal(result.palaces.length, 9);

  for (const palace of result.palaces) {
    assert.equal(typeof palace.palaceIndex, 'number');
    assert.equal(typeof palace.palaceName, 'string');
    assert.ok(palace.palaceName.length > 0, 'palaceName should be non-empty');
    assert.equal(typeof palace.star, 'string');
assert.equal(typeof palace.gate, 'string');
    assert.equal(typeof palace.deity, 'string');
    assert.equal(typeof palace.earthStem, 'string');
    assert.equal(typeof palace.heavenStem, 'string');
  }

  // kongWang
  assert.ok(result.kongWang, 'kongWang should exist');
  assert.ok(result.kongWang.dayKong, 'dayKong should exist');
assert.ok(result.kongWang.hourKong, 'hourKong should exist');
  assert.ok(Array.isArray(result.kongWang.dayKong.branches), 'dayKong.branches should be an array');
  assert.ok(Array.isArray(result.kongWang.hourKong.branches), 'hourKong.branches should be an array');

  // yiMa
  assert.ok(result.yiMa, 'yiMa should exist');
  assert.equal(typeof result.yiMa.branch, 'string');
  assert.equal(typeof result.yiMa.palace, 'number');

  // siZhu
  assert.ok(result.siZhu,'siZhu should exist');
  assert.equal(typeof result.siZhu.year, 'string');
  assert.equal(typeof result.siZhu.month, 'string');
  assert.equal(typeof result.siZhu.day,'string');
  assert.equal(typeof result.siZhu.hour, 'string');
  assert.ok(result.siZhu.year.length > 0, 'siZhu.year should be non-empty');
  assert.ok(result.siZhu.month.length > 0, 'siZhu.month should be non-empty');
  assert.ok(result.siZhu.day.length > 0, 'siZhu.day should be non-empty');
  assert.ok(result.siZhu.hour.length > 0, 'siZhu.hour should be non-empty');
});

test('qimen globalFormations should be an array', async () => {
  const result = await calculateQimen({
    year: 2026,
    month: 4,
    day: 10,
    hour: 14,
    minute: 30,
  });

  assert.ok(Array.isArray(result.globalFormations), 'globalFormations should be an array');
  for (const f of result.globalFormations) {
    assert.equal(typeof f, 'string', 'each formation should be a string');
  }
});

test('qimen JSON rendering should return non-empty output', async () => {
  const result = await calculateQimen({
    year: 2026,
    month: 4,
    day: 10,
    hour: 14,
    minute: 30,
  });

  const json = toQimenJson(result);
  assert.ok(json, 'toQimenJson should return a non-empty result');
  assert.ok(typeof json === 'object', 'toQimenJson should return an object');
  assert.ok(Object.keys(json).length > 0, 'toQimenJson output should have keys');
});

test('qimen text rendering should return non-empty string', async () => {
  const result = await calculateQimen({
    year: 2026,
    month: 4,
    day: 10,
    hour: 14,
    minute: 30,
  });

  const text = toQimenText(result);
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0, 'toQimenText should return a non-empty string');
});

test('qimen concurrent calls should produce correct results with TZ mutex', async () => {
  const timezones = ['Asia/Shanghai', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'];
  const results = await Promise.all(
    timezones.map((tz) =>
      calculateQimen({
        year: 2026,
        month: 4,
        day: 10,
        hour: 14,
        minute: 30,
        timezone: tz,
      }),
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
assert.ok(r.palaces.length === 9, `concurrent call ${i} should have 9 palaces`);
    assert.ok(r.dunType === 'yang' || r.dunType === 'yin', `concurrent call ${i} should have valid dunType`);
    assert.ok(r.juNumber >= 1 && r.juNumber <= 9, `concurrent call ${i} should have valid juNumber`);
    assert.ok(r.siZhu.year.length > 0, `concurrent call ${i} should have non-empty siZhu.year`);
  }
});

test('qimen should reject invalid timezone', async () => {
  assert.throws(
    () => calculateQimen({
      year: 2026,
      month: 4,
      day: 10,
      hour: 14,
      minute: 30,
      timezone: 'Invalid/Zone',
    }),
    /timezone 无效/u,
  );
});
