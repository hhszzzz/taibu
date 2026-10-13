/**
 * Core 类型定义
 */

// ===== 公共类型 =====

export type Gender = 'male' | 'female';

export type CalendarType = 'solar' | 'lunar';

export type DetailLevel = 'default' | 'more' | 'full';

// ===== 公共出生时间类型 =====
export interface BirthTimeInput {
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  birthHour: number;
  birthMinute?: number;
  calendarType?: CalendarType;
  isLeapMonth?: boolean;
  timezone?: string;
  disambiguation?: 'reject' | 'earlier' | 'later' | 'compatible';
}

export interface HiddenStemInfo {
  stem: string;
  qiType: '本气' | '中气' | '余气';
  tenGod: string;
}

export interface GlobalKongWangInfo {
  xun: string;
  kongZhi: [string, string];
}

export interface PillarKongWangInfo {
  isKong: boolean;
}

export type PillarPosition = '年支' | '月支' | '日支' | '时支';

/** 天干所在柱位（用于天干五合、天干冲克等干系关系） */
export type StemPosition = '年干' | '月干' | '日干' | '时干';

export interface PillarRelation {
  type: '合' | '冲' | '刑' | '害';
  pillars: PillarPosition[];
  description: string;
}

export interface TianGanWuHeItem {
  stemA: string;
  stemB: string;
  resultElement: string;
  positions: [StemPosition, StemPosition];
}

export interface DiZhiBanHeItem {
  branches: [string, string];
  resultElement: string;
  missingBranch: string;
  positions: PillarPosition[];
}

export interface TianGanChongKeItem {
  stemA: string;
  stemB: string;
  positions: [StemPosition, StemPosition];
}

export interface DiZhiSanHuiItem {
  branches: [string, string, string];
  resultElement: string;
  positions: PillarPosition[];
}

export interface SmallLimitEntry {
  palaceName: string;
  ages: number[];
}

export interface ScholarStarEntry {
  starName: string;
  palaceName: string;
}

export interface GanZhiPair {
  gan: string;
  zhi: string;
}

/** 真太阳时校正信息 */
export interface TrueSolarTimeInfo {
  /** 钟表时间 (HH:MM) */
  clockTime: string;
  /** 真太阳时 (HH:MM) */
  trueSolarTime: string;
  /** 出生地经度 */
  longitude: number;
  /** 总校正量（分钟，正值表示真太阳时比钟表时间快） */
  correctionMinutes: number;
  /** 真太阳时对应的时辰索引 (0-12) */
  trueTimeIndex: number;
  /** 跨日偏移（-1=前一天, 0=当天, 1=后一天） */
  dayOffset: number;
  timezone?: string;
  utcOffsetMinutes?: number;
  equationOfTimeMinutes?: number;
  ruleVersion?: string;
}

export interface PalaceInfo {
  name: string;
  heavenlyStem: string;
  earthlyBranch: string;
  isBodyPalace: boolean;
  majorStars: StarInfo[];
  minorStars: StarInfo[];
  adjStars?: StarInfo[];
  index?: number;
  isOriginalPalace?: boolean;
  changsheng12?: string;
  boshi12?: string;
  jiangqian12?: string;
  suiqian12?: string;
  ages?: number[];
  decadalRange?: [number, number];  // 大限虚岁范围 [起, 止]
  liuNianAges?: number[];           // 流年虚岁列表
  sanFangSiZheng?: string[];        // 三方四正宫位名
}

export interface StarInfo {
  name: string;
  type?: string;
  brightness?: string;
  mutagen?: string;
  selfMutagen?: string;       // 离心自化 ↓（宫干四化落回本宫）
  oppositeMutagen?: string;   // 向心自化 ↑（对宫宫干四化飞入本宫）
}

export interface DecadalInfo {
  startAge: number;
  endAge: number;
  heavenlyStem: string;
  palace: {
    earthlyBranch: string;
    name: string;
  };
}

export type FlyingStarQuery =
  | { type: 'fliesTo'; from: string; to: string; mutagens: string[]; }
  | { type: 'selfMutaged'; palace: string; mutagens?: string[]; }
  | { type: 'mutagedPlaces'; palace: string; }
  | { type: 'surroundedPalaces'; palace: string; };

export interface FlyingStarActualFlight {
  mutagen: string;
  targetPalace: string | null;
  starName?: string | null;
}

export interface MutagedPlaceInfo {
  mutagen: string;
  targetPalace: string | null;
}

export interface SurroundedPalaceInfo {
  target: { name: string; index: number; };
  opposite: { name: string; index: number; };
  wealth: { name: string; index: number; };
  career: { name: string; index: number; };
}

export interface DerivedHexagramInfo {
  name: string;
  guaCi?: string;
  xiangCi?: string;
}

export interface GuaShenInfo {
  branch: string;
  linePosition?: number;
  absent?: boolean;
}

export type LiuQinType = '父母' | '兄弟' | '子孙' | '妻财' | '官鬼';

export type WuXing = '木' | '火' | '土' | '金' | '水';

export type TianGan = '甲' | '乙' | '丙' | '丁' | '戊' | '己' | '庚' | '辛' | '壬' | '癸';

export type DiZhi = '子' | '丑' | '寅' | '卯' | '辰' | '巳' | '午' | '未' | '申' | '酉' | '戌' | '亥';

export type YaoMovementState = 'static' | 'changing' | 'hidden_moving' | 'day_break';

export type WangShuai = 'wang' | 'xiang' | 'xiu' | 'qiu' | 'si';

/**
 * 旬空状态：kong_static 真空（静而无气、无日建动爻生扶）；kong_supported 假空（旺相或得日建、动爻生扶，旬内仍空，出空有用）；
 * kong_changing 动空；kong_ri_chong 冲空则实；kong_yue_jian 临月建而空（出空有用）。
 */
export type KongWangState = 'not_kong' | 'kong_static' | 'kong_supported' | 'kong_changing' | 'kong_ri_chong' | 'kong_yue_jian';

export type YaoSpecialStatus = 'none' | 'anDong' | 'riPo' | 'yuePo';

export type YongShenSelectionStatus = 'resolved' | 'ambiguous' | 'from_changed' | 'from_temporal' | 'from_fushen' | 'missing';

/** 日月论爻之气：strong 有气 / moderate 气平（日月相敌）/ weak 无气 */
export type YaoStrengthLevel = 'strong' | 'moderate' | 'weak';

export type CandidateStrength = YaoStrengthLevel | 'unknown';

export interface ChangedYaoDetail {
  type: number;
  liuQin: string;
  naJia: string;
  wuXing: string;
  liuShen: string;
  yaoCi?: string;
  relation: string;
}

export interface GanZhiTime {
  year: { gan: string; zhi: string; };
  month: { gan: string; zhi: string; };
  day: { gan: string; zhi: string; };
  hour: { gan: string; zhi: string; };
  xun: string;
}

export interface YaoStrengthInfo {
  wangShuai: WangShuai;
  level: YaoStrengthLevel;
  /** 等同 level === 'strong' */
  isStrong: boolean;
  specialStatus: YaoSpecialStatus;
  evidence: string[];
}

export interface YongShenCandidateInfo {
  liuQin: string;
  naJia?: string;
  changedNaJia?: string;
  huaType?: string;
  element: string;
  position?: number;
  source: 'visible' | 'changed' | 'temporal' | 'fushen';
  strength: CandidateStrength;
  strengthLabel: string;
  movementState: YaoMovementState;
  movementLabel: string;
  /** 明现、变出之爻的暗动/日破/月破（动爻月破时 movementState 仍为 changing） */
  specialStatus?: YaoSpecialStatus;
  isShiYao: boolean;
  isYingYao: boolean;
  kongWangState?: KongWangState;
  evidence: string[];
}

export interface YongShenGroupInfo {
  targetLiuQin: LiuQinType;
  selectionStatus: YongShenSelectionStatus;
  selectionNote: string;
  selected: YongShenCandidateInfo;
  candidates: YongShenCandidateInfo[];
}

export interface KongWangInfo {
  xun: string;
  kongDizhi: [DiZhi, DiZhi];
}

export interface KongWangByPillarInfo {
  year: KongWangInfo;
  month: KongWangInfo;
  day: KongWangInfo;
  hour: KongWangInfo;
}

export interface YaoFuShenInfo {
  liuQin: string;
  naJia: string;
  wuXing: string;
  relation: string;  // 伏神与飞神的生克关系
}

export interface FullYaoInfo {
  position: number;
  type: number;
  isChanging: boolean;
  movementState: YaoMovementState;
  movementLabel: string;
  liuQin: string;
  liuShen: string;
  naJia: string;
  wuXing: string;
  isShiYao: boolean;
  isYingYao: boolean;
  kongWangState?: KongWangState;
  strength: YaoStrengthInfo;
  yaoCi?: string;
  changedYao: ChangedYaoDetail | null;
  shenSha: string[];
  changSheng?: {
    stage: string;
    strength: 'strong' | 'medium' | 'weak';
  };
  fuShen?: YaoFuShenInfo;
}

export interface FuShenInfo {
  liuQin: string;
  wuXing: string;
  naJia: string;
  feiShenPosition: number;
  feiShenLiuQin?: string;
  availabilityStatus: 'available' | 'conditional' | 'blocked';
  availabilityReason: string;
}

export interface ShenSystemInfo {
  yuanShen?: { liuQin: string; wuXing: string; positions: number[]; };
  jiShen?: { liuQin: string; wuXing: string; positions: number[]; };
  chouShen?: { liuQin: string; wuXing: string; positions: number[]; };
}

export interface ShenSystemByYongShenInfo extends ShenSystemInfo {
  targetLiuQin: LiuQinType;
}

export interface LiuChongGuaInfo {
  isLiuChongGua: boolean;
  description?: string;
}

export interface LiuHeGuaInfo {
  isLiuHeGua: boolean;
  description?: string;
}

export interface ChongHeTransition {
  type: 'chong_to_he' | 'he_to_chong' | 'none';
  description?: string;
}

export interface GuaFanFuYinInfo {
  isFanYin: boolean;
  isFuYin: boolean;
  description?: string;
}

export interface SanHeAnalysisInfo {
  hasFullSanHe: boolean;
  fullSanHe?: { name: string; result: string; positions: number[]; description?: string; };
  fullSanHeList?: Array<{ name: string; result: string; positions: number[]; description?: string; }>;
  hasBanHe: boolean;
  banHe?: Array<{ branches: string[]; result: string; type: string; positions: number[]; }>;
}

export interface TimeRecommendation {
  targetLiuQin: LiuQinType;
  type: 'favorable' | 'unfavorable' | 'critical';
  trigger: string;
  earthlyBranch?: string;
  basis: string[];
  description: string;
}

export interface DirectionsInfo {
  caiShen: string;   // 财神方位
  xiShen: string;    // 喜神方位
  fuShen: string;    // 福神方位
  yangGui: string;   // 阳贵人方位
  yinGui: string;    // 阴贵人方位
}

export interface HourlyFortuneInfo {
  ganZhi: string;       // 时辰干支
  startTime?: string;
  endTime?: string;
  tianShen: string;     // 时辰天神
  tianShenType: string; // 黄道/黑道
  tianShenLuck: string; // 吉/凶
  chong: string;        // 冲
  sha: string;          // 煞
  suitable: string[];   // 宜
  avoid: string[];      // 忌
}

export interface NineStarInfo {
  number: number;       // 飞星数字 (1-9)
  description: string;  // 完整描述
  color: string;        // 颜色
  wuXing: string;       // 五行
  position: string;     // 方位
}

export interface AlmanacInfo {
  lunarDate: string;
  lunarMonth: string;
  lunarDay: string;
  zodiac: string;
  solarTerm?: string;
  suitable: string[];
  avoid: string[];
  chongSha: string;
  pengZuBaiJi: string;       // 彭祖百忌（完整文本）
  jishen: string[];
  xiongsha: string[];
  directions: DirectionsInfo;
  dayOfficer: string;       // 建除十二值星
  tianShen: string;          // 天神（日）
  tianShenType: string;      // 黄道/黑道
  tianShenLuck: string;      // 吉/凶
  lunarMansion: string;      // 二十八星宿
  lunarMansionLuck: string;  // 星宿吉凶
  lunarMansionSong: string;  // 星宿歌诀
  nayin: string;             // 日柱纳音
  dayNineStar?: NineStarInfo;  // 日九宫飞星
  taiShen?: string;            // 胎神占方
  hourlyFortune: HourlyFortuneInfo[];
}

export interface BranchRelation {
  type: '六合' | '六冲' | '三合' | '相刑' | '相害';
  branches: string[];
  description: string;
}

export interface LiunianInfo {
  year: number;
  age: number;
  ganZhi: string;
  gan: string;
  zhi: string;
  tenGod: string;
  nayin: string;
  hiddenStems: HiddenStemInfo[];
  diShi: string;
  shenSha: string[];
  branchRelations: BranchRelation[];
  taiSui: string[];
}

export interface XiaoyunInfo {
  age: number;
  ganZhi: string;
  tenGod: string;
}
