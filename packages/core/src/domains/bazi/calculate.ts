/**
 * 八字计算核心引擎
 */

import { Lunar, LunarMonth, LunarYear, Solar } from 'lunar-javascript';
import { resolveTrueSolarDateTimeFromInstant } from '../shared/true-solar.js';
import { CoreInputError, assertInteger, createUtcDateTime, parseCivilDate, resolveEnum, validateCivilDateTime } from '../../shared/validation.js';
import { DEFAULT_DIVINATION_TIMEZONE, getZonedDateTimeParts, zonedTimeToUtc } from '../../shared/timezone-utils.js';
import { calculatePillarShenSha as calculateSharedPillarShenSha } from '../shared/shensha.js';
import type {
  BaziFiveElementsStats,
  BaziInput,
  BaziLiuRiInfo,
  BaziLiuYueInfo,
  BaziOutput,
  BaziShenShaOutput,
  PillarInfo,
} from './types.js';
import type {
  DiZhiBanHeItem,
  DiZhiSanHuiItem,
  HiddenStemInfo,
  PillarKongWangInfo,
  PillarPosition,
  PillarRelation,
  StemPosition,
  TianGanChongKeItem,
  TianGanWuHeItem,
  TrueSolarTimeInfo,
} from '../shared/types.js';
import {
  calculateTenGod,
  getDiShi as getDiShiCore,
  getKongWang,
  STEM_ELEMENTS,
  ZHI_WUXING,
} from '../../shared/utils.js';
// 从数据模块导入静态数据
import {
  CI_GUAN,
  DE_XIU,
  DI_ZHI,
  DIAO_KE,
  FEI_REN,
  FU_XING,
  GU_CHEN,
  GUA_SU,
  GUO_YIN,
  HIDDEN_STEM_DETAILS,
  HONG_LUAN,
  HONG_YAN,
  HUA_GAI,
  JIANG_XING,
  JIE_SHA,
  JIN_YU,
  LIU_CHONG,
  LIU_HE,
  LIU_HE_HUA,
  LIU_XIA,
  LU_SHEN,
  NA_YIN_TABLE,
  SAN_HE,
  SANG_MEN,
  TAI_JI_GUI_REN,
  TAO_HUA,
  TIAN_CHU,
  TIAN_DE,
  TIAN_DE_HE,
  TIAN_GAN,
  TIAN_XI,
  TIAN_YI_GUI_REN,
  WANG_SHEN,
  WEN_CHANG,
  XIANG_HAI,
  XIANG_XING,
  YANG_REN,
  YI_MA,
  YUE_DE,
  YUE_DE_HE,
  ZAI_SHA,
} from '../../data/shensha.js';

export type {
  BaziFiveElementsStats,
  BaziInput,
  BaziLiuRiInfo,
  BaziLiuYueInfo,
  BaziOutput,
  BaziShenShaOutput,
  PillarInfo,
} from './types.js';
export type {
  HiddenStemInfo,
  PillarRelation,
} from '../shared/types.js';

type PillarShenShaByPosition = {
  year: string[];
  month: string[];
  day: string[];
  hour: string[];
};

type FortuneRuntimeContext = {
  dayStem: string;
  dayBranch: string;
  yearBranch: string;
};

export function getNaYin(stem: string, branch: string): string {
  return NA_YIN_TABLE[`${stem}${branch}`] || '';
}

export const getDiShi = getDiShiCore;

/** 从纳音字符串提取五行（最后一个字：金/木/水/火/土） */
export function getNaYinElement(nayin: string): string {
  if (!nayin) return '';
  const last = nayin.charAt(nayin.length - 1);
  return ['金', '木', '水', '火', '土'].includes(last) ? last : '';
}

export function calculateBaziFiveElementsStats(
  fourPillars: BaziOutput['fourPillars'],
): BaziFiveElementsStats {
  const stats: BaziFiveElementsStats = { 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 };
  const hiddenStemWeights = [0.6, 0.3, 0.1];
  const pillars = [fourPillars.year, fourPillars.month, fourPillars.day, fourPillars.hour];

  for (const pillar of pillars) {
    const stemElement = STEM_ELEMENTS[pillar.stem];
    if (stemElement && stemElement in stats) {
      stats[stemElement as keyof BaziFiveElementsStats] += 1;
    }

    const branchElement = ZHI_WUXING[pillar.branch];
    if (branchElement && branchElement in stats) {
      stats[branchElement as keyof BaziFiveElementsStats] += 1;
    }

    for (let i = 0; i < pillar.hiddenStems.length; i++) {
      const hiddenStem = pillar.hiddenStems[i]?.stem;
      const hiddenElement = hiddenStem ? STEM_ELEMENTS[hiddenStem] : '';
      const weight = hiddenStemWeights[i] ?? 0.1;
      if (hiddenElement && hiddenElement in stats) {
        stats[hiddenElement as keyof BaziFiveElementsStats] += weight;
      }
    }
  }

  for (const key of Object.keys(stats) as Array<keyof BaziFiveElementsStats>) {
    stats[key] = Math.round(stats[key] * 10) / 10;
  }

  return stats;
}

export function buildHiddenStems(branch: string, dayStem: string): HiddenStemInfo[] {
  const stems = HIDDEN_STEM_DETAILS[branch] || [];
  return stems.map((item) => ({
    stem: item.stem,
    qiType: item.qiType,
    tenGod: calculateTenGod(dayStem, item.stem),
  }));
}

function buildPillarKongWang(branch: string, kongWang: { xun: string; kongZhi: [string, string]; }): PillarKongWangInfo {
  return {
    isKong: kongWang.kongZhi.includes(branch),
  };
}

function createPillar(stem: string, branch: string, dayStem: string): PillarInfo {
  return {
    stem,
    branch,
    tenGod: calculateTenGod(dayStem, stem),
    hiddenStems: buildHiddenStems(branch, dayStem),
    naYin: getNaYin(stem, branch),
    diShi: getDiShiCore(dayStem, branch),
    shenSha: [],
    kongWang: { isKong: false },
  };
}

const PILLAR_POSITION_MAP: Record<string, PillarPosition> = {
  year: '年支',
  month: '月支',
  day: '日支',
  hour: '时支',
  yearBranch: '年支',
  monthBranch: '月支',
  dayBranch: '日支',
  hourBranch: '时支',
  YearBranch: '年支',
  MonthBranch: '月支',
  DayBranch: '日支',
  HourBranch: '时支',
  年: '年支',
  月: '月支',
  日: '日支',
  时: '时支',
  年柱: '年支',
  月柱: '月支',
  日柱: '日支',
  时柱: '时支',
  年支: '年支',
  月支: '月支',
  日支: '日支',
  时支: '时支',
};

function normalizePillarPosition(label: string): PillarPosition {
  const normalized = PILLAR_POSITION_MAP[label];
  if (!normalized) {
    throw new Error(`无效的柱位标签: ${label}`);
  }
  return normalized;
}

// ===== 天干五合 =====
const TIAN_GAN_WU_HE_RESULT: Record<string, string> = {
  '甲己': '土', '己甲': '土',
  '乙庚': '金', '庚乙': '金',
  '丙辛': '水', '辛丙': '水',
  '丁壬': '木', '壬丁': '木',
  '戊癸': '火', '癸戊': '火',
};

function analyzeTianGanWuHe(
  yearStem: string, monthStem: string, dayStem: string, hourStem: string,
): TianGanWuHeItem[] {
  const stems = [yearStem, monthStem, dayStem, hourStem];
  const stemNames: StemPosition[] = ['年干', '月干', '日干', '时干'];
  const result: TianGanWuHeItem[] = [];

  // Check all pillar pairs (including day master vs. non-adjacent stems)
  for (let i = 0; i < stems.length; i++) {
    for (let j = i + 1; j < stems.length; j++) {
      const pair = `${stems[i]}${stems[j]}`;
      const element = TIAN_GAN_WU_HE_RESULT[pair];
      if (element) {
        result.push({
          stemA: stems[i],
          stemB: stems[j],
          resultElement: element,
          positions: [stemNames[i], stemNames[j]],
        });
      }
    }
  }

  return result;
}

// ===== 地支半合 =====
const BAN_HE_PAIRS: Array<{
  pair: [string, string];
  missing: string;
  element: string;
}> = [
    { pair: ['申', '子'], missing: '辰', element: '水' },
    { pair: ['子', '辰'], missing: '申', element: '水' },
    { pair: ['亥', '卯'], missing: '未', element: '木' },
    { pair: ['卯', '未'], missing: '亥', element: '木' },
    { pair: ['寅', '午'], missing: '戌', element: '火' },
    { pair: ['午', '戌'], missing: '寅', element: '火' },
    { pair: ['巳', '酉'], missing: '丑', element: '金' },
    { pair: ['酉', '丑'], missing: '巳', element: '金' },
  ];

function analyzeDiZhiBanHe(
  yearBranch: string, monthBranch: string, dayBranch: string, hourBranch: string,
): DiZhiBanHeItem[] {
  const branches = [yearBranch, monthBranch, dayBranch, hourBranch];
  const pillarNames: PillarPosition[] = ['年支', '月支', '日支', '时支'];
  const result: DiZhiBanHeItem[] = [];
  const seen = new Set<string>();

  for (const banHe of BAN_HE_PAIRS) {
    const [a, b] = banHe.pair;
    const positionsA = branches.map((br, i) => br === a ? i : -1).filter(i => i >= 0);
    const positionsB = branches.map((br, i) => br === b ? i : -1).filter(i => i >= 0);

    if (positionsA.length > 0 && positionsB.length > 0) {
      // Check the full 三合 is NOT present (半合 only when the third is missing)
      if (branches.includes(banHe.missing)) continue;

      const key = [a, b].sort().join('') + banHe.element;
      if (seen.has(key)) continue;
      seen.add(key);

      const positions = [...positionsA, ...positionsB].map(i => pillarNames[i]);
      result.push({
        branches: [a, b],
        resultElement: banHe.element,
        missingBranch: banHe.missing,
        positions,
      });
    }
  }

  return result;
}

// ===== 天干冲克 =====
const TIAN_GAN_CHONG_KE: Array<[string, string]> = [
  ['甲', '庚'], ['乙', '辛'], ['丙', '壬'], ['丁', '癸'],
];

function analyzeTianGanChongKe(
  yearStem: string, monthStem: string, dayStem: string, hourStem: string,
): TianGanChongKeItem[] {
  const stems = [yearStem, monthStem, dayStem, hourStem];
  const stemNames: StemPosition[] = ['年干', '月干', '日干', '时干'];
  const result: TianGanChongKeItem[] = [];

  for (let i = 0; i < stems.length; i++) {
    for (let j = i + 1; j < stems.length; j++) {
      for (const [a, b] of TIAN_GAN_CHONG_KE) {
        if ((stems[i] === a && stems[j] === b) || (stems[i] === b && stems[j] === a)) {
          result.push({
            stemA: stems[i],
            stemB: stems[j],
            positions: [stemNames[i], stemNames[j]],
          });
        }
      }
    }
  }

  return result;
}

// ===== 地支三会（方局） =====
const SAN_HUI: Array<{ branches: [string, string, string]; element: string; }> = [
  { branches: ['寅', '卯', '辰'], element: '木' },
  { branches: ['巳', '午', '未'], element: '火' },
  { branches: ['申', '酉', '戌'], element: '金' },
  { branches: ['亥', '子', '丑'], element: '水' },
];

function analyzeDiZhiSanHui(
  yearBranch: string, monthBranch: string, dayBranch: string, hourBranch: string,
): DiZhiSanHuiItem[] {
  const branches = [yearBranch, monthBranch, dayBranch, hourBranch];
  const pillarNames: PillarPosition[] = ['年支', '月支', '日支', '时支'];
  const result: DiZhiSanHuiItem[] = [];

  for (const hui of SAN_HUI) {
    const matchIndices = branches
      .map((b, i) => hui.branches.includes(b) ? i : -1)
      .filter(i => i >= 0);
    const matchedUnique = new Set(matchIndices.map(i => branches[i]));
    if (matchedUnique.size === 3) {
      result.push({
        branches: hui.branches,
        resultElement: hui.element,
        positions: matchIndices.map(i => pillarNames[i]),
      });
    }
  }

  return result;
}

// ===== 胎元计算 =====
// 胎元 = 月干进一位 + 月支进三位
function calculateTaiYuan(monthStem: string, monthBranch: string): string {
  const stemIdx = TIAN_GAN.indexOf(monthStem as typeof TIAN_GAN[number]);
  const branchIdx = DI_ZHI.indexOf(monthBranch as typeof DI_ZHI[number]);
  if (stemIdx < 0 || branchIdx < 0) return '';
  const newStem = TIAN_GAN[(stemIdx + 1) % 10];
  const newBranch = DI_ZHI[(branchIdx + 3) % 12];
  return `${newStem}${newBranch}`;
}

// ===== 命宫计算 =====
// 从子宫起正月逆数到生月，再于生月宫起生时顺数，数到卯时所落之宫为命宫
// （与 lunar-javascript getMingGong 的「14/26 减月支数与时支数之和」等价）
// 天干用五虎遁月法：甲己→丙寅, 乙庚→戊寅, 丙辛→庚寅, 丁壬→壬寅, 戊癸→甲寅
function calculateMingGong(yearStem: string, monthBranch: string, hourBranch: string): string {
  const ziIdx = DI_ZHI.indexOf('子'); // 0
  const maoIdx = DI_ZHI.indexOf('卯'); // 3
  const monthIdx = DI_ZHI.indexOf(monthBranch as typeof DI_ZHI[number]);
  const hourIdx = DI_ZHI.indexOf(hourBranch as typeof DI_ZHI[number]);
  if (monthIdx < 0 || hourIdx < 0) return '';

  // 月支对应月份：寅=1月, 卯=2月, ..., 丑=12月
  const yinIdx = DI_ZHI.indexOf('寅'); // 2
  const monthNum = (monthIdx - yinIdx + 12) % 12 + 1;

  const monthPalaceIdx = (ziIdx - (monthNum - 1) + 12) % 12;
  // 生时越晚，数到卯时经过的宫越少：时支每进一位，命宫退一宫
  const mingBranchIdx = (monthPalaceIdx + maoIdx - hourIdx + 12) % 12;
  const mingBranch = DI_ZHI[mingBranchIdx];

  // 五虎遁月法：年干 → 寅月起始天干
  const WU_HU_DUN: Record<string, number> = {
    '甲': 2, '己': 2,  // 丙寅 → TIAN_GAN[2]=丙
    '乙': 4, '庚': 4,  // 戊寅
    '丙': 6, '辛': 6,  // 庚寅
    '丁': 8, '壬': 8,  // 壬寅
    '戊': 0, '癸': 0,  // 甲寅
  };
  const baseStemIdx = WU_HU_DUN[yearStem];
  if (baseStemIdx === undefined) return mingBranch;

  // 寅月天干 = baseStemIdx, 命宫地支距寅的偏移 = (mingBranchIdx - yinIdx + 12) % 12
  const offset = (mingBranchIdx - yinIdx + 12) % 12;
  const mingStem = TIAN_GAN[(baseStemIdx + offset) % 10];
  return `${mingStem}${mingBranch}`;
}

export function analyzePillarRelations(yearBranch: string, monthBranch: string, dayBranch: string, hourBranch: string): PillarRelation[] {
  const branches = [yearBranch, monthBranch, dayBranch, hourBranch];
  const pillarNames = ['year', 'month', 'day', 'hour'] as const;
  const relations: PillarRelation[] = [];

  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      if (LIU_HE[branches[i]] === branches[j]) {
        const huaElement = LIU_HE_HUA[branches[i]] || '';
        relations.push({
          type: '合',
          pillars: [normalizePillarPosition(pillarNames[i]), normalizePillarPosition(pillarNames[j])],
          description: `${branches[i]}${branches[j]}六合${huaElement ? '化' + huaElement : ''}`,
        });
      }
    }
  }

  for (const sanHe of SAN_HE) {
    const matchingBranches = branches.filter((b) => sanHe.branches.includes(b));
    const uniqueBranches = Array.from(new Set(matchingBranches));
    if (uniqueBranches.length >= 2) {
      const matchingPillars = branches
        .map((b, i) => (sanHe.branches.includes(b) ? normalizePillarPosition(pillarNames[i]) : null))
        .filter(Boolean) as PillarPosition[];

      if (uniqueBranches.length === 3) {
        relations.push({
          type: '合',
          pillars: matchingPillars,
          description: `${uniqueBranches.join('')}三合${sanHe.element}`,
        });
      } else {
        relations.push({
          type: '合',
          pillars: matchingPillars,
          description: `${uniqueBranches.join('')}半合${sanHe.element}`,
        });
      }
    }
  }

  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      if (LIU_CHONG[branches[i]] === branches[j]) {
        relations.push({
          type: '冲',
          pillars: [normalizePillarPosition(pillarNames[i]), normalizePillarPosition(pillarNames[j])],
          description: `${branches[i]}${branches[j]}相冲`,
        });
      }
    }
  }

  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      if (XIANG_HAI[branches[i]] === branches[j]) {
        relations.push({
          type: '害',
          pillars: [normalizePillarPosition(pillarNames[i]), normalizePillarPosition(pillarNames[j])],
          description: `${branches[i]}${branches[j]}相害`,
        });
      }
    }
  }

  for (const xing of XIANG_XING) {
    const matchingBranches = branches.filter((b) => xing.combination.includes(b));
    if (xing.combination.length === 1) {
      const count = branches.filter((b) => b === xing.combination[0]).length;
      if (count >= 2) {
        const matchingPillars = branches
          .map((b, i) => (b === xing.combination[0] ? normalizePillarPosition(pillarNames[i]) : null))
          .filter(Boolean) as PillarPosition[];
        relations.push({
          type: '刑',
          pillars: matchingPillars,
          description: xing.name,
        });
      }
    } else if (new Set(matchingBranches).size >= 2) {
      const matchingPillars = branches
        .map((b, i) => (xing.combination.includes(b) ? normalizePillarPosition(pillarNames[i]) : null))
        .filter(Boolean) as PillarPosition[];
      relations.push({
        type: '刑',
        pillars: matchingPillars,
        description: xing.name,
      });
    }
  }

  return relations;
}

export function calculateBaziPillarShenSha(params: {
  yearStem: string;
  yearBranch: string;
  monthStem: string;
  monthBranch: string;
  dayStem: string;
  dayBranch: string;
  hourStem: string;
  hourBranch: string;
  kongWang: { xun: string; kongZhi: [string, string]; };
  yearNaYinElement?: string;
}): PillarShenShaByPosition {
  const shenSha = calculateSharedPillarShenSha(params);
  const {
    yearStem,
    yearBranch,
    monthBranch,
    dayStem,
    dayBranch,
    hourStem,
    hourBranch,
  } = params;

  const pushUnique = (position: keyof PillarShenShaByPosition, name: string) => {
    if (!shenSha[position].includes(name)) {
      shenSha[position].push(name);
    }
  };

  const jinYuBranch = JIN_YU[dayStem];
  if (jinYuBranch === yearBranch) pushUnique('year', '金舆');
  if (jinYuBranch === monthBranch) pushUnique('month', '金舆');
  if (jinYuBranch === dayBranch) pushUnique('day', '金舆');
  if (jinYuBranch === hourBranch) pushUnique('hour', '金舆');

  const yueDeStem = YUE_DE[monthBranch];
  if (yueDeStem === yearStem) pushUnique('year', '月德贵人');
  if (yueDeStem === dayStem) pushUnique('day', '月德贵人');
  if (yueDeStem === hourStem) pushUnique('hour', '月德贵人');

  const tianDeChar = TIAN_DE[monthBranch];
  if (tianDeChar === yearStem || tianDeChar === yearBranch) pushUnique('year', '天德贵人');
  if (tianDeChar === dayStem || tianDeChar === dayBranch) pushUnique('day', '天德贵人');
  if (tianDeChar === hourStem || tianDeChar === hourBranch) pushUnique('hour', '天德贵人');

  const deXiuStems = DE_XIU[monthBranch] || [];
  if (deXiuStems.includes(dayStem)) pushUnique('day', '德秀贵人');
  if (deXiuStems.includes(hourStem)) pushUnique('hour', '德秀贵人');

  const tianDeHeChar = TIAN_DE_HE[monthBranch];
  if (tianDeHeChar === yearStem || tianDeHeChar === yearBranch) pushUnique('year', '天德合');
  if (tianDeHeChar === dayStem || tianDeHeChar === dayBranch) pushUnique('day', '天德合');
  if (tianDeHeChar === hourStem || tianDeHeChar === hourBranch) pushUnique('hour', '天德合');

  const yueDeHeStem = YUE_DE_HE[monthBranch];
  if (yueDeHeStem === yearStem) pushUnique('year', '月德合');
  if (yueDeHeStem === dayStem) pushUnique('day', '月德合');
  if (yueDeHeStem === hourStem) pushUnique('hour', '月德合');

  return shenSha;
}

export function calculateBaziFortuneShenSha(params: {
  targetBranch: string;
  dayStem: string;
  dayBranch: string;
  yearBranch: string;
}): string[] {
  const { targetBranch, dayStem, dayBranch, yearBranch } = params;
  const names: string[] = [];

  const addUnique = (name: string) => {
    if (name && !names.includes(name)) {
      names.push(name);
    }
  };

  // 日干查
  if ((TIAN_YI_GUI_REN[dayStem] || []).includes(targetBranch)) addUnique('天乙贵人');
  if ((TAI_JI_GUI_REN[dayStem] || []).includes(targetBranch)) addUnique('太极贵人');
  if (LU_SHEN[dayStem] === targetBranch) addUnique('禄神');
  if (YANG_REN[dayStem] === targetBranch) addUnique('羊刃');
  if (WEN_CHANG[dayStem] === targetBranch) addUnique('文昌');
  if (JIN_YU[dayStem] === targetBranch) addUnique('金舆');
  if (TIAN_CHU[dayStem] === targetBranch) addUnique('天厨');
  if (GUO_YIN[dayStem] === targetBranch) addUnique('国印');
  if (CI_GUAN[dayStem] === targetBranch) addUnique('词馆');
  if (LIU_XIA[dayStem] === targetBranch) addUnique('流霞');
  if (HONG_YAN[dayStem] === targetBranch) addUnique('红艳');
  if (FEI_REN[dayStem] === targetBranch) addUnique('飞刃');
  if (FU_XING[dayStem] === targetBranch) addUnique('福星');

  // 日支查
  if (YI_MA[dayBranch] === targetBranch) addUnique('驿马');
  if (TAO_HUA[dayBranch] === targetBranch) addUnique('桃花');
  if (HUA_GAI[dayBranch] === targetBranch) addUnique('华盖');
  if (JIE_SHA[dayBranch] === targetBranch) addUnique('劫煞');
  if (WANG_SHEN[dayBranch] === targetBranch) addUnique('亡神');

  // 年支查
  if (GU_CHEN[yearBranch] === targetBranch) addUnique('孤辰');
  if (GUA_SU[yearBranch] === targetBranch) addUnique('寡宿');
  if (JIANG_XING[yearBranch] === targetBranch) addUnique('将星');
  if (HONG_LUAN[yearBranch] === targetBranch) addUnique('红鸾');
  if (TIAN_XI[yearBranch] === targetBranch) addUnique('天喜');
  if (DIAO_KE[yearBranch] === targetBranch) addUnique('吊客');
  if (SANG_MEN[yearBranch] === targetBranch) addUnique('丧门');
  if (ZAI_SHA[yearBranch] === targetBranch) addUnique('灾煞');

  return names;
}

export function calculateBaziLiuYueData(year: number, context?: FortuneRuntimeContext): BaziLiuYueInfo[] {
  assertInteger(year, 'year', 1, 9998);
  const jieQiConfig = [
    { month: 2, jieQi: '立春' },
    { month: 3, jieQi: '惊蛰' },
    { month: 4, jieQi: '清明' },
    { month: 5, jieQi: '立夏' },
    { month: 6, jieQi: '芒种' },
    { month: 7, jieQi: '小暑' },
    { month: 8, jieQi: '立秋' },
    { month: 9, jieQi: '白露' },
    { month: 10, jieQi: '寒露' },
    { month: 11, jieQi: '立冬' },
    { month: 12, jieQi: '大雪' },
    { month: 1, jieQi: '小寒' },
  ] as const;

  const liuYue: BaziLiuYueInfo[] = [];
  const jieQiTable = Solar.fromYmd(year, 6, 15).getLunar().getJieQiTable();
  const nextYearJieQiTable = Solar.fromYmd(year + 1, 6, 15).getLunar().getJieQiTable();

  const formatYmd = (date: Date) => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const toDate = (solar: Solar) => createUtcDateTime({ year: solar.getYear(), month: solar.getMonth(), day: solar.getDay() });

  for (let i = 0; i < 12; i++) {
    const config = jieQiConfig[i];
    const segmentYear = config.month === 1 ? year + 1 : year;
    const startTable = segmentYear === year ? jieQiTable : nextYearJieQiTable;
    const startSolar = startTable[config.jieQi];
    if (!startSolar) throw new Error(`缺少${segmentYear}年${config.jieQi}时刻`);

    const nextConfig = jieQiConfig[(i + 1) % 12];
    const nextSegmentYear = config.month === 1
      ? year + 1
      : (nextConfig.month === 1 ? year + 1 : year);
    const nextTable = nextSegmentYear === year ? jieQiTable : nextYearJieQiTable;
    const nextStartSolar = nextTable[nextConfig.jieQi];
    if (!nextStartSolar) throw new Error(`缺少${nextSegmentYear}年${nextConfig.jieQi}时刻`);

    const startDate = toDate(startSolar);
    const endDate = new Date(toDate(nextStartSolar).getTime() - 24 * 60 * 60 * 1000);
    const monthLunar = startSolar.getLunar();

    const ganZhi = monthLunar.getMonthInGanZhiExact();
    const gan = ganZhi[0] || '';
    const zhi = ganZhi[1] || '';
    const hiddenStems = context ? buildHiddenStems(zhi, context.dayStem) : undefined;

    liuYue.push({
      month: i + 1,
      ganZhi,
      jieQi: config.jieQi,
      startDate: formatYmd(startDate),
      endDate: formatYmd(endDate),
      startDateTime: startSolar.toYmdHms(),
      endDateTime: nextStartSolar.toYmdHms(),
      endExclusive: true,
      timezone: DEFAULT_DIVINATION_TIMEZONE,
      gan: gan || undefined,
      zhi: zhi || undefined,
      tenGod: context && gan ? calculateTenGod(context.dayStem, gan) : undefined,
      hiddenStems,
      naYin: gan && zhi ? getNaYin(gan, zhi) : undefined,
      diShi: context && zhi ? getDiShi(context.dayStem, zhi) : undefined,
      shenSha: context && zhi
        ? calculateBaziFortuneShenSha({
          targetBranch: zhi,
          dayStem: context.dayStem,
          dayBranch: context.dayBranch,
          yearBranch: context.yearBranch,
        })
        : undefined,
    });
  }

  return liuYue;
}

export function calculateBaziLiuRiData(startDate: string, endDate: string, context?: FortuneRuntimeContext): BaziLiuRiInfo[] {
  const start = createUtcDateTime(parseCivilDate(startDate, 'startDate'));
  const end = createUtcDateTime(parseCivilDate(endDate, 'endDate'));
  const count = (end.getTime() - start.getTime()) / 86400000 + 1;
  if (count < 1 || count > 3660) throw new CoreInputError('dateRange', '结束日期需在开始日期之后，最多支持3660天');
  const days: BaziLiuRiInfo[] = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const day = cursor.getUTCDate();
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();
    const ganZhi = lunar.getDayInGanZhi();

    const gan = ganZhi[0] || '';
    const zhi = ganZhi[1] || '';
    const hiddenStems = context ? buildHiddenStems(zhi, context.dayStem) : undefined;

    days.push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      ganZhi,
      gan,
      zhi,
      tenGod: context && gan ? calculateTenGod(context.dayStem, gan) : undefined,
      hiddenStems,
      naYin: gan && zhi ? getNaYin(gan, zhi) : undefined,
      diShi: context && zhi ? getDiShi(context.dayStem, zhi) : undefined,
      shenSha: context && zhi
        ? calculateBaziFortuneShenSha({
          targetBranch: zhi,
          dayStem: context.dayStem,
          dayBranch: context.dayBranch,
          yearBranch: context.yearBranch,
        })
        : undefined,
    });
  }

  return days;
}

function validateLunarDateInput(params: {
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  birthHour: number;
  birthMinute: number;
  isLeapMonth: boolean;
}): { solar: ReturnType<typeof Solar.fromYmdHms>; lunar: ReturnType<typeof Lunar.fromYmdHms>; } {
  const {
    birthYear,
    birthMonth,
    birthDay,
    birthHour,
    birthMinute,
    isLeapMonth,
  } = params;

  if (!Number.isInteger(birthMonth) || birthMonth < 1 || birthMonth > 12) {
    throw new Error(`农历月份无效：${birthMonth}月不存在。请输入 1-12 之间的整数。`);
  }

  const leapMonth = LunarYear.fromYear(birthYear).getLeapMonth();
  if (isLeapMonth && leapMonth !== birthMonth) {
    throw new Error(`农历闰月无效：${birthYear}年没有闰${birthMonth}月，请检查该年是否有闰月。`);
  }

  const lunarMonth = isLeapMonth ? -Math.abs(birthMonth) : birthMonth;
  let lunarMonthInfo: ReturnType<typeof LunarMonth.fromYm>;
  try {
    lunarMonthInfo = LunarMonth.fromYm(birthYear, lunarMonth);
  } catch {
    throw new Error(`农历月份无效：${birthYear}年${isLeapMonth ? '闰' : ''}${birthMonth}月不存在。`);
  }
  if (!lunarMonthInfo) {
    throw new Error(`农历月份无效：${birthYear}年${isLeapMonth ? '闰' : ''}${birthMonth}月不存在。`);
  }

  const dayCount = lunarMonthInfo.getDayCount();
  if (birthDay < 1 || birthDay > dayCount) {
    throw new Error(`农历日期无效：${birthYear}年${isLeapMonth ? '闰' : ''}${birthMonth}月只有${dayCount}天，请输入 1-${dayCount} 之间的日期。`);
  }

  let lunar: ReturnType<typeof Lunar.fromYmdHms>;
  try {
    lunar = Lunar.fromYmdHms(birthYear, lunarMonth, birthDay, birthHour, birthMinute, 0);
  } catch {
    throw new Error(`农历日期无效：${birthYear}年${isLeapMonth ? '闰' : ''}${birthMonth}月${birthDay}日不存在，请检查日期是否正确。`);
  }
  return {
    solar: lunar.getSolar(),
    lunar,
  };
}

export function resolveBaziCalendarContext(input: BaziInput): {
  solar: ReturnType<typeof Solar.fromYmdHms>;
  lunar: ReturnType<typeof Lunar.fromYmdHms>;
  termLunar: ReturnType<typeof Lunar.fromYmdHms>;
  trueSolarTimeInfo?: TrueSolarTimeInfo;
} {
  const {
    birthYear,
    birthMonth,
    birthDay,
    birthHour,
    birthMinute = 0,
    calendarType = 'solar',
    isLeapMonth = false,
    longitude,
  } = input;

  if (input.gender !== 'male' && input.gender !== 'female') throw new CoreInputError('gender', '必须为 male 或 female');
  resolveEnum(calendarType, ['solar', 'lunar'], 'solar', 'calendarType');
  resolveEnum(input.dayBoundary, ['midnight', 'zi'], 'midnight', 'dayBoundary');
  const disambiguation = resolveEnum(input.disambiguation, ['reject', 'earlier', 'later', 'compatible'] as const, 'reject', 'disambiguation');
  assertInteger(birthYear, 'birthYear', 1, 9999);
  if (calendarType === 'solar') {
    assertInteger(birthMonth, 'birthMonth', 1, 12);
    assertInteger(birthDay, 'birthDay', 1, 31);
  } else if (!Number.isSafeInteger(birthDay)) {
    throw new CoreInputError('birthDay', '农历日期必须为整数');
  }
  assertInteger(birthHour, 'birthHour', 0, 23);
  assertInteger(birthMinute, 'birthMinute', 0, 59);
  if (typeof isLeapMonth !== 'boolean') throw new CoreInputError('isLeapMonth', '必须为布尔值');
  if (calendarType === 'solar') {
    validateCivilDateTime({ year: birthYear, month: birthMonth, day: birthDay, hour: birthHour, minute: birthMinute }, 'birth');
    if (isLeapMonth) throw new CoreInputError('isLeapMonth', '公历输入不能指定闰月');
  }
  const timezone = input.timezone ?? DEFAULT_DIVINATION_TIMEZONE;
  const termCalendar = (birthSolar: Solar) => {
    const instant = zonedTimeToUtc({ year: birthSolar.getYear(), month: birthSolar.getMonth(), day: birthSolar.getDay(),
      hour: birthSolar.getHour(), minute: birthSolar.getMinute() }, timezone, disambiguation);
    const beijing = new Date(instant.getTime() + 8 * 3600000);
    const clock = getZonedDateTimeParts(instant, timezone);
    return {
      instant,
      clockSolar: Solar.fromYmdHms(clock.year, clock.month, clock.day, clock.hour, clock.minute, 0),
      termLunar: Solar.fromYmdHms(beijing.getUTCFullYear(), beijing.getUTCMonth() + 1, beijing.getUTCDate(), beijing.getUTCHours(), beijing.getUTCMinutes(), 0).getLunar(),
    };
  };

  if (longitude != null && (typeof longitude !== 'number' || longitude < -180 || longitude > 180)) {
    throw new Error('longitude 必须是 -180 到 180 之间的数字');
  }

  let trueSolarTimeInfo: TrueSolarTimeInfo | undefined;
  let effectiveYear = birthYear;
  let effectiveMonth = birthMonth;
  let effectiveDay = birthDay;
  let effectiveHour = birthHour;
  let effectiveMinute = birthMinute;

  if (calendarType === 'lunar') {
    const prepared = validateLunarDateInput({
      birthYear,
      birthMonth,
      birthDay,
      birthHour,
      birthMinute,
      isLeapMonth,
    });

    const calendar = termCalendar(prepared.solar);

    if (longitude != null) {
      const resolvedDateTime = resolveTrueSolarDateTimeFromInstant(calendar.instant, longitude, timezone);
      const correctedSolar = Solar.fromYmdHms(
        resolvedDateTime.year,
        resolvedDateTime.month,
        resolvedDateTime.day,
        resolvedDateTime.hour,
        resolvedDateTime.minute,
        0,
      );
      return {
        solar: correctedSolar,
        lunar: correctedSolar.getLunar(),
        termLunar: calendar.termLunar,
        trueSolarTimeInfo: resolvedDateTime.trueSolarTimeInfo,
      };
    }

    return {
      solar: calendar.clockSolar,
      lunar: calendar.clockSolar.getLunar(),
      termLunar: calendar.termLunar,
      trueSolarTimeInfo,
    };
  }

  const calendar = termCalendar(Solar.fromYmdHms(birthYear, birthMonth, birthDay, birthHour, birthMinute, 0));
  if (longitude != null) {
    const resolvedDateTime = resolveTrueSolarDateTimeFromInstant(calendar.instant, longitude, timezone);
    trueSolarTimeInfo = resolvedDateTime.trueSolarTimeInfo;
    effectiveYear = resolvedDateTime.year;
    effectiveMonth = resolvedDateTime.month;
    effectiveDay = resolvedDateTime.day;
    effectiveHour = resolvedDateTime.hour;
    effectiveMinute = resolvedDateTime.minute;
  }

  const solar = longitude == null ? calendar.clockSolar : Solar.fromYmdHms(
    effectiveYear,
    effectiveMonth,
    effectiveDay,
    effectiveHour,
    effectiveMinute,
    0,
  );
  return {
    solar,
    lunar: solar.getLunar(),
    termLunar: calendar.termLunar,
    trueSolarTimeInfo,
  };
}

export function calculateBaziData(input: BaziInput): BaziOutput {
  const {
    gender,
    birthPlace,
  } = input;
  const { lunar, termLunar, trueSolarTimeInfo } = resolveBaziCalendarContext(input);

  const eightChar = lunar.getEightChar();
  eightChar.setSect(input.dayBoundary === 'zi' ? 1 : 2);
  const termEightChar = termLunar.getEightChar();
  const yearStem = termEightChar.getYearGan();
  const yearBranch = termEightChar.getYearZhi();
  const monthStem = termEightChar.getMonthGan();
  const monthBranch = termEightChar.getMonthZhi();
  const dayStem = eightChar.getDayGan();
  const dayBranch = eightChar.getDayZhi();
  const hourStem = eightChar.getTimeGan();
  const hourBranch = eightChar.getTimeZhi();

  const kongWang = getKongWang(dayStem, dayBranch);
  const yearNaYin = getNaYin(yearStem, yearBranch);
  const yearNaYinElement = getNaYinElement(yearNaYin);
  const pillarShenSha = calculateBaziPillarShenSha({
    yearStem,
    yearBranch,
    monthStem,
    monthBranch,
    dayStem,
    dayBranch,
    hourStem,
    hourBranch,
    kongWang,
    yearNaYinElement,
  });

  const fourPillars = {
    year: {
      ...createPillar(yearStem, yearBranch, dayStem),
      shenSha: pillarShenSha.year,
      kongWang: buildPillarKongWang(yearBranch, kongWang),
    },
    month: {
      ...createPillar(monthStem, monthBranch, dayStem),
      shenSha: pillarShenSha.month,
      kongWang: buildPillarKongWang(monthBranch, kongWang),
    },
    day: {
      ...createPillar(dayStem, dayBranch, dayStem),
      shenSha: pillarShenSha.day,
      kongWang: buildPillarKongWang(dayBranch, kongWang),
    },
    hour: {
      ...createPillar(hourStem, hourBranch, dayStem),
      shenSha: pillarShenSha.hour,
      kongWang: buildPillarKongWang(hourBranch, kongWang),
    },
  };

  fourPillars.day.tenGod = undefined;

  const relations = analyzePillarRelations(yearBranch, monthBranch, dayBranch, hourBranch);
  const tianGanWuHe = analyzeTianGanWuHe(yearStem, monthStem, dayStem, hourStem);
  const tianGanChongKe = analyzeTianGanChongKe(yearStem, monthStem, dayStem, hourStem);
  const diZhiBanHe = analyzeDiZhiBanHe(yearBranch, monthBranch, dayBranch, hourBranch);
  const diZhiSanHui = analyzeDiZhiSanHui(yearBranch, monthBranch, dayBranch, hourBranch);
  const taiYuan = calculateTaiYuan(monthStem, monthBranch);
  const mingGong = calculateMingGong(yearStem, monthBranch, hourBranch);

  return {
    gender,
    birthPlace,
    dayMaster: dayStem,
    kongWang,
    fourPillars,
    relations,
    tianGanWuHe,
    tianGanChongKe,
    diZhiBanHe,
    diZhiSanHui,
    taiYuan: taiYuan || undefined,
    mingGong: mingGong || undefined,
    trueSolarTimeInfo,
    calculationOptions: { dayBoundary: input.dayBoundary ?? 'midnight', timezone: input.timezone ?? DEFAULT_DIVINATION_TIMEZONE, solarTermBasis: 'instant', disambiguation: input.disambiguation ?? 'reject', ruleVersion: 'bazi-2026.10' },
  };
}

export function calculateBaziShenShaData(input: BaziInput): BaziShenShaOutput {
  const coreBazi = calculateBaziData(input);
  const { lunar } = resolveBaziCalendarContext(input);
  const pillarShenSha = calculateBaziPillarShenSha({
    yearStem: coreBazi.fourPillars.year.stem,
    yearBranch: coreBazi.fourPillars.year.branch,
    monthStem: coreBazi.fourPillars.month.stem,
    monthBranch: coreBazi.fourPillars.month.branch,
    dayStem: coreBazi.fourPillars.day.stem,
    dayBranch: coreBazi.fourPillars.day.branch,
    hourStem: coreBazi.fourPillars.hour.stem,
    hourBranch: coreBazi.fourPillars.hour.branch,
    kongWang: {
      xun: coreBazi.kongWang.xun,
      kongZhi: [...coreBazi.kongWang.kongZhi] as [string, string],
    },
    yearNaYinElement: getNaYinElement(coreBazi.fourPillars.year.naYin || ''),
  });

  let jiShen: string[] = [];
  let xiongSha: string[] = [];
  let dayYi: string[] = [];
  let dayJi: string[] = [];
  const warnings: string[] = [];

  try { jiShen = lunar.getDayJiShen() || []; } catch (e) { warnings.push(`吉神数据获取失败: ${e instanceof Error ? e.message : String(e)}`); }
  try { xiongSha = lunar.getDayXiongSha() || []; } catch (e) { warnings.push(`凶煞数据获取失败: ${e instanceof Error ? e.message : String(e)}`); }
  try { dayYi = lunar.getDayYi() || []; } catch (e) { warnings.push(`日宜数据获取失败: ${e instanceof Error ? e.message : String(e)}`); }
  try { dayJi = lunar.getDayJi() || []; } catch (e) { warnings.push(`日忌数据获取失败: ${e instanceof Error ? e.message : String(e)}`); }

  return {
    jiShen,
    xiongSha,
    dayYi,
    dayJi,
    pillarShenSha,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
