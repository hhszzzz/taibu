import type { StarInfo } from '../shared/types.js';
import type { ZiweiInput, ZiweiCalculationMetadata } from '../ziwei/types.js';

// ===== 紫微运限类型 =====

export interface ZiweiHoroscopeInput extends ZiweiInput {
  targetDate?: string;
  targetTimeIndex?: number;
}

export interface HoroscopePeriodInfo {
  /** 该运限命宫所在的本命宫位索引（0–11，与本命盘 palaces 同一坐标系）；无法确定时为 -1 */
  index: number;
  name: string;
  heavenlyStem: string;
  earthlyBranch: string;
  /** 本命宫位索引 → 该运限重排后的宫名（palaceNames[index] 为该运限的命宫） */
  palaceNames: string[];
  /** 该运限命宫落入的本命宫名；索引越界时缺省 */
  natalPalaceName?: string;
  mutagen: string[];
  startAge?: number;
  endAge?: number;
  stars?: StarInfo[][];
}

export interface TransitStarEntry {
  starName: string;
  palaceName: string;
}

export interface YearlyDecStarInfo {
  jiangqian12: string[];  // 将前十二星
  suiqian12: string[];    // 岁前十二星
}

export interface ZiweiHoroscopeOutput {
  solarDate: string;
  lunarDate: string;
  soul: string;
  body: string;
  fiveElement: string;
  targetDate: string;
  hasExplicitTargetTime: boolean;
  decadal: HoroscopePeriodInfo;
  age: HoroscopePeriodInfo & { nominalAge: number; };
  yearly: HoroscopePeriodInfo;
  monthly: HoroscopePeriodInfo;
  daily: HoroscopePeriodInfo;
  hourly: HoroscopePeriodInfo;
  transitStars?: TransitStarEntry[];      // 流年星曜
  yearlyDecStar?: YearlyDecStarInfo;      // 流年神煞（岁前/将前十二星）
  calculationOptions?: ZiweiCalculationMetadata;
}
