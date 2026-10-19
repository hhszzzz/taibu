import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';
import { calculateBazi, calculateBaziFiveElementsStats, deriveBaziWuxing } from 'taibu-core/bazi';

const BIRTH = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };
const ELEMENTS = ['木', '火', '土', '金', '水'];

async function wuxing(input) {
  return renderToolResult('bazi_wuxing', await executeTool('bazi_wuxing', input)).structuredContent;
}

test('bazi_wuxing takes exactly the bazi input and nothing else', () => {
  const tool = listToolDefinitions().find((item) => item.name === 'bazi_wuxing');
  const bazi = listToolDefinitions().find((item) => item.name === 'bazi');
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), Object.keys(bazi.inputSchema.properties).filter((key) => key !== 'detailLevel').sort());
  assert.deepEqual(tool.inputSchema.required, bazi.inputSchema.required);
});

test('1990-01-15 09:00: weighted stats, 月令 and roots of 庚金 in 丑月', async () => {
  const json = await wuxing(BIRTH);
  assert.deepEqual(json.日主, { 天干: '庚', 五行: '金' });
  assert.deepEqual(json.五行统计.map((row) => `${row.五行}${row.合计}`), ['木0.3', '火4.2', '土4.4', '金2.7', '水0.4']);
  // 《三命通会·论五行旺相休囚死》：四季月土旺、金相、火休、木囚、水死
  assert.deepEqual(json.月令, { 月支: '丑', 月令五行: '土', 旺: '土', 相: '金', 休: '火', 囚: '木', 死: '水', 日主状态: '相' });
  assert.deepEqual(json.通根.map((row) => `${row.位置[1].柱}${row.位置[1].字}${row.结果}`), ['年柱巳中气', '月柱丑余气', '时柱巳中气']);
  assert.ok(json.通根.every((row) => row.位置[0].柱 === '日柱' && row.位置[0].部位 === '天干'));
  assert.ok(json.透干.some((row) => row.说明 === '月柱丑藏己（本气）透出于年干'));
  assert.deepEqual(json.干支自坐.map((row) => row.结果), ['支生干', '干生支', '支生干', '支克干']);
  assert.deepEqual(json.相邻天干.map((row) => row.类型), ['天干生', '天干克', '天干同气']);
  assert.deepEqual(json.缺失五行, []);
  assert.deepEqual(json.相生链.连续段, ['木→火→土→金→水→木']);
  assert.deepEqual(json.十神分布.find((row) => row.十神 === '正官'), { 十神: '正官', 天干: ['月干丁'], 藏干: [] });
  assert.ok(json.口径.some((note) => note.includes('不判断身强身弱')));
  assert.ok(json.计算规则.ruleVersion.startsWith('bazi-wuxing-'));
});

test('a 寅 month follows the spring cycle: 木旺 火相 水休 金囚 土死', async () => {
  const json = await wuxing({ ...BIRTH, birthMonth: 2, birthDay: 20 });
  assert.equal(json.月令.月支, '寅');
  assert.deepEqual([json.月令.旺, json.月令.相, json.月令.休, json.月令.囚, json.月令.死], ['木', '火', '水', '金', '土']);
});

test('across many charts the breakdown sums to the chart stats and the chain accounts for every missing element', () => {
  let missingSeen = 0;
  for (let day = 0; day < 240; day++) {
    const date = new Date(Date.UTC(1960, 0, 1 + day * 97));
    const input = { gender: day % 2 ? 'female' : 'male', birthYear: date.getUTCFullYear(), birthMonth: date.getUTCMonth() + 1, birthDay: date.getUTCDate(), birthHour: (day * 7) % 24 };
    const chart = calculateBazi(input);
    const result = deriveBaziWuxing(chart);
    const stats = calculateBaziFiveElementsStats(chart.fourPillars);
    for (const row of result.elementStats) {
      assert.equal(row.total, stats[row.element]);
      assert.ok(Math.abs(row.stems + row.branches + row.hiddenStems - row.total) < 0.11, JSON.stringify(row));
    }
    const chain = result.generatingChain;
    assert.deepEqual([...chain.present, ...result.missingElements].sort(), [...ELEMENTS].sort());
    assert.equal(chain.breaks.length, result.missingElements.length);
    for (const element of result.missingElements) assert.ok(chain.breaks.some((item) => item.startsWith(`缺${element}`)));
    const inSegments = chain.segments.join('→').split('→');
    for (const element of chain.present) assert.ok(inSegments.includes(element), element);
    if (result.missingElements.length) missingSeen++;
    assert.ok(result.roots.every((fact) => fact.cells[0].pillar === '日柱'));
  }
  assert.ok(missingSeen > 0, 'the sample includes charts with a missing element');
});
