import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBazi, calculateBaziHourCandidates } from 'taibu-core/bazi';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';
import { validateOutput } from '../dist/mcp/output-validator.js';

const HER = { gender: 'female', birthYear: 1995, birthMonth: 1, birthDay: 9 };
const ganZhi = (pillar) => `${pillar.stem}${pillar.branch}`;
/** 「YYYY-MM-DD HH:mm」的钟表时间排盘，与 bazi 给出同一时间时一致 */
const castAt = (input, clock, extra = {}) => {
  const [date, time] = clock.split(' ');
  const [birthYear, birthMonth, birthDay] = date.split('-').map(Number);
  const [birthHour, birthMinute] = time.split(':').map(Number);
  const chart = calculateBazi({ ...input, calendarType: 'solar', birthYear, birthMonth, birthDay, birthHour, birthMinute, ...extra });
  return ['year', 'month', 'day', 'hour'].map((key) => ganZhi(chart.fourPillars[key]));
};
const minuteBefore = (clock) => {
  const date = new Date(`${clock.replace(' ', 'T')}:00Z`);
  return new Date(date.getTime() - 60000).toISOString().slice(0, 16).replace('T', ' ');
};

test('a day without a known hour has thirteen candidates, each the pillars bazi casts at its first and last minute', () => {
  const result = calculateBaziHourCandidates(HER);
  assert.deepEqual(result.candidates.map((candidate) => candidate.label),
    ['早子时', '丑时', '寅时', '卯时', '辰时', '巳时', '午时', '未时', '申时', '酉时', '戌时', '亥时', '晚子时']);
  assert.deepEqual(result.shared.map((pillar) => `${pillar.label}${pillar.ganZhi}`), ['年柱甲戌', '月柱丁丑', '日柱庚子']);
  assert.deepEqual(result.dayMaster, { stem: '庚', element: '金' });
  assert.deepEqual(result.date, { solar: '1995-01-09', lunar: '一九九四年腊月初九' });
  assert.equal(result.candidates.reduce((sum, candidate) => sum + candidate.clock.minutes, 0), 1440);
  for (const [index, candidate] of result.candidates.entries()) {
    const pillars = candidate.pillars.map((pillar) => pillar.ganZhi);
    assert.deepEqual(castAt(HER, candidate.clock.start), pillars, candidate.label);
    assert.deepEqual(castAt(HER, minuteBefore(candidate.clock.end)), pillars, candidate.label);
    // 结束不含：下一段从这里开始
    if (index + 1 < result.candidates.length) assert.equal(result.candidates[index + 1].clock.start, candidate.clock.end);
    // 排盘参数是段内的时刻，排出的正是这个候选
    assert.deepEqual(castAt(HER, `1995-01-09 ${String(candidate.birthHour).padStart(2, '0')}:${String(candidate.birthMinute).padStart(2, '0')}`), pillars, candidate.label);
  }
  const [early, ox] = result.candidates;
  assert.deepEqual([early.clock, early.birthHour, early.birthMinute], [{ start: '1995-01-09 00:00', end: '1995-01-09 01:00', minutes: 60 }, 0, 30]);
  assert.deepEqual([ox.birthHour, ox.birthMinute], [2, 0]);
  assert.equal(result.candidates.at(-1).clock.end, '1995-01-10 00:00');
  // 晚子时日柱仍取当日，时干按次日起
  assert.deepEqual(result.candidates.at(-1).pillars.map((pillar) => pillar.ganZhi), ['甲戌', '丁丑', '庚子', '戊子']);
});

test('each candidate lists the facts its hour pillar adds: ten gods, relations, life palace, roots and luck', () => {
  const byLabel = Object.fromEntries(calculateBaziHourCandidates(HER).candidates.map((candidate) => [candidate.label, candidate]));
  const ox = byLabel['丑时'];
  assert.equal(ganZhi(ox.hour), '丁丑');
  assert.equal(ox.hour.tenGod, '正官');
  assert.deepEqual(ox.relations.map((fact) => fact.description), ['子丑六合化土', '戌丑恃势之刑']);
  assert.ok(ox.relations.every((fact) => fact.participants.some((p) => p.label === '时柱')), 'only relations the hour pillar joins');
  assert.equal(ox.mingGong, '丁卯');
  assert.deepEqual(ox.dayMasterRoot, { hidden: '辛', qiType: '余气' });
  assert.equal(byLabel['寅时'].dayMasterRoot, undefined);
  assert.deepEqual(byLabel['申时'].dayMasterRoot, { hidden: '庚', qiType: '本气' });
  // 月令丑藏己癸辛：卯时时干己透出
  assert.deepEqual(byLabel['卯时'].monthRevealed, ['己']);
  assert.deepEqual(byLabel['亥时'].relations.map((fact) => [fact.type, fact.result]), [['三会', '水']]);
  // 起运随时辰推迟：子时之后跨过一个年份
  assert.deepEqual([ox.luck.first, byLabel['寅时'].luck.first], [{ ganZhi: '丙子', startYear: 1995, startAge: 1 }, { ganZhi: '丙子', startYear: 1996, startAge: 2 }]);
});

test('a solar term on the birth day splits the hour it falls in and names the two halves', () => {
  const result = calculateBaziHourCandidates({ gender: 'male', birthYear: 2024, birthMonth: 2, birthDay: 4 });
  assert.equal(result.candidates.length, 14);
  assert.deepEqual(result.termChange, { name: '立春', beijingTime: '2024-02-04 16:27', localTime: '2024-02-04 16:28' });
  const [before, after] = result.candidates.filter((candidate) => candidate.branch === '申');
  assert.deepEqual([before.label, before.clock.end, after.label, after.clock.start], ['申时（立春前）', '2024-02-04 16:28', '申时（立春后）', '2024-02-04 16:28']);
  assert.deepEqual([before.pillars[0].ganZhi, before.pillars[1].ganZhi, after.pillars[0].ganZhi, after.pillars[1].ganZhi], ['癸卯', '乙丑', '甲辰', '丙寅']);
  // 只有日柱对各候选相同
  assert.deepEqual(result.shared.map((pillar) => pillar.label), ['日柱']);
  assert.deepEqual(castAt({ gender: 'male' }, '2024-02-04 16:27').slice(0, 2), ['癸卯', '乙丑']);
});

test('true solar time shifts the clock windows and can bring in an hour of the previous day', () => {
  const input = { gender: 'male', birthYear: 1990, birthMonth: 5, birthDay: 20, longitude: 87.6 };
  const result = calculateBaziHourCandidates(input);
  const [first, second] = result.candidates;
  assert.equal(first.label, '戌时（日柱甲申）');
  assert.deepEqual(first.clock, { start: '1990-05-20 00:00', end: '1990-05-20 00:06', minutes: 6 });
  assert.deepEqual(first.trueSolar, { start: '1990-05-19 20:54', end: '1990-05-19 21:00' });
  assert.deepEqual([second.label, second.clock.start, second.trueSolar.start], ['亥时', '1990-05-20 00:06', '1990-05-19 21:00']);
  assert.equal(result.candidates.at(-1).label, '戌时（日柱乙酉）');
  assert.equal(result.dayMaster, undefined, 'the day pillar is not shared');
  assert.deepEqual(result.shared.map((pillar) => pillar.label), ['年柱', '月柱']);
  for (const candidate of result.candidates) {
    const pillars = candidate.pillars.map((pillar) => pillar.ganZhi);
    assert.deepEqual(castAt(input, candidate.clock.start), pillars, candidate.label);
  }
  // 23 点换日：前一日的晚子与当日的早子连成一个子时
  const zi = calculateBaziHourCandidates({ ...input, dayBoundary: 'zi' }).candidates.filter((candidate) => candidate.branch === '子');
  assert.deepEqual(zi.map((candidate) => [candidate.label, candidate.clock.minutes]), [['子时', 120]]);
});

test('daylight saving: a repeated hour counts twice, a skipped one not at all, and an all-repeated hour names its pass', () => {
  const newYork = calculateBaziHourCandidates({ gender: 'female', birthYear: 2024, birthMonth: 11, birthDay: 3, timezone: 'America/New_York' });
  const ox = newYork.candidates.find((candidate) => candidate.label === '丑时');
  assert.equal(ox.clock.minutes, 180);
  assert.deepEqual([ox.birthHour, ox.birthMinute, ox.disambiguation], [2, 0, undefined], 'the middle moves to a clock time that occurs once');
  assert.equal(newYork.candidates.reduce((sum, candidate) => sum + candidate.clock.minutes, 0), 1500);
  const havana = calculateBaziHourCandidates({ gender: 'female', birthYear: 2024, birthMonth: 11, birthDay: 3, timezone: 'America/Havana' });
  const early = havana.candidates[0];
  assert.deepEqual([early.label, early.clock.minutes, early.birthHour, early.birthMinute, early.disambiguation], ['早子时', 120, 0, 0, 'later']);
  assert.deepEqual(castAt({ gender: 'female', timezone: 'America/Havana' }, '2024-11-03 00:00', { disambiguation: 'later' }), early.pillars.map((pillar) => pillar.ganZhi));
  const santiago = calculateBaziHourCandidates({ gender: 'female', birthYear: 2024, birthMonth: 9, birthDay: 8, timezone: 'America/Santiago' });
  assert.equal(santiago.candidates[0].label, '丑时', 'midnight to one does not exist that day');
  assert.equal(santiago.candidates.reduce((sum, candidate) => sum + candidate.clock.minutes, 0), 1380);
});

test('a lunar birthday lists the same candidates as its solar date; a remembered window keeps only the hours it meets', () => {
  const lunar = calculateBaziHourCandidates({ gender: 'female', birthYear: 1994, birthMonth: 12, birthDay: 9, calendarType: 'lunar' });
  assert.deepEqual(lunar.candidates, calculateBaziHourCandidates(HER).candidates);
  const morning = calculateBaziHourCandidates({ ...HER, fromHour: 5, toHour: 12 });
  assert.deepEqual(morning.candidates.map((candidate) => candidate.label), ['卯时', '辰时', '巳时', '午时']);
  assert.deepEqual(morning.window, { fromHour: 5, toHour: 12 });
  assert.equal(morning.candidates[3].clock.end, '1995-01-09 13:00', 'a window filters candidates without cutting them');
});

test('event years list only what tells the candidates apart, and the luck pillar once it differs between them', () => {
  const morning = calculateBaziHourCandidates({ ...HER, fromHour: 5, toHour: 12, eventYears: [2015, 2018] });
  assert.deepEqual(morning.events, [{ year: 2015, ganZhi: '乙未' }, { year: 2018, ganZhi: '戊戌' }]);
  const dragon = morning.candidates.find((candidate) => candidate.label === '辰时').events[1];
  assert.deepEqual(dragon.fortune, { layer: '大运', ganZhi: '甲戌', label: '第3步大运' });
  assert.deepEqual(dragon.relations.map((fact) => fact.description), ['庚甲相冲', '辰戌相冲', '辰戌相冲']);
  assert.deepEqual(dragon.hints, ['大运与时柱天克地冲（甲戌对庚辰，亦称反吟）']);
  for (const candidate of morning.candidates) {
    for (const event of candidate.events) assert.ok(event.relations.every((fact) => fact.participants.some((p) => p.label === '时柱')), `${candidate.label} ${event.year}`);
  }
  // 2005 年：子时、丑时出生已交第二步大运乙亥，其余仍在丙子；涉及大运的关系也成了区分事实
  const allDay = calculateBaziHourCandidates({ ...HER, eventYears: [2005] }).candidates;
  assert.deepEqual([...new Set(allDay.map((candidate) => candidate.events[0].fortune.ganZhi))], ['乙亥', '丙子']);
  const tiger = allDay.find((candidate) => candidate.label === '寅时').events[0];
  assert.deepEqual(tiger.relations.map((fact) => fact.description), ['丑子六合化土', '子酉相破']);
  assert.ok(tiger.relations.every((fact) => fact.participants.some((p) => p.label === '大运')));
});

test('the birth time, a reversed window and impossible event years are refused', () => {
  for (const [patch, pattern] of [
    [{ birthHour: 8 }, /birthHour 推算出生时辰时不给出生时间/],
    [{ birthMinute: 30 }, /birthMinute/],
    [{ fromHour: 12, toHour: 12 }, /toHour 须晚于 fromHour/],
    [{ toHour: 25 }, /toHour/],
    [{ eventYears: [] }, /eventYears 须为 1–8 个年份/],
    [{ eventYears: [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009] }, /eventYears 须为 1–8 个年份/],
    [{ eventYears: [2010, 2010] }, /年份不能重复/],
    [{ eventYears: [1994] }, /前事年份不能早于出生年 1995/],
    [{ eventYears: [2010.5] }, /eventYears\.0/],
  ]) assert.throws(() => calculateBaziHourCandidates({ ...HER, ...patch }), (error) => error.name === 'CoreInputError' && pattern.test(error.message), JSON.stringify(patch));
});

test('the MCP tool renders lean text by default and schema-valid JSON with every fact', async () => {
  const definition = listToolDefinitions().find((tool) => tool.name === 'bazi_hour_candidates');
  assert.equal(definition.title, '推算出生时辰');
  assert.deepEqual(definition.inputSchema.required, ['gender', 'birthYear', 'birthMonth', 'birthDay']);
  for (const key of ['birthHour', 'birthMinute', 'disambiguation']) assert.equal(key in definition.inputSchema.properties, false, key);
  const raw = await executeTool('bazi_hour_candidates', { ...HER, eventYears: [2015] });
  const rendered = renderToolResult('bazi_hour_candidates', raw);
  validateOutput('bazi_hour_candidates', rendered.structuredContent, definition.outputSchema);
  const json = rendered.structuredContent;
  assert.equal(json.候选数量, 13);
  assert.deepEqual(json.候选[1].排盘参数, { 出生时: 2, 出生分: 0 });
  assert.equal(json.候选[1].日主之根, '日主庚通根于时支丑（藏辛·余气）');
  assert.ok(json.候选[0].时柱.神煞.length > 0 && json.口径.length > 0);
  assert.deepEqual(json.前事年份, [{ 年份: 2015, 流年: '乙未' }]);
  const text = rendered.content[0].text;
  assert.match(text, /^# 推算出生时辰/u);
  assert.match(text, /^- 各候选共有：年柱甲戌、月柱丁丑、日柱庚子（日主庚金）$/mu);
  assert.match(text, /^## 早子时 00:00–01:00$/mu);
  assert.match(text, /^## 晚子时 23:00–24:00$/mu);
  assert.match(text, /^- 时柱丁丑：天干正官；藏干己（正印·本气） 癸（伤官·中气） 辛（劫财·余气）；日主坐墓；纳音涧下水$/mu);
  assert.match(text, /^- 时柱关系：子丑六合化土（日支子·时支丑）；戌丑恃势之刑（年支戌·月支丑·时支丑）$/mu);
  assert.match(text, /^- 排盘：birthHour 2，birthMinute 0$/mu);
  assert.match(text, /^- 前事 2015（流年乙未，第2步大运乙亥）：/mu);
  assert.doesNotMatch(text, /神煞|## 口径/u);
  const full = renderToolResult('bazi_hour_candidates', raw, { detailLevel: 'full' }).content[0].text;
  assert.match(full, /神煞/u);
  assert.match(full, /## 口径/u);
});
