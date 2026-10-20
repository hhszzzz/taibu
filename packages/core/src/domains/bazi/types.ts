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

export interface BaziInput extends BirthTimeInput {
  gender: Gender;
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
    hour: PillarInfo;
  };
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
    hour: string[];
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
