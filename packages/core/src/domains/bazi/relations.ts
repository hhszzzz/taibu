/**
 * 八字岁运刑冲合害详查：原局四柱叠加大运/小运、流年、流月、流日，
 * 列出至少涉及一个叠加柱的干支关系、岁运提示与太岁，只陈述事实，不下吉凶结论。
 * 原局四柱之间的关系已在八字命盘的干支关系里，这里不再重复。
 * 可按柱位、关系类型筛选；筛选不丢同一字上的其他叠加关系（同字牵连），其余计入「未列出」。
 */

import { Solar } from 'lunar-javascript';
import { HIDDEN_STEM_DETAILS } from '../../data/shensha.js';
import { calculateTenGod } from '../../shared/utils.js';
import { CoreInputError, assertInteger, parseCivilDate, resolveEnumList } from '../../shared/validation.js';
import { calculateDayunData, calculateTaiSui, getYearGanZhi } from '../bazi-dayun/calculate.js';
import type { DayunOutput } from '../bazi-dayun/types.js';
import {
  analyzeGanzhiRelations,
  GANZHI_RELATION_TYPES,
  type GanzhiLayer,
  type GanzhiPillar,
  type GanzhiRelationFact,
  type GanzhiRelationParticipant,
  type GanzhiRelationType,
} from '../shared/ganzhi-relations.js';
import { calculateBaziLiuYueData, getNaYin } from './calculate.js';
import type { BaziInput, BaziOutput } from './types.js';

export const BAZI_RELATIONS_RULE_VERSION = 'bazi-relations-2026.10';
/** 可筛选的柱位；「大运」在起运前指小运 */
export const BAZI_RELATION_PILLARS = ['年柱', '月柱', '日柱', '时柱', '大运', '流年', '流月', '流日'] as const;
export type BaziRelationPillar = typeof BAZI_RELATION_PILLARS[number];

export interface BaziRelationsFilter {
  /** 只留同时涉及所列全部柱位的关系 */
  pillars?: BaziRelationPillar[];
  /** 只留这些类型的关系；岁运提示与太岁关系不按类型筛 */
  types?: GanzhiRelationType[];
}

export interface BaziRelationsSelector extends BaziRelationsFilter {
  /** 流年（公历年份，按大运流年同口径取干支） */
  year?: number;
  /** 流月：节气月序号 1–12（1=寅月，自立春起），须同时给出 year */
  month?: number;
  /** 流日 YYYY-MM-DD；按当日正午取立春换年、节气换月，与 year/month 互斥 */
  day?: string;
  /** 大运序号 1–10；省略时按流年自动落入所在大运 */
  dayun?: number;
  yunSect?: 1 | 2;
}

export interface BaziRelationsPillar {
  label: string;
  layer: GanzhiLayer;
  stem: string;
  branch: string;
  stemTenGod: string;
  branchTenGod: string;
  naYin: string;
}

export interface BaziRelationsQuery {
  dayun?: { index: number; ganZhi: string; startYear: number; endYear: number; startAge: number; };
  xiaoYun?: { age: number; ganZhi: string; };
  year?: number;
  month?: { index: number; ganZhi: string; jieQi: string; startDate: string; endDate: string; };
  day?: string;
}

/** 岁运提示：伏吟（干支全同；大运与流年伏吟即岁运并临）、天克地冲（天干相冲且地支六冲） */
export interface BaziFortuneHint {
  type: '伏吟' | '岁运并临' | '天克地冲';
  /** 涉及的两柱，叠加在后的柱在前 */
  labels: [string, string];
  description: string;
}

export interface BaziRelationsOutput {
  query: BaziRelationsQuery;
  /** 给出 pillars 或 types 时的筛选条件 */
  filter?: BaziRelationsFilter;
  pillars: BaziRelationsPillar[];
  /** 至少涉及一个叠加柱的关系；原局之间的关系见命盘 */
  overlayRelations: GanzhiRelationFact[];
  /** 筛选时：未入选、但与入选关系共用同一字（同柱同部位）的关系 */
  linkedRelations?: GanzhiRelationFact[];
  fortuneHints: BaziFortuneHint[];
  taiSui: string[];
  /** 筛选时其余没有列出的事实，每条记一个类型（关系类型、「岁运提示」或「太岁关系」） */
  omitted?: string[];
  calculationOptions: Record<string, unknown> & { ruleVersion: string; };
}

const NATAL_LABELS = ['年柱', '月柱', '日柱', '时柱'] as const;

function tenGods(dayStem: string, stem: string, branch: string, isDayPillar: boolean) {
  const mainStem = HIDDEN_STEM_DETAILS[branch]?.[0]?.stem;
  return {
    stemTenGod: isDayPillar ? '日主' : calculateTenGod(dayStem, stem),
    branchTenGod: mainStem ? calculateTenGod(dayStem, mainStem) : '',
  };
}

/** 公历出生年：首步大运的起运年份减去虚岁起运年龄再加一 */
export function solarYearOfDayun(dayun: DayunOutput): number | undefined {
  const first = dayun.list[0];
  return first ? first.startYear - first.startAge + 1 : undefined;
}

function resolveDay(day: string) {
  const { year, month, day: date } = parseCivilDate(day, 'day');
  const lunar = Solar.fromYmdHms(year, month, date, 12, 0, 0).getLunar();
  const yearGanZhi = lunar.getYearInGanZhiExact();
  // 立春前的日子仍属上一流年
  const flowYear = getYearGanZhi(year) === yearGanZhi ? year : year - 1;
  return { flowYear, yearGanZhi, monthGanZhi: lunar.getMonthInGanZhiExact(), dayGanZhi: lunar.getDayInGanZhi() };
}

function validateSelector(selector: BaziRelationsSelector): void {
  if (selector.year === undefined && selector.day === undefined && selector.dayun === undefined) {
    throw new CoreInputError('year', '原局四柱之间的关系已在八字命盘的「干支关系」中列出；本工具查叠加大运、流年、流月或流日后的关系，须给出 year、day 或 dayun');
  }
  if (selector.year !== undefined) assertInteger(selector.year, 'year', 1, 9998);
  if (selector.month !== undefined) {
    assertInteger(selector.month, 'month', 1, 12);
    if (selector.year === undefined) throw new CoreInputError('month', '查询流月时必须同时给出 year');
  }
  if (selector.day !== undefined && (selector.year !== undefined || selector.month !== undefined)) {
    throw new CoreInputError('day', 'day 与 year/month 不能同时使用');
  }
  if (selector.dayun !== undefined) assertInteger(selector.dayun, 'dayun', 1, 10);
}

/** 筛选条件：去重、校验取值；都没给时返回 undefined */
export function resolveRelationsFilter(
  selector: BaziRelationsFilter,
  choices: readonly BaziRelationPillar[] = BAZI_RELATION_PILLARS,
): BaziRelationsFilter | undefined {
  const pillars = resolveEnumList(selector.pillars, choices, 'pillars');
  const types = resolveEnumList(selector.types, GANZHI_RELATION_TYPES, 'types');
  if (!pillars && !types) return undefined;
  return { ...(pillars ? { pillars } : {}), ...(types ? { types } : {}) };
}

/** 柱名集合是否含所筛柱位；「大运」也指起运前的小运 */
export function coversPillar(labels: readonly string[], pillar: BaziRelationPillar): boolean {
  return labels.includes(pillar) || (pillar === '大运' && labels.includes('小运'));
}

const cellKey = (participant: GanzhiRelationParticipant) => `${participant.label}${participant.part}`;

export interface RelationSelection {
  kept: GanzhiRelationFact[];
  /** 未入选、但与入选关系共用同一字（同柱同部位）的关系 */
  linked: GanzhiRelationFact[];
  rest: GanzhiRelationFact[];
}

/**
 * 按柱位（须同时涉及所列各柱）与类型筛选关系。
 * 同一字上合、冲、刑并见时，合能否解冲各派说法不一，但都要一起看，所以与入选关系共用一字的关系不随筛选丢掉。
 */
export function selectRelations(facts: readonly GanzhiRelationFact[], filter: BaziRelationsFilter): RelationSelection {
  const matches = (fact: GanzhiRelationFact) => (filter.pillars ?? []).every((pillar) => coversPillar(fact.participants.map((p) => p.label), pillar))
    && (!filter.types || filter.types.includes(fact.type));
  const kept = facts.filter(matches);
  const cells = new Set(kept.flatMap((fact) => fact.participants.map(cellKey)));
  const others = facts.filter((fact) => !kept.includes(fact));
  const linked = others.filter((fact) => fact.participants.some((p) => cells.has(cellKey(p))));
  return { kept, linked, rest: others.filter((fact) => !linked.includes(fact)) };
}

/** 所筛柱位不在本次参与柱位时，说明该补哪个查询参数 */
function missingPillarHint(pillar: BaziRelationPillar): string {
  switch (pillar) {
    // 查询必含 year、day 或 dayun，缺大运只会是流年落在大运与小运之外
    case '大运': return '该流年不在任何一步大运或小运内';
    case '流年': return '查流年须同时给出 year 或 day';
    case '流月': return '查流月须同时给出 year 与 month，或 day';
    case '流日': return '查流日须改用 day（YYYY-MM-DD，与 year、month 互斥）';
    default: return '';
  }
}

export function deriveBaziRelations(
  chart: BaziOutput,
  selector: BaziRelationsSelector,
  baseInput: BaziInput,
  /** 逐年扫描时复用同一份大运，避免每年重排 */
  precomputedDayun?: DayunOutput,
): BaziRelationsOutput {
  validateSelector(selector);
  const filter = resolveRelationsFilter(selector);
  const dayStem = chart.dayMaster;
  const natal = [chart.fourPillars.year, chart.fourPillars.month, chart.fourPillars.day, chart.fourPillars.hour];
  const pillars: GanzhiPillar[] = natal.map((p, i) => ({ label: NATAL_LABELS[i], layer: '原局', stem: p.stem, branch: p.branch }));
  const query: BaziRelationsQuery = {};
  const fortuneHints: BaziFortuneHint[] = [];
  const add = (label: string, layer: GanzhiLayer, ganZhi: string) => {
    pillars.push({ label, layer, stem: ganZhi[0], branch: ganZhi[1] });
    return ganZhi;
  };

  const day = selector.day === undefined ? undefined : resolveDay(selector.day);
  const flowYear = day?.flowYear ?? selector.year;
  const needsFortune = flowYear !== undefined || selector.dayun !== undefined;
  const dayun = needsFortune
    ? precomputedDayun ?? calculateDayunData({ ...baseInput, ...(selector.yunSect ? { yunSect: selector.yunSect } : {}) })
    : undefined;

  if (dayun) {
    const birthYear = solarYearOfDayun(dayun);
    if (flowYear !== undefined && birthYear !== undefined && flowYear < birthYear) {
      throw new CoreInputError(day ? 'day' : 'year', `流年不能早于出生年 ${birthYear}`);
    }
    const located = flowYear === undefined
      ? -1
      : dayun.list.findIndex((item, i) => item.startYear <= flowYear && flowYear < (dayun.list[i + 1]?.startYear ?? item.startYear + 10));
    const index = selector.dayun !== undefined ? selector.dayun - 1 : located;
    if (selector.dayun !== undefined) {
      if (index >= dayun.list.length) throw new CoreInputError('dayun', `只有 ${dayun.list.length} 步大运`);
      if (flowYear !== undefined && located !== index) throw new CoreInputError('dayun', `${flowYear} 年不在第 ${selector.dayun} 步大运内`);
    }
    if (index >= 0) {
      const item = dayun.list[index];
      add('大运', '大运', item.ganZhi);
      const next = dayun.list[index + 1];
      query.dayun = { index: index + 1, ganZhi: item.ganZhi, startYear: item.startYear, endYear: next ? next.startYear - 1 : item.startYear + 9, startAge: item.startAge };
    } else if (flowYear !== undefined && birthYear !== undefined) {
      const age = flowYear - birthYear + 1;
      const xiaoYun = dayun.xiaoYun.find((item) => item.age === age);
      if (xiaoYun) {
        add('小运', '小运', xiaoYun.ganZhi);
        query.xiaoYun = { age, ganZhi: xiaoYun.ganZhi };
      }
    }
  }

  let yearGanZhi: string | undefined;
  if (flowYear !== undefined) {
    query.year = flowYear;
    yearGanZhi = add('流年', '流年', day?.yearGanZhi ?? getYearGanZhi(flowYear));
  }
  if (selector.month !== undefined && selector.year !== undefined) {
    const month = calculateBaziLiuYueData(selector.year)[selector.month - 1];
    query.month = { index: selector.month, ganZhi: month.ganZhi, jieQi: month.jieQi, startDate: month.startDate, endDate: month.endDate };
    add('流月', '流月', month.ganZhi);
  }
  if (day && selector.day) {
    query.day = selector.day;
    add('流月', '流月', day.monthGanZhi);
    add('流日', '流日', day.dayGanZhi);
  }

  const labels = pillars.map((p) => p.label);
  const missing = filter?.pillars?.find((pillar) => !coversPillar(labels, pillar));
  if (missing) {
    throw new CoreInputError('pillars', `本次查询没有「${missing}」柱（参与柱位：${labels.join('、')}）；${missingPillarHint(missing)}`);
  }

  const overlayIndices = pillars.map((_, i) => i).slice(NATAL_LABELS.length);
  const overlayRelations = overlayIndices.length > 0 ? analyzeGanzhiRelations(pillars, { focus: overlayIndices }) : [];

  // 岁运提示：伏吟（干支全同）、天克地冲（天干相冲且地支六冲，亦称反吟）、岁运并临
  for (const i of overlayIndices) {
    for (let j = 0; j < i; j++) {
      const a = pillars[j], b = pillars[i];
      const pair: [string, string] = [b.label, a.label];
      if (a.stem === b.stem && a.branch === b.branch) {
        fortuneHints.push(a.layer === '大运' && b.layer === '流年'
          ? { type: '岁运并临', labels: pair, description: `岁运并临（大运与流年同为${b.stem}${b.branch}）` }
          : { type: '伏吟', labels: pair, description: `${b.label}伏吟${a.label}（同为${b.stem}${b.branch}）` });
        continue;
      }
      const clash = overlayRelations.filter((f) => f.participants.some((p) => p.index === i) && f.participants.some((p) => p.index === j));
      if (clash.some((f) => f.type === '天干相冲') && clash.some((f) => f.type === '六冲')) {
        fortuneHints.push({ type: '天克地冲', labels: pair, description: `${b.label}与${a.label}天克地冲（${b.stem}${b.branch}对${a.stem}${a.branch}，亦称反吟）` });
      }
    }
  }

  const taiSui = yearGanZhi ? calculateTaiSui(yearGanZhi[1], chart.fourPillars.year.branch) : [];
  const selected = filter ? selectBaziRelations(overlayRelations, fortuneHints, taiSui, filter) : undefined;
  const rows: BaziRelationsPillar[] = pillars.map((p, i) => ({
    label: p.label,
    layer: p.layer,
    stem: p.stem,
    branch: p.branch,
    ...tenGods(dayStem, p.stem, p.branch, i === 2),
    naYin: getNaYin(p.stem, p.branch),
  }));

  return {
    query,
    ...(filter ? { filter } : {}),
    pillars: rows,
    overlayRelations: selected?.overlayRelations ?? overlayRelations,
    ...(selected ? { linkedRelations: selected.linkedRelations } : {}),
    fortuneHints: selected?.fortuneHints ?? fortuneHints,
    taiSui: selected?.taiSui ?? taiSui,
    ...(selected ? { omitted: selected.omitted } : {}),
    calculationOptions: {
      ...(chart.calculationOptions ?? {}),
      ...(dayun ? { yunSect: dayun.yunSect ?? 1 } : {}),
      ruleVersion: BAZI_RELATIONS_RULE_VERSION,
    },
  };
}

/** 太岁是流年地支对年支：所筛柱位都在年柱、流年之内时才列出 */
const TAI_SUI_PILLARS: readonly BaziRelationPillar[] = ['年柱', '流年'];

/**
 * 关系按 selectRelations 筛选，同字牵连只取叠加关系（原局之间的关系见命盘）；岁运提示与太岁只按柱位筛，不按类型筛。
 * 没有列出的事实逐条记入 omitted。
 */
function selectBaziRelations(
  overlay: GanzhiRelationFact[],
  hints: BaziFortuneHint[],
  taiSui: string[],
  filter: BaziRelationsFilter,
) {
  const selection = selectRelations(overlay, filter);
  const pillars = filter.pillars ?? [];
  const keptHints = hints.filter((hint) => pillars.every((pillar) => coversPillar(hint.labels, pillar)));
  const keepTaiSui = pillars.every((pillar) => TAI_SUI_PILLARS.includes(pillar));
  return {
    overlayRelations: selection.kept,
    linkedRelations: selection.linked,
    fortuneHints: keptHints,
    taiSui: keepTaiSui ? taiSui : [],
    omitted: [
      ...selection.rest.map((fact) => fact.type),
      ...hints.filter((hint) => !keptHints.includes(hint)).map(() => '岁运提示'),
      ...(keepTaiSui ? [] : taiSui.map(() => '太岁关系')),
    ],
  };
}
