import test from 'node:test';
import assert from 'node:assert/strict';
import { astro } from 'iztro';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';
import { calculateZiwei } from 'taibu-core/ziwei';

const BIRTH = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };
const STAR_GROUPS = ['主星及四化', '辅星', '杂曜'];
/** ziwei_horoscope 的宫名带「宫」后缀，本工具与命盘十二宫位一致不带后缀（命宫除外） */
const bare = (name) => (name === '命宫' ? name : name.replace(/宫$/, ''));

async function palace(selector, birth = BIRTH) {
  return renderToolResult('ziwei_palace', await executeTool('ziwei_palace', { ...birth, ...selector })).structuredContent;
}

async function natalChart(birth = BIRTH) {
  return renderToolResult('ziwei', await executeTool('ziwei', birth), { detailLevel: 'full' }).structuredContent;
}

test('ziwei_palace schema is the ziwei schema plus selectors and its own detail level', () => {
  const tool = listToolDefinitions().find((item) => item.name === 'ziwei_palace');
  const ziwei = listToolDefinitions().find((item) => item.name === 'ziwei');
  for (const key of Object.keys(ziwei.inputSchema.properties).filter((key) => key !== 'detailLevel')) {
    assert.deepEqual(tool.inputSchema.properties[key], ziwei.inputSchema.properties[key], key);
  }
  assert.deepEqual(tool.inputSchema.properties.detailLevel.enum, ['default', 'full'], 'the drilldown has its own text detail level');
  assert.deepEqual(tool.inputSchema.required, [...ziwei.inputSchema.required, 'palace']);
});

test('命宫 facts equal what the ziwei chart itself reports, and an empty 命宫 borrows 迁移 major stars', async () => {
  const json = await palace({ palace: '命宫' });
  const chart = await natalChart();
  const soul = chart.十二宫位.find((item) => item.宫位 === '命宫');
  assert.equal(json.宫位概览.干支, soul.干支);
  assert.equal(json.宫位概览.空宫, '是');
  assert.deepEqual(json.本宫星曜.map((star) => `${star.组别}:${star.星曜}`),
    STAR_GROUPS.flatMap((group) => (soul[group] ?? []).map((star) => `${group}:${star.星名}`)));
  assert.ok(json.本宫星曜.every((star) => star.位置[0].宫位 === '命宫' && star.位置[0].星曜 === star.星曜));
  const raw = calculateZiwei(BIRTH).palaces.find((item) => item.name === '命宫');
  assert.deepEqual(json.三方四正.map((row) => row.宫位), raw.sanFangSiZheng);
  assert.deepEqual(json.三方四正.map((row) => row.角色), ['本宫', '三合', '三合', '对宫']);
  const opposite = chart.十二宫位.find((item) => item.宫位 === '迁移');
  assert.equal(json.借对宫.对宫, '迁移');
  assert.deepEqual(json.借对宫.主星.map((star) => star.星曜), opposite.主星及四化.map((star) => star.星名));
  assert.ok(json.借对宫.主星.every((star) => star.组别 === '主星及四化'), 'only major stars are borrowed');
  assert.ok(json.计算规则.ruleVersion.startsWith('ziwei-palace-'));
});

test('palace-stem flights equal ziwei_flying_star, and incoming flights all land in the palace', async () => {
  const json = await palace({ palace: '命宫' });
  const flying = renderToolResult('ziwei_flying_star', await executeTool('ziwei_flying_star', { ...BIRTH, queries: [{ type: 'mutagedPlaces', palace: '命宫' }] })).structuredContent;
  assert.deepEqual(json.宫干四化飞出.map((row) => [row.类型, row.结果, row.位置.at(-1).宫位]),
    flying.查询结果[0].四化落宫.map((item) => [`化${item.四化}`, item.星曜, bare(item.宫位)]));
  const migration = await palace({ palace: '迁移' });
  assert.ok(migration.四化飞入.length > 0);
  assert.ok(migration.四化飞入.every((row) => row.位置.at(-1).宫位 === '迁移' && migration.本宫星曜.some((star) => star.星曜 === row.结果)));
  assert.equal(migration.借对宫, undefined, 'a palace with major stars borrows nothing');
});

test('仆役 is an alias of 交友', async () => {
  assert.deepEqual(await palace({ palace: '仆役' }), await palace({ palace: '交友' }));
  assert.equal((await palace({ palace: '仆役' })).查询.宫位, '交友');
});

test('the 禄存 palace is always flanked by 擎羊 and 陀罗', async () => {
  const lucun = calculateZiwei(BIRTH).palaces.find((item) => item.minorStars.some((star) => star.name === '禄存'));
  const json = await palace({ palace: lucun.name });
  const flank = json.夹宫.夹星.find((row) => row.类型 === '羊陀夹');
  assert.ok(flank, JSON.stringify(json.夹宫));
  const chart = await natalChart();
  for (const position of flank.位置) {
    const neighbour = chart.十二宫位.find((item) => item.宫位 === position.宫位);
    assert.ok(STAR_GROUPS.some((group) => (neighbour[group] ?? []).some((star) => star.星名 === position.星曜)), position.星曜);
  }
  assert.equal(json.夹宫.两邻.length, 2);
});

test('every scope works and the overlay lands where ziwei_horoscope says', async () => {
  const targetDate = '2026-03-13';
  const horoscope = renderToolResult('ziwei_horoscope', await executeTool('ziwei_horoscope', { ...BIRTH, targetDate })).structuredContent;
  for (const [scope, label] of [['decadal', '大限'], ['yearly', '流年'], ['monthly', '流月'], ['daily', '流日']]) {
    const json = await palace({ palace: '命宫', scope, targetDate });
    const layer = horoscope.运限叠宫.find((item) => item.层次 === label);
    assert.equal(json.查询.层次, label);
    assert.equal(json.运限叠加.运限干支, layer.干支, scope);
    assert.equal(json.运限叠加.落入本命宫位, bare(layer.落入本命宫位), scope);
    assert.equal(json.宫位概览.宫位, bare(layer.落入本命宫位), scope);
    assert.deepEqual(json.运限叠加.运限四化.map((row) => `${row.结果}[${row.类型}]`), layer.运限四化, scope);
  }
  const hourly = await palace({ palace: '财帛', scope: 'hourly', targetDate, targetTimeIndex: 5 });
  assert.equal(hourly.运限叠加.层次, '流时');
  assert.equal(hourly.运限叠加.时辰序号, 5);
  const natal = await palace({ palace: '命宫' });
  assert.equal(natal.运限叠加, undefined);
  const lunar = await palace({ palace: '夫妻', scope: 'yearly', targetDate }, { gender: 'female', birthYear: 1995, birthMonth: 6, birthDay: 20, birthHour: 23, calendarType: 'lunar' });
  assert.ok(lunar.运限叠加.落入本命宫位);
});

test('invalid selectors are rejected', async () => {
  for (const selector of [
    { palace: '命' },
    { palace: '命宫', scope: 'yearly' },
    { palace: '命宫', scope: 'hourly', targetDate: '2026-03-13' },
    { palace: '命宫', targetDate: '2026-03-13' },
    { palace: '命宫', targetTimeIndex: 3 },
    { palace: '命宫', scope: 'yearly', targetDate: '2026-3-1' },
    { palace: '命宫', scope: 'centennial', targetDate: '2026-03-13' },
    { scope: 'natal' },
  ]) {
    await assert.rejects(executeTool('ziwei_palace', { ...BIRTH, ...selector }), JSON.stringify(selector));
  }
});

test('concurrent calls with different four-transformation tables never leak into each other', async () => {
  const before = structuredClone(astro.getConfig());
  // 壬干化科：默认左辅，另一派作天府
  const custom = { ...BIRTH, calculationOptions: { mutagens: { 壬: ['天梁', '紫微', '天府', '武曲'] } } };
  const science = (json) => json.宫干四化飞出.find((row) => row.类型 === '化科').结果;
  const sequentialDefault = await palace({ palace: '命宫' });
  const sequentialCustom = await palace({ palace: '命宫' }, custom);
  assert.equal(science(sequentialDefault), '左辅');
  assert.equal(science(sequentialCustom), '天府');
  const yearly = { palace: '命宫', scope: 'yearly', targetDate: '2026-03-13' };
  const expected = [[sequentialDefault, await palace(yearly)], [sequentialCustom, await palace(yearly, custom)]];
  const runs = await Promise.all(Array.from({ length: 12 }, (_, i) => palace(i % 3 === 2 ? yearly : { palace: '命宫' }, i % 2 ? custom : BIRTH)));
  runs.forEach((json, i) => assert.deepEqual(json, expected[i % 2][i % 3 === 2 ? 1 : 0], `run ${i}`));
  assert.deepEqual(astro.getConfig(), before, 'global iztro configuration is restored');
});
