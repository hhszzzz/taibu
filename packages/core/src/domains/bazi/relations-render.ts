import { withRulesJSON, withRulesText } from '../../shared/calculation-rules.js';
import type { GanzhiRelationFact } from '../shared/ganzhi-relations.js';
import type { BaziRelationsOutput, BaziRelationsQuery } from './relations.js';

export interface GanzhiRelationRowJSON {
  类型: string;
  位置: Array<{ 柱: string; 部位: '天干' | '地支'; 字: string; }>;
  结果?: string;
  说明: string;
}

export interface BaziRelationsCanonicalJSON {
  查询: Record<string, string | number>;
  参与柱位: Array<{ 柱: string; 层: string; 干支: string; 天干十神: string; 地支主气十神: string; 纳音: string; }>;
  原局关系: GanzhiRelationRowJSON[];
  叠加关系?: GanzhiRelationRowJSON[];
  岁运提示?: string[];
  太岁关系?: string[];
  口径: string[];
}

const RELATION_NOTES = [
  '只列干支关系事实，不判断吉凶与喜忌',
  '不计拱合、暗合、半会；半合在第三支出现于任一柱时不报（已成三合）',
  '三刑：寅巳申无恩、丑戌未恃势、子卯无礼；辰午酉亥自刑须两支同见',
  '天克地冲取天干相冲（甲庚、乙辛、丙壬、丁癸）且地支六冲，亦称反吟；伏吟取干支全同',
  '流年按公历年份取干支（与大运流年同口径）；流日按当日正午的立春、节气换年换月',
];

export function ganzhiRelationRow(fact: GanzhiRelationFact): GanzhiRelationRowJSON {
  return {
    类型: fact.type,
    位置: fact.participants.map((p) => ({ 柱: p.label, 部位: p.part, 字: p.char })),
    ...(fact.result ? { 结果: fact.result } : {}),
    说明: fact.description,
  };
}

/** 文本行：类型｜参与｜说明，参与写作「年柱地支子·流年地支午」 */
export function ganzhiRelationLine(fact: GanzhiRelationFact): string {
  const members = fact.participants.map((p) => `${p.label}${p.part}${p.char}`).join('·');
  return `- ${fact.type}｜${members}｜${fact.description}`;
}

function queryJSON(query: BaziRelationsQuery): Record<string, string | number> {
  return {
    ...(query.dayun ? { 大运: `第${query.dayun.index}步 ${query.dayun.ganZhi}（${query.dayun.startYear}–${query.dayun.endYear}，${query.dayun.startAge}岁起）` } : {}),
    ...(query.xiaoYun ? { 小运: `${query.xiaoYun.ganZhi}（虚岁${query.xiaoYun.age}，起运前）` } : {}),
    ...(query.year !== undefined ? { 流年: query.year } : {}),
    ...(query.month ? { 流月: `${query.month.ganZhi}月（${query.month.jieQi}起，${query.month.startDate} 至 ${query.month.endDate}）` } : {}),
    ...(query.day ? { 流日: query.day } : {}),
  };
}

function renderBaziRelationsJSONBase(result: BaziRelationsOutput): BaziRelationsCanonicalJSON {
  return {
    查询: queryJSON(result.query),
    参与柱位: result.pillars.map((p) => ({
      柱: p.label, 层: p.layer, 干支: `${p.stem}${p.branch}`, 天干十神: p.stemTenGod, 地支主气十神: p.branchTenGod, 纳音: p.naYin,
    })),
    原局关系: result.natalRelations.map(ganzhiRelationRow),
    ...(result.pillars.length > 4 ? { 叠加关系: result.overlayRelations.map(ganzhiRelationRow) } : {}),
    ...(result.fortuneHints.length ? { 岁运提示: [...result.fortuneHints] } : {}),
    ...(result.taiSui.length ? { 太岁关系: [...result.taiSui] } : {}),
    口径: RELATION_NOTES,
  };
}

function renderBaziRelationsTextBase(result: BaziRelationsOutput): string {
  const query = queryJSON(result.query);
  const lines = ['# 八字刑冲合害详查', '', '## 查询', ''];
  lines.push(...(Object.keys(query).length ? Object.entries(query).map(([key, value]) => `- ${key}：${value}`) : ['- 仅原局']));
  lines.push('', '## 参与柱位', '', '| 柱 | 层 | 干支 | 天干十神 | 地支主气十神 | 纳音 |', '|----|----|------|----------|--------------|------|');
  for (const p of result.pillars) {
    lines.push(`| ${p.label} | ${p.layer} | ${p.stem}${p.branch} | ${p.stemTenGod || '-'} | ${p.branchTenGod || '-'} | ${p.naYin || '-'} |`);
  }
  lines.push('', '## 原局关系', '', ...(result.natalRelations.length ? result.natalRelations.map(ganzhiRelationLine) : ['- 无']));
  if (result.pillars.length > 4) {
    lines.push('', '## 叠加关系', '', ...(result.overlayRelations.length ? result.overlayRelations.map(ganzhiRelationLine) : ['- 无']));
  }
  if (result.fortuneHints.length) lines.push('', '## 岁运提示', '', ...result.fortuneHints.map((hint) => `- ${hint}`));
  if (result.taiSui.length) lines.push('', '## 太岁关系', '', `- ${result.taiSui.join('、')}`);
  lines.push('', '## 口径', '', ...RELATION_NOTES.map((note) => `- ${note}`));
  return lines.join('\n');
}

export const toBaziRelationsJson = withRulesJSON(renderBaziRelationsJSONBase);
export const toBaziRelationsText = withRulesText(renderBaziRelationsTextBase);
