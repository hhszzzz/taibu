import type {
  BirthTimeInput,
  DiZhiBanHeItem,
  DiZhiSanHuiItem,
  Gender,
  GlobalKongWangInfo,
  HiddenStemInfo,
  PillarKongWangInfo,
  PillarRelation,
  TianGanChongKeItem,
  TianGanWuHeItem,
  TrueSolarTimeInfo
} from '../shared/types.js';

// ===== 八字相关类型 =====

/**
 * 八字的出生信息。省略 birthHour 表示出生时辰未知：只排年、月、日三柱，不排时柱，
 * 与时辰有关的命宫、时柱神煞、小运与真太阳时校正都不给出；出生当天交节（年柱或月柱取决于时辰）时报错。
 */
export interface BaziInput extends Omit<BirthTimeInput, 'birthHour'> {
  gender: Gender;
  birthHour?: number;
  birthPlace?: string;
  longitude?: number;
  dayBoundary?: 'midnight' | 'zi';
}

export interface BaziOutput {
  gender: Gender;
  birthPlace?: string;
  dayMaster: string;
  kongWang: GlobalKongWangInfo;
  fourPillars: {
    year: PillarInfo;
    month: PillarInfo;
    day: PillarInfo;
    /** 出生时辰未知时没有时柱 */
    hour?: PillarInfo;
  };
  /** 出生时辰未知：没有时柱与命宫，关系、神煞只在年、月、日三柱之间 */
  birthTimeUnknown?: true;
  relations: PillarRelation[];
  tianGanWuHe: TianGanWuHeItem[];
  tianGanChongKe: TianGanChongKeItem[];
  diZhiBanHe: DiZhiBanHeItem[];
  diZhiSanHui: DiZhiSanHuiItem[];
  taiYuan?: string;
  mingGong?: string;
  trueSolarTimeInfo?: TrueSolarTimeInfo;
  calculationOptions?: { dayBoundary: 'midnight' | 'zi'; timezone: string; solarTermBasis: 'instant'; disambiguation?: BirthTimeInput['disambiguation']; ruleVersion?: string; };
}

export interface BaziShenShaOutput {
  jiShen: string[];
  xiongSha: string[];
  dayYi: string[];
  dayJi: string[];
  pillarShenSha: {
    year: string[];
    month: string[];
    day: string[];
    /** 出生时辰未知时没有 */
    hour?: string[];
  };
  /** 数据获取过程中产生的警告（如 lunar-javascript 在边界日期抛出异常） */
  warnings?: string[];
}

export interface BaziLiuYueInfo {
  month: number;
  ganZhi: string;
  jieQi: string;
  startDate: string;
  endDate: string;
  startDateTime?: string;
  endDateTime?: string;
  endExclusive?: boolean;
  timezone?: string;
  gan?: string;
  zhi?: string;
  tenGod?: string;
  hiddenStems?: HiddenStemInfo[];
  naYin?: string;
  diShi?: string;
  shenSha?: string[];
}

export interface BaziLiuRiInfo {
  date: string;
  day: number;
  ganZhi: string;
  gan: string;
  zhi: string;
  tenGod?: string;
  hiddenStems?: HiddenStemInfo[];
  naYin?: string;
  diShi?: string;
  shenSha?: string[];
}

export interface PillarInfo {
  stem: string;
  branch: string;
  tenGod?: string;
  hiddenStems: HiddenStemInfo[];
  naYin?: string;
  diShi?: string;
  shenSha: string[];
  kongWang: PillarKongWangInfo;
}
