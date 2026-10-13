/**
 * 紫微斗数运限核心引擎
 */

import type { HoroscopePeriodInfo, TransitStarEntry, YearlyDecStarInfo, ZiweiHoroscopeInput, ZiweiHoroscopeOutput } from './types.js';
import type { DiZhi } from '../shared/types.js';
import { createAstrolabeWithTrueSolar, DI_ZHI, hourToTimeIndex, LUCUN_TABLE, mapStar, normalizePalaceName } from '../ziwei/shared.js';
import { ensureZiweiProfile, getZiweiOptions, snapshotZiweiResult } from '../ziwei/profile.js';
import { assertInteger, parseCivilDate } from '../../shared/validation.js';
import { getZonedDateTimeParts } from '../../shared/timezone-utils.js';

export type { ZiweiHoroscopeInput, ZiweiHoroscopeOutput } from './types.js';

type Astrolabe = ReturnType<typeof createAstrolabeWithTrueSolar>['astrolabe'];
type HoroscopePeriodLike = Partial<HoroscopePeriodInfo> & { nominalAge?: number; };
type HoroscopeLike = {
  decadal?: HoroscopePeriodLike;
  age?: HoroscopePeriodLike;
  yearly?: HoroscopePeriodLike & {
    yearlyDecStar?: { jiangqian12?: string[]; suiqian12?: string[]; };
  };
  monthly?: HoroscopePeriodLike;
  daily?: HoroscopePeriodLike;
  hourly?: HoroscopePeriodLike;
};

/** 流昌/流曲查表：年干 → [流昌地支, 流曲地支] */
const FLOW_CHANG_QU_TABLE: Record<string, [string, string]> = {
  '甲': ['巳', '酉'], '乙': ['午', '申'], '丙': ['申', '午'],
  '丁': ['酉', '巳'], '戊': ['申', '午'], '己': ['酉', '巳'],
  '庚': ['亥', '卯'], '辛': ['子', '寅'], '壬': ['寅', '子'],
  '癸': ['卯', '亥'],
};

/** 流魁查表（天魁）：年干 → 地支 */
const FLOW_KUI_TABLE: Record<string, string> = {
  '甲': '丑', '戊': '丑', '庚': '丑',
  '乙': '子', '己': '子',
  '丙': '亥', '丁': '亥',
  '壬': '卯', '癸': '卯',
  '辛': '午',
};

/** 流钺查表（天钺）：年干 → 地支 */
const FLOW_YUE_TABLE: Record<string, string> = {
  '甲': '未', '戊': '未', '庚': '未',
  '乙': '申', '己': '申',
  '丙': '酉', '丁': '酉',
  '壬': '巳', '癸': '巳',
  '辛': '寅',
};

/** 流马查表（天马）：年支 → 地支 */
const FLOW_MA_TABLE: Record<string, string> = {
  '寅': '申', '午': '申', '戌': '申',
  '申': '寅', '子': '寅', '辰': '寅',
  '巳': '亥', '酉': '亥', '丑': '亥',
  '亥': '巳', '卯': '巳', '未': '巳',
};

/** 流鸾查表（红鸾）：年支 → 地支 */
const FLOW_LUAN_TABLE: Record<string, string> = {
  '子': '卯', '丑': '寅', '寅': '丑', '卯': '子',
  '辰': '亥', '巳': '戌', '午': '酉', '未': '申',
  '申': '未', '酉': '午', '戌': '巳', '亥': '辰',
};

/** 计算流年星曜 */
function computeTransitStars(
  flowYearStem: string,
  flowYearBranch: string,
  palaces: { name: string; earthlyBranch: string; }[],
): TransitStarEntry[] {
  const result: TransitStarEntry[] = [];

  const findPalace = (branch: string) =>
    palaces.find(p => p.earthlyBranch === branch)?.name ?? branch;

  // 流禄：same as 禄存 table
  const liuLuBranch = LUCUN_TABLE[flowYearStem];
  if (!liuLuBranch) return result;
  result.push({ starName: '流禄', palaceName: findPalace(liuLuBranch) });

  // 流羊：流禄 +1 palace
  const luIdx = DI_ZHI.indexOf(liuLuBranch as DiZhi);
  if (luIdx >= 0) {
    const yangBranch = DI_ZHI[(luIdx + 1) % 12];
    result.push({ starName: '流羊', palaceName: findPalace(yangBranch) });

    // 流陀：流禄 -1 palace
    const tuoBranch = DI_ZHI[(luIdx - 1 + 12) % 12];
    result.push({ starName: '流陀', palaceName: findPalace(tuoBranch) });
  }

  // 流昌 & 流曲
  const changQu = FLOW_CHANG_QU_TABLE[flowYearStem];
  if (changQu) {
    result.push({ starName: '流昌', palaceName: findPalace(changQu[0]) });
    result.push({ starName: '流曲', palaceName: findPalace(changQu[1]) });
  }

  // 流魁（天魁）
  const kuiBranch = FLOW_KUI_TABLE[flowYearStem];
  if (kuiBranch) {
    result.push({ starName: '流魁', palaceName: findPalace(kuiBranch) });
  }

  // 流钺（天钺）
  const yueBranch = FLOW_YUE_TABLE[flowYearStem];
  if (yueBranch) {
    result.push({ starName: '流钺', palaceName: findPalace(yueBranch) });
  }

  // 流马（天马）
  const maBranch = FLOW_MA_TABLE[flowYearBranch];
  if (maBranch) {
    result.push({ starName: '流马', palaceName: findPalace(maBranch) });
  }

  // 流鸾（红鸾）
  const luanBranch = FLOW_LUAN_TABLE[flowYearBranch];
  if (luanBranch) {
    result.push({ starName: '流鸾', palaceName: findPalace(luanBranch) });

    // 流喜（天喜）= 红鸾对宫（+6）
    const luanIdx = DI_ZHI.indexOf(luanBranch as DiZhi);
    if (luanIdx >= 0) {
      const xiBranch = DI_ZHI[(luanIdx + 6) % 12];
      result.push({ starName: '流喜', palaceName: findPalace(xiBranch) });
    }
  }

  return result;
}

/**
 * @param natalPalaceNames 本命十二宫名，按宫位索引排列；用于回查运限命宫落入的本命宫。
 *   注意 palaceNames 是该运限重排后的宫名，palaceNames[0] 只是本命索引 0 宫在该运限中的名称，不是落宫。
 */
function mapPeriod(item: {
  index?: number;
  name?: string;
  heavenlyStem?: string;
  earthlyBranch?: string;
  palaceNames?: string[];
  mutagen?: string[];
  startAge?: number;
  endAge?: number;
  stars?: NonNullable<HoroscopePeriodInfo['stars']>;
}, natalPalaceNames: readonly string[]): HoroscopePeriodInfo {
  const index = item.index ?? 0;
  const natalPalaceName = Number.isInteger(index) && index >= 0 ? natalPalaceNames[index] : undefined;
  return {
    index,
    name: normalizePalaceName(item.name ?? ''),
    heavenlyStem: item.heavenlyStem ?? '',
    earthlyBranch: item.earthlyBranch ?? '',
    palaceNames: (item.palaceNames ?? []).map(normalizePalaceName),
    ...(natalPalaceName ? { natalPalaceName } : {}),
    mutagen: item.mutagen ?? [],
    ...(typeof item.startAge === 'number' ? { startAge: item.startAge } : {}),
    ...(typeof item.endAge === 'number' ? { endAge: item.endAge } : {}),
    ...(item.stars ? { stars: item.stars.map(stars => stars.map(mapStar)) } : {}),
  };
}

export function calculateZiweiHoroscopeDataWithAstrolabe(
  sourceAstrolabe: Astrolabe,
  options: { targetDate?: string | Date; targetTimeIndex?: number; timezone?: string; } = {},
): ZiweiHoroscopeOutput {
  const { targetDate, targetTimeIndex } = options;
  if (targetTimeIndex !== undefined) assertInteger(targetTimeIndex, 'targetTimeIndex', 0, 12);
  const timezone = options.timezone ?? getZiweiOptions(sourceAstrolabe).timezone;
  getZonedDateTimeParts(new Date(0), timezone);
  const astrolabe = ensureZiweiProfile(sourceAstrolabe, timezone);
  const parts = typeof targetDate === 'string'
    ? { ...parseCivilDate(targetDate, 'targetDate'), hour: 0, minute: 0, second: 0 }
    : getZonedDateTimeParts(targetDate ?? new Date(), timezone);
  const queryDate = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  const timeIndex = targetTimeIndex ?? hourToTimeIndex(parts.hour + parts.minute / 60);
  const horoscope = astrolabe.horoscope(queryDate, timeIndex) as HoroscopeLike;
  const targetDateLabel = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;

  // 流年星曜：from flow year stem + branch
  const flowYearStem = horoscope.yearly?.heavenlyStem ?? '';
  const flowYearBranch = horoscope.yearly?.earthlyBranch ?? '';
  const palaceList = astrolabe.palaces.map(p => ({
    name: normalizePalaceName(p.name),
    earthlyBranch: p.earthlyBranch,
  }));
  const natalPalaceNames = palaceList.map(p => p.name);
  const transitStars = (flowYearStem && flowYearBranch)
    ? computeTransitStars(flowYearStem, flowYearBranch, palaceList)
    : undefined;

  // P2: 岁前十二星 & 将前十二星
  const yearlyData = horoscope.yearly;
  let yearlyDecStar: YearlyDecStarInfo | undefined;
  if (yearlyData?.yearlyDecStar) {
    const { jiangqian12, suiqian12 } = yearlyData.yearlyDecStar;
    if ((jiangqian12 && jiangqian12.length > 0) || (suiqian12 && suiqian12.length > 0)) {
      yearlyDecStar = {
        jiangqian12: jiangqian12 || [],
        suiqian12: suiqian12 || [],
      };
    }
  }

  const nominalAge = horoscope.age?.nominalAge ?? 0;
  const decadalAgeRange = astrolabe.palaces
    .map((palace) => palace.decadal?.range)
    .find((range): range is [number, number] => Array.isArray(range) && range.length === 2 && nominalAge >= range[0] && nominalAge <= range[1]);

  return snapshotZiweiResult({
    solarDate: astrolabe.solarDate || '',
    lunarDate: astrolabe.lunarDate || '',
    soul: astrolabe.soul || '',
    body: astrolabe.body || '',
    fiveElement: astrolabe.fiveElementsClass || '',
    targetDate: targetDateLabel,
    hasExplicitTargetTime: typeof targetTimeIndex === 'number',
    decadal: mapPeriod({
      ...(horoscope.decadal ?? {}),
      startAge: decadalAgeRange?.[0],
      endAge: decadalAgeRange?.[1],
    }, natalPalaceNames),
    age: { ...mapPeriod(horoscope.age ?? {}, natalPalaceNames), nominalAge: horoscope.age?.nominalAge ?? 0 },
    yearly: mapPeriod(horoscope.yearly ?? {}, natalPalaceNames),
    monthly: mapPeriod(horoscope.monthly ?? {}, natalPalaceNames),
    daily: mapPeriod(horoscope.daily ?? {}, natalPalaceNames),
    hourly: mapPeriod(horoscope.hourly ?? {}, natalPalaceNames),
    transitStars,
    yearlyDecStar,
    calculationOptions: getZiweiOptions(astrolabe),
  });
}

export function calculateZiweiHoroscopeData(input: ZiweiHoroscopeInput): ZiweiHoroscopeOutput {
  const { astrolabe } = createAstrolabeWithTrueSolar(input);
  return calculateZiweiHoroscopeDataWithAstrolabe(astrolabe, {
    targetDate: input.targetDate,
    targetTimeIndex: input.targetTimeIndex,
    timezone: input.timezone,
  });
}
