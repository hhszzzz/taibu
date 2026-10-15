/**
 * 紫微斗数排盘核心引擎
 */

import type { MutagenSummaryItem, ZiweiInput, ZiweiOutput } from './types.js';
import type { DecadalInfo, DiZhi, PalaceInfo, ScholarStarEntry, SmallLimitEntry, StarInfo } from '../shared/types.js';
import { computeDouJun, computeLiuNianAges, createAstrolabeWithTrueSolar, DI_ZHI, LUCUN_TABLE, mapStar, MUTAGEN_NAMES, normalizePalaceName, type MutagenName } from '../ziwei/shared.js';
import { getAstrolabeMutagens, getZiweiOptions, snapshotZiweiResult } from './profile.js';
export { calculateZiweiHoroscopeData, calculateZiweiHoroscopeDataWithAstrolabe } from '../ziwei-horoscope/calculate.js';
export { createAstrolabeWithTrueSolar } from '../ziwei/shared.js';
export type { ZiweiInput, ZiweiOutput } from './types.js';
export type { ZiweiHoroscopeOutput } from '../ziwei-horoscope/types.js';

// ===== 命主星 =====
const LIFE_MASTER_STAR_TABLE: Record<string, string> = {
  '子': '贪狼', '丑': '巨门', '寅': '禄存', '卯': '文曲',
  '辰': '廉贞', '巳': '武曲', '午': '破军', '未': '武曲',
  '申': '廉贞', '酉': '文曲', '戌': '禄存', '亥': '巨门',
};

// ===== 身主星 =====
const BODY_MASTER_STAR_TABLE: Record<string, string> = {
  '子': '铃星', '丑': '天相', '寅': '天梁', '卯': '天同',
  '辰': '文昌', '巳': '天机', '午': '铃星', '未': '天相',
  '申': '天梁', '酉': '天同', '戌': '文昌', '亥': '天机',
};

// ===== 小限起始宫（三合局） =====
const SMALL_LIMIT_START: Record<string, string> = {
  '寅': '辰', '午': '辰', '戌': '辰',
  '申': '戌', '子': '戌', '辰': '戌',
  '巳': '未', '酉': '未', '丑': '未',
  '亥': '丑', '卯': '丑', '未': '丑',
};

// ===== 博士十二星 =====
const SCHOLAR_STAR_NAMES = ['博士', '力士', '青龙', '小耗', '将军', '奏书', '飞廉', '喜神', '病符', '大耗', '伏兵', '官府'];

// 阳年天干：甲丙戊庚壬
const YANG_STEMS = new Set(['甲', '丙', '戊', '庚', '壬']);

/** 计算命主星（按出生年地支查表） */
function getLifeMasterStar(yearBranch: string): string | undefined {
  return LIFE_MASTER_STAR_TABLE[yearBranch];
}

/** 计算身主星 */
function getBodyMasterStar(yearBranch: string): string | undefined {
  return BODY_MASTER_STAR_TABLE[yearBranch];
}

/** 计算小限 */
function computeSmallLimit(
  yearBranch: string,
  gender: 'male' | 'female',
  palaces: PalaceInfo[],
): SmallLimitEntry[] {
  const startBranch = SMALL_LIMIT_START[yearBranch];
  if (!startBranch) return [];

  const startIdx = DI_ZHI.indexOf(startBranch as DiZhi);
  if (startIdx < 0) return [];

  // male=forward, female=backward
  const direction = gender === 'male' ? 1 : -1;

  const result: SmallLimitEntry[] = [];
  for (let i = 0; i < 12; i++) {
    const branchIdx = ((startIdx + direction * i) % 12 + 12) % 12;
    const branch = DI_ZHI[branchIdx];
    const palace = palaces.find(p => p.earthlyBranch === branch);
    if (!palace) continue;

    // Each palace covers ages in 12-year cycles starting from (i+1)
    const ages: number[] = [];
    for (let age = i + 1; age <= 120; age += 12) {
      ages.push(age);
    }
    result.push({ palaceName: palace.name, ages });
  }
  return result;
}

/** 计算博士十二星 */
function computeScholarStars(
  yearStem: string,
  gender: 'male' | 'female',
  palaces: PalaceInfo[],
): ScholarStarEntry[] {
  const lucunBranch = LUCUN_TABLE[yearStem];
  if (!lucunBranch) return [];

  const startIdx = DI_ZHI.indexOf(lucunBranch as DiZhi);
  if (startIdx < 0) return [];

  // Direction: 阳年+男=顺, 阳年+女=逆, 阴年+男=逆, 阴年+女=顺
  const isYangYear = YANG_STEMS.has(yearStem);
  const isMale = gender === 'male';
  const forward = (isYangYear && isMale) || (!isYangYear && !isMale);
  const direction = forward ? 1 : -1;

  const result: ScholarStarEntry[] = [];
  for (let i = 0; i < 12; i++) {
    const branchIdx = ((startIdx + direction * i) % 12 + 12) % 12;
    const branch = DI_ZHI[branchIdx];
    const palace = palaces.find(p => p.earthlyBranch === branch);
    result.push({
      starName: SCHOLAR_STAR_NAMES[i],
      palaceName: palace?.name ?? branch,
    });
  }
  return result;
}

/** 计算三方四正 */
function computeSanFangSiZheng(palaceIdx: number, palaces: PalaceInfo[]): string[] {
  // self, +4 (三合), +8 (三合), +6 (对宫)
  const indices = [
    palaceIdx,
    (palaceIdx + 4) % 12,
    (palaceIdx + 8) % 12,
    (palaceIdx + 6) % 12,
  ];
  return indices.map(i => {
    const p = palaces.find(palace => (palace.index ?? 0) === i);
    return p?.name ?? '';
  });
}

function parsePillarGanZhi(pillar: string): { gan: string; zhi: string; } {
  return {
    gan: pillar.slice(0, 1) || '',
    zhi: pillar.slice(1, 2) || '',
  };
}

export function calculateZiweiDecadalListWithAstrolabe(
  astrolabe: ReturnType<typeof createAstrolabeWithTrueSolar>['astrolabe'],
): DecadalInfo[] {
  return snapshotZiweiResult(astrolabe.palaces.map((rawPalace) => {
    const decadal = rawPalace.decadal;
    return {
      startAge: decadal?.range?.[0] ?? 0,
      endAge: decadal?.range?.[1] ?? 0,
      heavenlyStem: decadal?.heavenlyStem ?? rawPalace.heavenlyStem,
      palace: {
        earthlyBranch: decadal?.earthlyBranch ?? rawPalace.earthlyBranch,
        name: normalizePalaceName(rawPalace.name),
      },
    };
  }).sort((a: DecadalInfo, b: DecadalInfo) => a.startAge - b.startAge));
}

function buildZiweiOutput(
  input: ZiweiInput,
  astrolabe: ReturnType<typeof createAstrolabeWithTrueSolar>['astrolabe'],
  timeIndex: number,
  trueSolarTimeInfo?: ReturnType<typeof createAstrolabeWithTrueSolar>['trueSolarTimeInfo'],
): ZiweiOutput {
  const mutagenSummary: MutagenSummaryItem[] = [];

  // 转换宫位数据
  const palaces: PalaceInfo[] = astrolabe.palaces.map((palace, idx: number) => {
    // 收集四化分布
    for (const star of [...palace.majorStars, ...palace.minorStars]) {
      if (star.mutagen && MUTAGEN_NAMES.includes(star.mutagen as MutagenName)) {
        mutagenSummary.push({
          mutagen: star.mutagen as MutagenName,
          starName: star.name,
          palaceName: normalizePalaceName(palace.name),
        });
      }
    }

    return {
      name: normalizePalaceName(palace.name),
      heavenlyStem: palace.heavenlyStem,
      earthlyBranch: palace.earthlyBranch,
      isBodyPalace: palace.isBodyPalace,
      index: palace.index ?? idx,
      isOriginalPalace: palace.isOriginalPalace ?? false,
      changsheng12: palace.changsheng12,
      boshi12: palace.boshi12,
      jiangqian12: palace.jiangqian12,
      suiqian12: palace.suiqian12,
      ages: palace.ages,
      decadalRange: palace.decadal?.range ? [palace.decadal.range[0], palace.decadal.range[1]] as [number, number] : undefined,
      majorStars: palace.majorStars.map(mapStar),
      minorStars: palace.minorStars.map(mapStar),
      adjStars: (palace.adjectiveStars || []).map(mapStar),
    };
  });

  // 每次查询都要安装并恢复 iztro 全局配置；同一命盘只有十个宫干，每干只查一次
  const mutagensByStem = new Map<string, string[]>();
  const getStemMutagens = (stem: string): string[] => {
    let stars = mutagensByStem.get(stem);
    if (!stars) {
      stars = getAstrolabeMutagens(astrolabe, stem);
      mutagensByStem.set(stem, stars);
    }
    return stars;
  };

  // 宫干自化标注（离心 + 向心）
  for (const palace of palaces) {
    const allStars: StarInfo[] = [...palace.majorStars, ...palace.minorStars, ...(palace.adjStars || [])];

    // 离心自化：本宫宫干四化落回本宫
    const selfMutagenStars = getStemMutagens(palace.heavenlyStem);
    if (selfMutagenStars) {
      for (const star of allStars) {
        const mIdx = selfMutagenStars.indexOf(star.name);
        if (mIdx >= 0) star.selfMutagen = MUTAGEN_NAMES[mIdx];
      }
    }

    // 向心自化：对宫宫干四化飞入本宫
    const palaceIdx = palace.index ?? 0;
    const oppositeIdx = (palaceIdx + 6) % 12;
    const oppositePalace = palaces.find(p => (p.index ?? 0) === oppositeIdx);
    if (oppositePalace) {
      const oppMutagenStars = getStemMutagens(oppositePalace.heavenlyStem);
      if (oppMutagenStars) {
        for (const star of allStars) {
          const mIdx = oppMutagenStars.indexOf(star.name);
          if (mIdx >= 0) star.oppositeMutagen = MUTAGEN_NAMES[mIdx];
        }
      }
    }
  }

  // 获取四柱
  const pillars = (astrolabe.chineseDate || '').split(' ');

  // 流年虚岁：从年柱第二个字取出生年地支
  const yearPillar = pillars[0] || '';
  const birthYearBranch = yearPillar.length >= 2 ? yearPillar[1] : '';
  if (birthYearBranch) {
    for (const palace of palaces) {
      palace.liuNianAges = computeLiuNianAges(palace.earthlyBranch as DiZhi, birthYearBranch as DiZhi);
    }
  }

  // 斗君计算
  let douJun: string | undefined;
  const rawDates = (astrolabe as unknown as Record<string, unknown>).rawDates as
    { lunarDate?: { lunarMonth: number; lunarDay: number; isLeap?: boolean; }; } | undefined;
  if (rawDates?.lunarDate) {
    const { lunarMonth, lunarDay, isLeap } = rawDates.lunarDate;
    const adjustedMonth = lunarMonth + (isLeap && getZiweiOptions(astrolabe).fixLeap && lunarDay > 15 ? 1 : 0);
    douJun = computeDouJun(adjustedMonth, timeIndex);
  }

  // 三方四正
  for (const palace of palaces) {
    const idx = palace.index ?? 0;
    palace.sanFangSiZheng = computeSanFangSiZheng(idx, palaces);
  }

  // 命主星 & 身主星
  const yearStem = yearPillar.length >= 2 ? yearPillar[0] : '';
  const lifeMasterStar = birthYearBranch ? getLifeMasterStar(birthYearBranch) : undefined;
  const bodyMasterStar = birthYearBranch ? getBodyMasterStar(birthYearBranch) : undefined;

  // 小限
  const smallLimit = birthYearBranch
    ? computeSmallLimit(birthYearBranch, input.gender, palaces)
    : undefined;

  // 博士十二星
  const scholarStars = (yearStem && birthYearBranch)
    ? computeScholarStars(yearStem, input.gender, palaces)
    : undefined;

  // 提取大限数据
  const decadalList = calculateZiweiDecadalListWithAstrolabe(astrolabe);

  return snapshotZiweiResult({
    solarDate: astrolabe.solarDate || '',
    lunarDate: astrolabe.lunarDate || '',
    fourPillars: {
      year: parsePillarGanZhi(pillars[0] || ''),
      month: parsePillarGanZhi(pillars[1] || ''),
      day: parsePillarGanZhi(pillars[2] || ''),
      hour: parsePillarGanZhi(pillars[3] || ''),
    },
    soul: astrolabe.soul || '',
    body: astrolabe.body || '',
    fiveElement: astrolabe.fiveElementsClass || '',
    zodiac: astrolabe.zodiac || '',
    sign: astrolabe.sign || '',
    palaces,
    decadalList,
    earthlyBranchOfSoulPalace: astrolabe.earthlyBranchOfSoulPalace,
    earthlyBranchOfBodyPalace: astrolabe.earthlyBranchOfBodyPalace,
    time: astrolabe.time,
    timeRange: astrolabe.timeRange,
    mutagenSummary,
    gender: input.gender,
    douJun,
    trueSolarTimeInfo,
    lifeMasterStar,
    bodyMasterStar,
    smallLimit,
    scholarStars,
    calculationOptions: getZiweiOptions(astrolabe),
  });
}

export function calculateZiweiDataWithAstrolabe(input: ZiweiInput): {
  output: ZiweiOutput;
  astrolabe: ReturnType<typeof createAstrolabeWithTrueSolar>['astrolabe'];
} {
  const { astrolabe, timeIndex, trueSolarTimeInfo } = createAstrolabeWithTrueSolar(input);
  return {
    output: buildZiweiOutput(input, astrolabe, timeIndex, trueSolarTimeInfo),
    astrolabe,
  };
}

export function calculateZiweiData(input: ZiweiInput): ZiweiOutput {
  return calculateZiweiDataWithAstrolabe(input).output;
}
