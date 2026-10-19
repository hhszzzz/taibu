/**
 * 八字刑冲合害详查：原局四柱 + 可选大运/小运、流年、流月、流日叠加，
 * 列出干支关系、岁运提示与太岁，只陈述事实，不下吉凶结论。
 */

import { Solar } from 'lunar-javascript';
import { HIDDEN_STEM_DETAILS } from '../../data/shensha.js';
import { calculateTenGod } from '../../shared/utils.js';
import { CoreInputError, assertInteger, parseCivilDate } from '../../shared/validation.js';
import { calculateDayunData, calculateTaiSui, getYearGanZhi } from '../bazi-dayun/calculate.js';
import type { DayunOutput } from '../bazi-dayun/types.js';
import {
  analyzeGanzhiRelations,
  type GanzhiLayer,
  type GanzhiPillar,
  type GanzhiRelationFact,
} from '../shared/ganzhi-relations.js';
import { calculateBaziLiuYueData, getNaYin } from './calculate.js';
import type { BaziInput, BaziOutput } from './types.js';

export const BAZI_RELATIONS_RULE_VERSION = 'bazi-relations-2026.10';

export interface BaziRelationsSelector {
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

export interface BaziRelationsOutput {
  query: BaziRelationsQuery;
  pillars: BaziRelationsPillar[];
  natalRelations: GanzhiRelationFact[];
  overlayRelations: GanzhiRelationFact[];
  fortuneHints: string[];
  taiSui: string[];
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

function solarYearOfDayun(dayun: DayunOutput): number | undefined {
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

export function deriveBaziRelations(
  chart: BaziOutput,
  selector: BaziRelationsSelector,
  baseInput: BaziInput,
): BaziRelationsOutput {
  validateSelector(selector);
  const dayStem = chart.dayMaster;
  const natal = [chart.fourPillars.year, chart.fourPillars.month, chart.fourPillars.day, chart.fourPillars.hour];
  const pillars: GanzhiPillar[] = natal.map((p, i) => ({ label: NATAL_LABELS[i], layer: '原局', stem: p.stem, branch: p.branch }));
  const query: BaziRelationsQuery = {};
  const fortuneHints: string[] = [];
  const add = (label: string, layer: GanzhiLayer, ganZhi: string) => {
    pillars.push({ label, layer, stem: ganZhi[0], branch: ganZhi[1] });
    return ganZhi;
  };

  const day = selector.day === undefined ? undefined : resolveDay(selector.day);
  const flowYear = day?.flowYear ?? selector.year;
  const needsFortune = flowYear !== undefined || selector.dayun !== undefined;
  const dayun = needsFortune ? calculateDayunData({ ...baseInput, ...(selector.yunSect ? { yunSect: selector.yunSect } : {}) }) : undefined;

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

  const natalCount = NATAL_LABELS.length;
  const overlayIndices = pillars.map((_, i) => i).slice(natalCount);
  const natalRelations = analyzeGanzhiRelations(pillars.slice(0, natalCount));
  const overlayRelations = overlayIndices.length > 0 ? analyzeGanzhiRelations(pillars, { focus: overlayIndices }) : [];

  // 岁运提示：伏吟（干支全同）、天克地冲（天干相冲且地支六冲，亦称反吟）、岁运并临
  for (const i of overlayIndices) {
    for (let j = 0; j < i; j++) {
      const a = pillars[j], b = pillars[i];
      if (a.stem === b.stem && a.branch === b.branch) {
        fortuneHints.push(a.layer === '大运' && b.layer === '流年'
          ? `岁运并临（大运与流年同为${b.stem}${b.branch}）`
          : `${b.label}伏吟${a.label}（同为${b.stem}${b.branch}）`);
        continue;
      }
      const clash = overlayRelations.filter((f) => f.participants.some((p) => p.index === i) && f.participants.some((p) => p.index === j));
      if (clash.some((f) => f.type === '天干相冲') && clash.some((f) => f.type === '六冲')) {
        fortuneHints.push(`${b.label}与${a.label}天克地冲（${b.stem}${b.branch}对${a.stem}${a.branch}，亦称反吟）`);
      }
    }
  }

  const taiSui = yearGanZhi ? calculateTaiSui(yearGanZhi[1], chart.fourPillars.year.branch) : [];
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
    pillars: rows,
    natalRelations,
    overlayRelations,
    fortuneHints,
    taiSui,
    calculationOptions: {
      ...(chart.calculationOptions ?? {}),
      ...(dayun ? { yunSect: dayun.yunSect ?? 1 } : {}),
      ruleVersion: BAZI_RELATIONS_RULE_VERSION,
    },
  };
}
