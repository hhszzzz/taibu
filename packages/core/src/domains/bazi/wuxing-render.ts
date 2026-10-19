import { withRulesJSON, withRulesText } from '../../shared/calculation-rules.js';
import type { GanzhiRelationRowJSON } from './relations-render.js';
import type { BaziWuxingOutput, WuxingFact } from './wuxing.js';

export interface BaziWuxingCanonicalJSON {
  日主: { 天干: string; 五行: string; };
  五行统计: Array<{ 五行: string; 天干: number; 地支: number; 藏干: number; 合计: number; }>;
  缺失五行: string[];
  月令: { 月支: string; 月令五行: string; 旺: string; 相: string; 休: string; 囚: string; 死: string; 日主状态: string; };
  通根: GanzhiRelationRowJSON[];
  透干: GanzhiRelationRowJSON[];
  干支自坐: GanzhiRelationRowJSON[];
  相邻天干: GanzhiRelationRowJSON[];
  相生链: { 顺序: string; 出现: string[]; 连续段: string[]; 中断: string[]; };
  十神分布: Array<{ 十神: string; 天干: string[]; 藏干: string[]; }>;
  口径: string[];
}

const WUXING_NOTES = [
  '只列五行与生克事实，不判断身强身弱、格局或喜用神',
  '五行统计：天干、地支本气各计 1，藏干按顺序计 0.6 / 0.3 / 0.1，与八字命盘五行统计同口径',
  '月令旺衰：同月令五行者旺，月令所生者相，生月令者休，克月令者囚，月令所克者死；辰戌丑未月以土论',
  '通根取地支藏干中与日主同五行者（本气、中气、余气）；透干取藏干原字见于天干',
  '相生链按木→火→土→金→水的相生顺序，五行（含藏干）出现即视为在链上，不论多寡与远近',
];

function row(fact: WuxingFact): GanzhiRelationRowJSON {
  return {
    类型: fact.type,
    位置: fact.cells.map((cell) => ({ 柱: cell.pillar, 部位: cell.part, 字: cell.char })),
    ...(fact.result ? { 结果: fact.result } : {}),
    说明: fact.description,
  };
}

function renderBaziWuxingJSONBase(result: BaziWuxingOutput): BaziWuxingCanonicalJSON {
  const month = result.monthCommand;
  return {
    日主: { 天干: result.dayMaster.stem, 五行: result.dayMaster.element },
    五行统计: result.elementStats.map((item) => ({ 五行: item.element, 天干: item.stems, 地支: item.branches, 藏干: item.hiddenStems, 合计: item.total })),
    缺失五行: [...result.missingElements],
    月令: { 月支: month.branch, 月令五行: month.element, ...month.states, 日主状态: month.dayMasterState },
    通根: result.roots.map(row),
    透干: result.revealed.map(row),
    干支自坐: result.pillarSelf.map(row),
    相邻天干: result.adjacentStems.map(row),
    相生链: {
      顺序: result.generatingChain.order.join('→'),
      出现: [...result.generatingChain.present],
      连续段: [...result.generatingChain.segments],
      中断: [...result.generatingChain.breaks],
    },
    十神分布: result.tenGods.map((item) => ({ 十神: item.tenGod, 天干: [...item.stems], 藏干: [...item.hiddenStems] })),
    口径: WUXING_NOTES,
  };
}

const factLines = (facts: WuxingFact[]) => facts.length ? facts.map((fact) => `- ${fact.type}｜${fact.description}${fact.result ? `｜${fact.result}` : ''}`) : ['- 无'];

function renderBaziWuxingTextBase(result: BaziWuxingOutput): string {
  const month = result.monthCommand;
  const lines = [
    '# 八字五行流通详查', '',
    '## 日主', '', `- ${result.dayMaster.stem}${result.dayMaster.element}，于${month.branch}月为${month.dayMasterState}`, '',
    '## 五行统计', '', '| 五行 | 天干 | 地支本气 | 藏干 | 合计 |', '|------|------|----------|------|------|',
    ...result.elementStats.map((item) => `| ${item.element} | ${item.stems} | ${item.branches} | ${item.hiddenStems} | ${item.total} |`),
    ...(result.missingElements.length ? ['', `- 缺失：${result.missingElements.join('、')}`] : []),
    '', '## 月令', '', `- 月支${month.branch}（${month.element}）：${(['旺', '相', '休', '囚', '死'] as const).map((state) => `${month.states[state]}${state}`).join('，')}`,
    '', '## 通根', '', ...factLines(result.roots),
    '', '## 透干', '', ...factLines(result.revealed),
    '', '## 干支自坐', '', ...factLines(result.pillarSelf),
    '', '## 相邻天干', '', ...factLines(result.adjacentStems),
    '', '## 相生链', '',
    `- 出现：${result.generatingChain.present.join('、') || '无'}`,
    ...(result.generatingChain.segments.length ? [`- 连续：${result.generatingChain.segments.join('；')}`] : []),
    ...(result.generatingChain.breaks.length ? [`- 中断：${result.generatingChain.breaks.join('；')}`] : []),
    '', '## 十神分布', '',
    ...result.tenGods.map((item) => `- ${item.tenGod}｜天干：${item.stems.join('、') || '无'}｜藏干：${item.hiddenStems.join('、') || '无'}`),
    '', '## 口径', '', ...WUXING_NOTES.map((note) => `- ${note}`),
  ];
  return lines.join('\n');
}

export const toBaziWuxingJson = withRulesJSON(renderBaziWuxingJSONBase);
export const toBaziWuxingText = withRulesText(renderBaziWuxingTextBase);
