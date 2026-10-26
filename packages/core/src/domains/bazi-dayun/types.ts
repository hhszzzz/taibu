import type {
  BranchRelation,
  HiddenStemInfo,
  LiunianInfo,
  TrueSolarTimeInfo,
  XiaoyunInfo
} from '../shared/types.js';
import type { BaziInput } from '../bazi/types.js';

// ===== 大运相关类型 =====

export interface DayunInput extends BaziInput {
  yunSect?: 1 | 2;
}

/** 出生时辰未知、交运年份可能推迟一年时的说明 */
export const DAYUN_YEAR_SHIFT_NOTE = '出生时辰未知：时辰偏晚时各步大运晚一年交运';

/** 交运年份或年龄；时辰未知且可能推迟时写成「1993（或1994）」 */
export const dayunYearText = (value: number, shift: 0 | 1 | undefined, suffix = '') => shift ? `${value}${suffix}（或${value + 1}${suffix}）` : `${value}${suffix}`;

export interface DayunOutput {
  startAge: number;
  startAgeDetail: string;
  startSolar?: string;
  /**
   * 出生时辰未知：起运按当天最早与最晚出生分别推算，实际在 startSolar 与 latestStartSolar 之间。
   * yearShift 为 1 时最晚的情形下各步大运晚一年交运（list 按较早的起运排）。
   */
  startRange?: { latestStartSolar: string; latestStartAgeDetail: string; yearShift: 0 | 1; };
  direction?: 'forward' | 'backward';
  yunSect?: 1 | 2;
  dayBoundary?: 'midnight' | 'zi';
  trueSolarTimeInfo?: TrueSolarTimeInfo;
  calculationOptions?: { timezone: string; startSolarTimezone: string; longitude?: number; yunSect: 1 | 2; dayBoundary: 'midnight' | 'zi'; disambiguation?: BaziInput['disambiguation']; ageConvention: 'nominal'; ruleVersion?: string; };
  xiaoYun: XiaoyunInfo[];
  list: Array<{
    startYear: number;
    startAge: number;
    ganZhi: string;
    stem: string;
    branch: string;
    tenGod: string;
    branchTenGod: string;
    hiddenStems: HiddenStemInfo[];
    naYin: string;
    diShi: string;
    shenSha: string[];
    branchRelations: BranchRelation[];
    liunianList: LiunianInfo[];
  }>;
}
