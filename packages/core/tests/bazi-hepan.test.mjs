import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';
import { calculateBazi, calculateBaziHepan, toBaziHepanJson } from 'taibu-core/bazi';

const HIM = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };
const HER = { gender: 'female', birthYear: 1992, birthMonth: 8, birthDay: 3, birthHour: 14 };

async function hepan(input, detailLevel) {
  const raw = await executeTool('bazi_hepan', input);
  return { raw, rendered: renderToolResult('bazi_hepan', raw, detailLevel ? { detailLevel } : undefined) };
}

const cells = (row) => row.位置.map((p) => `${p.柱}${p.部位}${p.字}`).join('·');
const rows = (json) => [...json.日柱之间, ...json.年柱之间, ...json.其余关系];

test('bazi_hepan takes two bazi inputs, each with an optional name', () => {
  const tool = listToolDefinitions().find((item) => item.name === 'bazi_hepan');
  const bazi = listToolDefinitions().find((item) => item.name === 'bazi');
  assert.equal(tool.title, '八字合盘');
  assert.deepEqual(tool.inputSchema.required, ['a', 'b']);
  for (const side of ['a', 'b']) {
    const person = tool.inputSchema.properties[side];
    assert.equal(person.additionalProperties, false);
    assert.deepEqual(person.required, bazi.inputSchema.required);
    for (const key of Object.keys(bazi.inputSchema.properties).filter((key) => key !== 'detailLevel')) {
      assert.deepEqual(person.properties[key], bazi.inputSchema.properties[key], `${side}.${key}`);
    }
    assert.equal(person.properties.detailLevel, undefined, 'the detail level is the whole reading\'s, not a person\'s');
  }
});

test('only facts between the two charts are listed, each chart\'s own relations stay in its chart', async () => {
  const { rendered } = await hepan({ a: { name: '男方', ...HIM }, b: { name: '女方', ...HER } });
  const json = rendered.structuredContent;
  assert.deepEqual(json.双方.map((person) => `${person.称呼}${person.四柱.map((pillar) => pillar.干支).join('')}`), ['男方己巳丁丑庚辰辛巳', '女方壬申丁未辛亥乙未']);
  assert.deepEqual(json.双方.map((person) => [person.日主, person.月令旺衰, person.生肖]), [['庚金', '相', '蛇'], ['辛金', '相', '猴']]);
  // 男方盘内的丑辰相破、女方盘内的申亥相害不属于合盘
  assert.ok(rows(json).every((row) => row.位置.some((p) => p.柱.startsWith('男方')) && row.位置.some((p) => p.柱.startsWith('女方'))), JSON.stringify(rows(json)));
  const facts = rows(json).map((row) => `${row.类型}:${cells(row)}`);
  for (const fact of ['六合:男方年柱地支巳·女方年柱地支申', '天干五合:男方日柱天干庚·女方时柱天干乙', '六冲:男方年柱地支巳·女方日柱地支亥',
    '相刑:男方月柱地支丑·女方月柱地支未·女方时柱地支未']) assert.ok(facts.includes(fact), fact);
  assert.deepEqual(json.日主互见.说明, ['女方日主辛金是男方的劫财', '男方日主庚金是女方的劫财']);
  assert.equal(json.日主互见.五行生克, '男方日主庚金与女方日主辛金比和');
  assert.equal(json.年命纳音.五行生克, '女方年命剑锋金克男方年命大林木');
  assert.ok(json.计算规则.ruleVersion.startsWith('bazi-hepan-'));
  assert.deepEqual(json.计算规则.people.map((person) => person.timezone), ['Asia/Shanghai', 'Asia/Shanghai']);
});

test('day and year pillars each get their own section, and no relation is listed twice', async () => {
  const { rendered } = await hepan({ a: HIM, b: HER });
  const json = rendered.structuredContent;
  const both = (row, pillar) => row.位置.some((p) => p.柱 === `甲方${pillar}`) && row.位置.some((p) => p.柱 === `乙方${pillar}`);
  assert.ok(json.日柱之间.every((row) => both(row, '日柱')));
  assert.ok(json.年柱之间.every((row) => both(row, '年柱') && !both(row, '日柱')));
  assert.ok(json.其余关系.every((row) => !both(row, '日柱') && !both(row, '年柱')));
  const all = rows(json).map((row) => `${row.类型}:${cells(row)}`);
  assert.equal(new Set(all).size, all.length);
  const text = rendered.content[0].text;
  assert.match(text, /## 日柱之间（日主与夫妻宫）\n\n- 无\n/u, 'an empty section says so');
  assert.match(text, /- 甲方属蛇，乙方属猴；年命纳音 甲方大林木、乙方剑锋金：乙方年命剑锋金克甲方年命大林木\n- 六合｜甲方年柱地支巳·乙方年柱地支申｜巳申六合化水/u);
  assert.doesNotMatch(text, /## 口径/u, 'the default text stays lean');
  assert.match((await hepan({ a: HIM, b: HER }, 'full')).rendered.content[0].text, /## 口径\n\n- 只列两盘之间的事实/u);
});

test('swapping the two people swaps the names and nothing else', () => {
  const key = (output) => [...output.dayRelations, ...output.yearRelations, ...output.otherRelations]
    .map((fact) => `${fact.type}:${fact.participants.map((p) => `${p.label.slice(2)}${p.part}${p.char}`).sort().join('·')}`).sort();
  const forward = calculateBaziHepan({ a: HIM, b: HER });
  const backward = calculateBaziHepan({ a: HER, b: HIM });
  assert.deepEqual(key(forward), key(backward));
  assert.equal(forward.dayMasters.aSeesB, backward.dayMasters.bSeesA);
  assert.equal(forward.dayRelations.length, backward.dayRelations.length);
});

test('an element one lacks and the other has is named; charts lacking nothing say so', () => {
  const lacksWoodFire = { gender: 'male', birthYear: 1993, birthMonth: 1, birthDay: 27, birthHour: 1 };
  const lacksMetalWater = { gender: 'female', birthYear: 1998, birthMonth: 7, birthDay: 19, birthHour: 13 };
  const json = toBaziHepanJson(calculateBaziHepan({ a: lacksWoodFire, b: lacksMetalWater }));
  assert.deepEqual(json.双方.map((person) => person.缺失五行), [['木', '火'], ['金', '水']]);
  assert.deepEqual(json.五行互补, ['甲方缺木，乙方原局有木', '甲方缺火，乙方原局有火', '乙方缺金，甲方原局有金', '乙方缺水，甲方原局有水']);
  assert.deepEqual(toBaziHepanJson(calculateBaziHepan({ a: HIM, b: HER })).五行互补, ['双方原局五行俱全']);
  assert.deepEqual(toBaziHepanJson(calculateBaziHepan({ a: lacksWoodFire, b: lacksWoodFire })).五行互补, ['一方所缺的五行，另一方原局也没有']);
});

test('the day master is read in each chart as bazi reads it', () => {
  const output = calculateBaziHepan({ a: HIM, b: HER });
  assert.equal(output.people[0].dayMaster.stem, calculateBazi(HIM).dayMaster);
  assert.equal(output.people[1].dayMaster.stem, calculateBazi(HER).dayMaster);
});

test('names label the pillars, must differ, and errors say whose birth data is wrong', async () => {
  const { rendered } = await hepan({ a: { name: '小王', ...HIM }, b: { name: '小李', ...HER } });
  assert.ok(rows(rendered.structuredContent).every((row) => row.位置.every((p) => /^小[王李][年月日时]柱$/u.test(p.柱))));
  await assert.rejects(executeTool('bazi_hepan', { a: { name: '我', ...HIM }, b: { name: '我', ...HER } }), /b\.name 两人的称呼不能相同/u);
  await assert.rejects(executeTool('bazi_hepan', { a: { name: '我 们', ...HIM }, b: HER }), /a\.name 须为 1–12 个字/u);
  await assert.rejects(executeTool('bazi_hepan', { a: HIM, b: { ...HER, birthMonth: 2, birthDay: 30 } }), (error) => error.name === 'CoreInputError' && error.path.startsWith('b.'));
  await assert.rejects(executeTool('bazi_hepan', { a: { ...HIM, detailLevel: 'full' }, b: HER }), /未知参数 'a\.detailLevel'/u);
  await assert.rejects(executeTool('bazi_hepan', { a: HIM }), /缺少必填参数 'b'/u);
});
