/**
 * 八字流年扫描：逐年列出流年干支、所在大运（起运前为小运）、十神，
 * 流年与原局、与大运的干支关系，太岁与岁运提示。只陈述事实。
 */

import { CoreInputError, assertInteger } from '../../shared/validation.js';
import { calculateDayunData } from '../bazi-dayun/calculate.js';
import { GANZHI_RELATION_TYPES, type GanzhiRelationFact } from '../shared/ganzhi-relations.js';
import { deriveBaziRelations, solarYearOfDayun, type BaziRelationsPillar } from './relations.js';
import type { BaziInput, BaziOutput } from './types.js';

export const BAZI_LIUNIAN_SCAN_RULE_VERSION = 'bazi-liunian-scan-2026.10';
export const BAZI_LIUNIAN_SCAN_MAX_YEARS = 30;
export const BAZI_LIUNIAN_SCAN_PILLARS = ['年柱', '月柱', '日柱', '时柱', '大运'] as const;
export const BAZI_LIUNIAN_SCAN_FOCUS = [...BAZI_LIUNIAN_SCAN_PILLARS, ...GANZHI_RELATION_TYPES] as const;

export interface BaziLiunianScanSelector {
  fromYear: number;
  toYear: number;
  /** 只保留涉及该柱位（年柱…时柱、大运）或该关系类型的年份与关系 */
  focus?: typeof BAZI_LIUNIAN_SCAN_FOCUS[number];
  yunSect?: 1 | 2;
}

export interface BaziLiunianYear {
  year: number;
  pillar: BaziRelationsPillar;
  fortune?: { layer: '大运' | '小运'; ganZhi: string; label: string; };
  natalRelations: GanzhiRelationFact[];
  fortuneRelations: GanzhiRelationFact[];
  taiSui: string[];
  fortuneHints: string[];
}

export interface BaziLiunianScanOutput {
  range: { fromYear: number; toYear: number; focus?: string; matchedYears: number; };
  natal: Array<{ label: string; ganZhi: string; }>;
  years: BaziLiunianYear[];
  calculationOptions: Record<string, unknown> & { ruleVersion: string; };
}

function validate(selector: BaziLiunianScanSelector): void {
  assertInteger(selector.fromYear, 'fromYear', 1, 9998);
  assertInteger(selector.toYear, 'toYear', 1, 9998);
  if (selector.toYear < selector.fromYear) throw new CoreInputError('toYear', '结束年份不能早于起始年份');
  if (selector.toYear - selector.fromYear + 1 > BAZI_LIUNIAN_SCAN_MAX_YEARS) {
    throw new CoreInputError('toYear', `一次最多扫描 ${BAZI_LIUNIAN_SCAN_MAX_YEARS} 年`);
  }
  if (selector.focus !== undefined && !(BAZI_LIUNIAN_SCAN_FOCUS as readonly string[]).includes(selector.focus)) {
    throw new CoreInputError('focus', `focus 只能是 ${BAZI_LIUNIAN_SCAN_FOCUS.join('、')} 之一`);
  }
}

const touches = (fact: GanzhiRelationFact, label: string) => fact.participants.some((p) => p.label === label);

export function deriveBaziLiunianScan(
  chart: BaziOutput,
  selector: BaziLiunianScanSelector,
  baseInput: BaziInput,
): BaziLiunianScanOutput {
  validate(selector);
  const dayun = calculateDayunData({ ...baseInput, ...(selector.yunSect ? { yunSect: selector.yunSect } : {}) });
  const birthYear = solarYearOfDayun(dayun);
  if (birthYear !== undefined && selector.fromYear < birthYear) {
    throw new CoreInputError('fromYear', `起始年份不能早于出生年 ${birthYear}`);
  }
  const focus = selector.focus;
  const keep = (fact: GanzhiRelationFact) => !focus
    || ((BAZI_LIUNIAN_SCAN_PILLARS as readonly string[]).includes(focus)
      ? focus === '大运' ? fact.participants.some((p) => p.layer === '大运' || p.layer === '小运') : touches(fact, focus)
      : fact.type === focus);

  const years: BaziLiunianYear[] = [];
  let first: ReturnType<typeof deriveBaziRelations> | undefined;
  for (let year = selector.fromYear; year <= selector.toYear; year++) {
    const result = deriveBaziRelations(chart, { year, ...(selector.yunSect ? { yunSect: selector.yunSect } : {}) }, baseInput, dayun);
    first ??= result;
    const fortunePillar = result.pillars.find((p) => p.layer === '大运' || p.layer === '小运');
    const flow = result.pillars.find((p) => p.layer === '流年')!;
    // 只留流年参与的关系；大运与原局的关系每年相同，不在逐年里重复
    const withFlow = result.overlayRelations.filter((fact) => touches(fact, '流年') && keep(fact));
    const withFortune = (fact: GanzhiRelationFact) => fact.participants.some((p) => p.layer === '大运' || p.layer === '小运');
    const hints = result.fortuneHints.filter((hint) => (hint.startsWith('流年') || hint.startsWith('岁运并临'))
      && (!focus || !(BAZI_LIUNIAN_SCAN_PILLARS as readonly string[]).includes(focus) || hint.includes(focus === '大运' ? '大运' : focus)));
    const row: BaziLiunianYear = {
      year,
      pillar: flow,
      ...(fortunePillar ? {
        fortune: {
          layer: fortunePillar.layer as '大运' | '小运',
          ganZhi: `${fortunePillar.stem}${fortunePillar.branch}`,
          label: result.query.dayun ? `第${result.query.dayun.index}步大运` : `小运（虚岁${result.query.xiaoYun?.age}）`,
        },
      } : {}),
      natalRelations: withFlow.filter((fact) => !withFortune(fact)),
      fortuneRelations: withFlow.filter(withFortune),
      taiSui: result.taiSui,
      fortuneHints: focus && !(BAZI_LIUNIAN_SCAN_PILLARS as readonly string[]).includes(focus) ? [] : hints,
    };
    if (focus && !row.natalRelations.length && !row.fortuneRelations.length && !row.fortuneHints.length) continue;
    years.push(row);
  }

  return {
    range: { fromYear: selector.fromYear, toYear: selector.toYear, ...(focus ? { focus } : {}), matchedYears: years.length },
    natal: (first?.pillars ?? []).slice(0, 4).map((p) => ({ label: p.label, ganZhi: `${p.stem}${p.branch}` })),
    years,
    calculationOptions: {
      ...(chart.calculationOptions ?? {}),
      yunSect: dayun.yunSect ?? 1,
      ruleVersion: BAZI_LIUNIAN_SCAN_RULE_VERSION,
    },
  };
}
