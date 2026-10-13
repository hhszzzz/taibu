import test from 'node:test';
import assert from 'node:assert/strict';
import { LunarMonth, LunarYear, Solar } from 'lunar-javascript';

import * as mcpCore from 'taibu-core';
import { analyzePillarRelations } from '../dist/domains/bazi/calculate.js';

const SAMPLE_INPUT = {
  gender: 'male',
  birthYear: 1992,
  birthMonth: 8,
  birthDay: 16,
  birthHour: 9,
  birthMinute: 30,
  calendarType: 'solar',
};

function toPillarString(pillar) {
  return `${pillar.stem}${pillar.branch}`;
}

test('stem combinations and clashes retain distinct stem positions in canonical chart coordinates', () => {
  const chart = mcpCore.calculateBazi({ gender: 'male', birthYear: 1987, birthMonth: 6, birthDay: 15, birthHour: 12, timezone: 'Asia/Shanghai' });
  assert.ok(chart.tianGanWuHe.length > 0 && chart.tianGanChongKe.length > 0, 'fixture has both combination and clash relations');
  const stemRelations = [...chart.tianGanWuHe, ...chart.tianGanChongKe];
  for (const relation of stemRelations) assert.ok(relation.positions.every(position => /^(年|月|日|时)干$/u.test(position)));
  for (const detailLevel of ['default', 'full']) {
    const coordinates = mcpCore.toBaziJson(chart, { detailLevel }).干支关系明细;
    const combinations = coordinates.filter(relation => relation.类型 === '合' && relation.位置.every(cell => cell.部位 === '天干'));
    const clashes = coordinates.filter(relation => relation.类型 === '冲克');
    assert.equal(combinations.length, chart.tianGanWuHe.length);
    assert.equal(clashes.length, chart.tianGanChongKe.length);
    for (const relation of [...combinations, ...clashes]) assert.equal(relation.位置.length, 2);
    assert.ok(coordinates.some(relation => relation.类型 === '生' || relation.类型 === '克'), 'element relation coordinates remain available');
  }
});

test('bazi punishment groups require distinct branches unless explicitly self-punishing', () => {
  for (const branch of ['子', '丑', '寅', '卯', '巳', '未', '申', '戌']) {
    const punishments = analyzePillarRelations(branch, branch, '辰', '酉').filter(relation => relation.type === '刑');
    assert.deepEqual(punishments, [], `${branch}${branch} is not a self-punishment`);
  }
  for (const branch of ['辰', '午', '酉', '亥']) {
    const punishments = analyzePillarRelations(branch, branch, '寅', '丑').filter(relation => relation.type === '刑');
    assert.deepEqual(punishments.map(relation => relation.description), [`${branch}自刑`]);
  }
  assert.ok(analyzePillarRelations('寅', '巳', '辰', '酉').some(relation => relation.description === '无恩之刑'));
  assert.ok(analyzePillarRelations('子', '卯', '辰', '酉').some(relation => relation.description === '无礼之刑'));
});

test('命宫 counts from 子 back to the birth month, then forward from the birth hour to 卯', () => {
  // 午月申时：子宫起正月逆数，五月落申；申宫起申时顺数，数到卯时落卯宫。甲辰年五虎遁得丁卯
  assert.equal(mcpCore.calculateBazi({ gender: 'male', birthYear: 2024, birthMonth: 6, birthDay: 20, birthHour: 15, birthMinute: 30 }).mingGong, '丁卯');
  // 每月 20 日均已过节，覆盖十二个月支；奇数整点覆盖十二个时辰（23 点为子时）
  for (let month = 1; month <= 12; month++) {
    for (let hour = 1; hour <= 23; hour += 2) {
      const chart = mcpCore.calculateBazi({ gender: 'male', birthYear: 2024, birthMonth: month, birthDay: 20, birthHour: hour, birthMinute: 30 });
      const reference = Solar.fromYmdHms(2024, month, 20, hour, 30, 0).getLunar().getEightChar().getMingGong();
      assert.equal(chart.mingGong, reference, `${chart.fourPillars.month.branch}月${chart.fourPillars.hour.branch}时`);
    }
  }
});

test('bazi and dayun do not turn repeated Yin branches into punishment', () => {
  const input = { gender: 'male', birthYear: 2022, birthMonth: 2, birthDay: 10, birthHour: 8, timezone: 'Asia/Shanghai' };
  const chart = mcpCore.calculateBazi(input);
  assert.deepEqual(Object.values(chart.fourPillars).map(toPillarString), ['壬寅', '壬寅', '甲午', '戊辰']);
  assert.deepEqual(chart.relations.filter(relation => relation.type === '刑'), []);
  const sameBranchYears = mcpCore.calculateBaziDayun(input).list.flatMap(dayun => dayun.liunianList)
    .filter(year => year.ganZhi.endsWith('寅'));
  assert.ok(sameBranchYears.length > 0);
  for (const year of sameBranchYears) assert.deepEqual(year.taiSui, ['值太岁']);
});

test('dayun labels fixed-eight start times and retains true-solar calculation rules', () => {
  const input = { gender: 'male', birthYear: 1987, birthMonth: 6, birthDay: 15, birthHour: 12, timezone: 'Asia/Shanghai', yunSect: 2 };
  const result = mcpCore.calculateBaziDayun(input);
  assert.equal(result.startSolar, '1990-06-02 23:00:00');
  assert.equal(result.calculationOptions.startSolarTimezone, 'Etc/GMT-8');
  const solarInput = { ...input, longitude: 116.4 };
  const corrected = mcpCore.calculateBaziDayun(solarInput);
  assert.equal(corrected.calculationOptions.longitude, 116.4);
  assert.deepEqual(corrected.trueSolarTimeInfo, mcpCore.calculateBazi(solarInput).trueSolarTimeInfo);
});

test('bazi should expose enhanced pillar fields', async () => {
  const result = await mcpCore.calculateBazi(SAMPLE_INPUT);

  assert.ok(result.fourPillars, 'missing fourPillars');
  assert.equal(typeof result.kongWang, 'object', 'missing top-level kongWang');
  assert.equal(typeof result.kongWang.xun, 'string', 'top-level kongWang.xun missing');
  assert.ok(Array.isArray(result.kongWang.kongZhi), 'top-level kongWang.kongZhi should be array');
  assert.equal(result.kongWang.kongZhi.length, 2, 'top-level kongWang.kongZhi should contain 2 branches');

  for (const pillarKey of ['year', 'month', 'day', 'hour']) {
    const pillar = result.fourPillars[pillarKey];
    assert.ok(Array.isArray(pillar.hiddenStems), `${pillarKey}.hiddenStems should be array`);
    assert.ok(pillar.hiddenStems.length > 0, `${pillarKey}.hiddenStems should not be empty`);

    const firstHiddenStem = pillar.hiddenStems[0];
    assert.equal(typeof firstHiddenStem, 'object', `${pillarKey}.hiddenStems should be object[]`);
    assert.equal(typeof firstHiddenStem.stem, 'string', `${pillarKey}.hiddenStems[].stem missing`);
    assert.ok(['本气', '中气', '余气'].includes(firstHiddenStem.qiType), `${pillarKey}.hiddenStems[].qiType invalid`);
    assert.equal(typeof firstHiddenStem.tenGod, 'string', `${pillarKey}.hiddenStems[].tenGod missing`);

    assert.ok(Array.isArray(pillar.shenSha), `${pillarKey}.shenSha should be array`);
    assert.equal(typeof pillar.kongWang, 'object', `${pillarKey}.kongWang should be object`);
    assert.equal(typeof pillar.kongWang.isKong, 'boolean', `${pillarKey}.kongWang.isKong missing`);
    assert.ok(!('xun' in pillar.kongWang), `${pillarKey}.kongWang.xun should not exist`);
    assert.ok(!('kongZhi' in pillar.kongWang), `${pillarKey}.kongWang.kongZhi should not exist`);
  }

  assert.equal(result.daYun, undefined, 'daYun should not exist in bazi output');

  assert.ok(Array.isArray(result.relations), 'relations should be array');
  assert.ok(!('shenSha' in result), 'legacy shenSha should be removed');
});

test('bazi should output relation list with type/description/auspiciousness', async () => {
  const result = await mcpCore.calculateBazi({
    gender: 'male',
    birthYear: 1980,
    birthMonth: 1,
    birthDay: 1,
    birthHour: 2,
    birthMinute: 0,
    calendarType: 'solar',
  });

  assert.ok(result.relations.length > 0, 'relations should not be empty for this sample');

  const he = result.relations.find((r) => r.type === '合');
  const chong = result.relations.find((r) => r.type === '冲');
  const hai = result.relations.find((r) => r.type === '害');
  const xing = result.relations.find((r) => r.type === '刑');

  assert.ok(he, 'should include 合 relation');
  assert.ok(chong, 'should include 冲 relation');
  assert.ok(hai, 'should include 害 relation');
  assert.ok(xing, 'should include 刑 relation');

  assert.equal(typeof he.description, 'string');
  assert.equal(typeof chong.description, 'string');
  assert.equal(typeof hai.description, 'string');
  assert.equal(typeof xing.description, 'string');
  for (const rel of result.relations) {
    for (const p of rel.pillars) {
      assert.ok(['年支', '月支', '日支', '时支'].includes(p), `invalid relation pillar label: ${p}`);
    }
  }
});

test('bazi should set consistent pillar kongWang objects', async () => {
  const result = await mcpCore.calculateBazi(SAMPLE_INPUT);
  const pillars = ['year', 'month', 'day', 'hour'];
  const globalKong = result.kongWang;

  for (const key of pillars) {
    const pillar = result.fourPillars[key];
    assert.equal(
      pillar.kongWang.isKong,
      globalKong.kongZhi.includes(pillar.branch),
      `${key}.kongWang.isKong should match top-level kongWang.kongZhi`
    );
  }
});

test('bazi should return consistent chart for equivalent solar and lunar inputs', async () => {
  const solar = Solar.fromYmdHms(1992, 8, 16, 9, 30, 0);
  const lunar = solar.getLunar();
  const lunarMonth = lunar.getMonth();

  const solarResult = await mcpCore.calculateBazi({
    gender: 'male',
    birthYear: 1992,
    birthMonth: 8,
    birthDay: 16,
    birthHour: 9,
    birthMinute: 30,
    calendarType: 'solar',
  });

  const lunarResult = await mcpCore.calculateBazi({
    gender: 'male',
    birthYear: lunar.getYear(),
    birthMonth: Math.abs(lunarMonth),
    birthDay: lunar.getDay(),
    birthHour: 9,
    birthMinute: 30,
    calendarType: 'lunar',
    isLeapMonth: lunarMonth < 0,
  });

  assert.equal(solarResult.dayMaster, lunarResult.dayMaster);
  assert.equal(toPillarString(solarResult.fourPillars.year), toPillarString(lunarResult.fourPillars.year));
  assert.equal(toPillarString(solarResult.fourPillars.month), toPillarString(lunarResult.fourPillars.month));
  assert.equal(toPillarString(solarResult.fourPillars.day), toPillarString(lunarResult.fourPillars.day));
  assert.equal(toPillarString(solarResult.fourPillars.hour), toPillarString(lunarResult.fourPillars.hour));
});

test('bazi should reject invalid lunar leap month and out-of-range lunar day', async () => {
  let nonLeapYear = 1900;
  while (LunarYear.fromYear(nonLeapYear).getLeapMonth() !== 0) {
    nonLeapYear += 1;
  }

  assert.throws(
    () => mcpCore.calculateBazi({
      gender: 'female',
      birthYear: nonLeapYear,
      birthMonth: 1,
      birthDay: 1,
      birthHour: 10,
      birthMinute: 0,
      calendarType: 'lunar',
      isLeapMonth: true,
    }),
    /闰月/
  );

  const leapMonth = LunarYear.fromYear(nonLeapYear).getLeapMonth();
  const month = leapMonth > 0 ? leapMonth : 1;
  const ym = leapMonth > 0 ? -Math.abs(month) : month;
  const dayCount = LunarMonth.fromYm(nonLeapYear, ym).getDayCount();

  assert.throws(
    () => mcpCore.calculateBazi({
      gender: 'female',
      birthYear: nonLeapYear,
      birthMonth: month,
      birthDay: dayCount + 1,
      birthHour: 10,
      birthMinute: 0,
      calendarType: 'lunar',
      isLeapMonth: leapMonth > 0,
    }),
    /农历日期/
  );

  assert.throws(
    () => mcpCore.calculateBazi({
      gender: 'female',
      birthYear: nonLeapYear,
      birthMonth: -1,
      birthDay: 1,
      birthHour: 10,
      birthMinute: 0,
      calendarType: 'lunar',
      isLeapMonth: false,
    }),
    /农历月份/
  );
});

test('bazi should keep bazi-specific shensha after shared refactor', async () => {
  const samples = [
    {
      input: { gender: 'male', birthYear: 1980, birthMonth: 1, birthDay: 1, birthHour: 9, birthMinute: 0, calendarType: 'solar' },
      pillar: 'hour',
      star: '天德贵人',
    },
    {
      input: { gender: 'male', birthYear: 1980, birthMonth: 1, birthDay: 1, birthHour: 9, birthMinute: 0, calendarType: 'solar' },
      pillar: 'day',
      star: '德秀贵人',
    },
    {
      input: { gender: 'male', birthYear: 1980, birthMonth: 1, birthDay: 1, birthHour: 9, birthMinute: 0, calendarType: 'solar' },
      pillar: 'hour',
      star: '月德合',
    },
    {
      input: { gender: 'male', birthYear: 1980, birthMonth: 1, birthDay: 3, birthHour: 9, birthMinute: 0, calendarType: 'solar' },
      pillar: 'hour',
      star: '金舆',
    },
    {
      input: { gender: 'male', birthYear: 1980, birthMonth: 1, birthDay: 8, birthHour: 9, birthMinute: 0, calendarType: 'solar' },
      pillar: 'day',
      star: '月德贵人',
    },
    {
      input: { gender: 'male', birthYear: 1980, birthMonth: 1, birthDay: 10, birthHour: 9, birthMinute: 0, calendarType: 'solar' },
      pillar: 'hour',
      star: '天德合',
    },
  ];

  for (const sample of samples) {
    const result = await mcpCore.calculateBazi(sample.input);
    assert.ok(
      result.fourPillars[sample.pillar].shenSha.includes(sample.star),
      `expected ${sample.star} in ${sample.pillar} pillar`
    );
  }
});

test('bazi_pillars_resolve should return candidates and next call hint', async () => {
  assert.equal(typeof mcpCore.resolveBaziPillars, 'function', 'resolveBaziPillars should be exported');

  const result = await mcpCore.resolveBaziPillars({
    yearPillar: '壬申',
    monthPillar: '戊申',
    dayPillar: '丙午',
    hourPillar: '癸巳',
  });

  assert.equal(typeof result.count, 'number');
  assert.ok(Array.isArray(result.candidates), 'candidates should be array');

  if (result.candidates.length > 0) {
    const first = result.candidates[0];
    assert.equal(typeof first.candidateId, 'string');
    assert.equal(typeof first.birthYear, 'number');
    assert.equal(typeof first.birthMonth, 'number');
    assert.equal(typeof first.birthDay, 'number');
    assert.equal(typeof first.birthHour, 'number');
    assert.equal(typeof first.birthMinute, 'number');
    assert.equal(typeof first.isLeapMonth, 'boolean');
    assert.equal(typeof first.solarText, 'string');
    assert.equal(typeof first.lunarText, 'string');
    assert.equal(first.nextCall.tool, 'bazi');
    assert.equal(first.nextCall.arguments.birthYear, first.birthYear);
    assert.equal(first.nextCall.arguments.calendarType, 'lunar');
    assert.equal(first.nextCall.arguments.isLeapMonth, first.isLeapMonth);
  }
});

test('bazi_pillars_resolve candidates should round-trip to identical four pillars', async () => {
  const inputPillars = {
    yearPillar: '壬申',
    monthPillar: '戊申',
    dayPillar: '丙午',
    hourPillar: '癸巳',
  };

  const result = await mcpCore.resolveBaziPillars(inputPillars);
  assert.ok(result.count > 0, 'expected at least one candidate');

  for (const candidate of result.candidates) {
    const chart = await mcpCore.calculateBazi({
      gender: 'male',
      birthYear: candidate.birthYear,
      birthMonth: candidate.birthMonth,
      birthDay: candidate.birthDay,
      birthHour: candidate.birthHour,
      birthMinute: candidate.birthMinute,
      calendarType: 'lunar',
      isLeapMonth: candidate.isLeapMonth,
    });

    assert.equal(toPillarString(chart.fourPillars.year), inputPillars.yearPillar);
    assert.equal(toPillarString(chart.fourPillars.month), inputPillars.monthPillar);
    assert.equal(toPillarString(chart.fourPillars.day), inputPillars.dayPillar);
    assert.equal(toPillarString(chart.fourPillars.hour), inputPillars.hourPillar);
  }
});

test('bazi_pillars_resolve should reject invalid pillar strings', async () => {
  await assert.rejects(
    () => mcpCore.resolveBaziPillars({
      yearPillar: '甲',
      monthPillar: '乙丑',
      dayPillar: '丙寅',
      hourPillar: '丁卯',
    }),
    /yearPillar 必须是 2 字干支/
  );

  await assert.rejects(
    () => mcpCore.resolveBaziPillars({
      yearPillar: '甲子',
      monthPillar: '乙X',
      dayPillar: '丙寅',
      hourPillar: '丁卯',
    }),
    /monthPillar 地支无效/
  );

  await assert.rejects(
    () => mcpCore.resolveBaziPillars({
      yearPillar: '甲子',
      monthPillar: '甲子',
      dayPillar: '甲子',
      hourPillar: '乙子',
    }),
    /hourPillar 不是有效干支组合/
  );
});

test('bazi_pillars_resolve should return empty candidates for legal but unmatched pillars', async () => {
  const result = await mcpCore.resolveBaziPillars({
    yearPillar: '甲子',
    monthPillar: '乙丑',
    dayPillar: '丙寅',
    hourPillar: '丁卯',
  });

  assert.equal(result.count, 0);
  assert.deepEqual(result.candidates, []);
});
