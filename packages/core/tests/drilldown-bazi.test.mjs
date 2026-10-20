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

test('bazi_relations schema is the bazi schema plus selectors and its own detail level', () => {
  const tool = listToolDefinitions().find((item) => item.name === 'bazi_relations');
  const bazi = listToolDefinitions().find((item) => item.name === 'bazi');
  assert.ok(tool);
  for (const key of Object.keys(bazi.inputSchema.properties).filter((key) => key !== 'detailLevel')) {
    assert.deepEqual(tool.inputSchema.properties[key], bazi.inputSchema.properties[key], key);
  }
  assert.deepEqual(tool.inputSchema.properties.detailLevel.enum, ['default', 'full'], 'the drilldown has its own text detail level');
  assert.deepEqual(tool.inputSchema.required, bazi.inputSchema.required);
  assert.ok(tool.inputSchema.examples.every((example) => example.gender && example.birthYear));
});

test('natal relations live only in the chart: the chart lists 相破 and a query without 岁运 is rejected', async () => {
  const chart = renderToolResult('bazi', await executeTool('bazi', BIRTH)).structuredContent;
  assert.ok(chart.干支关系.includes('丑辰相破'));
  assert.ok(chart.干支关系明细.some((row) => row.类型 === '破' && labels(row) === '月柱地支丑·日柱地支辰'));
  await assert.rejects(executeTool('bazi_relations', BIRTH), /year；day；dayun/);
  assert.throws(() => deriveBaziRelations(calculateBazi(BIRTH), {}, BIRTH), /八字命盘的「干支关系」/);
  const { json } = await relations({ dayun: 4 });
  assert.equal(json.原局关系, undefined, 'natal relations are not repeated');
  assert.deepEqual(json.参与柱位.map((p) => `${p.柱}${p.干支}`), ['年柱己巳', '月柱丁丑', '日柱庚辰', '时柱辛巳', '大运癸酉']);
  assert.equal(json.参与柱位[2].天干十神, '日主');
  assert.ok(json.叠加关系.length > 0 && json.叠加关系.every((row) => row.位置.some((p) => p.柱 === '大运')));
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
  const merged = hints.find((hint) => hint.type === '岁运并临');
  assert.ok(merged?.description.startsWith('岁运并临'), hints.map((hint) => hint.description).join('\n'));
  assert.deepEqual(merged.labels, ['流年', '大运']);
  assert.ok(hints.some((hint) => hint.type === '天克地冲' && hint.description.includes('天克地冲')));
  const json = toBaziRelationsJson(deriveBaziRelations(chart, { year: 2027 }, BIRTH));
  assert.equal(json.岁运提示, undefined, '2027 丁未 neither repeats nor clashes 癸酉 or the natal pillars');
});

test('types keeps only those relations, lists the ones sharing a character, and counts the rest', async () => {
  const { json } = await relations({ year: 2027, types: ['六冲'] });
  assert.deepEqual(json.筛选, { 类型: ['六冲'] });
  assert.deepEqual(json.叠加关系.map((row) => `${row.类型}:${labels(row)}`), ['六冲:月柱地支丑·流年地支未']);
  // 同一个丑、未上的三合与刑：合能否解冲须一并看；丑辰相破是原局关系，见命盘
  assert.deepEqual(json.同字牵连.map((row) => `${row.类型}:${labels(row)}`), [
    '三合:大运地支酉·年柱地支巳·月柱地支丑·时柱地支巳', '相刑:流年地支未·月柱地支丑',
  ]);
  assert.deepEqual(json.未列出, { 条数: 3, 按类型: [{ 类型: '天干相冲', 条数: 2 }, { 类型: '六合', 条数: 1 }], 提示: '去掉 pillars 或 types 可看全部' });
  const text = renderToolResult('bazi_relations', await executeTool('bazi_relations', { ...BIRTH, year: 2027, types: ['六冲'] })).content[0].text;
  assert.match(text, /## 叠加关系\n\n- 六冲｜月柱地支丑·流年地支未｜丑未相冲\n\n## 同字牵连/);
  assert.doesNotMatch(text, /原局关系/);
  assert.match(text, /另有 3 条（天干相冲 2、六合 1）/);
});

test('pillars keeps relations touching every listed pillar; 大运 also means the 小运 before 起运', async () => {
  const both = (await relations({ year: 2027, pillars: ['月柱', '流年'] })).json;
  assert.deepEqual(both.叠加关系.map((row) => `${row.类型}:${labels(row)}`), ['六冲:月柱地支丑·流年地支未', '相刑:流年地支未·月柱地支丑']);
  assert.ok(both.叠加关系.every((row) => ['月柱', '流年'].every((pillar) => row.位置.some((p) => p.柱 === pillar))));
  const quiet = (await relations({ year: 2027, pillars: ['时柱', '流年'] })).json;
  assert.deepEqual(quiet.叠加关系, []);
  assert.match(renderToolResult('bazi_relations', await executeTool('bazi_relations', { ...BIRTH, year: 2027, pillars: ['时柱', '流年'] })).content[0].text, /## 叠加关系\n\n- 筛选范围内无/);
  const early = (await relations({ year: 1992, pillars: ['大运'] })).json;
  assert.match(early.查询.小运, /^戊寅/);
  assert.ok(early.叠加关系.length > 0 && early.叠加关系.every((row) => row.位置.some((p) => p.柱 === '小运')));
});

test('岁运提示 and 太岁 follow the pillar filter only', async () => {
  // 2000 庚辰：流年伏吟日柱
  assert.deepEqual((await relations({ year: 2000, pillars: ['日柱'] })).json.岁运提示, ['流年伏吟日柱（同为庚辰）']);
  const month = (await relations({ year: 2000, pillars: ['月柱'] })).json;
  assert.equal(month.岁运提示, undefined);
  assert.ok(month.未列出.按类型.some((item) => item.类型 === '岁运提示'));
  assert.deepEqual((await relations({ year: 2000, types: ['六冲'] })).json.岁运提示, ['流年伏吟日柱（同为庚辰）'], 'types does not filter hints');
  // 1992 壬申：太岁只在柱位不超出年柱、流年时列出
  assert.deepEqual((await relations({ year: 1992, pillars: ['年柱'] })).json.太岁关系, ['合太岁', '刑太岁', '破太岁']);
  const fortune = (await relations({ year: 1992, pillars: ['大运'] })).json;
  assert.equal(fortune.太岁关系, undefined);
  assert.deepEqual(fortune.未列出.按类型.at(-1), { 类型: '太岁关系', 条数: 3 });
});

test('filters are validated and a pillar outside the query names the missing parameter', async () => {
  await assert.rejects(executeTool('bazi_relations', { ...BIRTH, dayun: 4, pillars: ['流年'] }), /没有「流年」柱.*year 或 day/);
  await assert.rejects(executeTool('bazi_relations', { ...BIRTH, year: 2027, pillars: ['流月'] }), /没有「流月」柱.*year 与 month，或 day/);
  await assert.rejects(executeTool('bazi_relations', { ...BIRTH, year: 2027, pillars: ['流日'] }), /改用 day/);
  for (const selector of [{ types: ['拱合'] }, { types: [] }, { pillars: ['命宫'] }, { pillars: '日柱' }]) {
    await assert.rejects(executeTool('bazi_relations', { ...BIRTH, year: 2027, ...selector }), JSON.stringify(selector));
  }
  assert.throws(() => deriveBaziRelations(calculateBazi(BIRTH), { year: 2027, types: ['拱合'] }, BIRTH), { name: 'CoreInputError' });
});

test('default text lists only the overlay facts; full adds 纳音 and 口径; JSON always keeps 口径 and 计算规则', async () => {
  const raw = await executeTool('bazi_relations', { ...BIRTH, year: 2027 });
  const lean = renderToolResult('bazi_relations', raw).content[0].text;
  const full = renderToolResult('bazi_relations', raw, { detailLevel: 'full' }).content[0].text;
  assert.doesNotMatch(lean, /## 口径|## 计算规则|原局|纳音/);
  assert.match(lean, /## 叠加柱位\n\n- 大运 癸酉：天干伤官，地支主气劫财\n- 流年 丁未：天干正官，地支主气正印\n\n## 叠加关系\n\n- 天干相冲｜月柱天干丁·大运天干癸｜丁癸相冲/);
  assert.match(full, /- 大运 癸酉：天干伤官，地支主气劫财；纳音剑锋金[\s\S]*## 口径\n\n- 只列干支关系事实/);
  assert.doesNotMatch(full, /## 计算规则|ruleVersion/);
  for (const detailLevel of ['default', 'full']) {
    const json = renderToolResult('bazi_relations', raw, { detailLevel }).structuredContent;
    assert.ok(json.口径.length > 0 && json.计算规则.ruleVersion);
  }
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
  const late = { gender: 'female', birthYear: 1995, birthMonth: 6, birthDay: 20, birthHour: 23, year: 2027 };
  const zi = renderToolResult('bazi_relations', await executeTool('bazi_relations', { ...late, dayBoundary: 'zi' })).structuredContent;
  const plain = renderToolResult('bazi_relations', await executeTool('bazi_relations', { ...late, dayBoundary: 'midnight' })).structuredContent;
  assert.notEqual(zi.参与柱位[2].干支, plain.参与柱位[2].干支, '早晚子时换日影响日柱');
  const lunar = renderToolResult('bazi_relations', await executeTool('bazi_relations', { ...late, calendarType: 'lunar', isLeapMonth: false })).structuredContent;
  assert.deepEqual(lunar.参与柱位.slice(4).map((p) => p.柱), ['大运', '流年']);
});
