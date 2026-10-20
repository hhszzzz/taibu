import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';

/** 选卦法定盘：天火同人，九三为世爻官鬼，无变卦，结果可复现 */
const SELECT = { question: '财运怎么样？', yongShenTargets: ['妻财'], method: 'select', hexagramName: '天火同人', date: '2026-02-10 14:00:00' };
/** 固定摇卦值：九三与上六明动，含回头克与化绝 */
const COINS = { question: '占问', yongShenTargets: ['官鬼'], method: 'coins', yaoValues: [7, 8, 9, 7, 8, 6], date: '2026-02-10T09:30:00' };

async function line(selector, input = SELECT) {
  return renderToolResult('liuyao_line', await executeTool('liuyao_line', { ...input, ...selector })).structuredContent;
}

test('liuyao_line schema is the liuyao schema plus selectors and its own detail level', () => {
  const tool = listToolDefinitions().find((item) => item.name === 'liuyao_line');
  const liuyao = listToolDefinitions().find((item) => item.name === 'liuyao');
  assert.ok(tool && liuyao);
  for (const key of Object.keys(liuyao.inputSchema.properties).filter((key) => key !== 'detailLevel')) {
    assert.deepEqual(tool.inputSchema.properties[key], liuyao.inputSchema.properties[key], key);
  }
  assert.deepEqual(tool.inputSchema.properties.detailLevel.enum, ['default', 'full'], 'the drilldown has its own text detail level');
  assert.deepEqual(tool.inputSchema.required, liuyao.inputSchema.required);
  assert.ok(tool.inputSchema.examples.every((example) => example.question && (example.line || example.role)));
});

test('世, its 六亲 and an explicit index resolve to the same line', async () => {
  const byRole = await line({ role: '世' });
  const byKin = await line({ role: '官鬼' });
  const byIndex = await line({ line: 3 });
  assert.deepEqual(byRole.查询, { 角色: '世', 本卦: '天火同人', 月建: '寅', 日辰: '卯' });
  assert.equal(byRole.爻详情.length, 1);
  assert.deepEqual(byRole.爻详情, byKin.爻详情);
  assert.deepEqual(byRole.爻详情, byIndex.爻详情);
  const [detail] = byRole.爻详情;
  assert.deepEqual(
    [detail.爻位, detail.序号, detail.六亲, detail.六神, detail.纳甲, detail.五行, detail.世应, detail.动静],
    ['九三', 3, '官鬼', '勾陈', '亥', '水', '世', '静'],
  );
  assert.equal(detail.旺衰, '休');
  assert.deepEqual(detail.旺衰判据, ['月令休', '月合']);
  assert.equal(detail.月建作用, '月合');
  assert.equal(detail.日辰作用, undefined, '月建与日辰都无作用时不编造说明');
  assert.deepEqual(detail.位置, [{ 爻位: '九三', 序号: 3, 部位: '本爻' }]);
  assert.equal(detail.变爻, undefined, '静卦无变爻');
  assert.deepEqual(detail.受动爻作用, []);
  assert.ok(byRole.计算规则.ruleVersion.startsWith('liuyao-line-'));
});

test('the drilldown keeps the AI-safe contract: no 用神 ruling and no 应期', async () => {
  const payload = await line({ role: '妻财' });
  assert.deepEqual(payload.爻详情.map((item) => [item.爻位, item.六亲]), [['九五', '妻财']]);
  assert.ok(payload.口径.join(' ').includes('不输出用神取用'));
  assert.doesNotMatch(JSON.stringify(payload.爻详情), /"(用神|应期|原神|忌神|仇神)"/u);
  assert.equal(payload.用神分析, undefined);
  const rendered = renderToolResult('liuyao_line', await executeTool('liuyao_line', { ...SELECT, role: '妻财' })).content[0].text;
  assert.match(rendered, /# 六爻逐爻详查/u);
  assert.match(rendered, /## 爻详情/u);
});

test('a moving-line chart reports 化变 and the actions between lines', async () => {
  const json = await line({ role: '动' }, COINS);
  assert.deepEqual(json.爻详情.map((item) => item.爻位), ['九三', '上六']);
  assert.deepEqual(json.爻详情.map((item) => [item.动静, item.变爻.化变]), [['明动', '回头克'], ['明动', '化绝']]);
  const third = json.爻详情[0];
  assert.deepEqual(third.变爻, { 六亲: '官鬼', 纳甲: '辰', 五行: '土', 化变: '回头克' });
  assert.deepEqual(third.位置, [{ 爻位: '九三', 序号: 3, 部位: '本爻' }, { 爻位: '九三', 序号: 3, 部位: '变爻' }]);
  assert.ok(third.受动爻作用.some((action) => action.说明.includes('上六')));
  assert.ok(third.动而作用.some((action) => action.说明.includes('初九')));
  const single = await line({ line: 3 }, COINS);
  assert.deepEqual(single.爻详情, [third], '单爻查询与动爻查询给出同一爻');
});

test('invalid selectors are rejected', async () => {
  for (const selector of [{}, { line: 3, role: '世' }, { line: 0 }, { line: 7 }, { role: '用神' }]) {
    await assert.rejects(executeTool('liuyao_line', { ...SELECT, ...selector }), JSON.stringify(selector));
  }
});
