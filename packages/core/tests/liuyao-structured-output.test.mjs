import test from 'node:test';
import assert from 'node:assert/strict';

import * as mcpCore from 'taibu-core';
import { listToolDefinitions } from 'taibu-core/mcp';

const LIU_QIN = ['父母', '兄弟', '子孙', '妻财', '官鬼'];
const MOVEMENT_STATES = ['static', 'changing', 'hidden_moving', 'day_break'];

test('liuyao schema removes deprecated top-level fields and exposes refactored structures', () => {
  const tool = listToolDefinitions().find((t) => t.name === 'liuyao');
  assert.ok(tool, 'liuyao tool missing');

  const inputProps = tool.inputSchema?.properties;
  assert.equal(inputProps?.question?.type, 'string');
  assert.equal(inputProps?.yongShenTargets?.type, 'array');
  assert.deepEqual(inputProps?.yongShenTargets?.items?.enum, LIU_QIN);
  assert.equal(tool.inputSchema?.required?.includes('yongShenTargets'), true);
  assert.deepEqual(inputProps?.detailLevel?.enum, ['default', 'more', 'full']);

  const outputProps = tool.outputSchema?.properties;
  assert.equal(outputProps?.changedLines, undefined, 'changedLines should be removed');
  assert.equal(outputProps?.changedYaoCi, undefined, 'changedYaoCi should be removed');
  assert.equal(outputProps?.changedYaos, undefined, 'changedYaos should be removed');
  assert.equal(outputProps?.summary, undefined, 'summary should be removed');
  assert.equal(outputProps?.rankScoreNote, undefined, 'rankScoreNote should be removed');
  assert.equal(outputProps?.卦盘?.type, 'object');
  assert.equal(outputProps?.六爻全盘?.type, 'object');
  assert.equal(outputProps?.全局互动?.type, 'object');
  assert.equal(outputProps?.元信息?.type, 'object');
  assert.equal(outputProps?.卦盘?.properties?.卦身?.type, 'object');
  assert.equal(outputProps?.卦盘?.properties?.衍生卦?.type, 'object');
  assert.equal(outputProps?.卦盘?.properties?.全局神煞?.type, 'array');
  assert.equal(outputProps?.globalShenSha, undefined);
  assert.equal(outputProps?.warnings, undefined);
  assert.equal(outputProps?.guaLevelAnalysis, undefined);
  assert.equal(outputProps?.yaos, undefined);
  assert.equal(outputProps?.targets, undefined);

  const fullBoardLine = outputProps?.六爻全盘?.properties?.爻列表?.items?.properties;
  assert.equal(fullBoardLine?.六神?.type, 'string');
  assert.equal(fullBoardLine?.本爻?.type, 'object');
  assert.equal(fullBoardLine?.变爻?.type, 'object');
  assert.equal(fullBoardLine?.世应?.type, 'string');
  assert.equal(fullBoardLine?.神煞?.type, 'array');
  assert.equal(fullBoardLine?.动静?.type, 'string');
  assert.equal(fullBoardLine?.空亡?.type, 'string');
  assert.equal(fullBoardLine?.化变?.type, 'string');

  const combination = outputProps?.全局互动?.properties?.组合关系?.items?.properties;
  assert.equal(combination?.类型?.type, 'string');
  assert.equal(combination?.参与者?.type, 'array');
  assert.equal(outputProps?.全局互动?.properties?.是否六冲卦?.type, 'string');
  assert.equal(outputProps?.全局互动?.properties?.是否六合卦?.type, 'string');
  assert.equal(outputProps?.computedFlags, undefined);
});

test('liuyao output uses refactored yao/yongshen/time structures', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '考试结果和排名怎么样',
    method: 'select',
    hexagramName: '天火同人',
    changedHexagramName: '天山遯',
    date: '2026-02-10T12:00:00',
    yongShenTargets: ['官鬼', '父母'],
  });

  assert.equal(typeof result.question, 'string');
  assert.ok(Array.isArray(result.fullYaos), 'fullYaos should be array');
  assert.equal(result.fullYaos.length, 6, 'fullYaos should contain six yaos');

  assert.equal(result.changedLines, undefined, 'changedLines should be removed');
  assert.equal(result.changedYaoCi, undefined, 'changedYaoCi should be removed');
  assert.equal(result.changedYaos, undefined, 'changedYaos should be removed');
  assert.equal(result.summary, undefined, 'summary should be removed');

  for (const yao of result.fullYaos) {
    assert.equal(typeof yao.isChanging, 'boolean');
    assert.ok(MOVEMENT_STATES.includes(yao.movementState), `invalid movementState: ${yao.movementState}`);
    assert.equal(typeof yao.movementLabel, 'string');
    assert.ok(Array.isArray(yao.shenSha), 'shenSha should always be array');

    if (yao.isChanging) {
      assert.ok(yao.changedYao, 'changing yao should contain changedYao');
      assert.equal(typeof yao.changedYao.yaoCi, 'string');
      assert.equal(typeof yao.changedYao.relation, 'string');
      assert.ok(yao.changedYao.relation.length > 0, 'relation should not be empty');
    } else {
      assert.equal(yao.changedYao, null, 'stable yao should have null changedYao');
    }
  }

  assert.ok(Array.isArray(result.yongShen), 'yongShen should be grouped array');
  assert.ok(result.yongShen.length >= 2, 'yongShen should include requested multi targets');
  assert.equal(result.rankScoreNote, undefined, 'rankScoreNote should be removed from output');

  for (const group of result.yongShen) {
    assert.ok(LIU_QIN.includes(group.targetLiuQin), `invalid targetLiuQin: ${group.targetLiuQin}`);
    assert.ok(group.selected, 'group should expose selected');
    assert.ok(Array.isArray(group.candidates), 'candidates should always be array');
    assert.ok(['resolved', 'ambiguous', 'from_changed', 'from_temporal', 'from_fushen', 'missing'].includes(group.selectionStatus));
    assert.equal(typeof group.selectionNote, 'string');
    assert.ok(Array.isArray(group.selected.evidence), 'selected should expose evidence');
    assert.equal('strengthScore' in group.selected, false, 'selected should not expose strengthScore');
    assert.equal('rankScore' in group.selected, false, 'selected should not expose rankScore');
    assert.equal('source' in group, false, 'group should not expose legacy source');
    for (const candidate of group.candidates) {
      assert.equal('strengthScore' in candidate, false, 'candidate should not expose strengthScore');
      assert.equal('rankScore' in candidate, false, 'candidate should not expose rankScore');
    }
  }

  assert.ok(Array.isArray(result.timeRecommendations), 'timeRecommendations should be array');
  assert.ok(result.timeRecommendations.length > 0, 'timeRecommendations should not be empty');
  for (const item of result.timeRecommendations) {
    assert.ok(LIU_QIN.includes(item.targetLiuQin), `invalid targetLiuQin in time recommendation: ${item.targetLiuQin}`);
    assert.ok(['favorable', 'unfavorable', 'critical'].includes(item.type));
    assert.equal(typeof item.trigger, 'string');
    assert.ok(Array.isArray(item.basis));
    assert.equal(typeof item.description, 'string');
    assert.equal('confidence' in item, false, 'time recommendation should not expose confidence');
    assert.equal('startDate' in item, false, 'time recommendation should not expose startDate');
    assert.equal('endDate' in item, false, 'time recommendation should not expose endDate');
  }

  assert.ok(Array.isArray(result.globalShenSha), 'globalShenSha should be array');
});

test('liuyao can identify hidden_moving and day_break in sampled cases', async () => {
  const dates = [
    '2026-02-10T12:00:00',
    '2026-03-10T12:00:00',
    '2026-04-10T12:00:00',
    '2026-05-10T12:00:00',
    '2026-06-10T12:00:00',
    '2026-07-10T12:00:00',
  ];
  const hexagrams = ['天火同人', '地天泰', '泽雷随', '火天大有', '坎为水', '离为火'];

  const seen = new Set();

  for (const date of dates) {
    for (const hexagramName of hexagrams) {
      const result = await mcpCore.calculateLiuyao({
        question: '近期计划是否顺利',
        yongShenTargets: ['兄弟'],
        method: 'select',
        hexagramName,
        date,
      });

      for (const yao of result.fullYaos || []) {
        if (yao.movementState === 'hidden_moving' || yao.movementState === 'day_break') {
          seen.add(yao.movementState);
        }
      }

      if (seen.has('hidden_moving') && seen.has('day_break')) {
        break;
      }
    }

    if (seen.has('hidden_moving') && seen.has('day_break')) {
      break;
    }
  }

  assert.ok(seen.has('hidden_moving'), 'expected at least one hidden_moving case');
  assert.ok(seen.has('day_break'), 'expected at least one day_break case');
});

test('liuyao relation uses 伏吟 when changed branch stays the same', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '测试伏吟关系',
    yongShenTargets: ['兄弟'],
    method: 'select',
    hexagramName: '乾为天',
    changedHexagramName: '水雷屯',
    date: '2026-02-10T12:00:00',
  });

  const target = result.fullYaos.find((yao) => yao.position === 2);
  assert.ok(target?.changedYao, 'position 2 should be changing yao');
  assert.equal(target.naJia, target.changedYao.naJia, 'fixture expects same branch');
  assert.equal(target.changedYao.relation, '伏吟');
});

test('liuyao uses 伏神 fallback when target liuqin is absent in main hexagram', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '测试官鬼不上卦时伏神回退',
    yongShenTargets: ['官鬼'],
    method: 'select',
    hexagramName: '火水未济',
    date: '2026-02-10T12:00:00',
  });

  const group = result.yongShen.find((item) => item.targetLiuQin === '官鬼');
  assert.ok(group, 'missing 官鬼 yongShen group');
  assert.equal(group.selectionStatus, 'from_fushen');
  const primary = group.selected;
  assert.equal(typeof primary.position, 'number', 'primary.position should come from 伏神爻位');
  assert.equal('rankScore' in primary, false, '伏神回退结果不应暴露 rankScore');
  assert.equal(primary.source, 'fushen');
  assert.match(
    (primary.evidence || []).join('、'),
    /伏神/u,
    'fallback evidence should mention 伏神'
  );
});

test('liuyao exposes ambiguous selection when top candidates differ only by fallback position ordering', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '测试同类并见',
    yongShenTargets: ['兄弟'],
    method: 'select',
    hexagramName: '水雷屯',
    date: '2024-01-02T10:00:00+08:00',
  });

  const group = result.yongShen.find((item) => item.targetLiuQin === '兄弟');
  assert.ok(group, 'missing 兄弟 yongShen group');
  assert.equal(group.selectionStatus, 'ambiguous');
  assert.ok(group.candidates.length > 0, 'ambiguous group should preserve candidate list');
});

test('liuyao MCP output preserves changedNaJia and huaType for selected/candidate yongshen items', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '测试化变取用',
    yongShenTargets: ['子孙'],
    method: 'select',
    hexagramName: '乾为天',
    changedHexagramName: '011111',
    date: '2024-01-02T10:00:00+08:00',
  });

  const group = result.yongShen.find((item) => item.targetLiuQin === '子孙');
  assert.ok(group, 'missing 子孙 yongShen group');
  assert.equal(group.selected.changedNaJia, '丑');
  assert.equal(group.selected.huaType, 'huiTouKe');
});

test('liuyao time recommendations prioritize出伏提示 over generic favorable timing when fallback is still unresolved', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '测试官鬼不上卦时伏神回退',
    yongShenTargets: ['官鬼'],
    method: 'select',
    hexagramName: '火水未济',
    date: '2026-02-10T12:00:00',
  });

  const group = result.yongShen.find((item) => item.targetLiuQin === '官鬼');
  assert.ok(group, 'missing 官鬼 yongShen group');
  const primary = group.selected;
  assert.equal(typeof primary.naJia, 'string', 'primary candidate should expose naJia');

  const targetedRec = result.timeRecommendations.find(
    (item) => item.targetLiuQin === '官鬼' && item.trigger === '待出伏'
  );
  assert.ok(targetedRec, 'should include 出伏提示');
  assert.equal(
    result.timeRecommendations.some((item) => item.targetLiuQin === '官鬼' && item.type === 'favorable'),
    false,
  );
});

test('liuyao should use temporal yongshen before fuShen when month/day can stand in', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '问财运',
    yongShenTargets: ['妻财'],
    method: 'select',
    hexagramName: '天风姤',
    date: '2024-02-10T10:00:00+08:00',
  });

  const group = result.yongShen.find((item) => item.targetLiuQin === '妻财');
  assert.ok(group, 'missing 妻财 yongShen group');
  assert.equal(group.selectionStatus, 'from_temporal');
  assert.equal(group.selected.source, 'temporal');
  assert.equal(group.selected.naJia, '寅');
});

test('liuyao should use changed yongshen before fuShen when a moving line transforms into target liuqin', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '问财运',
    yongShenTargets: ['妻财'],
    method: 'select',
    hexagramName: '水雷屯',
    changedHexagramName: '雷火丰',
    date: '2024-01-02T10:00:00+08:00',
  });

  const group = result.yongShen.find((item) => item.targetLiuQin === '妻财');
  assert.ok(group, 'missing 妻财 yongShen group');
  assert.equal(group.selectionStatus, 'from_changed');
  assert.equal(group.selected.source, 'changed');
  assert.equal(group.selected.position, 4);
  assert.equal(group.selected.naJia, '午');
});

test('liuyao should surface kong_yue_jian when a changing empty line is rescued by month-jian', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '问财运',
    yongShenTargets: ['妻财'],
    method: 'select',
    hexagramName: '乾为天',
    changedHexagramName: '天火同人',
    date: '2024-02-10T10:00:00+08:00',
  });

  assert.equal(result.fullYaos[1]?.kongWangState, 'kong_yue_jian');
});

test('liuyao should not emit generic favorable timing for unresolved fuShen fallback', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '测试官鬼不上卦时伏神回退',
    yongShenTargets: ['官鬼'],
    method: 'select',
    hexagramName: '火水未济',
    date: '2026-02-10T12:00:00',
  });

  const group = result.yongShen.find((item) => item.targetLiuQin === '官鬼');
  assert.ok(group, 'missing 官鬼 yongShen group');
  assert.equal(group.selectionStatus, 'from_fushen');
  assert.equal(
    result.timeRecommendations.some((item) => item.targetLiuQin === '官鬼' && item.type === 'favorable'),
    false
  );
});

test('liuyao should preserve multiple full sanhe groups when the same board contains more than one hit', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '测试三合并存',
    yongShenTargets: ['子孙'],
    method: 'select',
    hexagramName: '乾为天',
    changedHexagramName: '艮为山',
    date: '2024-01-02T10:00:00+08:00',
  });

  assert.ok(Array.isArray(result.sanHeAnalysis.fullSanHeList), 'expected fullSanHeList to exist');
  assert.equal(result.sanHeAnalysis.fullSanHeList.length, 2);
  assert.deepEqual(
    result.sanHeAnalysis.fullSanHeList.map((item) => item.name).sort(),
    ['寅午戌合火局', '申子辰合水局']
  );
});

test('formatGuaLevelLines labels 半合 types in Chinese and never leaks the internal enum', () => {
  const lines = mcpCore.formatGuaLevelLines({
    sanHeAnalysis: {
      hasFullSanHe: false,
      hasBanHe: true,
      banHe: [
        { branches: ['寅', '午'], result: '火', type: 'sheng' },
        { branches: ['午', '戌'], result: '火', type: 'mu' },
        { branches: ['子', '辰'], result: '水', type: 'unknown' },
      ],
    },
  });
  assert.deepEqual(lines, ['半合：寅午→火（生地半合）', '半合：午戌→火（墓地半合）', '半合：子辰→水']);
});

test('liuyao canonical JSON and text describe real 半合 cases with Chinese type labels', async () => {
  for (const [yaoValues, expected] of [
    [[7, 9, 8, 8, 6, 7], '半合：申子→水（生地半合）'],
    [[8, 6, 7, 6, 6, 6], '半合：午戌→火（墓地半合）'],
  ]) {
    const result = await mcpCore.calculateLiuyao({
      question: '近期计划是否顺利',
      yongShenTargets: ['官鬼'],
      method: 'coins',
      yaoValues,
      date: '2026-01-10T12:00:00',
    });
    assert.ok(mcpCore.toLiuyaoCanonicalJson(result).卦级分析.includes(expected), expected);
    assert.match(mcpCore.toLiuyaoCanonicalText(result), new RegExp(`- ${expected}`, 'u'));
    for (const text of [mcpCore.toLiuyaoCanonicalText(result), mcpCore.toLiuyaoText(result, { detailLevel: 'full' })]) {
      assert.doesNotMatch(text, /（(?:sheng|mu)）/u);
    }
  }
});
