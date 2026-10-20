/**
 * 八字流年扫描：逐年列出流年干支、所在大运（起运前为小运）、十神，
 * 流年与原局、与大运的干支关系，太岁与岁运提示。只陈述事实。
 * 可按柱位、关系类型筛选，只列命中的年份；筛选口径与 bazi_relations 相同。
 */

import { CoreInputError, assertInteger } from '../../shared/validation.js';
import { calculateDayunData } from '../bazi-dayun/calculate.js';
import type { GanzhiRelationFact } from '../shared/ganzhi-relations.js';
import {
  coversPillar,
  deriveBaziRelations,
  resolveRelationsFilter,
  selectRelations,
  solarYearOfDayun,
  type BaziRelationPillar,
  type BaziRelationsFilter,
  type BaziRelationsPillar,
} from './relations.js';
import type { BaziInput, BaziOutput } from './types.js';

export const BAZI_LIUNIAN_SCAN_RULE_VERSION = 'bazi-liunian-scan-2026.10';
export const BAZI_LIUNIAN_SCAN_MAX_YEARS = 30;
/** 流年总在其中，筛选只需再指定原局四柱或大运（起运前指小运） */
export const BAZI_LIUNIAN_SCAN_PILLARS = ['年柱', '月柱', '日柱', '时柱', '大运'] as const satisfies readonly BaziRelationPillar[];

export interface BaziLiunianScanSelector extends BaziRelationsFilter {
  fromYear: number;
  toYear: number;
  yunSect?: 1 | 2;
}

export interface BaziLiunianYear {
  year: number;
  pillar: BaziRelationsPillar;
  fortune?: { layer: '大运' | '小运'; ganZhi: string; label: string; };
  natalRelations: GanzhiRelationFact[];
  fortuneRelations: GanzhiRelationFact[];
  /** 筛选时：不在筛选内、但与入选关系共用同一字的流年关系 */
  linkedRelations?: GanzhiRelationFact[];
  taiSui: string[];
  fortuneHints: string[];
}

export interface BaziLiunianScanOutput {
  range: { fromYear: number; toYear: number; matchedYears: number; };
  filter?: BaziRelationsFilter;
  natal: Array<{ label: string; ganZhi: string; }>;
  years: BaziLiunianYear[];
  /** 筛选时整个范围内没有列出的流年事实（含未列出年份的全部事实），每条记一个类型 */
  omitted?: string[];
  calculationOptions: Record<string, unknown> & { ruleVersion: string; };
}

function validate(selector: BaziLiunianScanSelector): void {
  assertInteger(selector.fromYear, 'fromYear', 1, 9998);
  assertInteger(selector.toYear, 'toYear', 1, 9998);
  if (selector.toYear < selector.fromYear) throw new CoreInputError('toYear', '结束年份不能早于起始年份');
  if (selector.toYear - selector.fromYear + 1 > BAZI_LIUNIAN_SCAN_MAX_YEARS) {
    throw new CoreInputError('toYear', `一次最多扫描 ${BAZI_LIUNIAN_SCAN_MAX_YEARS} 年`);
  }
}

const touchesFlow = (fact: GanzhiRelationFact) => fact.participants.some((p) => p.label === '流年');
const withFortune = (fact: GanzhiRelationFact) => fact.participants.some((p) => p.layer === '大运' || p.layer === '小运');

export function deriveBaziLiunianScan(
  chart: BaziOutput,
  selector: BaziLiunianScanSelector,
  baseInput: BaziInput,
): BaziLiunianScanOutput {
  validate(selector);
  const filter = resolveRelationsFilter(selector, BAZI_LIUNIAN_SCAN_PILLARS);
  const dayun = calculateDayunData({ ...baseInput, ...(selector.yunSect ? { yunSect: selector.yunSect } : {}) });
  const birthYear = solarYearOfDayun(dayun);
  if (birthYear !== undefined && selector.fromYear < birthYear) {
    throw new CoreInputError('fromYear', `起始年份不能早于出生年 ${birthYear}`);
  }
  const pillars = filter?.pillars ?? [];
  // 太岁是流年地支对年支：所筛柱位只有年柱时才列出
  const keepTaiSui = pillars.every((pillar) => pillar === '年柱');

  const years: BaziLiunianYear[] = [];
  const omitted: string[] = [];
  let first: ReturnType<typeof deriveBaziRelations> | undefined;
  for (let year = selector.fromYear; year <= selector.toYear; year++) {
    const result = deriveBaziRelations(chart, { year, ...(selector.yunSect ? { yunSect: selector.yunSect } : {}) }, baseInput, dayun);
    first ??= result;
    const fortunePillar = result.pillars.find((p) => p.layer === '大运' || p.layer === '小运');
    const flow = result.pillars.find((p) => p.layer === '流年')!;
    // 只看流年参与的关系与提示；大运与原局的关系每年相同，不在逐年里重复
    const flowFacts = result.overlayRelations.filter(touchesFlow);
    const flowHints = result.fortuneHints.filter((hint) => hint.labels.includes('流年'));
    const selection = filter ? selectRelations(flowFacts, filter) : { kept: flowFacts, linked: [], rest: [] };
    const hints = flowHints.filter((hint) => pillars.every((pillar) => coversPillar(hint.labels, pillar)));
    const taiSui = keepTaiSui ? result.taiSui : [];
    // 按类型筛时只认关系；只按柱位筛时，岁运提示与太岁也算命中
    const matched = !filter || selection.kept.length > 0 || (!filter.types && (hints.length > 0 || taiSui.length > 0));
    if (filter) {
      const shownHints = matched ? hints : [];
      const shownTaiSui = matched ? taiSui : [];
      omitted.push(
        ...(matched ? selection.rest : flowFacts).map((fact) => fact.type),
        ...flowHints.filter((hint) => !shownHints.includes(hint)).map(() => '岁运提示'),
        ...result.taiSui.filter((item) => !shownTaiSui.includes(item)).map(() => '太岁关系'),
      );
    }
    if (!matched) continue;
    years.push({
      year,
      pillar: flow,
      ...(fortunePillar ? {
        fortune: {
          layer: fortunePillar.layer as '大运' | '小运',
          ganZhi: `${fortunePillar.stem}${fortunePillar.branch}`,
          label: result.query.dayun ? `第${result.query.dayun.index}步大运` : `小运（虚岁${result.query.xiaoYun?.age}）`,
        },
      } : {}),
      natalRelations: selection.kept.filter((fact) => !withFortune(fact)),
      fortuneRelations: selection.kept.filter(withFortune),
      ...(filter ? { linkedRelations: selection.linked } : {}),
      taiSui,
      fortuneHints: hints.map((hint) => hint.description),
    });
  }

  return {
    range: { fromYear: selector.fromYear, toYear: selector.toYear, matchedYears: years.length },
    ...(filter ? { filter } : {}),
    natal: (first?.pillars ?? []).slice(0, 4).map((p) => ({ label: p.label, ganZhi: `${p.stem}${p.branch}` })),
    years,
    ...(filter ? { omitted } : {}),
    calculationOptions: {
      ...(chart.calculationOptions ?? {}),
      yunSect: dayun.yunSect ?? 1,
      ruleVersion: BAZI_LIUNIAN_SCAN_RULE_VERSION,
    },
  };
}
