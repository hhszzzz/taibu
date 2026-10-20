import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';

/** 甲子日丙寅时 · 阳遁一局（手工局数，盘面固定，便于逐宫核对） */
const JIAZI = { year: 2024, month: 1, day: 1, hour: 3, juNumber: 1, dunType: 'yang' };

async function palace(selector, input = JIAZI) {
  return renderToolResult('qimen_palace', await executeTool('qimen_palace', { ...input, ...selector })).structuredContent;
}

async function board(input = JIAZI) {
  return renderToolResult('qimen', await executeTool('qimen', input), { detailLevel: 'full' }).structuredContent;
}

test('qimen_palace schema is the qimen schema plus selectors and its own detail level', () => {
  const tool = listToolDefinitions().find((item) => item.name === 'qimen_palace');
  const qimen = listToolDefinitions().find((item) => item.name === 'qimen');
  assert.ok(tool && qimen);
  for (const key of Object.keys(qimen.inputSchema.properties).filter((key) => key !== 'detailLevel')) {
    assert.deepEqual(tool.inputSchema.properties[key], qimen.inputSchema.properties[key], key);
  }
  assert.deepEqual(tool.inputSchema.properties.detailLevel.enum, ['default', 'full'], 'the drilldown has its own text detail level');
  assert.deepEqual(tool.inputSchema.required, qimen.inputSchema.required);
  assert.ok(tool.inputSchema.examples.every((example) => example.year && example.month && example.day));
});

test('a named palace repeats the board row and adds stem/gate/star relations', async () => {
  const json = await palace({ palace: 1 });
  const row = (await board()).九宫盘[0];
  assert.equal(json.查询.方式, '指定宫位');
  assert.equal(json.查询.宫位, row.宫位);
  assert.equal(json.宫位.宫名, row.宫名);
  assert.equal(json.宫位.宫位五行, row.宫位五行);
  assert.deepEqual([json.星门神.九星, json.星门神.八门, json.星门神.八神], [row.九星, row.八门, row.八神]);
  assert.equal(json.天地盘.天盘天干, row.天盘天干);
  assert.equal(json.天地盘.地盘天干, row.地盘天干);
  assert.deepEqual(json.状态, row.宫位状态);
  // 生克只申明五行方向：惊门(金)生坎宫(水)、天心星(金)生坎宫(水)、地盘戊(土)克天盘癸(水)
  assert.deepEqual(json.生克.map((item) => item.类型), ['门宫', '星宫', '天盘干与宫', '地盘干与宫', '天地盘干']);
  assert.deepEqual(json.生克.map((item) => item.结果), ['门生宫', '星生宫', '比和', '地盘干克宫', '地盘干克天盘干']);
  assert.equal(json.生克[0].说明, '惊门(金)生坎宫(水)');
  // 柱干落宫用排盘四柱：2024-01-01 03:00 为 癸卯年 甲子月 甲子日 丙寅时，甲遁于戊
  assert.deepEqual(json.柱干落宫.map((item) => [item.类型, item.结果, item.位置[0].部位]), [['年干', '癸', '天盘天干'], ['月干', '戊', '地盘天干'], ['日干', '戊', '地盘天干']]);
  assert.deepEqual(json.遁甲, ['时旬首甲子遁于戊，本宫地盘见戊']);
  assert.ok(json.计算规则.ruleVersion.startsWith('qimen-palace-'));
});

test('states and formations come from the board: 空亡, 驿马, 入墓, 击刑 and 门迫', async () => {
  const chart = await board();
  const kun = await palace({ palace: 2 });
  assert.deepEqual(kun.状态, chart.九宫盘[1].宫位状态);
  assert.ok(kun.状态.includes('驿马') && kun.状态.includes('门迫'));
  assert.ok(kun.状态.some((item) => item.startsWith('入墓(')));
  assert.ok(kun.格局.includes('三奇得使'));
  const qian = await palace({ palace: 6 });
  assert.deepEqual(qian.状态, ['日空', '时空']);
  const li = await palace({ palace: 9 });
  assert.deepEqual(li.状态, ['六仪击刑']);
  assert.ok(li.格局.includes('六仪击刑'));
  // 门迫就是门克宫：状态与格局标记的同时，生克给出同一关系
  const dui = await palace({ palace: 7 });
  assert.ok(dui.状态.includes('门迫'));
  assert.equal(dui.生克.find((item) => item.类型 === '门宫').结果, '门克宫');
});

test('locate finds a palace by pillar stem (甲 taking its hidden 六仪), star, gate or deity', async () => {
  const year = await palace({ locate: { type: '年干' } });
  assert.equal(year.查询.宫位, '坎1');
  assert.equal(year.查询.定位, '年干癸临天盘癸');
  const day = await palace({ locate: { type: '日干' } });
  assert.equal(day.查询.宫位, '艮8');
  assert.match(day.查询.定位, /日干甲（甲子遁于戊）临天盘戊/);
  for (const locate of [{ type: '星', value: '天蓬' }, { type: '门', value: '开门' }, { type: '神', value: '值符' }]) {
    assert.equal((await palace({ locate })).查询.宫位, '艮8', JSON.stringify(locate));
  }
});

test('值符 and 值使 report their real landing palaces and mark the palace they land on', async () => {
  assert.deepEqual((await palace({ palace: 8 })).值符值使, { 值符: '天蓬星 落艮8', 值使: '休门 落震3', 本宫: '值符宫' });
  assert.equal((await palace({ palace: 3 })).值符值使.本宫, '值使宫');
  assert.equal((await palace({ palace: 2 })).值符值使.本宫, undefined);
});

test('the turning centre keeps only its earth stem and points to its hosts; the flying centre keeps star, gate and deity', async () => {
  const centre = await palace({ palace: 5 });
  assert.equal(centre.天地盘.天盘天干, '-');
  assert.deepEqual([centre.星门神.九星, centre.星门神.八门, centre.星门神.八神], ['-', '-', '-']);
  assert.deepEqual(centre.状态, ['寄宫参看对应宫位']);
  assert.deepEqual(centre.中宫寄宫, ['中五地盘壬寄坤2', '天禽星随天芮星落兑7，带天盘壬']);
  assert.deepEqual(centre.生克.map((item) => item.类型), ['地盘干与宫'], '转盘中五不布星门神');
  const flying = await palace({ palace: 5 }, { ...JIAZI, panType: 'fei' });
  assert.equal(flying.天地盘.天盘天干, '丁');
  assert.deepEqual([flying.星门神.九星, flying.星门神.八门, flying.星门神.八神], ['天柱星', '伤门', '朱雀']);
  assert.deepEqual(flying.状态, ['门迫'], '飞盘中五照常标记自身门迫');
  assert.deepEqual(flying.生克.map((item) => item.类型), ['门宫', '星宫', '天盘干与宫', '地盘干与宫', '天地盘干']);
  assert.equal(flying.中宫寄宫, undefined);
});

test('invalid selectors are rejected', async () => {
  for (const selector of [
    {},
    { palace: 1, locate: { type: '日干' } },
    { palace: 0 },
    { palace: 10 },
    { palace: 1.5 },
    { locate: { type: '旬首' } },
    { locate: { type: '星' } },
    { locate: { type: '日干', value: '甲' } },
    { locate: { type: '门', value: '天蓬' } },
  ]) {
    await assert.rejects(executeTool('qimen_palace', { ...JIAZI, ...selector }), JSON.stringify(selector));
  }
});
