/**
 * 紫微宫位详查：在已排好的命盘上聚焦一宫，列出本宫星曜与自化、空宫借对宫、
 * 三方四正、夹宫、宫干四化飞出与飞入来源；指定运限层次时叠加运限宫与运限四化。
 * 只陈述盘面事实，不下吉凶结论。
 */

import { util } from 'iztro';
import type { PalaceInfo, StarInfo } from '../shared/types.js';
import { CoreInputError } from '../../shared/validation.js';
import { calculateZiweiHoroscopeDataWithAstrolabe } from '../ziwei-horoscope/calculate.js';
import type { HoroscopePeriodInfo } from '../ziwei-horoscope/types.js';
import { resolveZiweiOptions, withZiweiOptions } from './profile.js';
import { createAstrolabeWithTrueSolar, MUTAGEN_NAMES, normalizePalaceName } from './shared.js';
import type { ZiweiCalculationOptions, ZiweiInput, ZiweiOutput } from './types.js';

export const ZIWEI_PALACE_RULE_VERSION = 'ziwei-palace-2026.10';

/** 对外宫名；「仆役」作为「交友」的别名接受 */
export const ZIWEI_PALACE_NAMES = ['命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄', '迁移', '交友', '官禄', '田宅', '福德', '父母'] as const;
export const ZIWEI_PALACE_SCOPES = ['natal', 'decadal', 'yearly', 'monthly', 'daily', 'hourly'] as const;
export type ZiweiPalaceScope = typeof ZIWEI_PALACE_SCOPES[number];

export const ZIWEI_SCOPE_LABELS: Record<ZiweiPalaceScope, string> = {
  natal: '本命', decadal: '大限', yearly: '流年', monthly: '流月', daily: '流日', hourly: '流时',
};

export interface ZiweiPalaceSelector {
  /** 宫名；非本命层次时指该运限的宫名 */
  palace: string;
  scope?: ZiweiPalaceScope;
  /** 运限目标日期 YYYY-MM-DD（非本命层次必填） */
  targetDate?: string;
  /** 流时时辰序号 0–12（流时层次必填） */
  targetTimeIndex?: number;
}

export type ZiweiStarGroup = '主星及四化' | '辅星' | '杂曜';

export interface ZiweiPalaceStarFact {
  palace: string;
  name: string;
  group: ZiweiStarGroup;
  brightness?: string;
  mutagen?: string;
  selfMutagen?: string;
  oppositeMutagen?: string;
}

export interface ZiweiPalaceFact {
  name: string;
  index: number;
  stem: string;
  branch: string;
  isBodyPalace: boolean;
  isOriginalPalace: boolean;
  stars: ZiweiPalaceStarFact[];
}

export interface ZiweiMutagenFlight {
  mutagen: string;
  star: string;
  fromPalace: string;
  fromStem: string;
  /** 星曜所在的本命宫位；星不在盘上时为 null */
  toPalace: string | null;
}

export interface ZiweiFlankPattern {
  name: string;
  stars: [{ palace: string; star: string; }, { palace: string; star: string; }];
}

export interface ZiweiPalaceOverlay {
  scope: ZiweiPalaceScope;
  label: string;
  stem: string;
  branch: string;
  /** 所查的运限宫名 */
  scopePalace: string;
  /** 运限宫落入的本命宫位 */
  natalPalace: string;
  /** 运限命宫落入的本命宫位 */
  soulInNatal?: string;
  targetDate: string;
  targetTimeIndex?: number;
  mutagens: Array<{ mutagen: string; star: string; natalPalace: string | null; scopePalace: string | null; }>;
}

export interface ZiweiPalaceOutput {
  query: { palace: string; scope: ZiweiPalaceScope; targetDate?: string; targetTimeIndex?: number; };
  palace: ZiweiPalaceFact;
  borrowed?: { from: ZiweiPalaceFact; stars: ZiweiPalaceStarFact[]; };
  sanFang: Array<{ role: '本宫' | '三合' | '对宫'; palace: ZiweiPalaceFact; }>;
  flanks: { palaces: [ZiweiPalaceFact, ZiweiPalaceFact]; patterns: ZiweiFlankPattern[]; };
  fliesOut: ZiweiMutagenFlight[];
  fliesIn: ZiweiMutagenFlight[];
  overlay?: ZiweiPalaceOverlay;
  calculationOptions: Record<string, unknown> & { ruleVersion: string; };
}

/** 两邻宫成对出现即为夹：六吉六煞成对星与日月 */
const FLANK_PAIRS: Array<{ name: string; stars: [string, string]; }> = [
  { name: '左右夹', stars: ['左辅', '右弼'] },
  { name: '昌曲夹', stars: ['文昌', '文曲'] },
  { name: '魁钺夹', stars: ['天魁', '天钺'] },
  { name: '日月夹', stars: ['太阳', '太阴'] },
  { name: '羊陀夹', stars: ['擎羊', '陀罗'] },
  { name: '火铃夹', stars: ['火星', '铃星'] },
  { name: '空劫夹', stars: ['地空', '地劫'] },
];

const SCOPE_PERIODS: Record<Exclude<ZiweiPalaceScope, 'natal'>, 'decadal' | 'yearly' | 'monthly' | 'daily' | 'hourly'> = {
  decadal: 'decadal', yearly: 'yearly', monthly: 'monthly', daily: 'daily', hourly: 'hourly',
};

function normalizeQueryPalace(name: unknown): string {
  const normalized = typeof name === 'string' ? normalizePalaceName(name.trim()) : '';
  if (!(ZIWEI_PALACE_NAMES as readonly string[]).includes(normalized)) {
    throw new CoreInputError('palace', `必须是十二宫名之一：${ZIWEI_PALACE_NAMES.join('、')}（仆役同交友）`);
  }
  return normalized;
}

function profileOf(chart: ZiweiOutput): ZiweiCalculationOptions {
  const { timezone: _timezone, disambiguation: _disambiguation, ruleVersion: _ruleVersion, ...profile } = chart.calculationOptions ?? {};
  return resolveZiweiOptions(profile);
}

function starFacts(palace: PalaceInfo): ZiweiPalaceStarFact[] {
  const groups: Array<[ZiweiStarGroup, StarInfo[]]> = [['主星及四化', palace.majorStars], ['辅星', palace.minorStars], ['杂曜', palace.adjStars ?? []]];
  return groups.flatMap(([group, stars]) => stars.map((star) => ({
    palace: palace.name,
    name: star.name,
    group,
    ...(star.brightness ? { brightness: star.brightness } : {}),
    ...(star.mutagen ? { mutagen: star.mutagen } : {}),
    ...(star.selfMutagen ? { selfMutagen: star.selfMutagen } : {}),
    ...(star.oppositeMutagen ? { oppositeMutagen: star.oppositeMutagen } : {}),
  })));
}

function palaceFact(palace: PalaceInfo): ZiweiPalaceFact {
  return {
    name: palace.name,
    index: palace.index ?? 0,
    stem: palace.heavenlyStem,
    branch: palace.earthlyBranch,
    isBodyPalace: palace.isBodyPalace === true,
    isOriginalPalace: palace.isOriginalPalace === true,
    stars: starFacts(palace),
  };
}

function validateSelector(selector: ZiweiPalaceSelector): ZiweiPalaceScope {
  const scope = selector.scope ?? 'natal';
  if (!(ZIWEI_PALACE_SCOPES as readonly string[]).includes(scope)) throw new CoreInputError('scope', `必须是 ${ZIWEI_PALACE_SCOPES.join('/')}`);
  if (scope === 'natal') {
    if (selector.targetDate !== undefined) throw new CoreInputError('targetDate', '本命层次不需要目标日期');
    if (selector.targetTimeIndex !== undefined) throw new CoreInputError('targetTimeIndex', '本命层次不需要时辰序号');
    return scope;
  }
  if (selector.targetDate === undefined) throw new CoreInputError('targetDate', `查询${ZIWEI_SCOPE_LABELS[scope]}时必须给出目标日期`);
  if (scope === 'hourly' && selector.targetTimeIndex === undefined) throw new CoreInputError('targetTimeIndex', '查询流时时必须给出时辰序号');
  return scope;
}

export function deriveZiweiPalace(
  chart: ZiweiOutput,
  selector: ZiweiPalaceSelector,
  baseInput: ZiweiInput,
): ZiweiPalaceOutput {
  const scope = validateSelector(selector);
  const queryPalace = normalizeQueryPalace(selector.palace);
  const byIndex = new Map(chart.palaces.map((palace) => [palace.index ?? 0, palace]));
  if (byIndex.size !== 12) throw new Error('命盘宫位不完整');
  const at = (index: number) => byIndex.get(((index % 12) + 12) % 12)!;

  let overlay: ZiweiPalaceOverlay | undefined;
  let targetIndex: number;
  if (scope === 'natal') {
    targetIndex = chart.palaces.find((palace) => palace.name === queryPalace)!.index ?? 0;
  } else {
    const { astrolabe } = createAstrolabeWithTrueSolar(baseInput);
    const horoscope = calculateZiweiHoroscopeDataWithAstrolabe(astrolabe, {
      targetDate: selector.targetDate,
      targetTimeIndex: selector.targetTimeIndex,
    });
    const period: HoroscopePeriodInfo = horoscope[SCOPE_PERIODS[scope]];
    targetIndex = period.palaceNames.length === 12 ? period.palaceNames.indexOf(queryPalace) : -1;
    if (targetIndex < 0) throw new CoreInputError('targetDate', `该日期的${ZIWEI_SCOPE_LABELS[scope]}没有可叠加的宫位`);
    const starPalace = (star: string) => chart.palaces.find((palace) => starFacts(palace).some((item) => item.name === star));
    overlay = {
      scope,
      label: ZIWEI_SCOPE_LABELS[scope],
      stem: period.heavenlyStem,
      branch: period.earthlyBranch,
      scopePalace: queryPalace,
      natalPalace: at(targetIndex).name,
      ...(period.natalPalaceName ? { soulInNatal: period.natalPalaceName } : {}),
      targetDate: horoscope.targetDate,
      ...(selector.targetTimeIndex !== undefined ? { targetTimeIndex: selector.targetTimeIndex } : {}),
      mutagens: period.mutagen.slice(0, 4).map((star, i) => {
        const palace = starPalace(star);
        const index = palace?.index;
        return {
          mutagen: MUTAGEN_NAMES[i],
          star,
          natalPalace: palace?.name ?? null,
          scopePalace: index === undefined ? null : normalizePalaceName(period.palaceNames[index] ?? '') || null,
        };
      }),
    };
  }

  const target = at(targetIndex);
  const profile = profileOf(chart);
  const stemCache = new Map<string, string[]>();
  // 宫干四化按盘面所用的四化表（含自定义 mutagens）取，iztro 全局配置在调用后恢复
  const stemMutagens = (stem: string) => {
    let stars = stemCache.get(stem);
    if (!stars) {
      stars = withZiweiOptions(profile, () => [...util.getMutagensByHeavenlyStem(stem as Parameters<typeof util.getMutagensByHeavenlyStem>[0])]);
      stemCache.set(stem, stars);
    }
    return stars;
  };
  const locate = (star: string) => chart.palaces.find((palace) => starFacts(palace).some((item) => item.name === star))?.name ?? null;
  const flights = (palace: PalaceInfo): ZiweiMutagenFlight[] => stemMutagens(palace.heavenlyStem).slice(0, 4).map((star, i) => ({
    mutagen: MUTAGEN_NAMES[i], star, fromPalace: palace.name, fromStem: palace.heavenlyStem, toPalace: locate(star),
  }));

  const opposite = at(targetIndex + 6);
  const isEmpty = target.majorStars.length === 0;
  const neighbours: [PalaceInfo, PalaceInfo] = [at(targetIndex - 1), at(targetIndex + 1)];
  const names = neighbours.map((palace) => new Set(starFacts(palace).map((star) => star.name)));
  const patterns: ZiweiFlankPattern[] = [];
  for (const pair of FLANK_PAIRS) {
    for (const [first, second] of [[0, 1], [1, 0]] as const) {
      if (!names[first].has(pair.stars[0]) || !names[second].has(pair.stars[1])) continue;
      patterns.push({ name: pair.name, stars: [
        { palace: neighbours[first].name, star: pair.stars[0] },
        { palace: neighbours[second].name, star: pair.stars[1] },
      ] });
    }
  }

  return {
    query: {
      palace: queryPalace,
      scope,
      ...(selector.targetDate !== undefined ? { targetDate: selector.targetDate } : {}),
      ...(selector.targetTimeIndex !== undefined ? { targetTimeIndex: selector.targetTimeIndex } : {}),
    },
    palace: palaceFact(target),
    ...(isEmpty ? { borrowed: { from: palaceFact(opposite), stars: starFacts(opposite).filter((star) => star.group === '主星及四化') } } : {}),
    sanFang: [
      { role: '本宫', palace: palaceFact(target) },
      { role: '三合', palace: palaceFact(at(targetIndex + 4)) },
      { role: '三合', palace: palaceFact(at(targetIndex + 8)) },
      { role: '对宫', palace: palaceFact(opposite) },
    ],
    flanks: { palaces: [palaceFact(neighbours[0]), palaceFact(neighbours[1])], patterns },
    fliesOut: flights(target),
    fliesIn: chart.palaces.flatMap(flights).filter((flight) => flight.toPalace === target.name),
    ...(overlay ? { overlay } : {}),
    calculationOptions: { ...(chart.calculationOptions ?? {}), ruleVersion: ZIWEI_PALACE_RULE_VERSION },
  };
}
