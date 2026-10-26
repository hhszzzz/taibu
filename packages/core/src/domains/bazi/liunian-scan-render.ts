import { withRulesJSON } from '../../shared/calculation-rules.js';
import { drilldownText, omittedLine, omittedSummary, type DrilldownOmittedJSON } from '../shared/drilldown-render.js';
import {
  NATAL_UNKNOWN_TIME_NOTE,
  OMITTED_ORDER,
  ganzhiRelationLine,
  ganzhiRelationRow,
  relationsFilterJSON,
  relationsFilterText,
  type BaziRelationsFilterJSON,
  type GanzhiRelationRowJSON,
} from './relations-render.js';
import type { BaziLiunianScanOutput, BaziLiunianYear } from './liunian-scan.js';

export interface BaziLiunianYearJSON {
  流年: number;
  干支: string;
  天干十神: string;
  地支主气十神: string;
  纳音: string;
  大运?: string;
  小运?: string;
  原局关系: GanzhiRelationRowJSON[];
  大运关系: GanzhiRelationRowJSON[];
  同字牵连?: GanzhiRelationRowJSON[];
  太岁关系?: string[];
  岁运提示?: string[];
}

export interface BaziLiunianScanCanonicalJSON {
  扫描范围: { 起始年: number; 结束年: number; 列出年数: number; };
  筛选?: BaziRelationsFilterJSON;
  原局四柱: Array<{ 柱: string; 干支: string; }>;
  /** 只在出生时辰未知时出现：原局只有年、月、日三柱 */
  出生时辰?: string;
  逐年: BaziLiunianYearJSON[];
  未列出?: DrilldownOmittedJSON;
  口径: string[];
}

const SCAN_NOTES = [
  '只列流年与原局、与大运（起运前为小运）的干支关系事实，不判断吉凶',
  '流年按公历年份取干支，所在大运按起运年份划分，与 bazi_dayun 同口径',
  '大运与原局之间的关系每年相同，逐年不重复列出；需要时用 bazi_relations 查询',
  '给出 pillars 时只列同时涉及所列各柱（与流年）的关系，给出 types 时只列这些类型，并只列出有命中的年份；与所列关系共用同一字的流年关系列为牵连，其余计入未列出；岁运提示与太岁关系只按柱位筛，太岁只在柱位不超出年柱时列出',
  '关系判定口径同 bazi_relations：不计拱合、暗合、半会，天克地冲取天干相冲且地支六冲',
];

const OMITTED_HINT = '去掉 pillars 或 types 可看全部；某一年的完整关系用 bazi_relations 传 year';

function yearJSON(item: BaziLiunianYear): BaziLiunianYearJSON {
  return {
    流年: item.year,
    干支: `${item.pillar.stem}${item.pillar.branch}`,
    天干十神: item.pillar.stemTenGod,
    地支主气十神: item.pillar.branchTenGod,
    纳音: item.pillar.naYin,
    ...(item.fortune ? { [item.fortune.layer]: `${item.fortune.ganZhi}（${item.fortune.label}）` } : {}),
    原局关系: item.natalRelations.map(ganzhiRelationRow),
    大运关系: item.fortuneRelations.map(ganzhiRelationRow),
    ...(item.linkedRelations?.length ? { 同字牵连: item.linkedRelations.map(ganzhiRelationRow) } : {}),
    ...(item.taiSui.length ? { 太岁关系: [...item.taiSui] } : {}),
    ...(item.fortuneHints.length ? { 岁运提示: [...item.fortuneHints] } : {}),
  };
}

function renderScanJSONBase(result: BaziLiunianScanOutput): BaziLiunianScanCanonicalJSON {
  const omitted = result.omitted && omittedSummary(result.omitted, OMITTED_HINT, OMITTED_ORDER);
  return {
    扫描范围: { 起始年: result.range.fromYear, 结束年: result.range.toYear, 列出年数: result.range.matchedYears },
    ...(result.filter ? { 筛选: relationsFilterJSON(result.filter) } : {}),
    原局四柱: result.natal.map((p) => ({ 柱: p.label, 干支: p.ganZhi })),
    ...(result.birthTimeUnknown ? { 出生时辰: NATAL_UNKNOWN_TIME_NOTE } : {}),
    逐年: result.years.map(yearJSON),
    ...(omitted ? { 未列出: omitted } : {}),
    口径: SCAN_NOTES,
  };
}

/**
 * 原局四柱在命盘里已有，不再重写；默认每年只写十神（纳音在 full 时给出）；
 * 所在大运只在与上一个列出的年份不同时写出；关系一行一条，牵连关系前标「牵连」
 */
function renderScanTextBase(result: BaziLiunianScanOutput, full: boolean): string {
  const range = result.range;
  const lines = [
    '# 八字流年扫描', '',
    '## 扫描范围', '',
    `- ${range.fromYear}–${range.toYear} 年${result.filter ? `，筛选：${relationsFilterText(result.filter)}` : ''}，列出 ${range.matchedYears} 年`,
  ];
  if (result.birthTimeUnknown) lines.push(`- 出生时辰：${NATAL_UNKNOWN_TIME_NOTE}`);
  if (result.years.some((item) => item.linkedRelations?.length)) lines.push('- 牵连：不在筛选内、但与所列关系共用同一字的流年关系，须一并看');
  let fortune = '';
  for (const item of result.years) {
    lines.push('', `## ${item.year} ${item.pillar.stem}${item.pillar.branch}`, '');
    lines.push(`- 十神：天干${item.pillar.stemTenGod || '-'}，地支主气${item.pillar.branchTenGod || '-'}${full ? `；纳音${item.pillar.naYin || '-'}` : ''}`);
    const current = item.fortune ? `- ${item.fortune.layer}：${item.fortune.ganZhi}（${item.fortune.label}）` : '';
    if (current && current !== fortune) lines.push(current);
    fortune = current;
    lines.push(...item.natalRelations.map(ganzhiRelationLine), ...item.fortuneRelations.map(ganzhiRelationLine));
    if (!item.natalRelations.length && !item.fortuneRelations.length) lines.push(result.filter ? '- 关系：筛选范围内无' : '- 关系：无');
    lines.push(...(item.linkedRelations ?? []).map((fact) => ganzhiRelationLine(fact).replace(/^- /, '- 牵连：')));
    if (item.taiSui.length) lines.push(`- 太岁：${item.taiSui.join('、')}`);
    if (item.fortuneHints.length) lines.push(...item.fortuneHints.map((hint) => `- 岁运：${hint}`));
  }
  if (!result.years.length) lines.push('', '## 逐年', '', '- 范围内没有符合筛选的年份');
  const omitted = result.omitted && omittedSummary(result.omitted, OMITTED_HINT, OMITTED_ORDER);
  if (omitted) lines.push('', '## 未列出', '', omittedLine(omitted));
  return lines.join('\n');
}

export const toBaziLiunianScanJson = withRulesJSON(renderScanJSONBase);
export const toBaziLiunianScanText = drilldownText(SCAN_NOTES, renderScanTextBase);
