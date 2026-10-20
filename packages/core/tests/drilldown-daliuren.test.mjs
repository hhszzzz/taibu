import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';

/** 2026-04-10 14:30 上海：甲寅日辰月辛未时，干上巳，重审课 */
const CASE = { date: '2026-04-10', hour: 14, minute: 30, timezone: 'Asia/Shanghai', birthYear: 1990, gender: 'male' };

async function lessons(selector, input = CASE) {
  return renderToolResult('daliuren_lessons', await executeTool('daliuren_lessons', { ...input, ...selector })).structuredContent;
}

async function board(input = CASE) {
  return renderToolResult('daliuren', await executeTool('daliuren', input), { detailLevel: 'full' }).structuredContent;
}

test('daliuren_lessons schema is the daliuren schema plus selectors and its own detail level', () => {
  const tool = listToolDefinitions().find((item) => item.name === 'daliuren_lessons');
  const daliuren = listToolDefinitions().find((item) => item.name === 'daliuren');
  assert.ok(tool && daliuren);
  for (const key of Object.keys(daliuren.inputSchema.properties).filter((key) => key !== 'detailLevel')) {
    assert.deepEqual(tool.inputSchema.properties[key], daliuren.inputSchema.properties[key], key);
  }
  assert.deepEqual(tool.inputSchema.properties.detailLevel.enum, ['default', 'full'], 'the drilldown has its own text detail level');
  assert.deepEqual(tool.inputSchema.required, daliuren.inputSchema.required);
  assert.ok(tool.inputSchema.examples.every((example) => example.date && example.hour !== undefined));
});

test('the four lessons repeat the board and add 上下, 六亲 and 神将 facts', async () => {
  const json = await lessons({});
  const chart = await board();
  assert.equal(json.查询.范围, '全部');
  assert.deepEqual(json.四课.map((row) => row.课别), ['一课 (干上)', '二课 (干阴)', '三课 (支上)', '四课 (支阴)']);
  assert.deepEqual(json.四课.map((row) => [row.上神, row.下神]), chart.四课.map((row) => [row.上神, row.下神]));
  assert.deepEqual(json.四课.map((row) => row.天将), chart.四课.map((row) => row.乘将));
  assert.deepEqual(json.四课.map((row) => row.上下), ['下生上', '下贼上', '下生上', '下贼上']);
  assert.deepEqual(json.四课.map((row) => row.六亲), ['子孙', '官鬼', '子孙', '官鬼']);
  assert.deepEqual(json.四课[0].位置, [{ 课别: '一课 (干上)' }, { 地盘: '寅', 部位: '天盘' }]);
  // 申乘青龙：神(金)克将(木)为内战（《六壬大全》论神将之法）
  assert.deepEqual(json.神将交战, [
    '二课 申乘青龙：神克将（内战）',
    '四课 申乘青龙：神克将（内战）',
    '初传 申乘青龙：神克将（内战）',
    '中传 亥乘朱雀：神克将（内战）',
  ]);
  assert.ok(json.计算规则.ruleVersion.startsWith('daliuren-lessons-'));
});

test('the three transmissions add 六亲, 与日干, 旺衰, 空亡 and 递生递克', async () => {
  const json = await lessons({});
  const chart = await board();
  assert.deepEqual(json.三传.map((row) => row.传序), ['初传 (发端)', '中传 (移易)', '末传 (归计)']);
  assert.deepEqual(json.三传.map((row) => [row.地支, row.天将]), chart.三传.map((row) => [row.地支, row.天将]));
  assert.deepEqual(json.三传.map((row) => row.五行), ['金', '水', '木']);
  assert.deepEqual(json.三传.map((row) => row.与日干), ['克日干', '生日干', '比和']);
  // 辰月：土旺、金相、水死、木囚
  assert.deepEqual(json.三传.map((row) => row.旺衰), ['相', '死', '囚']);
  assert.deepEqual(json.三传.map((row) => row.空亡), ['否', '否', '否']);
  assert.deepEqual(json.三传递进, { 初传至中传: '申金生亥水', 中传至末传: '亥水生寅木', 递进: '递生（初生中、中生末）' });
  assert.deepEqual(json.基础, {
    日干: '甲', 日干寄宫: '寅', 日支: '寅', 月建: '辰', 旬: '甲寅', 空亡: ['子', '丑'], 课式: '甲寅日第七局 干上巳 / 重审课',
  });
});

test('focus narrows the report to lessons or transmissions', async () => {
  const lessonsOnly = await lessons({ focus: '课' });
  assert.equal(lessonsOnly.查询.范围, '课');
  assert.equal(lessonsOnly.四课.length, 4);
  assert.equal(lessonsOnly.三传, undefined);
  assert.equal(lessonsOnly.三传递进, undefined);
  assert.ok(lessonsOnly.神将交战.every((line) => /^[一二三四]课 /.test(line)));
  const chuanOnly = await lessons({ focus: '传' });
  assert.equal(chuanOnly.四课, undefined);
  assert.equal(chuanOnly.三传.length, 3);
  assert.ok(chuanOnly.神将交战.every((line) => /^(初传|中传|末传) /.test(line)));
});

test('本命 and 行年 use the birth data of the base call; 类神 locates a branch or a general', async () => {
  const json = await lessons({});
  assert.deepEqual(json.本命行年.map((row) => [row.类型, row.结果]), [['本命上神', '酉'], ['行年上神', '巳']]);
  assert.match(json.本命行年[0].说明, /本命庚午，午上见酉，乘勾陈，官鬼/);
  const withoutBirth = await lessons({}, { date: CASE.date, hour: CASE.hour, minute: CASE.minute, timezone: CASE.timezone });
  assert.equal(withoutBirth.本命行年, undefined);

  const branch = await lessons({ leiShen: '卯' });
  assert.equal(branch.查询.类神, '卯');
  assert.deepEqual(branch.类神, [{
    类型: '天盘落处', 位置: [{ 地盘: '子', 部位: '天盘' }], 结果: '子', 说明: '卯临子上，乘太阴，遁干乙，兄弟',
  }]);
  const general = await lessons({ leiShen: '贵人' });
  assert.equal(general.类神[0].位置[0].部位, '天将');
  assert.match(general.类神[0].说明, /乘贵人/);
  assert.deepEqual((await lessons({ leiShen: '螣蛇' })).类神, (await lessons({ leiShen: '腾蛇' })).类神, '螣蛇 is an alias of 腾蛇');
});

test('a 类神 alone lists only where it falls; 全部 keeps the lessons and 本命行年 alongside it', async () => {
  const only = await lessons({ leiShen: '申' });
  assert.equal(only.查询.范围, '类神');
  for (const key of ['四课', '三传', '三传递进', '神将交战', '本命行年']) assert.equal(only[key], undefined, key);
  // 天盘申临地盘巳（干上巳临寅，天盘顺移三位）；申又为二课、四课上神与初传
  assert.deepEqual(only.类神.map((row) => `${row.类型}:${row.结果}`), ['天盘落处:巳', '入课:二课', '入课:四课', '入传:初传']);
  const everything = await lessons({ focus: '全部', leiShen: '申' });
  assert.deepEqual([everything.四课.length, everything.三传.length, everything.本命行年.length], [4, 3, 2]);
  assert.deepEqual(everything.类神, only.类神);
  assert.equal((await lessons({ focus: '课' })).本命行年, undefined, '本命行年 only with 全部');
  await assert.rejects(executeTool('daliuren_lessons', { ...CASE, focus: '类神' }), /须给出 leiShen/);
});

test('default text drops the repeated 神将交战 and the fact coordinates; full restores 神将交战 and 口径', async () => {
  const raw = await executeTool('daliuren_lessons', { ...CASE, focus: '全部', leiShen: '卯' });
  const lean = renderToolResult('daliuren_lessons', raw).content[0].text;
  const full = renderToolResult('daliuren_lessons', raw, { detailLevel: 'full' }).content[0].text;
  assert.match(lean, /## 类神\n\n- 天盘落处｜卯临子上，乘太阴，遁干乙，兄弟/);
  assert.doesNotMatch(lean, /## 神将交战|## 口径|## 计算规则|地盘子 部位/);
  assert.match(full, /## 三传递进[\s\S]*## 神将交战[\s\S]*## 本命行年[\s\S]*## 口径/);
  assert.doesNotMatch(full, /## 计算规则/);
  assert.ok(renderToolResult('daliuren_lessons', raw).structuredContent.神将交战.length > 0, 'JSON keeps 神将交战');
});

test('invalid selectors are rejected', async () => {
  for (const selector of [{ focus: '课传' }, { focus: '' }, { leiShen: '' }, { leiShen: '甲' }, { leiShen: '财神' }]) {
    await assert.rejects(executeTool('daliuren_lessons', { ...CASE, ...selector }), JSON.stringify(selector));
  }
});
