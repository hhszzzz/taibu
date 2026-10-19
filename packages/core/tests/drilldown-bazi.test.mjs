import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';
import { deriveBaziRelations, toBaziRelationsJson, calculateBazi } from 'taibu-core/bazi';

const BIRTH = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };

async function relations(selector) {
  const raw = await executeTool('bazi_relations', { ...BIRTH, ...selector });
  return { raw, json: renderToolResult('bazi_relations', raw).structuredContent };
}

const labels = (row) => row.位置.map((p) => `${p.柱}${p.部位}${p.字}`).join('·');

test('bazi_relations schema is the bazi schema plus selectors, without bazi detail levels', () => {
  const tool = listToolDefinitions().find((item) => item.name === 'bazi_relations');
  const bazi = listToolDefinitions().find((item) => item.name === 'bazi');
  assert.ok(tool);
  for (const key of Object.keys(bazi.inputSchema.properties).filter((key) => key !== 'detailLevel')) {
    assert.deepEqual(tool.inputSchema.properties[key], bazi.inputSchema.properties[key], key);
  }
  assert.equal('detailLevel' in tool.inputSchema.properties, false);
  assert.deepEqual(tool.inputSchema.required, bazi.inputSchema.required);
  assert.ok(tool.inputSchema.examples.every((example) => example.gender && example.birthYear));
});

test('natal-only query reports the four pillars and their relations, without overlay sections', async () => {
  const { json } = await relations({});
  assert.deepEqual(json.查询, {});
  assert.deepEqual(json.参与柱位.map((p) => `${p.柱}${p.干支}`), ['年柱己巳', '月柱丁丑', '日柱庚辰', '时柱辛巳']);
  assert.equal(json.参与柱位[2].天干十神, '日主');
  assert.deepEqual(json.原局关系.map((row) => `${row.类型}:${labels(row)}`), ['相破:月柱地支丑·日柱地支辰']);
  assert.equal(json.叠加关系, undefined);
  assert.ok(json.计算规则.ruleVersion.startsWith('bazi-relations-'));
});

test('a flow year lands in its 大运 and lists overlay relations including 大运–流年', async () => {
  const { json } = await relations({ year: 2027 });
  assert.match(json.查询.大运, /^第4步 癸酉（2023–2032/);
  assert.equal(json.查询.流年, 2027);
  const rows = json.叠加关系.map((row) => `${row.类型}:${labels(row)}`);
  assert.ok(rows.includes('天干相冲:大运天干癸·流年天干丁'));
  assert.ok(rows.includes('六冲:月柱地支丑·流年地支未'));
  assert.ok(rows.includes('相刑:流年地支未·月柱地支丑'));
  assert.ok(json.叠加关系.every((row) => row.位置.some((p) => ['大运', '流年'].includes(p.柱))));
});

test('flow month and flow day add their pillars; years before 起运 use 小运 and report 太岁', async () => {
  const month = (await relations({ year: 2027, month: 5 })).json;
  assert.match(month.查询.流月, /^丙午月（芒种起/);
  const day = (await relations({ day: '2027-06-10' })).json;
  assert.deepEqual(day.参与柱位.slice(4).map((p) => `${p.柱}${p.干支}`), ['大运癸酉', '流年丁未', '流月丙午', '流日庚申']);
  const early = (await relations({ year: 1992 })).json;
  assert.match(early.查询.小运, /^戊寅（虚岁3/);
  assert.deepEqual(early.太岁关系, ['合太岁', '刑太岁', '破太岁']);
});

test('a day before 立春 belongs to the previous flow year', async () => {
  const { json } = await relations({ day: '2027-02-03' });
  assert.equal(json.查询.流年, 2026);
  assert.equal(json.参与柱位.find((p) => p.柱 === '流年').干支, '丙午');
});

test('岁运并临 and 天克地冲 are flagged from pillar identity and clashes', () => {
  const chart = calculateBazi(BIRTH);
  // 逐年扫描十步大运区间，必然出现与大运同干支的流年与天克地冲
  const hints = [];
  for (let year = 1994; year <= 2089; year++) hints.push(...deriveBaziRelations(chart, { year }, BIRTH).fortuneHints);
  assert.ok(hints.some((hint) => hint.startsWith('岁运并临')), hints.join('\n'));
  assert.ok(hints.some((hint) => hint.includes('天克地冲')), hints.join('\n'));
  const json = toBaziRelationsJson(deriveBaziRelations(chart, {}, BIRTH));
  assert.equal(json.岁运提示, undefined);
});

test('selector boundaries are rejected with input errors', async () => {
  for (const selector of [
    { month: 5 },
    { day: '2027-06-10', year: 2027 },
    { day: '2027-13-10' },
    { day: '20270610' },
    { year: 1980 },
    { year: 2027, dayun: 2 },
    { dayun: 11 },
    { year: 2027, month: 13 },
  ]) {
    await assert.rejects(executeTool('bazi_relations', { ...BIRTH, ...selector }), JSON.stringify(selector));
  }
});

test('子时 rule inputs and lunar birth dates flow through to the base chart', async () => {
  const late = { gender: 'female', birthYear: 1995, birthMonth: 6, birthDay: 20, birthHour: 23 };
  const zi = renderToolResult('bazi_relations', await executeTool('bazi_relations', { ...late, dayBoundary: 'zi' })).structuredContent;
  const plain = renderToolResult('bazi_relations', await executeTool('bazi_relations', { ...late, dayBoundary: 'midnight' })).structuredContent;
  assert.notEqual(zi.参与柱位[2].干支, plain.参与柱位[2].干支, '早晚子时换日影响日柱');
  const lunar = renderToolResult('bazi_relations', await executeTool('bazi_relations', { ...late, calendarType: 'lunar', isLeapMonth: false })).structuredContent;
  assert.equal(lunar.参与柱位.length, 4);
});
