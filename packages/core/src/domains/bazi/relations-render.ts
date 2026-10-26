import { withRulesJSON } from '../../shared/calculation-rules.js';
import { drilldownText, omittedLine, omittedSummary, type DrilldownOmittedJSON } from '../shared/drilldown-render.js';
import { GANZHI_RELATION_TYPES, type GanzhiRelationFact } from '../shared/ganzhi-relations.js';
import type { BaziRelationsFilter, BaziRelationsOutput, BaziRelationsQuery } from './relations.js';

export interface GanzhiRelationRowJSON {
  类型: string;
  位置: Array<{ 柱: string; 部位: '天干' | '地支'; 字: string; }>;
  结果?: string;
  说明: string;
}

/** 给出 pillars / types 时的筛选条件 */
export interface BaziRelationsFilterJSON {
  柱位?: string[];
  类型?: string[];
}

export interface BaziRelationsCanonicalJSON {
  查询: Record<string, string | number>;
  筛选?: BaziRelationsFilterJSON;
  /** 原局四柱与叠加柱；原局四柱只作连线与定位用，文本只写叠加柱 */
  参与柱位: Array<{ 柱: string; 层: string; 干支: string; 天干十神: string; 地支主气十神: string; 纳音: string; }>;
  /** 至少涉及一个叠加柱的关系；原局之间的关系见八字命盘的干支关系 */
  叠加关系: GanzhiRelationRowJSON[];
  同字牵连?: GanzhiRelationRowJSON[];
  岁运提示?: string[];
  太岁关系?: string[];
  未列出?: DrilldownOmittedJSON;
  口径: string[];
}

const RELATION_NOTES = [
  '只列干支关系事实，不判断吉凶与喜忌',
  '只列至少涉及一个叠加柱（大运或小运、流年、流月、流日）的关系；原局四柱之间的关系见八字命盘的干支关系，同一字上的原局合冲须与之一并看',
  '不计拱合、暗合、半会；半合在第三支出现于任一柱时不报（已成三合）',
  '三刑：寅巳申无恩、丑戌未恃势、子卯无礼；辰午酉亥自刑须两支同见',
  '天克地冲取天干相冲（甲庚、乙辛、丙壬、丁癸）且地支六冲，亦称反吟；伏吟取干支全同',
  '流年按公历年份取干支（与大运流年同口径）；流日按当日正午的立春、节气换年换月',
  '给出 pillars 时只列同时涉及所列各柱的关系（「大运」在起运前指小运），给出 types 时只列这些类型；与所列关系共用同一字的其他叠加关系列入同字牵连，其余计入未列出；岁运提示与太岁关系只按柱位筛',
];

const OMITTED_HINT = '去掉 pillars 或 types 可看全部';
/** 未列出按关系类型的固定顺序计数，岁运提示与太岁关系殿后 */
export const OMITTED_ORDER: readonly string[] = [...GANZHI_RELATION_TYPES, '岁运提示', '太岁关系'];

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

export function relationsFilterJSON(filter: BaziRelationsFilter): BaziRelationsFilterJSON {
  return { ...(filter.pillars ? { 柱位: [...filter.pillars] } : {}), ...(filter.types ? { 类型: [...filter.types] } : {}) };
}

/** 「同时涉及 日柱、流年；类型 六冲」 */
export function relationsFilterText(filter: BaziRelationsFilter): string {
  const pillars = filter.pillars && `${filter.pillars.length > 1 ? '同时涉及' : '涉及'} ${filter.pillars.join('、')}`;
  const types = filter.types && `类型 ${filter.types.join('、')}`;
  return [pillars, types].filter(Boolean).join('；');
}

/** 出生时辰未知的命盘上详查：原局没有时柱，关系里也就没有时柱 */
export const NATAL_UNKNOWN_TIME_NOTE = '未知（原局只有年、月、日三柱，关系不含时柱）';

/** 同字牵连的段名：说明这些关系为何在筛选之外仍然列出 */
export const LINKED_SECTION = '同字牵连（不在筛选内，与上列关系共用同一字，须一并看）';

function queryJSON(query: BaziRelationsQuery): Record<string, string | number> {
  return {
    ...(query.dayun ? { 大运: `第${query.dayun.index}步 ${query.dayun.ganZhi}（${query.dayun.startYear}–${query.dayun.endYear}，${query.dayun.startAge}岁起）${query.dayun.note ? `；${query.dayun.note}` : ''}` } : {}),
    ...(query.xiaoYun ? { 小运: `${query.xiaoYun.ganZhi}（虚岁${query.xiaoYun.age}，起运前）` } : {}),
    ...(query.year !== undefined ? { 流年: query.year } : {}),
    ...(query.month ? { 流月: `${query.month.ganZhi}月（${query.month.jieQi}起，${query.month.startDate} 至 ${query.month.endDate}）` } : {}),
    ...(query.day ? { 流日: query.day } : {}),
    ...(query.birthTimeUnknown ? { 出生时辰: NATAL_UNKNOWN_TIME_NOTE } : {}),
  };
}

function renderBaziRelationsJSONBase(result: BaziRelationsOutput): BaziRelationsCanonicalJSON {
  const omitted = result.omitted && omittedSummary(result.omitted, OMITTED_HINT, OMITTED_ORDER);
  return {
    查询: queryJSON(result.query),
    ...(result.filter ? { 筛选: relationsFilterJSON(result.filter) } : {}),
    参与柱位: result.pillars.map((p) => ({
      柱: p.label, 层: p.layer, 干支: `${p.stem}${p.branch}`, 天干十神: p.stemTenGod, 地支主气十神: p.branchTenGod, 纳音: p.naYin,
    })),
    叠加关系: result.overlayRelations.map(ganzhiRelationRow),
    ...(result.linkedRelations?.length ? { 同字牵连: result.linkedRelations.map(ganzhiRelationRow) } : {}),
    ...(result.fortuneHints.length ? { 岁运提示: result.fortuneHints.map((hint) => hint.description) } : {}),
    ...(result.taiSui.length ? { 太岁关系: [...result.taiSui] } : {}),
    ...(omitted ? { 未列出: omitted } : {}),
    口径: RELATION_NOTES,
  };
}

/**
 * 原局四柱及其关系在命盘里已有，文本只写叠加柱的十神（full 时加纳音）与叠加关系。
 * 筛选后某段为空写「筛选范围内无」，不让读者误以为全盘都没有。
 */
function renderBaziRelationsTextBase(result: BaziRelationsOutput, full: boolean): string {
  const query = queryJSON(result.query);
  const none = result.filter ? '- 筛选范围内无' : '- 无';
  const lines = ['# 八字岁运刑冲合害详查', '', '## 查询', ''];
  lines.push(...Object.entries(query).map(([key, value]) => `- ${key}：${value}`));
  if (result.filter) lines.push(`- 筛选：${relationsFilterText(result.filter)}`);
  lines.push('', '## 叠加柱位', '');
  for (const p of result.pillars.filter((item) => item.layer !== '原局')) {
    lines.push(`- ${p.label} ${p.stem}${p.branch}：天干${p.stemTenGod || '-'}，地支主气${p.branchTenGod || '-'}${full ? `；纳音${p.naYin || '-'}` : ''}`);
  }
  lines.push('', '## 叠加关系', '', ...(result.overlayRelations.length ? result.overlayRelations.map(ganzhiRelationLine) : [none]));
  if (result.linkedRelations?.length) lines.push('', `## ${LINKED_SECTION}`, '', ...result.linkedRelations.map(ganzhiRelationLine));
  if (result.fortuneHints.length) lines.push('', '## 岁运提示', '', ...result.fortuneHints.map((hint) => `- ${hint.description}`));
  if (result.taiSui.length) lines.push('', '## 太岁关系', '', `- ${result.taiSui.join('、')}`);
  const omitted = result.omitted && omittedSummary(result.omitted, OMITTED_HINT, OMITTED_ORDER);
  if (omitted) lines.push('', '## 未列出', '', omittedLine(omitted));
  return lines.join('\n');
}

export const toBaziRelationsJson = withRulesJSON(renderBaziRelationsJSONBase);
export const toBaziRelationsText = drilldownText(RELATION_NOTES, renderBaziRelationsTextBase);
