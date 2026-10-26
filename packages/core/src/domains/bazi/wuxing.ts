/**
 * 八字五行旺衰详查：月令旺相休囚死与月令藏干透出、四个天干的通根、干支自坐与相邻天干生克、缺失五行。
 * 只陈述事实，不判断身强身弱、格局或用神；旺衰不是五行字数相加，所以不计权重、不做合计。
 * 日主、月令与缺失五行总在，其余事实组可按 sections 只取一部分。
 */

import { HIDDEN_STEM_DETAILS } from '../../data/shensha.js';
import { getElementRelation, STEM_ELEMENTS, WU_XING_ORDER, ZHI_WUXING } from '../../shared/utils.js';
import { resolveEnumList } from '../../shared/validation.js';
import type { BaziOutput } from './types.js';
import { baziPillarEntries } from './calculate.js';

export const BAZI_WUXING_RULE_VERSION = 'bazi-wuxing-2026.10.2';
/** 可按需取的事实组，顺序即输出顺序 */
export const BAZI_WUXING_SECTIONS = ['通根', '干支自坐', '相邻天干'] as const;
export type BaziWuxingSection = typeof BAZI_WUXING_SECTIONS[number];

export interface BaziWuxingSelector {
  /** 只取这些事实组；省略时全部给出 */
  sections?: BaziWuxingSection[];
}

const PILLAR_LABELS = ['年柱', '月柱', '日柱', '时柱'] as const;
const STEM_LABELS = ['年干', '月干', '日主', '时干'] as const;
const BRANCH_LABELS = ['年支', '月支', '日支', '时支'] as const;
export const WANG_SHUAI_STATES = ['旺', '相', '休', '囚', '死'] as const;
export type WangShuaiState = typeof WANG_SHUAI_STATES[number];
export type QiType = '本气' | '中气' | '余气';

export type WuxingCell = { pillar: typeof PILLAR_LABELS[number]; part: '天干' | '地支'; char: string; };

export interface WuxingFact {
  type: string;
  cells: WuxingCell[];
  result?: string;
  description: string;
}

/** 天干通根：cells 为 [天干, 地支]，hidden 是地支里与该天干同五行的藏干；年、月、时干与藏干同字即透出 */
export interface WuxingRootFact extends WuxingFact {
  type: '通根';
  hidden: string;
  result: QiType;
}

/** 一个天干与它的全部根；roots 为空即无根 */
export interface StemRoots {
  /** 日主、年干、月干、时干 */
  label: string;
  stem: string;
  element: string;
  roots: WuxingRootFact[];
}

/** 月令的一个藏干：透出到哪些天干（年干、月干、时干），没有则为不透 */
export interface MonthHiddenStem {
  stem: string;
  qiType: QiType;
  revealedIn: string[];
}

/** 事实组只在被选取（或未给 sections）时出现 */
export interface BaziWuxingOutput {
  dayMaster: { stem: string; element: string; };
  missingElements: string[];
  monthCommand: {
    branch: string;
    element: string;
    states: Record<WangShuaiState, string>;
    dayMasterState: WangShuaiState;
    hiddenStems: MonthHiddenStem[];
  };
  /** 出生时辰未知：只看年、月、日三柱，缺失五行可能由时柱补上 */
  birthTimeUnknown?: true;
  /** 给出 sections 时所取的事实组 */
  sections?: BaziWuxingSection[];
  /** 日主在前，其后年干、月干、时干 */
  stemRoots?: StemRoots[];
  pillarSelf?: WuxingFact[];
  adjacentStems?: WuxingFact[];
  calculationOptions: Record<string, unknown> & { ruleVersion: string; };
}

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

/** 日主排在最前：旺衰先看日主之根，再看其余天干的虚实（时辰未知时没有时干） */
const ROOT_STEM_ORDER = [2, 0, 1, 3] as const;

export function deriveBaziWuxing(chart: BaziOutput, selector: BaziWuxingSelector = {}): BaziWuxingOutput {
  const sections = resolveEnumList(selector.sections, BAZI_WUXING_SECTIONS, 'sections');
  const want = (section: BaziWuxingSection) => !sections || sections.includes(section);
  const pillars = baziPillarEntries(chart).map((entry) => entry.pillar);
  const dayStem = chart.dayMaster;
  const dayElement = STEM_ELEMENTS[dayStem];
  const cell = (index: number, part: '天干' | '地支'): WuxingCell => ({
    pillar: PILLAR_LABELS[index], part, char: part === '天干' ? pillars[index].stem : pillars[index].branch,
  });

  // 缺失五行：天干、地支本气、藏干都没有出现的五行；只记出现与否，不设权重、不做合计。
  const present = new Set<string>();
  pillars.forEach((pillar) => {
    present.add(STEM_ELEMENTS[pillar.stem]);
    present.add(ZHI_WUXING[pillar.branch]);
    pillar.hiddenStems.forEach((hidden) => present.add(STEM_ELEMENTS[hidden.stem]));
  });

  const monthBranch = chart.fourPillars.month.branch;
  const monthElement = ZHI_WUXING[monthBranch];
  const states = Object.fromEntries(WANG_SHUAI_STATES.map((state) => [state, ''])) as Record<WangShuaiState, string>;
  for (const element of WU_XING_ORDER) states[monthCommandState(monthElement, element)] = element;
  // 月令藏干透出与否是取格的依据：逐个列出，不透的也列。透出只看年、月、时干，日主本身不算透。
  const monthHidden: MonthHiddenStem[] = (HIDDEN_STEM_DETAILS[monthBranch] ?? []).map((hidden) => ({
    stem: hidden.stem,
    qiType: hidden.qiType,
    revealedIn: pillars.flatMap((pillar, index) => (index !== 2 && pillar.stem === hidden.stem ? [STEM_LABELS[index]] : [])),
  }));

  // 通根：每个天干在四支藏干中的同五行者；年、月、时干与藏干同字即透出
  const stemRoots: StemRoots[] = ROOT_STEM_ORDER.filter((stemIndex) => stemIndex < pillars.length).map((stemIndex) => {
    const stem = pillars[stemIndex].stem;
    const element = STEM_ELEMENTS[stem];
    const roots = pillars.flatMap((pillar, branchIndex) => (HIDDEN_STEM_DETAILS[pillar.branch] ?? [])
      .filter((hidden) => STEM_ELEMENTS[hidden.stem] === element)
      .map((hidden): WuxingRootFact => ({
        type: '通根', cells: [cell(stemIndex, '天干'), cell(branchIndex, '地支')], hidden: hidden.stem, result: hidden.qiType,
        description: `${STEM_LABELS[stemIndex]}${stem}${element}通根于${BRANCH_LABELS[branchIndex]}${pillar.branch}（藏${hidden.stem}·${hidden.qiType}）`,
      })));
    return { label: STEM_LABELS[stemIndex], stem, element, roots };
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

  // 相邻天干：年月、月日、日时（时辰未知时没有日时）
  const adjacentStems = pillars.slice(0, -1).map((_, index): WuxingFact => {
    const a = pillars[index].stem, b = pillars[index + 1].stem;
    const relation = getElementRelation(STEM_ELEMENTS[a], STEM_ELEMENTS[b]);
    const label = (i: number) => (i === 2 ? '日干' : STEM_LABELS[i]);
    return {
      type: `天干${RELATION_TYPES[relation]}`, cells: [cell(index, '天干'), cell(index + 1, '天干')],
      description: RELATION_WORDS[relation](`${label(index)}${a}${STEM_ELEMENTS[a]}`, `${label(index + 1)}${b}${STEM_ELEMENTS[b]}`),
    };
  });

  return {
    dayMaster: { stem: dayStem, element: dayElement },
    missingElements: WU_XING_ORDER.filter((element) => !present.has(element)),
    ...(chart.birthTimeUnknown ? { birthTimeUnknown: true as const } : {}),
    monthCommand: { branch: monthBranch, element: monthElement, states, dayMasterState: monthCommandState(monthElement, dayElement), hiddenStems: monthHidden },
    ...(sections ? { sections: BAZI_WUXING_SECTIONS.filter((section) => sections.includes(section)) } : {}),
    ...(want('通根') ? { stemRoots } : {}),
    ...(want('干支自坐') ? { pillarSelf } : {}),
    ...(want('相邻天干') ? { adjacentStems } : {}),
    calculationOptions: { ...(chart.calculationOptions ?? {}), ruleVersion: BAZI_WUXING_RULE_VERSION },
  };
}
