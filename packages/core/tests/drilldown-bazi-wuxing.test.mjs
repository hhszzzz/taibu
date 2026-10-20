import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';
import { calculateBazi, deriveBaziWuxing } from 'taibu-core/bazi';

const BIRTH = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };
const ELEMENTS = ['木', '火', '土', '金', '水'];
const STEM_ELEMENT = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };

async function wuxing(input) {
  return renderToolResult('bazi_wuxing', await executeTool('bazi_wuxing', input)).structuredContent;
}

test('bazi_wuxing takes the bazi input plus optional sections and its own detail level', () => {
  const tool = listToolDefinitions().find((item) => item.name === 'bazi_wuxing');
  const bazi = listToolDefinitions().find((item) => item.name === 'bazi');
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), [...Object.keys(bazi.inputSchema.properties), 'sections'].sort());
  assert.deepEqual(tool.inputSchema.properties.sections.items.enum, ['通根', '干支自坐', '相邻天干']);
  assert.deepEqual(tool.inputSchema.properties.detailLevel.enum, ['default', 'full']);
  assert.deepEqual(tool.inputSchema.required, bazi.inputSchema.required);
});

test('1990-01-15 09:00: 月令 with its hidden stems, the roots of every stem, and no weighting', async () => {
  const json = await wuxing(BIRTH);
  assert.deepEqual(json.日主, { 天干: '庚', 五行: '金' });
  for (const removed of ['五行统计', '相生链', '十神分布', '透干']) assert.equal(json[removed], undefined, removed);
  // 《三命通会·论五行旺相休囚死》：四季月土旺、金相、火休、木囚、水死
  assert.deepEqual(json.月令, {
    月支: '丑', 月令五行: '土', 旺: '土', 相: '金', 休: '火', 囚: '木', 死: '水', 日主状态: '相',
    藏干: [{ 天干: '己', 气性: '本气', 透出: ['年干'] }, { 天干: '癸', 气性: '中气', 透出: [] }, { 天干: '辛', 气性: '余气', 透出: ['时干'] }],
  });
  // 日主在前，其后年干、月干、时干；每条根写出藏干与气性
  const roots = json.通根.map((row) => `${row.位置[0].柱}${row.位置[0].字}>${row.位置[1].柱}${row.位置[1].字}:${row.藏干}${row.结果}`);
  assert.deepEqual(roots, [
    '日柱庚>年柱巳:庚中气', '日柱庚>月柱丑:辛余气', '日柱庚>时柱巳:庚中气',
    '年柱己>年柱巳:戊余气', '年柱己>月柱丑:己本气', '年柱己>日柱辰:戊本气', '年柱己>时柱巳:戊余气',
    '月柱丁>年柱巳:丙本气', '月柱丁>时柱巳:丙本气',
    '时柱辛>年柱巳:庚中气', '时柱辛>月柱丑:辛余气', '时柱辛>时柱巳:庚中气',
  ]);
  assert.ok(json.通根.every((row) => row.位置[0].部位 === '天干' && row.位置[1].部位 === '地支'));
  assert.equal(json.通根[0].说明, '日主庚金通根于年支巳（藏庚·中气）');
  assert.deepEqual(json.无根, []);
  assert.deepEqual(json.干支自坐.map((row) => row.结果), ['支生干', '干生支', '支生干', '支克干']);
  assert.deepEqual(json.相邻天干.map((row) => row.类型), ['天干生', '天干克', '天干同气']);
  assert.deepEqual(json.缺失五行, []);
  assert.ok(json.口径.some((note) => note.includes('不判断身强身弱')));
  assert.ok(json.计算规则.ruleVersion.startsWith('bazi-wuxing-'));
});

test('a 寅 month follows the spring cycle: 木旺 火相 水休 金囚 土死', async () => {
  const json = await wuxing({ ...BIRTH, birthMonth: 2, birthDay: 20 });
  assert.equal(json.月令.月支, '寅');
  assert.deepEqual([json.月令.旺, json.月令.相, json.月令.休, json.月令.囚, json.月令.死], ['木', '火', '水', '金', '土']);
});

test('across many charts every stem gets exactly its same-element hidden stems as roots, and 透出 never counts 日主', () => {
  let rootless = 0, missingSeen = 0;
  for (let day = 0; day < 240; day++) {
    const date = new Date(Date.UTC(1960, 0, 1 + day * 97));
    const input = { gender: day % 2 ? 'female' : 'male', birthYear: date.getUTCFullYear(), birthMonth: date.getUTCMonth() + 1, birthDay: date.getUTCDate(), birthHour: (day * 7) % 24 };
    const chart = calculateBazi(input);
    const result = deriveBaziWuxing(chart);
    const pillars = [chart.fourPillars.year, chart.fourPillars.month, chart.fourPillars.day, chart.fourPillars.hour];
    assert.deepEqual(result.stemRoots.map((item) => item.label), ['日主', '年干', '月干', '时干']);
    for (const item of result.stemRoots) {
      const expected = pillars.flatMap((pillar) => pillar.hiddenStems.filter((hidden) => STEM_ELEMENT[hidden.stem] === item.element).map((hidden) => `${pillar.branch}${hidden.stem}`));
      assert.deepEqual(item.roots.map((fact) => `${fact.cells[1].char}${fact.hidden}`), expected, `${item.label}${item.stem}`);
      if (!item.roots.length) rootless++;
    }
    for (const hidden of result.monthCommand.hiddenStems) {
      assert.equal(hidden.revealedIn.includes('日主'), false);
      assert.deepEqual(hidden.revealedIn, ['年干', '月干', '时干'].filter((_, i) => pillars[[0, 1, 3][i]].stem === hidden.stem));
    }
    const present = new Set(pillars.flatMap((pillar) => [STEM_ELEMENT[pillar.stem], ...pillar.hiddenStems.map((hidden) => STEM_ELEMENT[hidden.stem])]));
    assert.deepEqual(result.missingElements, ELEMENTS.filter((element) => !present.has(element)));
    if (result.missingElements.length) missingSeen++;
  }
  assert.ok(rootless > 0, 'the sample includes a rootless stem');
  assert.ok(missingSeen > 0, 'the sample includes charts with a missing element');
});

test('sections keeps only the chosen fact groups while 日主, 月令 and 缺失五行 always stay', async () => {
  const json = await wuxing({ ...BIRTH, sections: ['相邻天干', '通根', '相邻天干'] });
  assert.deepEqual(json.筛选, { 事实组: ['通根', '相邻天干'] }, 'deduplicated, in canonical order');
  assert.deepEqual(Object.keys(json), ['日主', '月令', '缺失五行', '筛选', '通根', '无根', '相邻天干', '口径', '计算规则']);
  const text = renderToolResult('bazi_wuxing', await executeTool('bazi_wuxing', { ...BIRTH, sections: ['干支自坐'] })).content[0].text;
  assert.match(text, /只取：干支自坐（去掉 sections 可看全部事实组）/);
  assert.match(text, /## 月令[\s\S]*## 干支自坐[\s\S]*## 缺失五行/);
  assert.doesNotMatch(text, /## 通根|## 相邻天干|## 口径|## 计算规则/);
  for (const sections of [[], ['旺衰'], ['透干'], ['相生链'], ['十神分布'], '通根']) {
    await assert.rejects(executeTool('bazi_wuxing', { ...BIRTH, sections }), JSON.stringify(sections));
  }
});

test('default text writes each fact once; full appends only 口径', async () => {
  const raw = await executeTool('bazi_wuxing', BIRTH);
  const lean = renderToolResult('bazi_wuxing', raw).content[0].text;
  const full = renderToolResult('bazi_wuxing', raw, { detailLevel: 'full' }).content[0].text;
  assert.match(lean, /## 月令\n\n- 月支丑（土）：土旺、金相、火休、木囚、水死；日主庚金相\n- 藏干：己（本气）透年干；癸（中气）不透；辛（余气）透时干\n/);
  assert.match(lean, /## 通根\n\n- 日主庚金：年支巳（藏庚·中气）、月支丑（藏辛·余气）、时支巳（藏庚·中气）\n- 年干己土：/);
  assert.match(lean, /## 干支自坐\n\n- 年柱巳火生己土（支生干）/);
  assert.match(lean, /## 缺失五行\n\n- 无$/);
  assert.doesNotMatch(lean, /## 口径|## 计算规则|相生链|十神/);
  assert.ok(full.startsWith(lean));
  assert.match(full.slice(lean.length), /^\n\n## 口径\n\n- 只列旺衰与生克的事实，不判断身强身弱/);
  assert.doesNotMatch(full, /## 计算规则/);
});

test('a stem without a same-element hidden stem is written as 无根', () => {
  for (let day = 0; day < 400; day++) {
    const date = new Date(Date.UTC(1950, 0, 1 + day * 53));
    const input = { gender: 'male', birthYear: date.getUTCFullYear(), birthMonth: date.getUTCMonth() + 1, birthDay: date.getUTCDate(), birthHour: (day * 5) % 24 };
    const result = deriveBaziWuxing(calculateBazi(input));
    const bare = result.stemRoots.find((item) => !item.roots.length);
    if (!bare) continue;
    const rendered = renderToolResult('bazi_wuxing', result);
    assert.match(rendered.content[0].text, new RegExp(`- ${bare.label}${bare.stem}${bare.element}：无根`));
    assert.ok(rendered.structuredContent.无根.includes(`${bare.label}${bare.stem}${bare.element}`));
    return;
  }
  assert.fail('no rootless stem in the sample');
});
