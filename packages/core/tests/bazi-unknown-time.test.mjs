import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';
import { calculateBazi } from 'taibu-core/bazi';
import { calculateBaziDayun } from 'taibu-core/bazi-dayun';
import { validateOutput } from '../dist/mcp/output-validator.js';

// 1995-01-09 的女命：起运在一天之内跨了年份，时辰偏晚的各步大运晚一年交运
const HER = { gender: 'female', birthYear: 1995, birthMonth: 1, birthDay: 9 };
const HIM = { gender: 'male', birthYear: 1993, birthMonth: 11, birthDay: 2, birthHour: 7 };

async function render(name, input, detailLevel) {
  return renderToolResult(name, await executeTool(name, input), detailLevel ? { detailLevel } : undefined);
}
const labels = (pillars) => pillars.map((pillar) => pillar.柱);

test('bazi and bazi_dayun take the birth hour as optional and say what leaving it out means', () => {
  const tools = Object.fromEntries(listToolDefinitions().map((tool) => [tool.name, tool]));
  for (const name of ['bazi', 'bazi_dayun', 'bazi_relations', 'bazi_wuxing']) {
    assert.ok(!tools[name].inputSchema.required.includes('birthHour'), name);
    assert.match(tools[name].inputSchema.properties.birthHour.description, /不知道出生时辰时省略/, name);
  }
  assert.ok(!tools.bazi_hepan.inputSchema.properties.a.required.includes('birthHour'));
});

test('an unknown birth time casts three pillars, with no hour pillar, life palace or hour shensha', async () => {
  const raw = calculateBazi(HER);
  assert.equal(raw.fourPillars.hour, undefined);
  assert.equal(raw.birthTimeUnknown, true);
  assert.equal(raw.mingGong, undefined);
  assert.ok(raw.taiYuan, 'the conception pillar comes from the month alone');
  const { structuredContent: json, content } = await render('bazi', HER, 'full');
  assert.deepEqual(labels(json.四柱), ['年柱', '月柱', '日柱']);
  assert.deepEqual(json.四柱.map((pillar) => pillar.干支), ['甲戌', '丁丑', '庚子']);
  assert.equal(json.基本信息.出生时辰, '未知（未排时柱；命宫、时柱神煞与小运不给出）');
  assert.equal(json.基本信息.命宫, undefined);
  assert.ok(json.干支关系明细.every((relation) => relation.位置.every((cell) => cell.柱 !== '时柱')));
  assert.match(content[0].text, /- 出生时辰: 未知（未排时柱/);
  assert.doesNotMatch(content[0].text.replace(/- 出生时辰: .*\n/, ''), /时柱|命宫/, 'only the note mentions them');
  // 同一天给了时辰，年、月、日三柱不变
  const known = (await render('bazi', { ...HER, birthHour: 21 })).structuredContent;
  assert.deepEqual(known.四柱.slice(0, 3).map((pillar) => pillar.干支), json.四柱.map((pillar) => pillar.干支));
  assert.equal(known.基本信息.出生时辰, undefined);
});

test('the public schema allows three pillars only on a chart marked as having no birth time', async () => {
  const bazi = listToolDefinitions().find((tool) => tool.name === 'bazi');
  const three = (await render('bazi', HER)).structuredContent;
  const four = (await render('bazi', { ...HER, birthHour: 9 })).structuredContent;
  validateOutput('bazi', three, bazi.outputSchema);
  validateOutput('bazi', four, bazi.outputSchema);
  const unmarked = structuredClone(three);
  delete unmarked.基本信息.出生时辰;
  const marked = structuredClone(four);
  marked.基本信息.出生时辰 = three.基本信息.出生时辰;
  for (const chart of [unmarked, marked]) {
    assert.throws(() => validateOutput('bazi', chart, bazi.outputSchema), { code: 'OUTPUT_SCHEMA_MISMATCH' });
  }
});

test('a birth day on which a solar term begins needs the hour: the pillars depend on it', async () => {
  await assert.rejects(executeTool('bazi', { ...HER, birthYear: 2024, birthMonth: 2, birthDay: 4 }),
    { name: 'CoreInputError', message: /birthHour 出生当天（2024-02-04）立春交节（北京时间 2024-02-04 16:27），年柱、月柱取决于出生时间，请提供出生时辰/ });
  await assert.rejects(executeTool('bazi_dayun', { ...HER, birthYear: 2024, birthMonth: 3, birthDay: 5 }),
    { message: /惊蛰交节（北京时间 2024-03-05 10:22），月柱取决于出生时间/ });
  await assert.rejects(executeTool('bazi', { ...HER, birthMinute: 30 }), { message: /birthMinute 出生时辰未知时不能只给分钟/ });
  // 交节前后各给一个时辰都能排
  assert.equal(calculateBazi({ ...HER, birthYear: 2024, birthMonth: 2, birthDay: 4, birthHour: 10 }).fourPillars.year.branch, '卯');
  assert.equal(calculateBazi({ ...HER, birthYear: 2024, birthMonth: 2, birthDay: 4, birthHour: 18 }).fourPillars.year.branch, '辰');
});

test('midnight and 23:59 only bound the day; a daylight-saving gap there is not the user\'s time', async () => {
  // 圣地亚哥 2024-09-08 零点跳到一点：给出 0 点要报错，不给时辰时照常排三柱
  const santiago = { ...HER, birthYear: 2024, birthMonth: 9, birthDay: 8, timezone: 'America/Santiago' };
  assert.equal(calculateBazi(santiago).fourPillars.hour, undefined);
  assert.throws(() => calculateBazi({ ...santiago, birthHour: 0 }), /夏令时跳时/);
  // 不知道时刻就没有真太阳时：经度不参与，也不写进口径
  const { structuredContent: json } = await render('bazi', { ...HER, longitude: 87.6 });
  assert.equal(json.基本信息.真太阳时, undefined);
  assert.equal(json.计算规则.longitude, undefined);
  // 23 点换日时日柱按出生日期取，说明里写明
  const zi = (await render('bazi', { ...HER, dayBoundary: 'zi' })).structuredContent;
  assert.equal(zi.四柱[2].干支, '庚子');
  assert.match(zi.基本信息.出生时辰, /日柱按出生日期取，23 点后出生则为次日/);
  // 农历生日同样只排三柱
  const lunar = (await render('bazi', { ...HER, calendarType: 'lunar', birthMonth: 12, birthDay: 9 })).structuredContent;
  assert.deepEqual(lunar.四柱.map((pillar) => pillar.干支), ['乙亥', '己丑', '甲子']);
});

test('the luck periods start within a range and say when every period may start a year later', async () => {
  const dayun = calculateBaziDayun(HER);
  assert.deepEqual(dayun.xiaoYun, [], 'minor luck runs from the hour pillar');
  assert.deepEqual(dayun.startRange, {
    latestStartSolar: '1996-04-09 23:59:00', latestStartAgeDetail: '1年3月0天起运', yearShift: 1,
  });
  assert.equal(dayun.startAgeDetail, '出生时辰未知，0年11月10天至1年3月0天之间起运');
  const { structuredContent: json, content } = await render('bazi_dayun', HER);
  assert.equal(json.起运信息.起运时刻, '1995-12-19 00:00:00');
  assert.equal(json.起运信息.最晚起运时刻, '1996-04-09 23:59:00');
  assert.equal(json.起运信息.交运年份, '出生时辰未知：时辰偏晚时各步大运晚一年交运');
  assert.deepEqual(json.大运列表.slice(0, 2).map((item) => [item.起运年份, item.最晚起运年份, item.起运年龄, item.最晚起运年龄]), [[1995, 1996, 1, 2], [2005, 2006, 11, 12]]);
  assert.match(content[0].text, /起运时刻：1995-12-19 00:00:00 至 1996-04-09 23:59:00 之间/);
  assert.match(content[0].text, /\| 1995（或1996） \| 1岁（或2岁）/);
  // 给了时辰就没有范围
  const known = calculateBaziDayun({ ...HER, birthHour: 9 });
  assert.equal(known.startRange, undefined);
  assert.ok(known.xiaoYun.length > 0);
  // 同一天里起运不跨年时，只给范围不写推迟
  const steady = calculateBaziDayun({ gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15 });
  assert.equal(steady.startRange.yearShift, 0);
  assert.equal(renderToolResult('bazi_dayun', steady).structuredContent.大运列表[0].最晚起运年份, undefined);
});

test('drilldowns work on the three pillars and refuse to look at an hour pillar there is none of', async () => {
  const relations = (await render('bazi_relations', { ...HER, year: 2005 })).structuredContent;
  assert.deepEqual(relations.参与柱位.filter((pillar) => pillar.层 === '原局').map((pillar) => pillar.柱), ['年柱', '月柱', '日柱']);
  assert.equal(relations.查询.出生时辰, '未知（原局只有年、月、日三柱，关系不含时柱）');
  // 2005 年正当交运：时辰偏晚时这一年还在上一步大运
  assert.equal(relations.查询.大运, '第2步 乙亥（2005–2014，11岁起）；出生时辰未知：2005 年也可能仍在上一步大运 丙子');
  assert.equal((await render('bazi_relations', { ...HER, year: 1995 })).structuredContent.查询.大运,
    '第1步 丙子（1995–2004，1岁起）；出生时辰未知：1995 年也可能仍在起运之前');
  assert.doesNotMatch((await render('bazi_relations', { ...HER, year: 2008 })).structuredContent.查询.大运, /也可能/);
  await assert.rejects(executeTool('bazi_relations', { ...HER, year: 2005, pillars: ['时柱'] }), { message: /出生时辰未知，命盘没有时柱/ });

  const scan = (await render('bazi_liunian_scan', { ...HER, fromYear: 2020, toYear: 2021 })).structuredContent;
  assert.deepEqual(scan.原局四柱, [{ 柱: '年柱', 干支: '甲戌' }, { 柱: '月柱', 干支: '丁丑' }, { 柱: '日柱', 干支: '庚子' }]);
  assert.equal(scan.出生时辰, '未知（原局只有年、月、日三柱，关系不含时柱）');
  assert.ok(scan.逐年.every((year) => year.原局关系.every((row) => row.位置.every((cell) => cell.柱 !== '时柱'))));
  await assert.rejects(executeTool('bazi_liunian_scan', { ...HER, fromYear: 2020, toYear: 2022, pillars: ['时柱'] }), { message: /pillars 出生时辰未知，命盘没有时柱/ });

  const wuxing = (await render('bazi_wuxing', HER)).structuredContent;
  assert.equal(wuxing.出生时辰, '未知（只看年、月、日三柱；缺失的五行可能由时柱补上）');
  assert.equal(wuxing.相邻天干.length, 2, '年月、月日；没有日时');
  assert.equal(wuxing.干支自坐.length, 3);
  assert.ok([...wuxing.通根, ...wuxing.干支自坐].every((row) => row.位置.every((cell) => cell.柱 !== '时柱')));
  assert.ok(wuxing.月令.藏干.every((hidden) => hidden.透出.every((stem) => stem !== '时干')));
});

test('a pairing leaves out the hour pillar of whoever has no birth time, on either side', async () => {
  for (const [a, b, unknownName, knownName] of [[HER, HIM, '甲方', '乙方'], [HIM, HER, '乙方', '甲方']]) {
    const json = (await render('bazi_hepan', { a, b })).structuredContent;
    const [first, second] = json.双方;
    const unknown = first.称呼 === unknownName ? first : second;
    const known = first.称呼 === knownName ? first : second;
    assert.deepEqual(labels(unknown.四柱), ['年柱', '月柱', '日柱']);
    assert.match(unknown.出生时辰, /未排时柱；两盘之间的关系不含其时柱/);
    assert.deepEqual(labels(known.四柱), ['年柱', '月柱', '日柱', '时柱']);
    assert.equal(known.出生时辰, undefined);
    const rows = [...json.日柱之间, ...json.年柱之间, ...json.其余关系];
    const cells = rows.flatMap((row) => row.位置.map((cell) => cell.柱));
    assert.ok(!cells.includes(`${unknownName}时柱`));
    assert.ok(cells.includes(`${knownName}时柱`), 'the other side\'s hour pillar still relates to the three pillars');
    // 日柱之间的关系确实落在两人的日柱上（乙方各柱接在三柱之后）
    assert.ok(json.日柱之间.every((row) => ['甲方日柱', '乙方日柱'].every((pillar) => row.位置.some((cell) => cell.柱 === pillar))));
    assert.ok(json.年柱之间.every((row) => ['甲方年柱', '乙方年柱'].every((pillar) => row.位置.some((cell) => cell.柱 === pillar))));
  }
});
