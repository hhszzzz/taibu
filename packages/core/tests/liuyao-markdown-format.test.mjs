import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateLiuyao, toLiuyaoCanonicalJson } from 'taibu-core/liuyao';
import { buildToolSuccessPayload, renderToolResult } from 'taibu-core/mcp';

const DEFAULT_SAMPLE = {
  seed: 'seed',
  question: '事业是否顺利',
  hexagramName: '天火同人',
  hexagramGong: '离',
  hexagramElement: '火',
  hexagramBrief: '和同',
  guaCi: '同人于野，亨。利涉大川。利君子贞。',
  changedHexagramName: '天山遯',
  ganZhiTime: {
    year: { gan: '甲', zhi: '辰' },
    month: { gan: '丙', zhi: '寅' },
    day: { gan: '戊', zhi: '子' },
    hour: { gan: '庚', zhi: '申' },
    xun: '甲子旬',
  },
  kongWang: { xun: '甲子旬', kongDizhi: ['戌', '亥'] },
  kongWangByPillar: {
    year: { xun: '甲子旬', kongDizhi: ['戌', '亥'] },
    month: { xun: '甲寅旬', kongDizhi: ['子', '丑'] },
    day: { xun: '甲子旬', kongDizhi: ['戌', '亥'] },
    hour: { xun: '甲申旬', kongDizhi: ['午', '未'] },
  },
  fullYaos: [],
  yongShen: [
    {
      targetLiuQin: '官鬼',
      selectionStatus: 'from_fushen',
      selectionNote: '用神不上卦，转取伏神。',
      selected: {
        liuQin: '官鬼',
        naJia: '亥',
        element: '水',
        position: 2,
        source: 'fushen',
        strength: 'moderate',
        strengthLabel: '伏神可取',
        movementState: 'static',
        movementLabel: '伏藏待时',
        isShiYao: false,
        isYingYao: false,
        kongWangState: 'not_kong',
        evidence: ['用神官鬼不上卦', '伏神得助'],
      },
      candidates: [],
    },
  ],
  shenSystemByYongShen: [],
  globalShenSha: ['魁罡', '十恶大败'],
  warnings: ['见三合仍须结合月日动静'],
  timeRecommendations: [
    {
      targetLiuQin: '官鬼',
      type: 'critical',
      earthlyBranch: '亥',
      trigger: '待出伏',
      basis: ['用神伏藏', '转取伏神'],
      description: '需待出伏、得助或飞神发动。',
    },
  ],
};

test('liuyao tool markdown defaults to the compact board text', async () => {
  const result = await calculateLiuyao({ method: 'select', question: DEFAULT_SAMPLE.question, hexagramName: DEFAULT_SAMPLE.hexagramName, changedHexagramName: DEFAULT_SAMPLE.changedHexagramName, yongShenTargets: ['官鬼'], date: '2024-02-10T15:00' });
  const markdown = renderToolResult('liuyao', result, { detailLevel: 'default' }).content[0].text;

  assert.match(markdown, /# 六爻盘面/u);
  assert.match(markdown, /## 卦盘总览/u);
  assert.match(markdown, /## 时间信息/u);
  assert.doesNotMatch(markdown, /全局神煞/u);
  assert.doesNotMatch(markdown, /卦身:/u);
  assert.doesNotMatch(markdown, /十恶大败/u);
  assert.doesNotMatch(markdown, /互卦/u);
  assert.doesNotMatch(markdown, /凶吉警告/u);
  assert.doesNotMatch(markdown, /month_/u);
  assert.doesNotMatch(markdown, /huaJue/u);
});

test('liuyao more detail level should expose expanded board details without computed flags', async () => {
  const result = await calculateLiuyao({
    method: 'select',
    yongShenTargets: ['官鬼', '父母'],
    changedHexagramName: '巽为风',
    hexagramName: '风山渐',
    question: '这次事业编能不能进面试',
    date: '2026-03-25T11:10',
  });
  const payload = buildToolSuccessPayload('liuyao', result, { detailLevel: 'more' });

  assert.equal(payload.structuredContent.元信息.细节级别, '扩展');
  assert.equal(payload.structuredContent.卦盘.卦身.地支, '寅');
  assert.equal(payload.structuredContent.卦盘.卦身.状态, '飞伏');
  assert.equal(payload.structuredContent.卦盘.全局神煞[1], '十恶大败');
  assert.equal(payload.structuredContent.computedFlags, undefined);
  assert.match(payload.content[0].text, /卦身: 寅/u);
  assert.match(payload.content[0].text, /全局神煞: 魁罡、十恶大败、八专/u);
  assert.match(payload.content[0].text, /互卦: 火水未济/u);
  assert.match(payload.content[0].text, /\| 爻位 \| 六神 \| 神煞 \| 伏神 \| 本卦六亲\/干支 \| 变出 \| 世应 \|/u);
  assert.doesNotMatch(payload.content[0].text, /\| 爻位 \| 六神 \| 神煞 \| 伏神 \| 本卦六亲\/干支 \| 旺衰 \|/u);
});

test('liuyao full detail level should expose complete board details and computed flags for the exam sample', async () => {
  const result = await calculateLiuyao({
    method: 'select',
    yongShenTargets: ['官鬼', '父母'],
    changedHexagramName: '巽为风',
    hexagramName: '风山渐',
    question: '这次事业编能不能进面试',
    date: '2026-03-25T11:10',
  });
  const payload = buildToolSuccessPayload('liuyao', result, { detailLevel: 'full' });

  assert.equal(payload.structuredContent.元信息.细节级别, '完整');
  assert.equal('toolVersion' in payload.structuredContent.元信息, false);
  assert.equal(payload.structuredContent.六爻全盘.爻列表[0].六神, '朱雀');
  assert.equal(payload.structuredContent.六爻全盘.爻列表[3].世应, '世');
  assert.match(payload.structuredContent.卦盘.本卦.卦辞, /渐/u);
  assert.match(payload.structuredContent.卦盘.变卦.卦辞, /巽/u);
  assert.equal(payload.structuredContent.卦盘.全局神煞[1], '十恶大败');
  assert.equal(payload.structuredContent.全局互动.组合关系[0].参与者[0].来源, '变爻');
  assert.equal(payload.structuredContent.全局互动.组合关系[0].参与者[1].来源, '月建');
  assert.equal(payload.structuredContent.全局互动.组合关系[1].参与者[0].来源, '动爻');
  assert.equal(payload.structuredContent.全局互动.组合关系[1].参与者[1].来源, '日建');
  // 午化亥既回头克又化绝：回头克为主名，化绝写入化变说明
  assert.equal(payload.structuredContent.六爻全盘.爻列表[4].化变, '回头克');
  assert.equal(payload.structuredContent.全局互动.是否六冲卦, '否');
  assert.match(payload.content[0].text, /\| 爻位 \| 六神 \| 神煞 \| 伏神 \| 本卦六亲\/干支 \| 旺衰 \| 动静 \| 空亡 \| 变出 \| 化变 \| 世应 \|/u);
  assert.match(payload.content[0].text, /\| 六二 \| 螣蛇 \| 羊刃、将星、魁罡、十恶大败 \| - \| 父母 午火 \| 相 \| 明动 \| - \| 妻财 亥水 \| 回头克 \| - \|/u);
  assert.match(payload.content[0].text, /- 六冲卦: 否/u);
  assert.doesNotMatch(payload.content[0].text, /凶吉警告/u);
  assert.doesNotMatch(payload.content[0].text, /month_/u);
  assert.doesNotMatch(payload.content[0].text, /huaJue|huiTouKe/u);
});

test('liuyao canonical json should keep global shensha separate from guaLevelAnalysis', () => {
  const json = toLiuyaoCanonicalJson({
    question: '事业是否顺利',
    hexagramName: '天火同人',
    hexagramGong: '离',
    hexagramElement: '火',
    changedHexagramName: '天山遯',
    ganZhiTime: {
      year: { gan: '甲', zhi: '辰' },
      month: { gan: '丙', zhi: '寅' },
      day: { gan: '戊', zhi: '子' },
      hour: { gan: '庚', zhi: '申' },
      xun: '甲子旬',
    },
    kongWang: { xun: '甲子旬', kongDizhi: ['戌', '亥'] },
    kongWangByPillar: {
      year: { xun: '甲子旬', kongDizhi: ['戌', '亥'] },
      month: { xun: '甲寅旬', kongDizhi: ['子', '丑'] },
      day: { xun: '甲子旬', kongDizhi: ['戌', '亥'] },
      hour: { xun: '甲申旬', kongDizhi: ['午', '未'] },
    },
    fullYaos: [],
    yongShen: [],
    shenSystemByYongShen: [],
    globalShenSha: ['天乙', '月德'],
    warnings: [],
    timeRecommendations: [],
  });

  assert.deepEqual(json.全局神煞, ['天乙', '月德']);
  assert.equal(json.卦级分析.some((line) => /全局神煞/u.test(line)), false);
});

test('liuyao canonical json should preserve selected snapshot fields for non-visible yongshen sources', () => {
  const json = toLiuyaoCanonicalJson({
    question: '测试',
    hexagramName: '水雷屯',
    hexagramGong: '坎',
    hexagramElement: '水',
    ganZhiTime: {
      year: { gan: '甲', zhi: '辰' },
      month: { gan: '丙', zhi: '寅' },
      day: { gan: '戊', zhi: '子' },
      hour: { gan: '庚', zhi: '申' },
      xun: '甲子旬',
    },
    kongWang: { xun: '甲子旬', kongDizhi: ['戌', '亥'] },
    kongWangByPillar: {
      year: { xun: '甲子旬', kongDizhi: ['戌', '亥'] },
      month: { xun: '甲寅旬', kongDizhi: ['子', '丑'] },
      day: { xun: '甲子旬', kongDizhi: ['戌', '亥'] },
      hour: { xun: '甲申旬', kongDizhi: ['午', '未'] },
    },
    fullYaos: [],
    yongShen: [{
      targetLiuQin: '妻财',
      selectionStatus: 'from_changed',
      selectionNote: '变出取用',
      selected: {
        liuQin: '妻财',
        naJia: '午',
        changedNaJia: '午',
        huaType: '回头生',
        element: '火',
        position: 4,
        source: 'changed',
        strength: 'strong',
        strengthLabel: '旺相',
        movementState: 'changing',
        movementLabel: '明动',
        isShiYao: false,
        isYingYao: true,
        kongWangState: 'empty',
        evidence: ['变出取用'],
      },
      candidates: [{
        liuQin: '妻财',
        naJia: '午',
        element: '火',
        position: 4,
        source: 'changed',
        strength: 'strong',
        strengthLabel: '旺相',
        movementState: 'changing',
        movementLabel: '明动',
        isShiYao: false,
        isYingYao: true,
        kongWangState: 'empty',
        evidence: ['并看'],
      }],
    }],
    shenSystemByYongShen: [],
    globalShenSha: [],
    warnings: [],
    timeRecommendations: [],
  });

  const selected = json.用神分析[0]?.已选用神;
  assert.equal(selected?.来源, 'changed');
  assert.equal(selected?.五行, '火');
  assert.equal(selected?.动静状态, 'changing');
  assert.equal(selected?.是否应爻, '是');
  assert.equal(selected?.空亡状态, 'empty');
  assert.equal(json.用神分析[0]?.候选用神?.[0]?.来源, 'changed');
});
