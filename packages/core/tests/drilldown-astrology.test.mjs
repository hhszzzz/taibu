import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';

/** 1990-01-01 12:30 纽约：有经纬度才有宫位与宫主星；流运固定为 2026-04-10 09:30 */
const BIRTH = {
  birthYear: 1990, birthMonth: 1, birthDay: 1, birthHour: 12, birthMinute: 30,
  latitude: 40.7128, longitude: -74.006, transitDateTime: '2026-04-10T09:30:00',
};

async function point(selector, input = BIRTH) {
  return renderToolResult('astrology_point', await executeTool('astrology_point', { ...input, ...selector })).structuredContent;
}

test('astrology_point schema is the astrology schema plus selectors and its own detail level', () => {
  const tool = listToolDefinitions().find((item) => item.name === 'astrology_point');
  const astrology = listToolDefinitions().find((item) => item.name === 'astrology');
  assert.ok(tool && astrology);
  for (const key of Object.keys(astrology.inputSchema.properties).filter((key) => key !== 'detailLevel')) {
    assert.deepEqual(tool.inputSchema.properties[key], astrology.inputSchema.properties[key], key);
  }
  assert.deepEqual(tool.inputSchema.properties.detailLevel.enum, ['default', 'full'], 'the drilldown has its own text detail level');
  assert.deepEqual(tool.inputSchema.required, astrology.inputSchema.required);
  assert.ok(tool.inputSchema.examples.every((example) => example.birthYear && (example.planet || example.house)));
});

test('a planet reports its placement, dignity, rulerships and both aspect lists', async () => {
  const json = await point({ planet: 'venus' });
  assert.deepEqual(json.查询, { 对象: '金星', 类型: '星体' });
  assert.deepEqual([json.位置信息.星座, json.位置信息.元素, json.位置信息.模式, json.位置信息.逆行, json.位置信息.宫位], ['水瓶座', '风', '固定', '是', '第10宫']);
  assert.deepEqual(json.位置信息.位置, [{ 盘: '本命', 标识: 'venus', 因素: '金星' }]);
  assert.deepEqual(json.传统尊贵, ['无']);
  // 上升金牛，故金星主管第1宫
  assert.deepEqual(json.主管宫位, ['第1宫']);
  assert.ok(json.本命相位.length >= 3);
  assert.ok(json.本命相位.every((row) => row.位置.length === 2 && row.位置[0].标识 === 'venus' && row.位置[1].标识 !== 'venus'));
  assert.ok(json.流运触发.length > 0 && json.流运触发.every((row) => row.位置[0].盘 === '流运' && row.位置[1].标识 === 'venus'));
  assert.ok(json.流运触发.some((row) => row.相态 === '入相') && json.本命相位.some((row) => row.相态 === '出相'));
  assert.ok(json.计算规则.ruleVersion.startsWith('astrology-point-'));
});

test('an angle keeps its house but is never given dignity or rulerships', async () => {
  const json = await point({ planet: 'ascendant' });
  assert.deepEqual([json.查询.对象, json.位置信息.星座, json.位置信息.宫位], ['上升点', '金牛座', '第1宫']);
  assert.equal(json.传统尊贵, undefined);
  assert.equal(json.主管宫位, undefined);
  assert.ok(json.本命相位.every((row) => row.相态 === undefined), '轴点不计速度');
});

test('a house query reports its span, occupants, ruling planet and the ruler aspects', async () => {
  const json = await point({ house: 7 });
  assert.deepEqual(json.查询, { 对象: '第7宫', 类型: '宫位' });
  assert.deepEqual(json.宫位信息, { 宫位: '第7宫', 宫位序号: 7, 宫头星座: '天蝎座', 宫头黄经: '212°43 / 2°43', 宫尾黄经: '244°18 / 4°18', 跨度: 31.5799 });
  assert.deepEqual(json.宫内星体.map((item) => item.因素), ['冥王星', '莉莉丝']);
  assert.deepEqual([json.宫主星.因素, json.宫主星.星座], ['火星', '射手座']);
  assert.equal(json.本命相位, undefined, '宫位本身不参与相位');
  assert.equal(json.宫主星相位.length, 2);
  assert.ok(json.宫主星相位.every((row) => row.位置.some((cell) => cell.标识 === 'mars')));
});

test('without coordinates a planet still reports placement and aspects but no house', async () => {
  const json = await point({ planet: 'sun' }, { birthYear: 1990, birthMonth: 1, birthDay: 1, birthHour: 12 });
  assert.deepEqual([json.位置信息.星座, json.位置信息.宫位], ['摩羯座', undefined]);
  assert.deepEqual(json.传统尊贵, ['无']);
  assert.equal(json.主管宫位, undefined);
  assert.equal(json.宫位信息, undefined);
  assert.equal(json.本命相位.length, 5);
});

test('invalid selectors are rejected', async () => {
  for (const selector of [{}, { planet: 'venus', house: 7 }, { planet: 'nibiru' }, { house: 0 }, { house: 13 }]) {
    await assert.rejects(executeTool('astrology_point', { ...BIRTH, ...selector }), JSON.stringify(selector));
  }
  await assert.rejects(executeTool('astrology_point', { birthYear: 1990, birthMonth: 1, birthDay: 1, birthHour: 12, house: 7 }),
    'a house query without coordinates');
});

test('focus narrows to natal facts or to transits, keeping the natal placement for reference', async () => {
  const natal = await point({ planet: 'venus', focus: '本命' });
  assert.deepEqual(natal.查询, { 对象: '金星', 类型: '星体', 范围: '本命' });
  assert.equal(natal.流运触发, undefined);
  assert.ok(natal.本命相位.length >= 3 && natal.传统尊贵 && natal.主管宫位);
  const transit = await point({ planet: 'venus', focus: '流运' });
  assert.equal(transit.位置信息.星座, '水瓶座');
  for (const key of ['传统尊贵', '主管宫位', '本命相位']) assert.equal(transit[key], undefined, key);
  assert.deepEqual(transit.流运触发, (await point({ planet: 'venus' })).流运触发);
  const house = await point({ house: 7, focus: '流运' });
  assert.ok(house.宫位信息 && Array.isArray(house.流运过境));
  for (const key of ['宫内星体', '宫主星', '宫主星相位']) assert.equal(house[key], undefined, key);
  assert.equal((await point({ house: 7, focus: '本命' })).流运过境, undefined);
  await assert.rejects(executeTool('astrology_point', { ...BIRTH, planet: 'venus', focus: '推运' }));
});

test('default text leaves 口径 to detailLevel full; 计算规则 stays in the JSON only', async () => {
  const raw = await executeTool('astrology_point', { ...BIRTH, planet: 'venus', focus: '流运' });
  const lean = renderToolResult('astrology_point', raw).content[0].text;
  assert.match(lean, /- 星体：金星（只看流运）/);
  assert.doesNotMatch(lean, /## 本命相位|## 口径|## 计算规则/);
  const full = renderToolResult('astrology_point', raw, { detailLevel: 'full' });
  assert.match(full.content[0].text, /## 口径[\s\S]*托勒密/);
  assert.doesNotMatch(full.content[0].text, /## 计算规则/);
  assert.ok(full.structuredContent.计算规则.ruleVersion);
});
