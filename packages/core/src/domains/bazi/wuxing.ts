/**
 * 八字五行流通详查：五行加权统计、月令旺相休囚死、日主通根与透干、
 * 干支自坐与相邻天干生克、相生链与十神分布。只陈述事实，不判断身强身弱或用神。
 */

import { HIDDEN_STEM_DETAILS } from '../../data/shensha.js';
import { calculateTenGod, getElementRelation, STEM_ELEMENTS, WU_XING_ORDER, ZHI_WUXING } from '../../shared/utils.js';
import { calculateBaziFiveElementsStats } from './calculate.js';
import type { BaziOutput } from './types.js';

export const BAZI_WUXING_RULE_VERSION = 'bazi-wuxing-2026.10';

/** 与 calculateBaziFiveElementsStats 相同的藏干权重（按藏干顺序） */
const HIDDEN_STEM_WEIGHTS = [0.6, 0.3, 0.1];
const PILLAR_LABELS = ['年柱', '月柱', '日柱', '时柱'] as const;
const STEM_LABELS = ['年干', '月干', '日干', '时干'] as const;
export const WANG_SHUAI_STATES = ['旺', '相', '休', '囚', '死'] as const;
export type WangShuaiState = typeof WANG_SHUAI_STATES[number];

export type WuxingCell = { pillar: typeof PILLAR_LABELS[number]; part: '天干' | '地支'; char: string; };

export interface WuxingFact {
  type: string;
  cells: WuxingCell[];
  result?: string;
  description: string;
}

export interface BaziWuxingOutput {
  dayMaster: { stem: string; element: string; };
  elementStats: Array<{ element: string; stems: number; branches: number; hiddenStems: number; total: number; }>;
  missingElements: string[];
  monthCommand: { branch: string; element: string; states: Record<WangShuaiState, string>; dayMasterState: WangShuaiState; };
  roots: WuxingFact[];
  revealed: WuxingFact[];
  pillarSelf: WuxingFact[];
  adjacentStems: WuxingFact[];
  generatingChain: { order: string[]; present: string[]; segments: string[]; breaks: string[]; };
  tenGods: Array<{ tenGod: string; stems: string[]; hiddenStems: string[]; }>;
  calculationOptions: Record<string, unknown> & { ruleVersion: string; };
}

const round = (value: number) => Math.round(value * 10) / 10;

/** 月令旺衰：同我者旺，月令所生者相，生月令者休，克月令者囚，月令所克者死；辰戌丑未月以土论 */
export function monthCommandState(monthElement: string, element: string): WangShuaiState {
  switch (getElementRelation(monthElement, element)) {
    case 'same': return '旺';
    case 'produce': return '相';
    case 'produced': return '休';
    case 'controlled': return '囚';
    default: return '死';
  }
}

const RELATION_WORDS: Record<string, (a: string, b: string) => string> = {
  same: (a, b) => `${a}与${b}同气`,
  produce: (a, b) => `${a}生${b}`,
  produced: (a, b) => `${b}生${a}`,
  control: (a, b) => `${a}克${b}`,
  controlled: (a, b) => `${b}克${a}`,
};
const RELATION_TYPES: Record<string, string> = { same: '同气', produce: '生', produced: '生', control: '克', controlled: '克' };

export function deriveBaziWuxing(chart: BaziOutput): BaziWuxingOutput {
  const pillars = [chart.fourPillars.year, chart.fourPillars.month, chart.fourPillars.day, chart.fourPillars.hour];
  const dayStem = chart.dayMaster;
  const dayElement = STEM_ELEMENTS[dayStem];
  const cell = (index: number, part: '天干' | '地支'): WuxingCell => ({
    pillar: PILLAR_LABELS[index], part, char: part === '天干' ? pillars[index].stem : pillars[index].branch,
  });

  const counts = Object.fromEntries(WU_XING_ORDER.map((element) => [element, { stems: 0, branches: 0, hiddenStems: 0 }]));
  pillars.forEach((pillar) => {
    counts[STEM_ELEMENTS[pillar.stem]].stems += 1;
    counts[ZHI_WUXING[pillar.branch]].branches += 1;
    pillar.hiddenStems.forEach((hidden, i) => { counts[STEM_ELEMENTS[hidden.stem]].hiddenStems += HIDDEN_STEM_WEIGHTS[i] ?? 0.1; });
  });
  const totals = calculateBaziFiveElementsStats(chart.fourPillars);
  const elementStats = WU_XING_ORDER.map((element) => ({
    element,
    stems: counts[element].stems,
    branches: counts[element].branches,
    hiddenStems: round(counts[element].hiddenStems),
    total: totals[element as keyof typeof totals],
  }));
  const present = elementStats.filter((item) => item.total > 0).map((item) => item.element);

  const monthBranch = chart.fourPillars.month.branch;
  const monthElement = ZHI_WUXING[monthBranch];
  const states = Object.fromEntries(WANG_SHUAI_STATES.map((state) => [state, ''])) as Record<WangShuaiState, string>;
  for (const element of WU_XING_ORDER) states[monthCommandState(monthElement, element)] = element;

  // 日主通根：地支藏干与日主同五行；透干：地支藏干原字出现在天干
  const roots: WuxingFact[] = [];
  const revealed: WuxingFact[] = [];
  pillars.forEach((pillar, index) => {
    for (const hidden of HIDDEN_STEM_DETAILS[pillar.branch] ?? []) {
      if (STEM_ELEMENTS[hidden.stem] === dayElement) {
        roots.push({
          type: '通根', cells: [cell(2, '天干'), cell(index, '地支')], result: hidden.qiType,
          description: `日主${dayStem}${dayElement}通根于${PILLAR_LABELS[index]}${pillar.branch}（藏${hidden.stem}·${hidden.qiType}）`,
        });
      }
      pillars.forEach((other, stemIndex) => {
        if (other.stem !== hidden.stem) return;
        revealed.push({
          type: '透干', cells: [cell(index, '地支'), cell(stemIndex, '天干')], result: hidden.qiType,
          description: `${PILLAR_LABELS[index]}${pillar.branch}藏${hidden.stem}（${hidden.qiType}）透出于${STEM_LABELS[stemIndex]}`,
        });
      });
    }
  });

  // 干支自坐：天干五行与地支本气五行
  const pillarSelf = pillars.map((pillar, index): WuxingFact => {
    const stemElement = STEM_ELEMENTS[pillar.stem];
    const branchElement = ZHI_WUXING[pillar.branch];
    const relation = getElementRelation(stemElement, branchElement);
    return {
      type: `干支${RELATION_TYPES[relation]}`, cells: [cell(index, '天干'), cell(index, '地支')], result: relation === 'same' ? '同气'
        : relation === 'produce' ? '干生支' : relation === 'produced' ? '支生干' : relation === 'control' ? '干克支' : '支克干',
      description: `${PILLAR_LABELS[index]}${RELATION_WORDS[relation](`${pillar.stem}${stemElement}`, `${pillar.branch}${branchElement}`)}`,
    };
  });

  // 相邻天干：年月、月日、日时
  const adjacentStems = [0, 1, 2].map((index): WuxingFact => {
    const a = pillars[index].stem, b = pillars[index + 1].stem;
    const relation = getElementRelation(STEM_ELEMENTS[a], STEM_ELEMENTS[b]);
    return {
      type: `天干${RELATION_TYPES[relation]}`, cells: [cell(index, '天干'), cell(index + 1, '天干')],
      description: RELATION_WORDS[relation](`${STEM_LABELS[index]}${a}${STEM_ELEMENTS[a]}`, `${STEM_LABELS[index + 1]}${b}${STEM_ELEMENTS[b]}`),
    };
  });

  // 相生链：按木火土金水的相生顺序看各五行是否出现（含藏干）
  const segments: string[] = [];
  const breaks: string[] = [];
  if (present.length === WU_XING_ORDER.length) segments.push([...WU_XING_ORDER, WU_XING_ORDER[0]].join('→'));
  else if (present.length > 0) {
    const start = WU_XING_ORDER.findIndex((element, i) => present.includes(element) && !present.includes(WU_XING_ORDER[(i + 4) % 5]));
    let run: string[] = [];
    for (let step = 0; step < 5; step++) {
      const element = WU_XING_ORDER[(start + step) % 5];
      if (present.includes(element)) { run.push(element); continue; }
      if (run.length) segments.push(run.join('→'));
      breaks.push(`缺${element}（${WU_XING_ORDER[(start + step + 4) % 5]}→${element}→${WU_XING_ORDER[(start + step + 1) % 5]}中断）`);
      run = [];
    }
    if (run.length) segments.push(run.join('→'));
  }

  const tenGodMap = new Map<string, { stems: string[]; hiddenStems: string[] }>();
  const entry = (tenGod: string) => tenGodMap.get(tenGod) ?? tenGodMap.set(tenGod, { stems: [], hiddenStems: [] }).get(tenGod)!;
  pillars.forEach((pillar, index) => {
    if (index !== 2) entry(calculateTenGod(dayStem, pillar.stem)).stems.push(`${STEM_LABELS[index]}${pillar.stem}`);
    for (const hidden of HIDDEN_STEM_DETAILS[pillar.branch] ?? []) {
      entry(calculateTenGod(dayStem, hidden.stem)).hiddenStems.push(`${PILLAR_LABELS[index]}${pillar.branch}藏${hidden.stem}（${hidden.qiType}）`);
    }
  });
  const TEN_GOD_ORDER = ['比肩', '劫财', '食神', '伤官', '偏财', '正财', '七杀', '正官', '偏印', '正印'];

  return {
    dayMaster: { stem: dayStem, element: dayElement },
    elementStats,
    missingElements: elementStats.filter((item) => item.total === 0).map((item) => item.element),
    monthCommand: { branch: monthBranch, element: monthElement, states, dayMasterState: monthCommandState(monthElement, dayElement) },
    roots,
    revealed,
    pillarSelf,
    adjacentStems,
    generatingChain: { order: [...WU_XING_ORDER], present, segments, breaks },
    tenGods: TEN_GOD_ORDER.filter((tenGod) => tenGodMap.has(tenGod)).map((tenGod) => ({ tenGod, ...tenGodMap.get(tenGod)! })),
    calculationOptions: { ...(chart.calculationOptions ?? {}), ruleVersion: BAZI_WUXING_RULE_VERSION },
  };
}
