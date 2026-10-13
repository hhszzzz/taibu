import { Solar } from 'lunar-javascript';
import { GUA_CI, HEXAGRAMS, XIANG_CI, YAO_CI, type Hexagram } from '../../data/hexagrams.js';
import { XUN_KONG_TABLE as RAW_XUN_KONG_TABLE } from '../../data/shensha.js';
import { createSeededRng, resolveSeed } from '../../shared/seeded-rng.js';
import { CoreInputError, assertInteger, resolveEnum, validateCivilDateTime } from '../../shared/validation.js';
import { CALENDAR_TIMEZONE, DEFAULT_DIVINATION_TIMEZONE, getZonedDateTimeParts, zonedTimeToUtc, zonedInstantToSystemDate } from '../../shared/timezone-utils.js';
import { calculateBranchShenSha, calculateGlobalShenSha } from '../shared/shensha.js';
import type {
  LiuyaoInput, LiuyaoOutput,
} from './types.js';
import type {
  CandidateStrength,
  DerivedHexagramInfo,
  DiZhi,
  GuaFanFuYinInfo,
  GuaScope,
  GuaShenInfo,
  KongWangState,
  LiuQinType,
  TianGan,
  WangShuai,
  WuXing,
  YaoMovementState, YaoSpecialStatus, YaoStrengthLevel, YongShenSelectionStatus,
} from '../shared/types.js';
import { getKongWang as getKongWangByPillarSource } from '../../shared/utils.js';
export type { Hexagram } from '../../data/hexagrams.js';

// ── 卦象 Map 索引（O(1) 查找） ──
const HEXAGRAM_BY_CODE = new Map<string, Hexagram>(HEXAGRAMS.map(h => [h.code, h]));
const HEXAGRAM_BY_NAME = new Map<string, Hexagram>(HEXAGRAMS.map(h => [h.name, h]));

export type { LiuyaoInput, LiuyaoOutput } from './types.js';
export type {
  CandidateStrength, DerivedHexagramInfo, DiZhi, GuaFanFuYinInfo, GuaScope, GuaShenInfo, KongWangState, LiuQinType, TianGan, WangShuai, WuXing, YaoMovementState, YaoSpecialStatus, YaoStrengthLevel, YongShenSelectionStatus
} from '../shared/types.js';
export type LiuShen = '青龙' | '朱雀' | '勾陈' | '螣蛇' | '白虎' | '玄武';
export type YaoType = 0 | 1;
export type YaoChange = 'stable' | 'changing';
export type HuaType = 'huaJin' | 'huaTui' | 'huiTouSheng' | 'huiTouKe' | 'huaKong' | 'huaMu' | 'huaJue' | 'fuYin' | 'fanYin' | 'none';
export type YaoAction = 'sheng' | 'ke' | 'fu' | 'chong' | 'he' | 'po' | 'none';
export type YongShenCandidateSource = 'visible' | 'changed' | 'temporal' | 'fushen';
export type ShiErChangSheng =
  | '长生'
  | '沐浴'
  | '冠带'
  | '临官'
  | '帝旺'
  | '衰'
  | '病'
  | '死'
  | '墓'
  | '绝'
  | '胎'
  | '养';

export interface YaoInput {
  type: YaoType;
  change: YaoChange;
  position: number;
}

export interface GanZhiPillar {
  gan: TianGan;
  zhi: DiZhi;
}

export interface GanZhiTime {
  year: GanZhiPillar;
  month: GanZhiPillar;
  day: GanZhiPillar;
  hour: GanZhiPillar;
  xun: string;
}

export interface KongWang {
  xun: string;
  kongDizhi: [DiZhi, DiZhi];
}

export interface KongWangByPillar {
  year: KongWang;
  month: KongWang;
  day: KongWang;
  hour: KongWang;
}

export interface YaoInfluence {
  monthAction: YaoAction;
  dayAction: YaoAction;
  description: string;
}

export interface YaoStrength {
  wangShuai: WangShuai;
  /** 日月论爻之气，见 judgeLine */
  level: YaoStrengthLevel;
  /** 等同 level === 'strong' */
  isStrong: boolean;
  specialStatus: YaoSpecialStatus;
  evidence: string[];
}

export interface ChangedYaoDetail {
  position?: number;
  type: YaoType;
  liuQin: LiuQinType;
  naJia: DiZhi;
  wuXing: WuXing;
  liuShen: LiuShen;
  yaoCi?: string;
  relation: string;
}

export interface YaoChangeAnalysis {
  huaType: HuaType;
  originalZhi: DiZhi;
  changedZhi: DiZhi;
  description: string;
}

export interface FullYaoInfo {
  type: YaoType;
  change: YaoChange;
  position: number;
  liuQin: LiuQinType;
  liuShen: LiuShen;
  naJia: DiZhi;
  wuXing: WuXing;
  isShiYao: boolean;
  isYingYao: boolean;
}

export interface YaoFuShenDetail {
  liuQin: LiuQinType;
  naJia: DiZhi;
  wuXing: WuXing;
  relation: string;  // 伏神与飞神的生克关系
}

export interface FullYaoInfoExtended extends FullYaoInfo {
  isChanging: boolean;
  movementState: YaoMovementState;
  movementLabel: string;
  kongWangState: KongWangState;
  influence: YaoInfluence;
  strength: YaoStrength;
  changeAnalysis?: YaoChangeAnalysis;
  changedYao: ChangedYaoDetail | null;
  shenSha: string[];
  changSheng?: {
    stage: ShiErChangSheng;
    strength: 'strong' | 'medium' | 'weak';
  };
  fuShen?: YaoFuShenDetail;
}

export interface FuShen {
  liuQin: LiuQinType;
  wuXing: WuXing;
  naJia: DiZhi;
  feiShenPosition: number;
  feiShenLiuQin: LiuQinType;
  availabilityStatus: 'available' | 'conditional' | 'blocked';
  availabilityReason: string;
}

export interface ShenMember {
  liuQin: LiuQinType;
  wuXing: WuXing;
  positions: number[];
}

export interface ShenSystem {
  yuanShen?: ShenMember;
  jiShen?: ShenMember;
  chouShen?: ShenMember;
}

export interface ShenSystemByYongShen extends ShenSystem {
  targetLiuQin: LiuQinType;
}

export interface YongShenCandidate {
  liuQin: LiuQinType;
  naJia?: DiZhi;
  changedNaJia?: DiZhi;
  huaType?: HuaType;
  element: WuXing;
  position?: number;
  source: YongShenCandidateSource;
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

export interface YongShenGroup {
  targetLiuQin: LiuQinType;
  selectionStatus: YongShenSelectionStatus;
  selectionNote: string;
  selected: YongShenCandidate;
  candidates: YongShenCandidate[];
}

export interface TimeRecommendation {
  targetLiuQin: LiuQinType;
  type: 'favorable' | 'unfavorable' | 'critical';
  earthlyBranch?: DiZhi;
  trigger: string;
  basis: string[];
  description: string;
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

export interface SanHeAnalysis {
  hasFullSanHe: boolean;
  fullSanHe?: {
    name: string;
    result: WuXing;
    positions: number[];
    description: string;
  };
  fullSanHeList?: Array<{
    name: string;
    result: WuXing;
    positions: number[];
    description: string;
  }>;
  /** 三支俱见而只一支发动、不成局者（「不动不成局」） */
  unformedSanHe?: Array<{
    name: string;
    result: WuXing;
    positions: number[];
    description: string;
  }>;
  hasBanHe: boolean;
  banHe?: Array<{
    branches: [DiZhi, DiZhi];
    result: WuXing;
    type: 'sheng' | 'mu';
    positions: number[];
  }>;
}

export interface LiuYaoFullAnalysis {
  ganZhiTime: GanZhiTime;
  kongWang: KongWang;
  kongWangByPillar: KongWangByPillar;
  fullYaos: FullYaoInfoExtended[];
  yongShen: YongShenGroup[];
  fuShen?: FuShen[];
  shenSystemByYongShen: ShenSystemByYongShen[];
  globalShenSha: string[];
  timeRecommendations: TimeRecommendation[];
  liuChongGuaInfo: LiuChongGuaInfo;
  liuHeGuaInfo: LiuHeGuaInfo;
  chongHeTransition: ChongHeTransition;
  guaFanFuYin: GuaFanFuYinInfo;
  sanHeAnalysis: SanHeAnalysis;
  warnings?: string[];
}

export interface FullAnalysisOptions {
  yongShenTargets?: readonly unknown[];
}

type InternalPalace = {
  name: string;
  element: WuXing;
  order: number;
};

export type TrigramNaJia = {
  element: WuXing;
  lower: [DiZhi, DiZhi, DiZhi];
  upper: [DiZhi, DiZhi, DiZhi];
};

const TIANGAN: TianGan[] = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const DIZHI: DiZhi[] = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const LIU_QIN_TARGETS: LiuQinType[] = ['父母', '兄弟', '子孙', '妻财', '官鬼'];

export const XUN_KONG_TABLE = RAW_XUN_KONG_TABLE as Record<string, [DiZhi, DiZhi]>;

export const WANG_SHUAI_LABELS: Record<WangShuai, string> = {
  wang: '旺',
  xiang: '相',
  xiu: '休',
  qiu: '囚',
  si: '死',
};

export const KONG_WANG_LABELS: Record<KongWangState, string> = {
  not_kong: '',
  kong_static: '真空',
  kong_supported: '假空',
  kong_changing: '动空',
  kong_ri_chong: '冲空',
  kong_yue_jian: '临建',
};

const STRENGTH_LABELS: Record<YaoStrengthLevel, string> = {
  strong: '有气',
  moderate: '气平',
  weak: '无气',
};

export const SPECIAL_STATUS_LABELS: Record<YaoSpecialStatus, string> = {
  none: '',
  anDong: '暗动',
  riPo: '日破',
  yuePo: '月破',
};

export const MOVEMENT_LABELS: Record<YaoMovementState, string> = {
  static: '静',
  changing: '明动',
  hidden_moving: '暗动',
  day_break: '日破',
};

export const HUA_TYPE_LABELS: Record<HuaType, string> = {
  huaJin: '化进',
  huaTui: '化退',
  huiTouSheng: '回头生',
  huiTouKe: '回头克',
  huaKong: '化空',
  huaMu: '化墓',
  huaJue: '化绝',
  fuYin: '伏吟',
  fanYin: '反吟',
  none: '',
};

export const YONG_SHEN_STATUS_LABELS: Record<YongShenSelectionStatus, string> = {
  resolved: '已定主用',
  ambiguous: '并看',
  from_changed: '变爻取用',
  from_temporal: '月日代用',
  from_fushen: '伏神取用',
  missing: '未稳取到',
};

export const YAO_POSITION_NAMES = ['一爻', '二爻', '三爻', '四爻', '五爻', '六爻'];

/**
 * 传统爻位名：阳爻用九、阴爻用六，初/二/三/四/五/上
 */
export function traditionalYaoName(pos: number, type: number): string {
  const yinYang = type === 1 ? '九' : '六';
  if (pos === 1) return `初${yinYang}`;
  if (pos === 6) return `上${yinYang}`;
  const posLabels = ['初', '二', '三', '四', '五', '上'];
  return `${yinYang}${posLabels[pos - 1]}`;
}

/** 格式化干支时间为标准文本 */
export function formatGanZhiTime(gz: { year: { gan: string; zhi: string; }; month: { gan: string; zhi: string; }; day: { gan: string; zhi: string; }; hour: { gan: string; zhi: string; }; }): string {
  return `${gz.year.gan}${gz.year.zhi}年 ${gz.month.gan}${gz.month.zhi}月 ${gz.day.gan}${gz.day.zhi}日 ${gz.hour.gan}${gz.hour.zhi}时`;
}

/** 半合类型：生地半合（长生 + 帝旺）、墓地半合（帝旺 + 墓库） */
const BAN_HE_TYPE_LABELS: Record<'sheng' | 'mu', string> = {
  sheng: '生地半合',
  mu: '墓地半合',
};

function formatBanHeType(type: string): string {
  return Object.hasOwn(BAN_HE_TYPE_LABELS, type) ? `（${BAN_HE_TYPE_LABELS[type as keyof typeof BAN_HE_TYPE_LABELS]}）` : '';
}

/**
 * 卦级分析行（六冲/六合/冲合转换/反吟伏吟/三合/半合/全局神煞）
 * 返回纯文本行数组，调用方自行决定前缀
 */
export function formatGuaLevelLines(analysis: {
  liuChongGuaInfo?: { isLiuChongGua: boolean; description?: string; };
  liuHeGuaInfo?: { isLiuHeGua: boolean; description?: string; };
  chongHeTransition?: { type: string; description?: string; };
  guaFanFuYin?: GuaFanFuYinInfo;
  sanHeAnalysis?: {
    hasFullSanHe: boolean;
    fullSanHe?: { name: string; result: string; description?: string; };
    fullSanHeList?: Array<{ name: string; result: string; description?: string; }>;
    hasBanHe: boolean;
    banHe?: Array<{ branches: string[]; result: string; type: string; }>;
  };
  globalShenSha?: string[];
}): string[] {
  const parts: string[] = [];
  const { liuChongGuaInfo, liuHeGuaInfo, chongHeTransition, guaFanFuYin, sanHeAnalysis } = analysis;
  if (liuChongGuaInfo?.isLiuChongGua) {
    parts.push(`六冲卦：是${liuChongGuaInfo.description ? `（${liuChongGuaInfo.description}）` : ''}`);
  }
  if (liuHeGuaInfo?.isLiuHeGua) {
    parts.push(`六合卦：是${liuHeGuaInfo.description ? `（${liuHeGuaInfo.description}）` : ''}`);
  }
  if (chongHeTransition && chongHeTransition.type !== 'none' && chongHeTransition.description) {
    parts.push(chongHeTransition.description);
  }
  if (guaFanFuYin && (guaFanFuYin.isFanYin || guaFanFuYin.isFuYin)) {
    parts.push(`${formatGuaFanFuYinFlags(guaFanFuYin).join('、')}：${guaFanFuYin.description || '是'}`);
  }
  if (sanHeAnalysis) {
    if (sanHeAnalysis.hasFullSanHe && sanHeAnalysis.fullSanHeList?.length) {
      for (const sh of sanHeAnalysis.fullSanHeList) {
        parts.push(`三合局：${sh.name}→${sh.result}${sh.description ? `（${sh.description}）` : ''}`);
      }
    } else if (sanHeAnalysis.hasFullSanHe && sanHeAnalysis.fullSanHe) {
      parts.push(`三合局：${sanHeAnalysis.fullSanHe.name}→${sanHeAnalysis.fullSanHe.result}${sanHeAnalysis.fullSanHe.description ? `（${sanHeAnalysis.fullSanHe.description}）` : ''}`);
    }
    if (sanHeAnalysis.hasBanHe && sanHeAnalysis.banHe?.length) {
      for (const bh of sanHeAnalysis.banHe) {
        parts.push(`半合：${bh.branches.join('')}→${bh.result}${formatBanHeType(bh.type)}`);
      }
    }
  }
  return parts;
}

/** 按位置降序排列爻（上爻→初爻） */
export function sortYaosDescending<T extends { position: number; }>(yaos: readonly T[]): T[] {
  return [...yaos].sort((a, b) => b.position - a.position);
}

const ACTION_LABELS: Record<YaoAction, string> = {
  sheng: '生',
  ke: '克',
  fu: '扶',
  chong: '冲',
  he: '合',
  // 写作「日相破」，避免与日冲休囚的「日破」、月建冲爻的「月破」混称
  po: '相破',
  none: '',
};

const DIZHI_WUXING: Record<DiZhi, WuXing> = {
  子: '水',
  丑: '土',
  寅: '木',
  卯: '木',
  辰: '土',
  巳: '火',
  午: '火',
  未: '土',
  申: '金',
  酉: '金',
  戌: '土',
  亥: '水',
};

const WUXING_SHENG: Record<WuXing, WuXing> = {
  木: '火',
  火: '土',
  土: '金',
  金: '水',
  水: '木',
};

const WUXING_KE: Record<WuXing, WuXing> = {
  木: '土',
  土: '水',
  水: '火',
  火: '金',
  金: '木',
};

const WUXING_BEI_SHENG: Record<WuXing, WuXing> = {
  火: '木',
  土: '火',
  金: '土',
  水: '金',
  木: '水',
};

const WUXING_BEI_KE: Record<WuXing, WuXing> = {
  土: '木',
  水: '土',
  火: '水',
  金: '火',
  木: '金',
};

// 六爻土随水论生旺墓绝（水土同宫）：《增删卜易·生旺墓绝章》「土水长生在申 旺在子墓在辰绝在巳」，
// 《卜筮正宗·四生逐位论》同；火土同宫是八字的取法，不用于六爻
const WUXING_MU: Record<WuXing, DiZhi> = {
  木: '未',
  火: '戌',
  土: '辰',
  金: '丑',
  水: '辰',
};

const WUXING_JUE: Record<WuXing, DiZhi> = {
  木: '申',
  火: '亥',
  土: '巳',
  金: '寅',
  水: '巳',
};

const LIU_SHEN_CONFIG: Record<string, LiuShen[]> = {
  甲乙: ['青龙', '朱雀', '勾陈', '螣蛇', '白虎', '玄武'],
  丙丁: ['朱雀', '勾陈', '螣蛇', '白虎', '玄武', '青龙'],
  戊: ['勾陈', '螣蛇', '白虎', '玄武', '青龙', '朱雀'],
  己: ['螣蛇', '白虎', '玄武', '青龙', '朱雀', '勾陈'],
  庚辛: ['白虎', '玄武', '青龙', '朱雀', '勾陈', '螣蛇'],
  壬癸: ['玄武', '青龙', '朱雀', '勾陈', '螣蛇', '白虎'],
};

const WANG_SHUAI_TABLE: Record<DiZhi, Record<WuXing, WangShuai>> = {
  寅: { 木: 'wang', 火: 'xiang', 水: 'xiu', 金: 'qiu', 土: 'si' },
  卯: { 木: 'wang', 火: 'xiang', 水: 'xiu', 金: 'qiu', 土: 'si' },
  辰: { 土: 'wang', 金: 'xiang', 火: 'xiu', 木: 'qiu', 水: 'si' },
  巳: { 火: 'wang', 土: 'xiang', 木: 'xiu', 水: 'qiu', 金: 'si' },
  午: { 火: 'wang', 土: 'xiang', 木: 'xiu', 水: 'qiu', 金: 'si' },
  未: { 土: 'wang', 金: 'xiang', 火: 'xiu', 木: 'qiu', 水: 'si' },
  申: { 金: 'wang', 水: 'xiang', 土: 'xiu', 火: 'qiu', 木: 'si' },
  酉: { 金: 'wang', 水: 'xiang', 土: 'xiu', 火: 'qiu', 木: 'si' },
  戌: { 土: 'wang', 金: 'xiang', 火: 'xiu', 木: 'qiu', 水: 'si' },
  亥: { 水: 'wang', 木: 'xiang', 金: 'xiu', 土: 'qiu', 火: 'si' },
  子: { 水: 'wang', 木: 'xiang', 金: 'xiu', 土: 'qiu', 火: 'si' },
  丑: { 土: 'wang', 金: 'xiang', 火: 'xiu', 木: 'qiu', 水: 'si' },
};

const LIU_CHONG: Record<DiZhi, DiZhi> = {
  子: '午',
  丑: '未',
  寅: '申',
  卯: '酉',
  辰: '戌',
  巳: '亥',
  午: '子',
  未: '丑',
  申: '寅',
  酉: '卯',
  戌: '辰',
  亥: '巳',
};

const LIU_HE: Record<DiZhi, { partner: DiZhi; result: WuXing; }> = {
  子: { partner: '丑', result: '土' },
  丑: { partner: '子', result: '土' },
  寅: { partner: '亥', result: '木' },
  亥: { partner: '寅', result: '木' },
  卯: { partner: '戌', result: '火' },
  戌: { partner: '卯', result: '火' },
  辰: { partner: '酉', result: '金' },
  酉: { partner: '辰', result: '金' },
  巳: { partner: '申', result: '水' },
  申: { partner: '巳', result: '水' },
  午: { partner: '未', result: '火' },
  未: { partner: '午', result: '火' },
};

const XIANG_PO: Record<DiZhi, DiZhi> = {
  子: '酉',
  酉: '子',
  丑: '辰',
  辰: '丑',
  寅: '亥',
  亥: '寅',
  卯: '午',
  午: '卯',
  巳: '申',
  申: '巳',
  未: '戌',
  戌: '未',
};

const SAN_HE_TABLE: Array<{ branches: [DiZhi, DiZhi, DiZhi]; result: WuXing; name: string; }> = [
  { branches: ['申', '子', '辰'], result: '水', name: '申子辰合水局' },
  { branches: ['亥', '卯', '未'], result: '木', name: '亥卯未合木局' },
  { branches: ['寅', '午', '戌'], result: '火', name: '寅午戌合火局' },
  { branches: ['巳', '酉', '丑'], result: '金', name: '巳酉丑合金局' },
];

const BAN_HE_TABLE: Array<{ branches: [DiZhi, DiZhi]; result: WuXing; type: 'sheng' | 'mu'; }> = [
  { branches: ['申', '子'], result: '水', type: 'sheng' },
  { branches: ['亥', '卯'], result: '木', type: 'sheng' },
  { branches: ['寅', '午'], result: '火', type: 'sheng' },
  { branches: ['巳', '酉'], result: '金', type: 'sheng' },
  { branches: ['子', '辰'], result: '水', type: 'mu' },
  { branches: ['卯', '未'], result: '木', type: 'mu' },
  { branches: ['午', '戌'], result: '火', type: 'mu' },
  { branches: ['酉', '丑'], result: '金', type: 'mu' },
];

const WUXING_CHANG_SHENG_TABLE: Record<WuXing, Record<DiZhi, ShiErChangSheng>> = {
  木: { 亥: '长生', 子: '沐浴', 丑: '冠带', 寅: '临官', 卯: '帝旺', 辰: '衰', 巳: '病', 午: '死', 未: '墓', 申: '绝', 酉: '胎', 戌: '养' },
  火: { 寅: '长生', 卯: '沐浴', 辰: '冠带', 巳: '临官', 午: '帝旺', 未: '衰', 申: '病', 酉: '死', 戌: '墓', 亥: '绝', 子: '胎', 丑: '养' },
  土: { 申: '长生', 酉: '沐浴', 戌: '冠带', 亥: '临官', 子: '帝旺', 丑: '衰', 寅: '病', 卯: '死', 辰: '墓', 巳: '绝', 午: '胎', 未: '养' },
  金: { 巳: '长生', 午: '沐浴', 未: '冠带', 申: '临官', 酉: '帝旺', 戌: '衰', 亥: '病', 子: '死', 丑: '墓', 寅: '绝', 卯: '胎', 辰: '养' },
  水: { 申: '长生', 酉: '沐浴', 戌: '冠带', 亥: '临官', 子: '帝旺', 丑: '衰', 寅: '病', 卯: '死', 辰: '墓', 巳: '绝', 午: '胎', 未: '养' },
};

const CHANG_SHENG_STRENGTH: Record<ShiErChangSheng, 'strong' | 'medium' | 'weak'> = {
  长生: 'strong',
  沐浴: 'medium',
  冠带: 'strong',
  临官: 'strong',
  帝旺: 'strong',
  衰: 'medium',
  病: 'weak',
  死: 'weak',
  墓: 'weak',
  绝: 'weak',
  胎: 'medium',
  养: 'medium',
};

export const TRIGRAM_NA_JIA: Record<string, TrigramNaJia> = {
  乾: { element: '金', lower: ['子', '寅', '辰'], upper: ['午', '申', '戌'] },
  坎: { element: '水', lower: ['寅', '辰', '午'], upper: ['申', '戌', '子'] },
  艮: { element: '土', lower: ['辰', '午', '申'], upper: ['戌', '子', '寅'] },
  震: { element: '木', lower: ['子', '寅', '辰'], upper: ['午', '申', '戌'] },
  巽: { element: '木', lower: ['丑', '亥', '酉'], upper: ['未', '巳', '卯'] },
  离: { element: '火', lower: ['卯', '丑', '亥'], upper: ['酉', '未', '巳'] },
  坤: { element: '土', lower: ['未', '巳', '卯'], upper: ['丑', '亥', '酉'] },
  兑: { element: '金', lower: ['巳', '卯', '丑'], upper: ['亥', '酉', '未'] },
};

const ALL_BA_GONG: Record<string, InternalPalace> = {
  '111111': { name: '乾', element: '金', order: 0 },
  '011111': { name: '乾', element: '金', order: 1 },
  '001111': { name: '乾', element: '金', order: 2 },
  '000111': { name: '乾', element: '金', order: 3 },
  '000011': { name: '乾', element: '金', order: 4 },
  '000001': { name: '乾', element: '金', order: 5 },
  '000101': { name: '乾', element: '金', order: 6 },
  '111101': { name: '乾', element: '金', order: 7 },
  '010010': { name: '坎', element: '水', order: 0 },
  '110010': { name: '坎', element: '水', order: 1 },
  '100010': { name: '坎', element: '水', order: 2 },
  '101010': { name: '坎', element: '水', order: 3 },
  '101110': { name: '坎', element: '水', order: 4 },
  '101100': { name: '坎', element: '水', order: 5 },
  '101000': { name: '坎', element: '水', order: 6 },
  '010000': { name: '坎', element: '水', order: 7 },
  '001001': { name: '艮', element: '土', order: 0 },
  '101001': { name: '艮', element: '土', order: 1 },
  '111001': { name: '艮', element: '土', order: 2 },
  '110001': { name: '艮', element: '土', order: 3 },
  '110101': { name: '艮', element: '土', order: 4 },
  '110111': { name: '艮', element: '土', order: 5 },
  '110011': { name: '艮', element: '土', order: 6 },
  '001011': { name: '艮', element: '土', order: 7 },
  '100100': { name: '震', element: '木', order: 0 },
  '000100': { name: '震', element: '木', order: 1 },
  '010100': { name: '震', element: '木', order: 2 },
  '011100': { name: '震', element: '木', order: 3 },
  '011000': { name: '震', element: '木', order: 4 },
  '011010': { name: '震', element: '木', order: 5 },
  '011110': { name: '震', element: '木', order: 6 },
  '100110': { name: '震', element: '木', order: 7 },
  '011011': { name: '巽', element: '木', order: 0 },
  '111011': { name: '巽', element: '木', order: 1 },
  '101011': { name: '巽', element: '木', order: 2 },
  '100011': { name: '巽', element: '木', order: 3 },
  '100111': { name: '巽', element: '木', order: 4 },
  '100101': { name: '巽', element: '木', order: 5 },
  '100001': { name: '巽', element: '木', order: 6 },
  '011001': { name: '巽', element: '木', order: 7 },
  '101101': { name: '离', element: '火', order: 0 },
  '001101': { name: '离', element: '火', order: 1 },
  '011101': { name: '离', element: '火', order: 2 },
  '010101': { name: '离', element: '火', order: 3 },
  '010001': { name: '离', element: '火', order: 4 },
  '010011': { name: '离', element: '火', order: 5 },
  '010111': { name: '离', element: '火', order: 6 },
  '101111': { name: '离', element: '火', order: 7 },
  '000000': { name: '坤', element: '土', order: 0 },
  '100000': { name: '坤', element: '土', order: 1 },
  '110000': { name: '坤', element: '土', order: 2 },
  '111000': { name: '坤', element: '土', order: 3 },
  '111100': { name: '坤', element: '土', order: 4 },
  '111110': { name: '坤', element: '土', order: 5 },
  '111010': { name: '坤', element: '土', order: 6 },
  '000010': { name: '坤', element: '土', order: 7 },
  '110110': { name: '兑', element: '金', order: 0 },
  '010110': { name: '兑', element: '金', order: 1 },
  '000110': { name: '兑', element: '金', order: 2 },
  '001110': { name: '兑', element: '金', order: 3 },
  '001010': { name: '兑', element: '金', order: 4 },
  '001000': { name: '兑', element: '金', order: 5 },
  '001100': { name: '兑', element: '金', order: 6 },
  '110100': { name: '兑', element: '金', order: 7 },
};

const BA_GONG_BEN_GUA: Record<string, string> = {
  乾: '111111',
  坎: '010010',
  艮: '001001',
  震: '100100',
  巽: '011011',
  离: '101101',
  坤: '000000',
  兑: '110110',
};

const SHI_YING_TABLE: Record<number, [number, number]> = {
  0: [6, 3],
  1: [1, 4],
  2: [2, 5],
  3: [3, 6],
  4: [4, 1],
  5: [5, 2],
  6: [4, 1],
  7: [3, 6],
};

const HUA_JIN_MAP: Partial<Record<DiZhi, DiZhi>> = {
  亥: '子',
  寅: '卯',
  巳: '午',
  申: '酉',
  丑: '辰',
  辰: '未',
  未: '戌',
  戌: '丑',
};

const HUA_TUI_MAP: Partial<Record<DiZhi, DiZhi>> = {
  子: '亥',
  卯: '寅',
  午: '巳',
  酉: '申',
  辰: '丑',
  未: '辰',
  戌: '未',
  丑: '戌',
};

function getHexagramByCode(code: string): Hexagram | undefined {
  return HEXAGRAM_BY_CODE.get(code);
}

function getHexagramByName(name: string): Hexagram | undefined {
  return HEXAGRAM_BY_NAME.get(name) || HEXAGRAMS.find((item) => item.name.includes(name));
}

function isValidHexagramCode(code: string): boolean {
  return /^[01]{6}$/.test(code);
}

export function findHexagram(input: string): Hexagram | undefined {
  if (isValidHexagramCode(input)) {
    return getHexagramByCode(input);
  }
  return getHexagramByName(input);
}

export function normalizeYongShenTargets(targets?: readonly unknown[]): LiuQinType[] {
  if (!targets || targets.length === 0) {
    return [];
  }
  const unique = new Set<LiuQinType>();
  for (const target of targets) {
    if (typeof target === 'string' && LIU_QIN_TARGETS.includes(target as LiuQinType)) {
      unique.add(target as LiuQinType);
    }
  }
  return Array.from(unique);
}

export function hasInvalidYongShenTargets(targets?: readonly unknown[]): boolean {
  if (!targets || targets.length === 0) {
    return false;
  }
  return targets.some((target) => typeof target !== 'string' || !LIU_QIN_TARGETS.includes(target as LiuQinType));
}

function resolveYongShenTargets(question: string, targets?: readonly unknown[]): LiuQinType[] {
  if (!question.trim()) {
    throw new Error('请先明确问题后再解卦');
  }
  const normalized = normalizeYongShenTargets(targets);
  if (normalized.length === 0) {
    throw new Error('请至少选择一个分析目标');
  }
  return normalized;
}

function getLiuShen(dayGan: TianGan): LiuShen[] {
  if ('甲乙'.includes(dayGan)) return LIU_SHEN_CONFIG.甲乙;
  if ('丙丁'.includes(dayGan)) return LIU_SHEN_CONFIG.丙丁;
  if (dayGan === '戊') return LIU_SHEN_CONFIG.戊;
  if (dayGan === '己') return LIU_SHEN_CONFIG.己;
  if ('庚辛'.includes(dayGan)) return LIU_SHEN_CONFIG.庚辛;
  return LIU_SHEN_CONFIG.壬癸;
}

function getLiuQin(gongElement: WuXing, yaoElement: WuXing): LiuQinType {
  if (gongElement === yaoElement) return '兄弟';
  if (WUXING_SHENG[yaoElement] === gongElement) return '父母';
  if (WUXING_SHENG[gongElement] === yaoElement) return '子孙';
  if (WUXING_KE[gongElement] === yaoElement) return '妻财';
  if (WUXING_KE[yaoElement] === gongElement) return '官鬼';
  return '兄弟';
}

function findPalace(code: string): InternalPalace | undefined {
  return ALL_BA_GONG[code];
}

export function getPalaceInfo(code: string): { name: string; element: WuXing; order: number; } | undefined {
  return findPalace(code);
}

export function getShiYingPosition(code: string): { shi: number; ying: number; } {
  const palace = findPalace(code);
  const [shi, ying] = SHI_YING_TABLE[palace?.order ?? 0] ?? [6, 3];
  return { shi, ying };
}

export function getNaJiaByHexagram(hexagramCode: string, position: number): DiZhi {
  const hexagram = getHexagramByCode(hexagramCode);
  if (!hexagram || position < 1 || position > 6) {
    return '子';
  }
  const isLower = position <= 3;
  const trigramName = isLower ? hexagram.lowerTrigram : hexagram.upperTrigram;
  const trigram = TRIGRAM_NA_JIA[trigramName];
  if (!trigram) {
    return '子';
  }
  return isLower ? trigram.lower[position - 1] : trigram.upper[position - 4];
}

function buildDerivedHexagramInfo(code: string): DerivedHexagramInfo | undefined {
  const hexagram = findHexagram(code);
  if (!hexagram) return undefined;
  return {
    name: hexagram.name,
    guaCi: GUA_CI[hexagram.name],
    xiangCi: XIANG_CI[hexagram.name],
  };
}

export function calculateDerivedHexagrams(hexagramCode: string): {
  nuclearHexagram?: DerivedHexagramInfo;
  oppositeHexagram?: DerivedHexagramInfo;
  reversedHexagram?: DerivedHexagramInfo;
} {
  if (!isValidHexagramCode(hexagramCode)) {
    return {};
  }

  const lowerTrigram = hexagramCode[1] + hexagramCode[2] + hexagramCode[3];
  const upperTrigram = hexagramCode[2] + hexagramCode[3] + hexagramCode[4];
  const nuclearCode = lowerTrigram + upperTrigram;
  const oppositeCode = hexagramCode.split('').map((c) => (c === '1' ? '0' : '1')).join('');
  const reversedCode = hexagramCode.split('').reverse().join('');

  return {
    nuclearHexagram: buildDerivedHexagramInfo(nuclearCode),
    oppositeHexagram: buildDerivedHexagramInfo(oppositeCode),
    reversedHexagram: buildDerivedHexagramInfo(reversedCode),
  };
}

export function calculateGuaShen(hexagramCode: string): GuaShenInfo {
  if (!isValidHexagramCode(hexagramCode)) {
    return { branch: '子', absent: true };
  }

  const { shi } = getShiYingPosition(hexagramCode);
  const shiLineType = Number.parseInt(hexagramCode[shi - 1] ?? '', 10);
  if (Number.isNaN(shiLineType)) {
    return { branch: '子', absent: true };
  }

  const startIndex = shiLineType === 1 ? 0 : 6;
  const targetBranchIndex = (startIndex + (shi - 1)) % 12;
  const targetBranch = DIZHI[targetBranchIndex] ?? '子';

  for (let pos = 1; pos <= 6; pos += 1) {
    const naJia = getNaJiaByHexagram(hexagramCode, pos);
    if (naJia === targetBranch) {
      return { branch: targetBranch, linePosition: pos };
    }
  }

  return { branch: targetBranch, absent: true };
}

function getXunFromGanZhi(gan: TianGan, zhi: DiZhi): string {
  const ganIndex = TIANGAN.indexOf(gan);
  const zhiIndex = DIZHI.indexOf(zhi);
  const xunStartZhiIndex = (zhiIndex - ganIndex + 12) % 12;
  const xunNames: Record<number, string> = {
    0: '甲子旬',
    2: '甲寅旬',
    4: '甲辰旬',
    6: '甲午旬',
    8: '甲申旬',
    10: '甲戌旬',
  };
  return xunNames[xunStartZhiIndex] || '甲子旬';
}

export function calculateGanZhiTime(date: Date): GanZhiTime {
  const solar = Solar.fromYmdHms(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  );
  const lunar = solar.getLunar();
  const eightChar = lunar.getEightChar() as unknown as {
    setSect?: (value: number) => void;
    getYearGan: () => string;
    getYearZhi: () => string;
    getMonthGan: () => string;
    getMonthZhi: () => string;
    getDayGan: () => string;
    getDayZhi: () => string;
    getTimeGan: () => string;
    getTimeZhi: () => string;
  };
  eightChar.setSect?.(1);
  const beijing = getZonedDateTimeParts(date, CALENDAR_TIMEZONE);
  const termEightChar = Solar.fromYmdHms(beijing.year, beijing.month, beijing.day, beijing.hour, beijing.minute, beijing.second).getLunar().getEightChar();

  const dayGan = eightChar.getDayGan() as TianGan;
  const dayZhi = eightChar.getDayZhi() as DiZhi;

  return {
    year: {
      gan: termEightChar.getYearGan() as TianGan,
      zhi: termEightChar.getYearZhi() as DiZhi,
    },
    month: {
      gan: termEightChar.getMonthGan() as TianGan,
      zhi: termEightChar.getMonthZhi() as DiZhi,
    },
    day: {
      gan: dayGan,
      zhi: dayZhi,
    },
    hour: {
      gan: eightChar.getTimeGan() as TianGan,
      zhi: eightChar.getTimeZhi() as DiZhi,
    },
    xun: getXunFromGanZhi(dayGan, dayZhi),
  };
}

export function getKongWang(dayGan: TianGan, dayZhi: DiZhi): KongWang {
  const kongWang = getKongWangByPillarSource(dayGan, dayZhi);
  return {
    xun: kongWang.xun,
    kongDizhi: kongWang.kongZhi as [DiZhi, DiZhi],
  };
}

export function calculateKongWangByPillar(ganZhiTime: GanZhiTime): KongWangByPillar {
  return {
    year: getKongWang(ganZhiTime.year.gan, ganZhiTime.year.zhi),
    month: getKongWang(ganZhiTime.month.gan, ganZhiTime.month.zhi),
    day: getKongWang(ganZhiTime.day.gan, ganZhiTime.day.zhi),
    hour: getKongWang(ganZhiTime.hour.gan, ganZhiTime.hour.zhi),
  };
}

export function getZhiAction(sourceZhi: DiZhi, targetZhi: DiZhi): YaoAction {
  if (LIU_CHONG[sourceZhi] === targetZhi) {
    return 'chong';
  }
  if (LIU_HE[sourceZhi]?.partner === targetZhi) {
    return 'he';
  }
  const sourceWuXing = DIZHI_WUXING[sourceZhi];
  const targetWuXing = DIZHI_WUXING[targetZhi];
  if (sourceWuXing === targetWuXing) {
    return 'fu';
  }
  if (WUXING_SHENG[sourceWuXing] === targetWuXing) {
    return 'sheng';
  }
  if (WUXING_KE[sourceWuXing] === targetWuXing) {
    return 'ke';
  }
  // 六破力弱（「六破不必论」），不能遮住酉生子、卯生午、辰丑戌未比扶这类生扶
  if (XIANG_PO[sourceZhi] === targetZhi) {
    return 'po';
  }
  return 'none';
}

export function getYaoInfluence(yaoZhi: DiZhi, monthZhi: DiZhi, dayZhi: DiZhi): YaoInfluence {
  const monthAction = getZhiAction(monthZhi, yaoZhi);
  const dayAction = getZhiAction(dayZhi, yaoZhi);
  const parts: string[] = [];
  if (monthAction !== 'none') parts.push(`月${ACTION_LABELS[monthAction]}`);
  if (dayAction !== 'none') parts.push(`日${ACTION_LABELS[dayAction]}`);
  return {
    monthAction,
    dayAction,
    description: parts.length > 0 ? parts.join('、') : '无特殊作用',
  };
}

type Verdict = 'help' | 'neutral' | 'hurt';

interface Judgement {
  verdict: Verdict;
  notes: string[];
}

interface DayJudgement extends Judgement {
  /** 静爻逢日冲：旺相为暗动，休囚为日破 */
  specialStatus: 'none' | 'anDong' | 'riPo';
  /** 实际作用的生旺墓绝（被「论生不论墓」等条文否定者不计） */
  stage?: ShiErChangSheng;
  /** 日辰之助全凭动爻生扶才成立（如土爻无根逢子日，得动爻生扶方论帝旺），相敌时不再重复计此动爻 */
  reliesOnMovingSupport?: boolean;
}

/** source 对 target 的五行作用：生、扶（同类）、克、泄（target 生 source）、耗（target 克 source） */
type ElementRelation = 'sheng' | 'fu' | 'ke' | 'xie' | 'hao';

function getElementRelation(source: WuXing, target: WuXing): ElementRelation {
  if (source === target) return 'fu';
  if (WUXING_SHENG[source] === target) return 'sheng';
  if (WUXING_KE[source] === target) return 'ke';
  return WUXING_SHENG[target] === source ? 'xie' : 'hao';
}

function judgeRelation(prefix: '月' | '日', isHe: boolean, relation: ElementRelation): Judgement {
  const heNotes = isHe ? [`${prefix}合`] : [];
  if (relation === 'ke') return { verdict: 'hurt', notes: [isHe ? `${prefix}合带克` : `${prefix}克`] };
  if (relation === 'fu') return { verdict: 'help', notes: [`${prefix}扶`, ...heNotes] };
  if (relation === 'sheng') return { verdict: 'help', notes: [`${prefix}生`, ...heNotes] };
  return { verdict: isHe ? 'help' : 'neutral', notes: heNotes };
}

/**
 * 月建论爻（《增删卜易·月将章》）：临月建、月扶（旺）、月生（相）为助；休囚逢月合「衰而亦旺」亦为助；
 * 月克（死）为伤，合而带克仍是克；其余休囚无助。月破另论，见 judgeLine。
 */
function judgeMonth(yaoZhi: DiZhi, yaoWuXing: WuXing, monthZhi: DiZhi): Judgement {
  if (yaoZhi === monthZhi) return { verdict: 'help', notes: ['临月建'] };
  return judgeRelation('月', LIU_HE[monthZhi].partner === yaoZhi, getElementRelation(DIZHI_WUXING[monthZhi], yaoWuXing));
}

/**
 * 日辰论爻：
 * - 临日建为助。静爻逢日冲，旺相为暗动（冲而带克仍为伤），休囚为日破（《日辰章》《暗动章》）；
 *   动爻逢冲不散，冲而带克为伤（《动散章》）；辰戌、丑未虽同类，相冲不作扶，墓逢冲则开不论入墓。
 * - 只验生旺墓绝，且须看本爻有根无根（《生旺墓绝章》觉子注）：长生、帝旺须日辰本生扶，或月令旺相，或得动爻生扶，
 *   否则不论（金爻休囚逢巳日「论克不论生」）；日墓为伤，惟日辰本生扶而本爻又旺相或得动爻生扶者论生不论墓；
 *   日绝为伤，月令当权则逢绝不绝（《月将章》），日辰本生扶而得动爻生扶者论生不论绝。
 * - 其余：日生、日扶、日合为助，日克、合而带克为伤，泄、耗、相破无助无伤。
 */
function judgeDay(
  yaoZhi: DiZhi,
  yaoWuXing: WuXing,
  dayZhi: DiZhi,
  isChanging: boolean,
  monthHelps: boolean,
  movingSupport: boolean,
): DayJudgement {
  const rawStage = getChangSheng(yaoWuXing, dayZhi);
  if (yaoZhi === dayZhi) {
    return { verdict: 'help', notes: ['临日建'], specialStatus: 'none', ...(rawStage === '长生' || rawStage === '帝旺' ? { stage: rawStage } : {}) };
  }
  const relation = getElementRelation(DIZHI_WUXING[dayZhi], yaoWuXing);
  const isChong = LIU_CHONG[yaoZhi] === dayZhi;
  const stage = isChong && rawStage === '墓' ? undefined : rawStage;
  if (isChong && !isChanging) {
    if (!monthHelps) {
      return stage === '绝'
        ? { verdict: 'hurt', notes: ['日破（休囚静爻逢日冲）', '日绝'], specialStatus: 'riPo', stage }
        : { verdict: 'hurt', notes: ['日破（休囚静爻逢日冲）'], specialStatus: 'riPo' };
    }
    return relation === 'ke'
      ? { verdict: 'hurt', notes: ['暗动（旺相静爻逢日冲）', '日冲带克'], specialStatus: 'anDong' }
      : { verdict: 'help', notes: ['暗动（旺相静爻逢日冲，愈得其力）'], specialStatus: 'anDong' };
  }

  const byRelation: Judgement = isChong
    ? { verdict: relation === 'ke' ? 'hurt' : 'neutral', notes: [relation === 'ke' ? '日冲带克' : '动爻逢日冲不散'] }
    : judgeRelation('日', LIU_HE[dayZhi].partner === yaoZhi, relation);
  const rootedByDay = !isChong && (relation === 'sheng' || relation === 'fu');
  const hurtNotes = byRelation.verdict === 'hurt' ? byRelation.notes : [];
  const result = (verdict: Verdict, notes: string[], appliedStage?: ShiErChangSheng, reliesOnMovingSupport = false): DayJudgement => ({
    verdict,
    notes,
    specialStatus: 'none',
    ...(appliedStage ? { stage: appliedStage } : {}),
    ...(reliesOnMovingSupport ? { reliesOnMovingSupport } : {}),
  });

  if (stage === '长生' || stage === '帝旺') {
    if (rootedByDay || monthHelps || movingSupport) {
      const helpNotes = byRelation.verdict === 'help' ? byRelation.notes : [];
      const viaMoving = !rootedByDay && !monthHelps && byRelation.verdict !== 'help';
      const qualifier = viaMoving ? '（得动爻生扶为根）' : hurtNotes.length > 0 ? '，论生不论克' : '';
      return result('help', [...helpNotes, `日辰${stage}${qualifier}`], stage, viaMoving);
    }
    return result(byRelation.verdict, [...byRelation.notes, `日辰${stage}而本爻无根，不论${stage === '帝旺' ? '旺' : '生'}`]);
  }
  if (stage === '墓') {
    if (rootedByDay && (monthHelps || movingSupport)) {
      return result('help', [...byRelation.notes, '日墓而得生扶，论生不论墓'], undefined, !monthHelps);
    }
    return result('hurt', [...hurtNotes, rootedByDay ? '日墓（本爻无气，论墓不论生）' : '日墓'], '墓');
  }
  if (stage === '绝') {
    if (monthHelps) return result(byRelation.verdict, [...byRelation.notes, '月令当权，逢绝不绝']);
    if (rootedByDay && movingSupport) {
      return result('help', [...byRelation.notes, '日绝而得动爻生扶，论生不论绝'], undefined, true);
    }
    return result('hurt', [...hurtNotes, rootedByDay ? '日绝（本爻无气，论绝不论生）' : '日绝'], '绝');
  }
  return result(byRelation.verdict, byRelation.notes);
}

/**
 * 日月合论（《增删卜易·月将章》）：得月日之助而无伤为有气；月日一助一伤为相敌（「午月克之，未日生之，可以相敌」），
 * 相敌之爻以他爻定胜负——「月克日生遇帮而愈旺，月生日克逢他削而亦衰」；无助者休囚无气。
 */
function combineMonthDay(month: Verdict, day: Verdict, hasSupport: boolean, hasHarm: boolean): { level: YaoStrengthLevel; note?: string; } {
  const helped = month === 'help' || day === 'help';
  const hurt = month === 'hurt' || day === 'hurt';
  if (helped && !hurt) return { level: 'strong' };
  if (helped) {
    if (hasSupport && !hasHarm) return { level: 'strong', note: '日月相敌，得动爻相扶' };
    if (hasHarm && !hasSupport) return { level: 'weak', note: '日月相敌，又逢动爻克制' };
    return { level: 'moderate', note: '日月相敌' };
  }
  return month === 'neutral' && day === 'neutral' ? { level: 'weak', note: '休囚无气' } : { level: 'weak' };
}

const KONG_NOTES: Record<KongWangState, string> = {
  not_kong: '',
  kong_static: '真空（静而无气，又无日建动爻生扶）',
  kong_supported: '假空（旬内仍空，出空之日有用）',
  kong_changing: '动空（动不为空，出空、冲空之日有用）',
  kong_ri_chong: '冲空则实',
  kong_yue_jian: '临月建而旬空（旬内仍空，出空之日有用）',
};

/**
 * 旬空真假（《增删卜易·旬空章》「旺不为空，动不为空，有日建动爻生扶者不为空」、月将章「在旬内者毕竟为空」；
 * 《卜筮正宗·旬空论》「休囚安静或日辰克动爻克…静逢月破值此旬空者，谓之真空」）：
 * 动爻或有根之爻逢日冲则冲空而实（日辰章「爻遇旬空，日辰冲起而有用」）；休囚静爻逢日冲是日破，「愈加无用」，仍为真空
 * （旬空论：旺相、发动、得生扶之空「到底有用，不过待其出旬、值日、有合空、冲起、冲实、填补」，休囚安静者「真空到底空矣」）；
 * 临月建、动爻、旺相或得日建动爻生扶者旬内仍空而出空有用；其余静而无气者为真空。
 */
function classifyKong(yaoZhi: DiZhi, kongWang: KongWang, monthZhi: DiZhi, dayZhi: DiZhi, isChanging: boolean, rooted: boolean): KongWangState {
  if (!kongWang.kongDizhi.includes(yaoZhi)) return 'not_kong';
  if (LIU_CHONG[yaoZhi] === dayZhi) return isChanging || rooted ? 'kong_ri_chong' : 'kong_static';
  if (yaoZhi === monthZhi) return 'kong_yue_jian';
  if (isChanging) return 'kong_changing';
  return rooted ? 'kong_supported' : 'kong_static';
}

interface LineFacts {
  yaoZhi: DiZhi;
  yaoWuXing: WuXing;
  /** moving 明动之爻；changed 动而变出之爻，冲、空、破皆按动论 */
  motion: 'static' | 'moving' | 'changed';
  /** 本爻动化之爻回克本爻（「卯爻动化申酉」） */
  changedKe: boolean;
  /** 有力之动爻（含暗动）生扶、克制本爻者，名称供判据 */
  movingSupport: string[];
  movingHarm: string[];
}

interface LineJudgement {
  strength: YaoStrength;
  kongWangState: KongWangState;
  monthVerdict: Verdict;
  dayVerdict: Verdict;
  /** 本爻有根：得月或日之助，或得动爻生扶（化变墓绝论生、旬空真假据此） */
  rooted: boolean;
  dayStage?: ShiErChangSheng;
}

/**
 * 一爻之气，按条判定、不计分：
 * 1. 月破：临日建者逢破不破，惟他爻动来克之或本爻动化回克，寡不敌众，破亦为破（《日辰章》）。破爻月内无功
 *    （《卜筮正宗·辟易林补遗》「不过在月内不能为吉凶」），一律无气；静而无日辰、动爻生助者为真破，
 *    其余出月、逢合、实破之日可用（《增删卜易·月破章》）。
 * 2. 其余按月、日各自的助伤合论，见 combineMonthDay。
 */
function judgeLine(facts: LineFacts, monthZhi: DiZhi, dayZhi: DiZhi, kongWang: KongWang): LineJudgement {
  const { yaoZhi, yaoWuXing, motion, changedKe, movingSupport, movingHarm } = facts;
  const isChanging = motion !== 'static';
  const wangShuai = WANG_SHUAI_TABLE[monthZhi][yaoWuXing];
  const hasSupport = movingSupport.length > 0;
  const hasHarm = movingHarm.length > 0;
  const isMonthChong = LIU_CHONG[yaoZhi] === monthZhi;
  const linDay = yaoZhi === dayZhi;
  const isYuePo = isMonthChong && !(linDay && !hasHarm && !changedKe);

  const month: Judgement = isMonthChong
    ? { verdict: isYuePo ? 'hurt' : 'neutral', notes: [] }
    : judgeMonth(yaoZhi, yaoWuXing, monthZhi);
  const day = judgeDay(yaoZhi, yaoWuXing, dayZhi, isChanging, month.verdict === 'help', hasSupport);

  const evidence = [`月令${WANG_SHUAI_LABELS[wangShuai]}`, ...month.notes];
  if (isMonthChong && !isYuePo) {
    evidence.push('临日建，逢月破而不破');
  } else {
    if (isYuePo) {
      if (linDay) evidence.push('临日建而受克，破亦为破');
      const rescue = motion === 'changed' ? '化出之爻不为真破' : isChanging ? '动而不为真破' : day.verdict === 'help' ? '得日辰生助' : hasSupport ? '得动爻生助' : '';
      evidence.push(rescue ? `月破（${rescue}，出月、逢合、实破之日可用）` : '月破（静而无日辰动爻生助，为真破）');
    }
    evidence.push(...day.notes);
  }
  if (motion === 'moving') evidence.push('明动');
  if (hasSupport) evidence.push(`动爻生扶（${movingSupport.join('、')}）`);
  if (hasHarm) evidence.push(`动爻克制（${movingHarm.join('、')}）`);

  const combined = isYuePo
    ? { level: 'weak' as const }
    : combineMonthDay(month.verdict, day.verdict, hasSupport && !day.reliesOnMovingSupport, hasHarm);
  const rooted = month.verdict === 'help' || day.verdict === 'help' || hasSupport;
  const kongWangState = classifyKong(yaoZhi, kongWang, monthZhi, dayZhi, isChanging, rooted);
  if (kongWangState !== 'not_kong') evidence.push(motion === 'changed' && kongWangState === 'kong_changing' ? '化空（动而化空不为真空，出空、冲空之日有用）' : KONG_NOTES[kongWangState]);
  if (combined.note) evidence.push(combined.note);

  return {
    strength: {
      wangShuai,
      level: combined.level,
      isStrong: combined.level === 'strong',
      specialStatus: isYuePo ? 'yuePo' : day.specialStatus,
      evidence,
    },
    kongWangState,
    monthVerdict: month.verdict,
    dayVerdict: day.verdict,
    rooted,
    ...(day.stage ? { dayStage: day.stage } : {}),
  };
}

/**
 * 他爻能否生克本爻（《增删卜易·元神忌神衰旺章》「元神虽现又有不能生用神者有六」、家人之贲占例「巳火又化回头之克，
 * 不能生丑土之财」）：只取明动、暗动之爻（「倘得他爻又动相扶」）；动化回头克者无力；无气之爻再逢月破、日月伤克、
 * 化退、化墓、化绝、化破者亦无力。
 */
function canActOnOthers(yao: FullYaoInfo, judgement: LineJudgement, change: YaoChangeAnalysis | undefined, monthZhi: DiZhi): boolean {
  if (yao.change !== 'changing' && judgement.strength.specialStatus !== 'anDong') return false;
  if (change && WUXING_KE[DIZHI_WUXING[change.changedZhi]] === yao.wuXing) return false;
  if (judgement.strength.level !== 'weak') return true;
  const huaType = change?.huaType;
  return !(judgement.strength.specialStatus === 'yuePo'
    || judgement.monthVerdict === 'hurt'
    || judgement.dayVerdict === 'hurt'
    || huaType === 'huaTui'
    || huaType === 'huaMu'
    || huaType === 'huaJue'
    || (change !== undefined && LIU_CHONG[change.changedZhi] === monthZhi));
}

function getYaoMovementState(yao: FullYaoInfo, strength: YaoStrength): YaoMovementState {
  if (yao.change === 'changing') {
    return 'changing';
  }
  if (strength.specialStatus === 'anDong') {
    return 'hidden_moving';
  }
  if (strength.specialStatus === 'riPo' || strength.specialStatus === 'yuePo') {
    return 'day_break';
  }
  return 'static';
}

// day_break 状态同时涵盖日破与月破（状态值保持兼容），标签按实际来源区分；
// 动爻亦论月破（《增删卜易·月破章》「动则能伤于爻」），动静状态仍为 changing，标签并列「明动·月破」
function getYaoMovementLabel(movementState: YaoMovementState, strength: YaoStrength): string {
  if (movementState === 'day_break') return SPECIAL_STATUS_LABELS[strength.specialStatus];
  if (movementState === 'changing' && strength.specialStatus === 'yuePo') return `${MOVEMENT_LABELS.changing}·${SPECIAL_STATUS_LABELS.yuePo}`;
  return MOVEMENT_LABELS[movementState];
}

function getChangSheng(wuXing: WuXing, diZhi: DiZhi): ShiErChangSheng {
  return WUXING_CHANG_SHENG_TABLE[wuXing][diZhi];
}

/**
 * 化变定性：一个变化常同时具备几种关系（如亥化辰既回头克又化墓），按以下次序取主名，其余写入说明：
 * 伏吟/反吟（爻象）→ 进退神（配对，《增删卜易》占例「丑土官动化进神」论进不论墓）→ 回头克（本质之伤）
 * → 墓绝与回头生相兼时看本爻有无日月帮比（《卜筮正宗·绝处逢生论》「土化出巳有日月帮比不云化绝，乃云回头生」）
 * → 化墓/化绝 → 回头生 → 化空（时间性条件）。
 * @param originalSupported 本爻有根：得月或日之助，或得动爻生扶（觉子注「旺相，或日月动爻生扶…皆谓长生」）
 */
function analyzeYaoChange(
  originalZhi: DiZhi,
  changedZhi: DiZhi,
  originalWuXing: WuXing,
  changedWuXing: WuXing,
  kongWang: KongWang,
  originalSupported: boolean,
): YaoChangeAnalysis {
  const result = (huaType: HuaType, description: string): YaoChangeAnalysis => ({
    huaType,
    originalZhi,
    changedZhi,
    description: huaType !== 'huaKong' && kongWang.kongDizhi.includes(changedZhi) ? `${description}；变爻旬空，出空方应` : description,
  });
  const isMu = WUXING_MU[originalWuXing] === changedZhi;
  const isJue = WUXING_JUE[originalWuXing] === changedZhi;
  const tombNote = isMu ? '（兼化墓）' : isJue ? '（兼化绝）' : '';
  const isKe = WUXING_KE[changedWuXing] === originalWuXing;
  const isSheng = WUXING_SHENG[changedWuXing] === originalWuXing;

  if (originalZhi === changedZhi) {
    return result('fuYin', '伏吟：变爻与本爻同支，事多反复');
  }
  if (LIU_CHONG[originalZhi] === changedZhi) {
    return result('fanYin', isKe
      ? `反吟：变爻冲本爻又回头克${tombNote}，反复之中受伤`
      : `反吟：变爻与本爻相冲${tombNote}，事态多反复`);
  }
  if (HUA_JIN_MAP[originalZhi] === changedZhi) {
    return result('huaJin', '化进：按进神配对，后势较前推进');
  }
  if (HUA_TUI_MAP[originalZhi] === changedZhi) {
    return result('huaTui', '化退：按退神配对，后势较前回退');
  }
  if (isKe) {
    return result('huiTouKe', `回头克：变爻回克本爻${tombNote}`);
  }
  if (isSheng && (isMu || isJue)) {
    if (originalSupported) {
      return result('huiTouSheng', `回头生：变爻回生本爻；本爻得日月帮比，论生不论${isMu ? '墓' : '绝'}`);
    }
    return isMu
      ? result('huaMu', '化墓：变爻虽生本爻，本爻无日月帮比，论墓不论生')
      : result('huaJue', '化绝：变爻虽生本爻，本爻无日月帮比，论绝不论生');
  }
  if (isMu) {
    return result('huaMu', '化墓：变爻入墓，事情受阻');
  }
  if (isJue) {
    return result('huaJue', '化绝：变爻入绝，后劲不足');
  }
  if (isSheng) {
    return result('huiTouSheng', '回头生：变爻回生本爻');
  }
  if (kongWang.kongDizhi.includes(changedZhi)) {
    return result('huaKong', '化空：变爻落空，需待填实');
  }
  return result('none', '');
}

function calculateChangedYaoDetail(
  hexagramCode: string,
  changedCode: string,
  position: number,
  gongElement: WuXing,
  originalYao: FullYaoInfo,
  changeAnalysis: YaoChangeAnalysis,
): ChangedYaoDetail {
  const changedNaJia = changeAnalysis.changedZhi;
  const changedWuXing = DIZHI_WUXING[changedNaJia];
  return {
    position,
    type: parseInt(changedCode[position - 1] || '0', 10) as YaoType,
    liuQin: getLiuQin(gongElement, changedWuXing),
    naJia: changedNaJia,
    wuXing: changedWuXing,
    liuShen: originalYao.liuShen,
    yaoCi: YAO_CI[getHexagramByCode(hexagramCode)?.name || '']?.[position - 1],
    relation: HUA_TYPE_LABELS[changeAnalysis.huaType] || '平',
  };
}

export function calculateFullYaoInfo(yaos: YaoInput[], hexagramCode: string, dayStem: TianGan): FullYaoInfo[] {
  const palace = findPalace(hexagramCode);
  const gongElement = palace?.element || '土';
  const { shi, ying } = getShiYingPosition(hexagramCode);
  const liuShenList = getLiuShen(dayStem);

  return yaos.map((yao) => {
    assertInteger(yao.position, 'yao.position', 1, 6);
    const naJia = getNaJiaByHexagram(hexagramCode, yao.position);
    const wuXing = DIZHI_WUXING[naJia];
    return {
      ...yao,
      liuQin: getLiuQin(gongElement, wuXing),
      liuShen: liuShenList[yao.position - 1],
      naJia,
      wuXing,
      isShiYao: yao.position === shi,
      isYingYao: yao.position === ying,
    };
  });
}

/** 三合局中一支的来处：本爻（明动、暗动、静）、动爻化出之支、月建、日辰 */
interface SanHeMember {
  /** 本爻或化出之支所在爻位；月建、日辰为 0 */
  position: number;
  /** 明动、暗动之爻，或动爻化出之支 */
  active: boolean;
  source: 'line' | 'changed' | 'month' | 'day';
  label: string;
  /** 此支之病与成局之期 */
  sickness?: string;
}

const SAN_HE_KONG_SICK: ReadonlySet<KongWangState> = new Set(['kong_static', 'kong_supported', 'kong_changing']);
/** 补足第三支时的取舍：月建补成本月即应，静爻待值日，日辰次之 */
const SAN_HE_SUPPLEMENT_RANK: Record<SanHeMember['source'], number> = { month: 3, line: 2, changed: 2, day: 1 };

/** 局中本爻之病（第四问「宗其一爻有病关因者断之」）：破待合填、空待出空、墓待冲开、合待冲开 */
function sanHeLineSickness(yao: FullYaoInfoExtended, monthZhi: DiZhi, dayZhi: DiZhi): string | undefined {
  const zhi = yao.naJia;
  const special = yao.strength.specialStatus;
  if (special === 'yuePo') return `${zhi}月破，逢${zhi}填实或逢${LIU_HE[zhi].partner}合之日成局`;
  if (special === 'riPo') return `${zhi}日破，逢${LIU_HE[zhi].partner}合之日成局`;
  if (SAN_HE_KONG_SICK.has(yao.kongWangState)) return `${zhi}旬空，逢${LIU_CHONG[zhi]}冲空或逢${zhi}填实之日成局`;
  if (yao.changSheng?.stage === '墓') return `${zhi}入墓，逢${LIU_CHONG[dayZhi]}冲开之日成局`;
  // 日冲之爻（暗动）不论合住
  if (LIU_CHONG[zhi] === dayZhi) return undefined;
  if (LIU_HE[zhi].partner === dayZhi) return `${zhi}合日，逢${LIU_CHONG[zhi]}冲开之日成局`;
  if (LIU_HE[zhi].partner === monthZhi) return `${zhi}合月，逢${LIU_CHONG[zhi]}或${LIU_CHONG[monthZhi]}冲开之日成局`;
  return undefined;
}

/** 逐支取来处：发动者最多为先，补足之支依 SAN_HE_SUPPLEMENT_RANK 取舍 */
function pickSanHeMembers(candidates: readonly SanHeMember[][]): SanHeMember[] {
  const keyOf = (members: readonly SanHeMember[]) => [
    members.filter((member) => member.active).length,
    members.reduce((sum, member) => sum + SAN_HE_SUPPLEMENT_RANK[member.source], 0),
  ];
  let best: { members: SanHeMember[]; key: number[]; } | undefined;
  const visit = (chosen: SanHeMember[]) => {
    if (chosen.length === candidates.length) {
      const key = keyOf(chosen);
      if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] > best.key[1])) best = { members: chosen, key };
      return;
    }
    for (const member of candidates[chosen.length]) visit([...chosen, member]);
  };
  visit([]);
  return best?.members ?? [];
}

/**
 * 三合局（《增删卜易·三合章》、《卜筮正宗》第四问）：
 * - 成局有四：三爻俱动；两爻动一爻静；内卦初三爻、外卦四六爻动而与化出之支合成。即三支俱全，其中至少两支发动
 *   （明动、暗动之爻，或动爻化出之支；「一爻明动一爻暗动亦作两爻动」）。第四问例艮天大畜之乾为天，四爻戌动化午、
 *   静爻寅，亦断「寅午戌三合父局」；例乾之小畜「借寅月建补成三合，本月必选」，月建、日辰可补一支。
 * - 「不动不成局」：三支虽全而只一支发动者不成局。合化五行的旺衰另论，不作成局条件。
 * - 局中有病待去病之日：「三合局中若有一空破者，待填满之日月成之；有一爻入墓者待冲开之日成之」，第四问「其冲破也，
 *   必待相合之期至」「静而逢合…必待冲期至」「化而逢空者，待其出空之期」；无病而一爻静二爻发者，「待一爻静者值日应事」。
 * 三支只见其二者（虚一待用）不在此列；半合沿用原法，只作辅助。
 */
function analyzeSanHe(fullYaos: readonly FullYaoInfoExtended[], monthZhi: DiZhi, dayZhi: DiZhi, kongBranches: readonly DiZhi[]): SanHeAnalysis {
  const membersOf = (zhi: DiZhi): SanHeMember[] => [
    ...fullYaos.filter((yao) => yao.naJia === zhi).map((yao): SanHeMember => {
      const hidden = yao.movementState === 'hidden_moving';
      const sickness = sanHeLineSickness(yao, monthZhi, dayZhi);
      return {
        position: yao.position,
        active: yao.isChanging || hidden,
        source: 'line',
        label: `${traditionalYaoName(yao.position, yao.type)}${zhi}${yao.isChanging ? '动' : hidden ? '暗动' : '静'}`,
        ...(sickness ? { sickness } : {}),
      };
    }),
    ...fullYaos.filter((yao) => yao.changedYao?.naJia === zhi).map((yao): SanHeMember => ({
      position: yao.position,
      active: true,
      source: 'changed',
      label: `${traditionalYaoName(yao.position, yao.type)}化出${zhi}`,
      ...(kongBranches.includes(zhi) ? { sickness: `${zhi}化空，逢${LIU_CHONG[zhi]}冲空或逢${zhi}填实之日成局` } : {}),
    })),
    ...(monthZhi === zhi ? [{ position: 0, active: false, source: 'month' as const, label: `月建${zhi}` }] : []),
    ...(dayZhi === zhi ? [{ position: 0, active: false, source: 'day' as const, label: `日辰${zhi}` }] : []),
  ];

  const formed: NonNullable<SanHeAnalysis['fullSanHeList']> = [];
  const unformed: NonNullable<SanHeAnalysis['unformedSanHe']> = [];
  for (const sanHe of SAN_HE_TABLE) {
    const candidates = sanHe.branches.map(membersOf);
    if (candidates.some((list) => list.length === 0)) continue;
    const members = pickSanHeMembers(candidates);
    const activeCount = members.filter((member) => member.active).length;
    const positions = [...new Set(members.filter((member) => member.position > 0).map((member) => member.position))];
    const labels = members.map((member) => member.label).join('、');
    if (activeCount >= 2) {
      const supplementIndex = members.findIndex((member) => !member.active);
      const supplement = members[supplementIndex];
      const mode = !supplement
        ? '三支俱动，可论成局'
        : supplement.source === 'line'
          ? '两动一静亦成局'
          : `借${supplement.source === 'month' ? '月建' : '日辰'}补成`;
      const sickness = members.flatMap((member) => (member.sickness ? [member.sickness] : []));
      const timing = sickness.length > 0
        ? `；${sickness.join('；')}`
        : supplement?.source === 'line'
          ? `，静者${sanHe.branches[supplementIndex]}值日应事`
          : supplement?.source === 'month'
            ? '，本月可应'
            : '';
      formed.push({ name: sanHe.name, result: sanHe.result, positions, description: `${labels}，${mode}${timing}` });
    } else if (activeCount === 1) {
      unformed.push({
        name: sanHe.name,
        result: sanHe.result,
        positions,
        description: `见${sanHe.name}三支（${labels}）而只一支发动，不成局（《卜筮正宗》第四问「不动不成局」）。`,
      });
    }
  }

  // 半合只补三合未及之局：同一局已断成局或不成局者不再重复
  const judgedResults = new Set<WuXing>([...formed, ...unformed].map((item) => item.result));
  const sources: Array<{ zhi: DiZhi; position: number; }> = [
    ...fullYaos.filter((yao) => yao.isChanging).map((yao) => ({ zhi: yao.naJia, position: yao.position })),
    ...fullYaos.flatMap((yao) => (yao.changedYao ? [{ zhi: yao.changedYao.naJia, position: yao.position }] : [])),
    { zhi: monthZhi, position: 0 },
    { zhi: dayZhi, position: 0 },
  ];
  const allZhi = sources.map((item) => item.zhi);
  const banHe = BAN_HE_TABLE.filter((item) => !judgedResults.has(item.result)).map((item) => {
    if (!item.branches.every((branch) => allZhi.includes(branch))) {
      return null;
    }
    const positions = sources
      .filter((source) => source.position > 0 && item.branches.includes(source.zhi))
      .map((source) => source.position)
      .filter((value, index, arr) => arr.indexOf(value) === index);
    if (positions.length === 0) {
      return null;
    }
    return {
      branches: item.branches,
      result: item.result,
      type: item.type,
      positions,
    };
  }).filter((item): item is NonNullable<SanHeAnalysis['banHe']>[number] => Boolean(item));

  return {
    hasFullSanHe: formed.length > 0,
    ...(formed.length > 0 ? { fullSanHe: formed[0], fullSanHeList: formed } : {}),
    ...(unformed.length > 0 ? { unformedSanHe: unformed } : {}),
    hasBanHe: banHe.length > 0,
    ...(banHe.length > 0 ? { banHe } : {}),
  };
}

function checkLiuChongGua(fullYaos: FullYaoInfo[]): LiuChongGuaInfo {
  const pair1 = LIU_CHONG[fullYaos[0]?.naJia] === fullYaos[3]?.naJia;
  const pair2 = LIU_CHONG[fullYaos[1]?.naJia] === fullYaos[4]?.naJia;
  const pair3 = LIU_CHONG[fullYaos[2]?.naJia] === fullYaos[5]?.naJia;
  if (pair1 && pair2 && pair3) {
    return {
      isLiuChongGua: true,
      description: '卦体三对相冲，事态多变、难稳，应期往往偏急。',
    };
  }
  const count = [pair1, pair2, pair3].filter(Boolean).length;
  if (count >= 2) {
    return {
      isLiuChongGua: false,
      description: `卦中有${count}对爻相冲，需重视变动因素，不宜单凭此点断散。`,
    };
  }
  return { isLiuChongGua: false };
}

/** 后天八卦方位两两相对之卦（《卜筮正宗·反吟卦定例》乾巽、坎离、艮坤、震兑「两卦相对」） */
const TRIGRAM_FACING: Record<string, string> = { 乾: '巽', 巽: '乾', 坎: '离', 离: '坎', 艮: '坤', 坤: '艮', 震: '兑', 兑: '震' };
export const GUA_SCOPE_LABELS = { inner: '内卦', outer: '外卦', both: '内外卦' } as const satisfies Record<GuaScope, string>;
const FAN_YIN_MEANING: Record<GuaScope, string> = { inner: '内则不安', outer: '外则不宁', both: '内外不宁' };
const FU_YIN_MEANING: Record<GuaScope, string> = { inner: '内则呻吟', outer: '外则忧郁', both: '内外忧郁呻吟' };

/** 反吟、伏吟标签，带所在之卦（旧数据无范围时只写反吟、伏吟） */
export function formatGuaFanFuYinFlags(info: GuaFanFuYinInfo): string[] {
  const scoped = (scope: GuaScope | undefined, name: string) => `${scope ? GUA_SCOPE_LABELS[scope] : ''}${name}`;
  return [
    ...(info.isFanYin ? [scoped(info.fanYinScope, '反吟')] : []),
    ...(info.isFuYin ? [scoped(info.fuYinScope, '伏吟')] : []),
  ];
}

/**
 * 一卦（内卦或外卦）之反伏。只在该卦有爻发动而卦体改变时论，卦中静爻随卦变亦在其内（《增删卜易·反伏章》比之井例，
 * 内卦坤化巽而初爻未动，仍断「内卦反伏」）：
 * - 伏吟：三爻纳甲复化原支，惟乾震互变（《卜筮正宗·伏吟卦定例》「伏吟惟乾变震、震变乾，查无他卦无伏吟也」）；
 * - 爻之反吟：三爻纳甲逐一相冲，惟坤巽互变（反吟卦定例「爻变相冲者，壹卦中惟有坤变巽，巽变坤」；反伏章升之观、观之坤、巽之观）；
 * - 卦之反吟：两卦后天方位相对（反吟卦定例「卦有反吟，卦变相冲也」）。
 * 反伏章另有「卦变者…如乾卦变坤卦」一语，未述判法，不据以定反吟。
 */
function trigramResonance(from: string, to: string, half: 'lower' | 'upper'): { kind: 'fanYin' | 'fuYin'; note: string; } | undefined {
  const before = TRIGRAM_NA_JIA[from]?.[half];
  const after = TRIGRAM_NA_JIA[to]?.[half];
  if (from === to || !before || !after) return undefined;
  if (before.every((zhi, index) => zhi === after[index])) {
    return { kind: 'fuYin', note: `${from}化${to}，${before.join('')}复化${after.join('')}` };
  }
  if (before.every((zhi, index) => LIU_CHONG[zhi] === after[index])) {
    return { kind: 'fanYin', note: `${from}化${to}，${before.join('')}与${after.join('')}逐爻相冲，爻之反吟` };
  }
  return TRIGRAM_FACING[from] === to ? { kind: 'fanYin', note: `${from}化${to}，两卦方位相对，卦之反吟` } : undefined;
}

/** 卦级反伏：内外卦分别论（反伏章「内卦反伏，内则不安…外卦动变伏吟，外则忧郁」），吉凶仍以用神旺衰为主 */
function checkGuaFanFuYin(hexagramCode: string, changedCode: string | undefined): GuaFanFuYinInfo {
  const base = getHexagramByCode(hexagramCode);
  const changed = changedCode ? getHexagramByCode(changedCode) : undefined;
  if (!base || !changed) {
    return { isFanYin: false, isFuYin: false };
  }
  const inner = trigramResonance(base.lowerTrigram, changed.lowerTrigram, 'lower');
  const outer = trigramResonance(base.upperTrigram, changed.upperTrigram, 'upper');
  const scopeOf = (kind: 'fanYin' | 'fuYin'): GuaScope | undefined => {
    const inInner = inner?.kind === kind;
    const inOuter = outer?.kind === kind;
    return inInner && inOuter ? 'both' : inInner ? 'inner' : inOuter ? 'outer' : undefined;
  };
  const fanYinScope = scopeOf('fanYin');
  const fuYinScope = scopeOf('fuYin');
  if (!fanYinScope && !fuYinScope) {
    return { isFanYin: false, isFuYin: false };
  }
  const evidence = [...(inner ? [`内卦${inner.note}`] : []), ...(outer ? [`外卦${outer.note}`] : [])];
  return {
    isFanYin: fanYinScope !== undefined,
    isFuYin: fuYinScope !== undefined,
    ...(fanYinScope ? { fanYinScope } : {}),
    ...(fuYinScope ? { fuYinScope } : {}),
    description: evidence.join('；'),
  };
}

/** 反伏断语（入凶吉警告），判据另见卦级分析；无范围的旧数据不出断语 */
export function formatGuaFanFuYinReading(info: GuaFanFuYinInfo): string | undefined {
  const meanings = [
    ...(info.isFanYin && info.fanYinScope ? [`${GUA_SCOPE_LABELS[info.fanYinScope]}反吟，${FAN_YIN_MEANING[info.fanYinScope]}，主成而败、败而成，去而复来（《增删卜易·反伏章》）`] : []),
    ...(info.isFuYin && info.fuYinScope ? [`${GUA_SCOPE_LABELS[info.fuYinScope]}伏吟，${FU_YIN_MEANING[info.fuYinScope]}，动如不动（《卜筮正宗》第六问）`] : []),
  ];
  return meanings.length > 0 ? `${meanings.join('；')}；吉凶仍以用神旺衰定。` : undefined;
}

function isLiuHeGuaPattern(yaos: FullYaoInfo[]): boolean {
  if (yaos.length < 6) return false;
  return LIU_HE[yaos[0].naJia]?.partner === yaos[3].naJia
    && LIU_HE[yaos[1].naJia]?.partner === yaos[4].naJia
    && LIU_HE[yaos[2].naJia]?.partner === yaos[5].naJia;
}

function isLiuChongGuaPattern(yaos: FullYaoInfo[]): boolean {
  if (yaos.length < 6) return false;
  return LIU_CHONG[yaos[0].naJia] === yaos[3].naJia
    && LIU_CHONG[yaos[1].naJia] === yaos[4].naJia
    && LIU_CHONG[yaos[2].naJia] === yaos[5].naJia;
}

function checkLiuHeGua(fullYaos: FullYaoInfo[]): LiuHeGuaInfo {
  if (isLiuHeGuaPattern(fullYaos)) {
    return {
      isLiuHeGua: true,
      description: '卦体三对相合，事态趋缓、有合好之象，但也须防合而不化、事迟不决。',
    };
  }
  return { isLiuHeGua: false };
}

function checkChongHeTransition(
  baseYaos: FullYaoInfo[],
  changedCode: string | undefined
): ChongHeTransition {
  if (!changedCode) {
    return { type: 'none' };
  }
  const changedYaos: FullYaoInfo[] = Array.from({ length: 6 }, (_, i) => ({
    naJia: getNaJiaByHexagram(changedCode, i + 1),
  } as FullYaoInfo));

  const benIsChong = isLiuChongGuaPattern(baseYaos);
  const benIsHe = isLiuHeGuaPattern(baseYaos);
  const bianIsChong = isLiuChongGuaPattern(changedYaos);
  const bianIsHe = isLiuHeGuaPattern(changedYaos);

  if (benIsChong && bianIsHe) {
    return {
      type: 'chong_to_he',
      description: '六冲变六合：事态由散转聚、先坏后好，有回旋余地。',
    };
  }
  if (benIsHe && bianIsChong) {
    return {
      type: 'he_to_chong',
      description: '六合变六冲：事态由合转散、先好后坏，需防变故。',
    };
  }
  return { type: 'none' };
}

/** 伏神及其判据；判据与空亡只供候选用神，不进入公开的 FuShen */
interface JudgedFuShen {
  fuShen: FuShen;
  evidence: string[];
  kongWangState: KongWangState;
}

/**
 * 伏神有用与否，按《增删卜易·飞伏神章》两列条文判定，不计分：
 * - 有用者六：得日月生、旺相、得飞神生、得动爻生、日月动爻冲克飞神、飞神空破休囚墓绝；
 * - 终不得出者五：休囚无气、被日月冲克、被旺相之飞神克、墓绝于日月飞爻、休囚值空月破。
 * 两列相抵时依次论：
 * 1. 旺相之飞神（不空不破、未被冲克）克伏，伏神受制，遁卦例「有用亦无用矣」；
 * 2. 被日月冲克而日月无助者，黄金策「制中弱主难以维持」注「用爻休囚又被月建日辰制服，纵遇生扶，亦不济事也」；
 * 3. 不旺相、无日月生扶，又无飞神动爻生扶者为休囚无气：飞神空破衰墓或受冲克者，「飞神逢破墓衰空，虽有若无，
 *    所以伏神易于出现」（升卦例丑土旬空，许午日子孙出现），待值日出露；否则终不得出；
 * 4. 日月一助一伤者相敌：得飞神动爻生伏或飞神受冲克、空破衰墓者可出，逢克者难出，余者待时；
 * 5. 其余有气者有用（「虽曰不现亦如现矣」）；只凭飞神动爻生扶而又被动爻克者待时。
 * 伏神逢日冲论被冲，不论暗动；旬空者有气则出空之日出（野鹤「凡用神旺相而遇旬空，出空之日则出矣」），
 * 被制者为真空（《卜筮正宗·旬空论》「伏而被克…谓之真空」）。
 */
function judgeFuShen(
  fu: { naJia: DiZhi; wuXing: WuXing; },
  fei: FullYaoInfoExtended,
  actors: readonly FullYaoInfo[],
  monthZhi: DiZhi,
  dayZhi: DiZhi,
  kongWang: KongWang,
): { status: FuShen['availabilityStatus']; evidence: string[]; conclusion: string; kongWangState: KongWangState; } {
  const month: Judgement = LIU_CHONG[fu.naJia] === monthZhi
    ? { verdict: 'hurt', notes: ['月破'] }
    : judgeRelation('月', LIU_HE[monthZhi].partner === fu.naJia, getElementRelation(DIZHI_WUXING[monthZhi], fu.wuXing));
  const day: Judgement = LIU_CHONG[fu.naJia] === dayZhi
    ? { verdict: 'hurt', notes: ['日冲'] }
    : judgeRelation('日', LIU_HE[dayZhi].partner === fu.naJia, getElementRelation(DIZHI_WUXING[dayZhi], fu.wuXing));
  const helped = month.verdict === 'help' || day.verdict === 'help';
  const hurt = month.verdict === 'hurt' || day.verdict === 'hurt';

  const describe = (yao: FullYaoInfo) => `${traditionalYaoName(yao.position, yao.type)}${yao.naJia}${yao.wuXing}`;
  const otherActors = actors.filter((actor) => actor.position !== fei.position);
  const movingSupport = otherActors.filter((actor) => actor.wuXing === fu.wuXing || WUXING_SHENG[actor.wuXing] === fu.wuXing);
  const movingHarm = otherActors.filter((actor) => WUXING_KE[actor.wuXing] === fu.wuXing);
  const feiSheng = WUXING_SHENG[fei.wuXing] === fu.wuXing;
  const feiKe = WUXING_KE[fei.wuXing] === fu.wuXing;
  const strikesFei = (zhi: DiZhi) => LIU_CHONG[fei.naJia] === zhi || WUXING_KE[DIZHI_WUXING[zhi]] === fei.wuXing;
  const feiStrikers = [
    ...(strikesFei(monthZhi) ? ['月建'] : []),
    ...(strikesFei(dayZhi) ? ['日辰'] : []),
    ...otherActors.filter((actor) => strikesFei(actor.naJia)).map(describe),
  ];
  const feiSpecial = fei.strength.specialStatus === 'yuePo' || fei.strength.specialStatus === 'riPo' ? SPECIAL_STATUS_LABELS[fei.strength.specialStatus] : '';
  const feiStage = fei.changSheng?.stage === '墓' || fei.changSheng?.stage === '绝' ? fei.changSheng.stage : undefined;
  const feiFeeble = [
    ...(isKongPending(fei.kongWangState) ? ['旬空'] : []),
    ...(feiSpecial ? [feiSpecial] : fei.strength.level === 'weak' ? ['无气'] : []),
    ...(feiStage ? [`日${feiStage}`] : []),
  ];
  const feiWangShuai = WANG_SHUAI_TABLE[monthZhi][fei.wuXing];
  const feiSuppresses = feiKe && (feiWangShuai === 'wang' || feiWangShuai === 'xiang') && feiFeeble.length === 0 && feiStrikers.length === 0;

  const wangShuai = WANG_SHUAI_TABLE[monthZhi][fu.wuXing];
  const supported = feiSheng || movingSupport.length > 0;
  const rooted = helped || supported;
  const tombs = ([['月建', monthZhi], ['日辰', dayZhi], ['飞爻', fei.naJia]] as const).flatMap(([label, zhi]) => (
    WUXING_MU[fu.wuXing] === zhi ? [`墓于${label}`] : WUXING_JUE[fu.wuXing] === zhi ? [`绝于${label}`] : []
  ));

  const evidence = [`月令${WANG_SHUAI_LABELS[wangShuai]}`, ...month.notes, ...day.notes];
  if (feiSheng) evidence.push('飞来生伏');
  if (feiKe) evidence.push('飞来克伏');
  if (WUXING_SHENG[fu.wuXing] === fei.wuXing) evidence.push('伏去生飞（泄气）');
  if (movingSupport.length > 0) evidence.push(`动爻生扶（${movingSupport.map(describe).join('、')}）`);
  if (movingHarm.length > 0) evidence.push(`动爻克制（${movingHarm.map(describe).join('、')}）`);
  if (feiStrikers.length > 0) evidence.push(`飞神受冲克（${feiStrikers.join('、')}）`);
  if (feiFeeble.length > 0) evidence.push(`飞神虽有若无（${feiFeeble.join('、')}）`);
  evidence.push(...tombs);

  const exposed = feiStrikers.length > 0 || feiFeeble.length > 0;
  let status: FuShen['availabilityStatus'];
  let conclusion: string;
  if (feiSuppresses) {
    status = 'blocked';
    conclusion = '旺相之飞神克伏，伏神受制，有用亦无用';
  } else if (hurt && !helped) {
    status = 'blocked';
    conclusion = '伏神被日月冲克，纵遇生扶亦不济事';
  } else if (!rooted) {
    status = exposed ? 'conditional' : 'blocked';
    conclusion = exposed ? '伏神休囚，而飞神虽有若无，易于引拔，待值日出露' : '伏神休囚无气，终不得出';
  } else if (hurt) {
    const lifted = supported || exposed;
    const pressed = movingHarm.length > 0 || feiKe;
    status = lifted && !pressed ? 'available' : pressed && !lifted ? 'blocked' : 'conditional';
    conclusion = status === 'available' ? '日月相敌，得飞神动爻之助，伏神可出' : status === 'blocked' ? '日月相敌，又逢克制，伏神难出' : '日月相敌，伏神待出';
  } else if (!helped && movingHarm.length > 0) {
    status = 'conditional';
    conclusion = '伏神无日月之助，生扶与克制相抵，伏神待出';
  } else {
    status = 'available';
    conclusion = '伏神有用，虽曰不现亦如现矣';
  }

  const isKong = kongWang.kongDizhi.includes(fu.naJia);
  const kongWangState: KongWangState = !isKong
    ? 'not_kong'
    : status === 'blocked' ? 'kong_static' : LIU_CHONG[fu.naJia] === dayZhi ? 'kong_ri_chong' : 'kong_supported';
  if (kongWangState === 'kong_static') evidence.push('真空（伏而被制，到底为空）');
  if (kongWangState === 'kong_supported') evidence.push('旬空（伏神有气，出空之日则出）');
  if (kongWangState === 'kong_ri_chong') evidence.push('冲空');
  return { status, evidence, conclusion, kongWangState };
}

/** 用神不上卦，取本宫首卦同位之爻为伏神（《增删卜易·飞伏神章》「因本宫首卦，父子财官六亲俱全之故耳」） */
function calculateFuShen(
  hexagramCode: string,
  fullYaos: FullYaoInfoExtended[],
  actors: readonly FullYaoInfo[],
  target: LiuQinType,
  gongElement: WuXing,
  monthZhi: DiZhi,
  dayZhi: DiZhi,
  kongWang: KongWang
): JudgedFuShen[] {
  if (fullYaos.some((yao) => yao.liuQin === target)) {
    return [];
  }
  const palace = findPalace(hexagramCode);
  const benGuaCode = palace ? BA_GONG_BEN_GUA[palace.name] : undefined;
  if (!benGuaCode) {
    return [];
  }

  const judged: JudgedFuShen[] = [];
  for (let position = 1; position <= 6; position++) {
    const naJia = getNaJiaByHexagram(benGuaCode, position);
    const wuXing = DIZHI_WUXING[naJia];
    const liuQin = getLiuQin(gongElement, wuXing);
    const feiShen = fullYaos.find((item) => item.position === position);
    if (liuQin !== target || !feiShen) {
      continue;
    }
    const { status, evidence, conclusion, kongWangState } = judgeFuShen({ naJia, wuXing }, feiShen, actors, monthZhi, dayZhi, kongWang);
    judged.push({
      fuShen: {
        liuQin,
        wuXing,
        naJia,
        feiShenPosition: position,
        feiShenLiuQin: feiShen.liuQin,
        availabilityStatus: status,
        availabilityReason: `${conclusion}（${evidence.join('、')}）`,
      },
      evidence: [`伏于${traditionalYaoName(position, feiShen.type)}爻${feiShen.liuQin}${feiShen.naJia}${feiShen.wuXing}之下`, ...evidence, conclusion],
      kongWangState,
    });
  }
  return judged;
}

/**
 * 计算伏神与飞神的生克关系描述
 */
function describeFuFeiRelation(fuWuXing: WuXing, feiWuXing: WuXing): string {
  if (fuWuXing === feiWuXing) return '比和';
  if (WUXING_SHENG[feiWuXing] === fuWuXing) return '飞生伏';
  if (WUXING_SHENG[fuWuXing] === feiWuXing) return '伏生飞';
  if (WUXING_KE[feiWuXing] === fuWuXing) return '飞克伏';
  if (WUXING_KE[fuWuXing] === feiWuXing) return '伏克飞';
  return '';
}

/**
 * 计算每爻位的飞伏神信息
 * 对比本卦与本宫首卦（八纯卦），找出本卦中缺失的六亲对应的伏神
 */
function calculatePerYaoFuShen(
  hexagramCode: string,
  baseYaos: FullYaoInfo[],
  gongElement: WuXing
): Map<number, YaoFuShenDetail> {
  const result = new Map<number, YaoFuShenDetail>();
  const palace = findPalace(hexagramCode);
  const benGuaCode = palace ? BA_GONG_BEN_GUA[palace.name] : undefined;
  if (!benGuaCode || benGuaCode === hexagramCode) {
    // 本宫首卦就是自己（八纯卦），不存在伏神
    return result;
  }

  // 收集本卦中已出现的六亲
  const visibleLiuQin = new Set(baseYaos.map(y => y.liuQin));

  // 遍历本宫首卦的每个爻位
  for (let position = 1; position <= 6; position++) {
    const benGuaNaJia = getNaJiaByHexagram(benGuaCode, position);
    const benGuaWuXing = DIZHI_WUXING[benGuaNaJia];
    const benGuaLiuQin = getLiuQin(gongElement, benGuaWuXing);

    // 只有当本卦中缺少该六亲时，才标注伏神
    if (!visibleLiuQin.has(benGuaLiuQin)) {
      const feiShen = baseYaos.find(y => y.position === position);
      if (feiShen) {
        const relation = describeFuFeiRelation(benGuaWuXing, feiShen.wuXing);
        result.set(position, {
          liuQin: benGuaLiuQin,
          naJia: benGuaNaJia,
          wuXing: benGuaWuXing,
          relation,
        });
      }
    }
  }

  return result;
}

/** 「舍其旬空」所论之空：冲空则实，不在此列 */
function isKongPending(state?: KongWangState): boolean {
  return state !== undefined && state !== 'not_kong' && state !== 'kong_ri_chong';
}

function buildVisibleCandidate(yao: FullYaoInfoExtended): YongShenCandidate {
  const level = yao.strength.level;
  const evidence = [...yao.strength.evidence];
  if (yao.isShiYao) evidence.push('世位');
  if (yao.isYingYao) evidence.push('应位');
  if (yao.changeAnalysis?.description) evidence.push(yao.changeAnalysis.description);

  return {
    liuQin: yao.liuQin,
    naJia: yao.naJia,
    changedNaJia: yao.changedYao?.naJia,
    huaType: yao.changeAnalysis?.huaType,
    element: yao.wuXing,
    position: yao.position,
    source: 'visible',
    strength: level,
    strengthLabel: STRENGTH_LABELS[level],
    movementState: yao.movementState,
    movementLabel: yao.movementLabel,
    specialStatus: yao.strength.specialStatus,
    isShiYao: yao.isShiYao,
    isYingYao: yao.isYingYao,
    kongWangState: yao.kongWangState,
    evidence,
  };
}

function buildChangedCandidate(
  yao: FullYaoInfoExtended,
  monthZhi: DiZhi,
  dayZhi: DiZhi,
  kongWang: KongWang
): YongShenCandidate | null {
  if (!yao.changedYao) {
    return null;
  }

  const changedNaJia = yao.changedYao.naJia;
  const changedWuXing = yao.changedYao.wuXing;
  // 变爻只受日月与本位动爻作用，他爻不能生克变爻（《增删卜易·动变生克冲合章》），故不计他爻生扶克制
  const { strength, kongWangState } = judgeLine({
    yaoZhi: changedNaJia,
    yaoWuXing: changedWuXing,
    motion: 'changed',
    changedKe: false,
    movingSupport: [],
    movingHarm: [],
  }, monthZhi, dayZhi, kongWang);
  const level = strength.level;
  const evidence = [`第${yao.position}爻变出用神`, ...strength.evidence];
  if (yao.isShiYao) evidence.push('世位');
  if (yao.isYingYao) evidence.push('应位');
  if (yao.changeAnalysis?.description) evidence.push(yao.changeAnalysis.description);

  return {
    liuQin: yao.changedYao.liuQin,
    naJia: changedNaJia,
    changedNaJia: changedNaJia,
    huaType: yao.changeAnalysis?.huaType,
    element: changedWuXing,
    position: yao.position,
    source: 'changed',
    strength: level,
    strengthLabel: `变出${STRENGTH_LABELS[level]}`,
    movementState: 'changing',
    movementLabel: '变出',
    specialStatus: strength.specialStatus,
    isShiYao: yao.isShiYao,
    isYingYao: yao.isYingYao,
    kongWangState,
    evidence,
  };
}

/**
 * 卦中、变爻皆无用神时以月日为用神：《增删卜易·月将章》「卦无用神即以月建为用神，不必寻伏神也」，
 * 飞伏神章「如于寅卯月占者，则以日月为用神」。月建先取；日辰为六爻之主宰，与月建同论有气。
 */
function buildTemporalCandidates(
  target: LiuQinType,
  gongElement: WuXing,
  monthZhi: DiZhi,
  dayZhi: DiZhi
): YongShenCandidate[] {
  const build = (branch: DiZhi, label: '月建' | '日辰', strengthLabel: string): YongShenCandidate => ({
    liuQin: target,
    naJia: branch,
    element: DIZHI_WUXING[branch],
    source: 'temporal',
    strength: 'strong',
    strengthLabel,
    movementState: 'static',
    movementLabel: label,
    isShiYao: false,
    isYingYao: false,
    kongWangState: 'not_kong',
    evidence: [`用神${target}不上卦`, `以${label}${branch}代用`],
  });

  const candidates: YongShenCandidate[] = [];
  const monthMatches = getLiuQin(gongElement, DIZHI_WUXING[monthZhi]) === target;
  const dayMatches = getLiuQin(gongElement, DIZHI_WUXING[dayZhi]) === target;
  if (monthMatches) {
    candidates.push(build(monthZhi, '月建', dayZhi === monthZhi ? '月日同临代用' : '月建代用'));
  }
  if (dayMatches && dayZhi !== monthZhi) {
    candidates.push(build(dayZhi, '日辰', '日辰代用'));
  }
  return candidates;
}

/** 伏神之气随有用与否：有用者有气，待出者气平（相敌），难出者无气 */
const FU_SHEN_STRENGTH: Record<FuShen['availabilityStatus'], { strength: YaoStrengthLevel; label: string; }> = {
  available: { strength: 'strong', label: '伏神有用' },
  conditional: { strength: 'moderate', label: '伏神待出' },
  blocked: { strength: 'weak', label: '伏神难出' },
};

function buildFuShenCandidate({ fuShen, evidence, kongWangState }: JudgedFuShen, attachedYao?: FullYaoInfoExtended): YongShenCandidate {
  const { strength, label } = FU_SHEN_STRENGTH[fuShen.availabilityStatus];
  return {
    liuQin: fuShen.liuQin,
    naJia: fuShen.naJia,
    element: fuShen.wuXing,
    position: fuShen.feiShenPosition,
    source: 'fushen',
    strength,
    strengthLabel: label,
    movementState: 'static',
    movementLabel: '伏藏',
    isShiYao: attachedYao?.isShiYao ?? false,
    isYingYao: attachedYao?.isYingYao ?? false,
    kongWangState,
    evidence: [`用神${fuShen.liuQin}不上卦`, ...evidence],
  };
}

/** 用神多现时一爻的取舍条件 */
interface RankedCandidate {
  candidate: YongShenCandidate;
  /** 爻名，如「九三爻」「初九爻变出」 */
  name: string;
  /** 临月建或临日建；临日建而破亦为破者无权 */
  authority?: '临月建' | '临日建';
  /** 「舍其被伤」之伤：月破、日破、旬空未实、化回头克/化墓/化绝/化破、被有力之动爻克制 */
  harms: string[];
}

interface PrecedenceRule {
  label: string;
  /** 本条之内的先后，小者优先；只逐条比较，不相加 */
  order: (item: RankedCandidate) => number;
  describe: (item: RankedCandidate) => string;
  /** 出处原文，按落选之爻引对应之句 */
  basis: (loser: RankedCandidate) => string;
}

const STRENGTH_ORDER: Record<CandidateStrength, number> = { strong: 0, moderate: 1, weak: 2, unknown: 3 };
const STRENGTH_TEXT: Record<CandidateStrength, string> = { ...STRENGTH_LABELS, unknown: '旺衰未明' };
const MOVEMENT_ORDER: Record<YaoMovementState, number> = { changing: 0, hidden_moving: 1, static: 2, day_break: 2 };

/** 两现章古法论伤的三句，按落选之爻所犯依次引出 */
function citeHarmClauses(harms: readonly string[]): string {
  const clauses = [
    harms.includes('月破') ? '舍其月破，而用不破' : '',
    harms.includes('旬空') ? '舍其旬空，用其不空' : '',
    harms.some((harm) => harm !== '月破' && harm !== '旬空') ? '舍其被伤，用其不伤' : '',
  ].filter(Boolean);
  return `「${clauses.join('，')}」（《增删卜易·两现章》）`;
}

/**
 * 用神多现，依次比较，先分高下者定主用，诸条皆同者并看：
 * - 持世、临月日：《卜筮正宗·十八问答》第十七问「舍其闲爻而用持世，舍其无权而用月日」；
 * - 旺衰、动静、伤损：《增删卜易·两现章》古法「舍其休囚，用其旺相，舍其静爻，而用动爻，舍其月破，而用不破，
 *   舍其旬空，用其不空，舍其被伤，用其不伤」。
 * 两现章又言「得其验者，应乎旬空月破」，第十七问亦云「舍其不破而用月破…天机尽泄于有病之间」，
 * 而两书所附小畜、师之涣、豫之归妹三例，都以有权有气之爻断得失，以空破之爻断应期，
 * 故空破之爻不夺主用，另出应期（见 calculateTimeRecommendations）。
 */
const YONG_SHEN_PRECEDENCE: readonly PrecedenceRule[] = [
  {
    label: '持世',
    order: (item) => (item.candidate.isShiYao ? 0 : 1),
    describe: (item) => (item.candidate.isShiYao ? '持世' : '不持世'),
    basis: () => '「舍其闲爻而用持世」（《卜筮正宗》）',
  },
  {
    label: '临月日',
    order: (item) => (item.authority ? 0 : 1),
    describe: (item) => item.authority ?? '不临月日',
    basis: () => '「舍其无权而用月日」（《卜筮正宗》）',
  },
  {
    label: '旺衰',
    order: (item) => STRENGTH_ORDER[item.candidate.strength],
    describe: (item) => STRENGTH_TEXT[item.candidate.strength],
    basis: () => '「舍其休囚，用其旺相」（《增删卜易·两现章》）',
  },
  {
    label: '动静',
    order: (item) => MOVEMENT_ORDER[item.candidate.movementState],
    describe: (item) => (MOVEMENT_ORDER[item.candidate.movementState] < 2 ? MOVEMENT_LABELS[item.candidate.movementState] : '安静'),
    basis: () => '「舍其静爻，而用动爻」（《增删卜易·两现章》）',
  },
  {
    label: '伤损',
    order: (item) => (item.harms.length > 0 ? 1 : 0),
    describe: (item) => (item.harms.length > 0 ? item.harms.join('、') : '无伤'),
    basis: (loser) => citeHarmClauses(loser.harms),
  },
];

const COUNT_TEXT = ['', '一', '两', '三', '四', '五', '六'];

function compareRanked(a: RankedCandidate, b: RankedCandidate): number {
  for (const rule of YONG_SHEN_PRECEDENCE) {
    const diff = rule.order(a) - rule.order(b);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 空破之爻不夺主用而主应期，在取用说明中点出 */
function describeSickCandidates(items: RankedCandidate[]): string {
  const sick = items.filter((item) => item.candidate.specialStatus === 'yuePo' || isKongPending(item.candidate.kongWangState));
  if (sick.length === 0) return '';
  const names = sick.map((item) => `${item.name}${item.candidate.specialStatus === 'yuePo' ? '月破' : '旬空'}`).join('、');
  return `${names}，另看应期（《增删卜易·两现章》「得其验者，应乎旬空月破」）。`;
}

/**
 * 按 YONG_SHEN_PRECEDENCE 定主用；诸条皆同者按爻位自下而上列出，只为输出稳定，不作取舍依据。
 * @param lead 多现时说明的开头，如「妻财两现」
 */
function resolveRanked(
  target: LiuQinType,
  ranked: RankedCandidate[],
  resolvedStatus: YongShenSelectionStatus,
  lead: string,
  singleNote: (item: RankedCandidate) => string,
): YongShenGroup {
  const [first, ...rest] = [...ranked].sort((a, b) => compareRanked(a, b) || (a.candidate.position ?? 0) - (b.candidate.position ?? 0));
  const group = { targetLiuQin: target, selected: first.candidate, candidates: rest.map((item) => item.candidate) };
  const runnerUp = rest[0];
  if (!runnerUp) {
    return { ...group, selectionStatus: resolvedStatus, selectionNote: singleNote(first) };
  }

  const sickNote = describeSickCandidates(rest);
  const rule = YONG_SHEN_PRECEDENCE.find((item) => item.order(first) !== item.order(runnerUp));
  if (!rule) {
    const tied = [first, ...rest.filter((item) => compareRanked(item, first) === 0)];
    const labels = YONG_SHEN_PRECEDENCE.map((item) => item.label).join('、');
    return {
      ...group,
      selectionStatus: 'ambiguous',
      selectionNote: `${lead}，${tied.map((item) => item.name).join('、')}${labels}皆同，并看。${sickNote}`,
    };
  }
  return {
    ...group,
    selectionStatus: resolvedStatus,
    selectionNote: `${lead}，以${first.name}为主用神：${first.name}${rule.describe(first)}，${runnerUp.name}${rule.describe(runnerUp)}，${rule.basis(runnerUp)}。${sickNote}`,
  };
}

interface YongShenContext {
  fullYaos: FullYaoInfoExtended[];
  fuShenByTarget: Map<LiuQinType, JudgedFuShen[]>;
  gongElement: WuXing;
  monthZhi: DiZhi;
  dayZhi: DiZhi;
  kongWang: KongWang;
  /** 各爻所受有力动爻之克（爻位 → 克之之动爻） */
  movingHarmByPosition: ReadonlyMap<number, readonly FullYaoInfo[]>;
}

/** 取用次序：明现 → 变出（《卜筮正宗》「凡卦中用神不出现，查变爻有不必寻伏神矣」）→ 月日 → 伏神 */
function buildYongShenGroups(targets: LiuQinType[], context: YongShenContext): YongShenGroup[] {
  const { fullYaos, fuShenByTarget, gongElement, monthZhi, dayZhi, kongWang, movingHarmByPosition } = context;
  const yaoName = (yao: FullYaoInfo) => `${traditionalYaoName(yao.position, yao.type)}爻`;
  const authorityOf = (branch: DiZhi, specialStatus?: YaoSpecialStatus): RankedCandidate['authority'] => {
    if (branch === monthZhi) return '临月建';
    return branch === dayZhi && specialStatus !== 'yuePo' ? '临日建' : undefined;
  };
  const harmsOf = (candidate: YongShenCandidate, extra: string[] = []): string[] => [
    ...(candidate.specialStatus === 'yuePo' || candidate.specialStatus === 'riPo' ? [SPECIAL_STATUS_LABELS[candidate.specialStatus]] : []),
    ...(isKongPending(candidate.kongWangState) ? ['旬空'] : []),
    ...extra,
  ];

  return targets.map((target): YongShenGroup => {
    const visible = fullYaos.filter((yao) => yao.liuQin === target).map((yao): RankedCandidate => {
      const candidate = buildVisibleCandidate(yao);
      const huaType = yao.changeAnalysis?.huaType;
      const changeHarms = [
        ...(huaType === 'huiTouKe' || huaType === 'huaMu' || huaType === 'huaJue' ? [HUA_TYPE_LABELS[huaType]] : []),
        ...(yao.changedYao && LIU_CHONG[yao.changedYao.naJia] === monthZhi ? ['化破'] : []),
        ...((movingHarmByPosition.get(yao.position)?.length ?? 0) > 0 ? ['动爻克制'] : []),
      ];
      return { candidate, name: yaoName(yao), authority: authorityOf(yao.naJia, candidate.specialStatus), harms: harmsOf(candidate, changeHarms) };
    });
    if (visible.length > 0) {
      return resolveRanked(target, visible, 'resolved', `${target}${COUNT_TEXT[visible.length]}现`,
        (item) => `以${item.name}${target}为用神，优先参考其旺衰、动静与空亡。`);
    }

    const changed = fullYaos.flatMap((yao): RankedCandidate[] => {
      const candidate = yao.changedYao?.liuQin === target ? buildChangedCandidate(yao, monthZhi, dayZhi, kongWang) : null;
      if (!candidate?.naJia) return [];
      return [{ candidate, name: `${yaoName(yao)}变出`, authority: authorityOf(candidate.naJia, candidate.specialStatus), harms: harmsOf(candidate) }];
    });
    if (changed.length > 0) {
      return resolveRanked(target, changed, 'from_changed', `本卦无${target}而${COUNT_TEXT[changed.length]}爻变出`,
        (item) => `本卦无${target}，${item.name}${target}，取变爻为用神（《卜筮正宗》「凡卦中用神不出现，查变爻有不必寻伏神矣」）。`);
    }

    const [temporal, ...otherTemporal] = buildTemporalCandidates(target, gongElement, monthZhi, dayZhi);
    if (temporal) {
      const source = temporal.movementLabel === '月建'
        ? '《增删卜易·月将章》「卦无用神即以月建为用神，不必寻伏神也」'
        : '《增删卜易·飞伏神章》「则以日月为用神」';
      const alsoDay = otherTemporal[0] ? `；日辰${otherTemporal[0].naJia}亦属${target}，并参` : '';
      return {
        targetLiuQin: target,
        selectionStatus: 'from_temporal',
        selectionNote: `本卦与变爻皆无${target}，以${temporal.movementLabel}${temporal.naJia}为用神（${source}）${alsoDay}。`,
        selected: temporal,
        candidates: otherTemporal,
      };
    }

    const fuShenCandidates = (fuShenByTarget.get(target) || [])
      .map((item) => buildFuShenCandidate(item, fullYaos.find((yao) => yao.position === item.fuShen.feiShenPosition)))
      .sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] || (a.position ?? 0) - (b.position ?? 0));
    if (fuShenCandidates.length > 0) {
      const [selected, ...candidates] = fuShenCandidates;
      const feiShen = fullYaos.find((yao) => yao.position === selected.position);
      const place = feiShen ? `伏于${yaoName(feiShen)}${feiShen.naJia}${feiShen.wuXing}之下` : '伏藏';
      return {
        targetLiuQin: target,
        selectionStatus: 'from_fushen',
        selectionNote: `本卦、变爻与月日皆无${target}，于本宫首卦寻伏神：${target}${selected.naJia}${selected.element}${place}，${selected.strengthLabel}（《增删卜易·飞伏神章》）。`,
        selected,
        candidates,
      };
    }

    return {
      targetLiuQin: target,
      selectionStatus: 'missing',
      selectionNote: `卦中未见${target}，本次无法稳定取用。`,
      selected: {
        liuQin: target,
        element: '土',
        source: 'visible',
        strength: 'unknown',
        strengthLabel: '未取到',
        movementState: 'static',
        movementLabel: '静',
        isShiYao: false,
        isYingYao: false,
        evidence: ['卦中未见目标六亲'],
      },
      candidates: [],
    };
  });
}

function calculateShenSystem(group: YongShenGroup, fullYaos: FullYaoInfoExtended[], gongElement: WuXing): ShenSystem {
  const yongShenElement = group.selected.element;
  const yuanWuXing = WUXING_BEI_SHENG[yongShenElement];
  const jiWuXing = WUXING_BEI_KE[yongShenElement];
  const chouWuXing = WUXING_BEI_KE[yuanWuXing];

  const findMember = (wuXing: WuXing): ShenMember | undefined => {
    const liuQin = getLiuQin(gongElement, wuXing);
    const positions = fullYaos.filter((yao) => yao.liuQin === liuQin).map((yao) => yao.position);
    return positions.length > 0 ? { liuQin, wuXing, positions } : undefined;
  };

  return {
    yuanShen: findMember(yuanWuXing),
    jiShen: findMember(jiWuXing),
    chouShen: findMember(chouWuXing),
  };
}

interface TimingContext {
  fullYaos: FullYaoInfoExtended[];
  monthZhi: DiZhi;
  dayZhi: DiZhi;
  movingHarmByPosition: ReadonlyMap<number, readonly FullYaoInfo[]>;
}

const TIMING_TYPE_ORDER: Record<TimeRecommendation['type'], number> = { critical: 0, favorable: 1, unfavorable: 2 };
/** 应期提示的性质：关键应期、转吉之期（遇生旺、克去克神）、忌期（化退逢值冲、克者逢生） */
export const TIME_RECOMMENDATION_LABELS = { critical: '应期', favorable: '吉期', unfavorable: '忌期' } as const satisfies Record<TimeRecommendation['type'], string>;
const WUXING_SEASON: Record<WuXing, string> = {
  木: '春令寅卯月',
  火: '夏令巳午月',
  土: '辰戌丑未四季月',
  金: '秋令申酉月',
  水: '冬令亥子月',
};

/** 五行所属地支，按习惯写法（如水为「亥子」） */
const WUXING_BRANCHES: Record<WuXing, string> = { 木: '寅卯', 火: '巳午', 土: '辰戌丑未', 金: '申酉', 水: '亥子' };

/**
 * 应期，依《增删卜易·各门类应期总注章》（下称总注），参《卜筮正宗·伏神正传》「空要值日、破要填合、伏待出露、冲待合、合待冲」
 * 与十八问答第四问「宗其一爻有病关因者断之」：
 * 1. 先看用神之病：旬空、月破、入墓（日墓、动墓、化墓）、合住（月合、日合、化合）、冲（冲空、暗动）、绝、伏藏，病在则应在去病之日；
 * 2. 无病再按动静旺衰取常期：静逢值冲、动逢值合、太旺逢墓冲、衰绝遇生旺、化进逢值合、化退忌值冲；
 * 3. 受克者看克神；用神多现时同类空破之爻另主应期。
 * 《增删卜易·囤货卖货章》「财爻太旺旺者得利于墓库之月，休囚者出脱于生旺之时，入墓必待冲开，逢绝当逢生旺，月破者填实之，
 * 被克者冲去克神之秋，伏藏者得价于出现之时，旬空者冲空实空之月，如逢合住亦待冲开」，与上述各条一一相合。
 * 只给相对条件（逢某支），不推算具体历日。每组按 应期 → 吉期 → 忌期 排列。
 */
function calculateTimeRecommendations(groups: YongShenGroup[], context: TimingContext): TimeRecommendation[] {
  return groups.flatMap((group) => timingOf(group, context)
    .sort((a, b) => TIMING_TYPE_ORDER[a.type] - TIMING_TYPE_ORDER[b.type]));
}

function timingOf(group: YongShenGroup, context: TimingContext): TimeRecommendation[] {
  const { targetLiuQin: target, selected } = group;
  const { fullYaos, monthZhi, dayZhi, movingHarmByPosition } = context;
  const recommendations: TimeRecommendation[] = [];
  const push = (type: TimeRecommendation['type'], trigger: string, basis: string[], description: string, earthlyBranch?: DiZhi) => {
    recommendations.push({ targetLiuQin: target, type, ...(earthlyBranch ? { earthlyBranch } : {}), trigger, basis, description });
  };

  if (group.selectionStatus === 'missing') {
    push('critical', '先明确取用后再断应期', ['目标六亲未能稳定落点'], `本卦暂未稳取到${target}，此时不宜强断具体应期。`);
    return recommendations;
  }
  const x = selected.naJia;
  if (!x || selected.source === 'temporal') return recommendations;

  if (selected.source === 'fushen') {
    const fei = fullYaos.find((yao) => yao.position === selected.position);
    const place = fei ? `伏于${fei.naJia}${fei.wuXing}之下` : '伏藏';
    const exits = [`${x}日出露`, ...(fei ? [`${LIU_CHONG[fei.naJia]}日冲开飞神`] : [])].join('，或');
    push('critical', '待出伏', ['用神伏藏', '伏待出露'], selected.strength === 'weak'
      ? `用神${target}${place}，${selected.strengthLabel}，不宜强断应期；纵有转机，亦待${exits}（《卜筮正宗·伏神正传》「伏待出露」）。`
      : `用神${target}${place}，${selected.strengthLabel}，待${exits}（《卜筮正宗·伏神正传》「伏待出露」，占例「冲其飞而露其伏」）${selected.kongWangState === 'kong_supported' ? '；伏神旬空，出空之日方出' : ''}。`, x);
    return recommendations;
  }

  const element = selected.element;
  const yao = selected.source === 'visible' ? fullYaos.find((item) => item.position === selected.position) : undefined;
  const changed = selected.source === 'visible' ? selected.changedNaJia : undefined;
  const heOf = (zhi: DiZhi) => LIU_HE[zhi].partner;

  // 用神之病
  const kong = selected.kongWangState;
  if (kong === 'kong_static') {
    push('critical', `待${LIU_CHONG[x]}冲空或${x}填实`, ['用神真空', '旬空最爱填冲'],
      `用神${target}真空，到底为空；纵有应验，亦在冲空、填实之日（总注「旬空最爱填冲」）。`, x);
  } else if (isKongPending(kong)) {
    push('critical', `逢${x}出空填实或${LIU_CHONG[x]}冲空`, [`用神${KONG_WANG_LABELS[kong as KongWangState]}`, '旬空最爱填冲'],
      `用神${target}旬内仍空，出空之日方应（《增删卜易·月将章》「在旬内者毕竟为空」，总注「旬空最爱填冲」）。`, x);
  } else if (kong === 'kong_ri_chong') {
    push('critical', `逢${heOf(x)}合`, ['冲空则实', '冲待合'],
      `用神${target}旬空逢日冲，冲空则实（《增删卜易·日辰章》「爻遇旬空，日辰冲起而有用」）；冲而待合，逢${heOf(x)}合之日应（《卜筮正宗·十八问答》第四问「其冲破也，必待相合之期至而应事之吉凶」）。`, heOf(x));
  }
  const isYuePo = selected.specialStatus === 'yuePo';
  if (isYuePo) {
    push('critical', `逢${x}填实或逢${heOf(x)}合`, ['用神月破', '月破喜填'],
      `用神${target}月破，月内无功；出月之后，逢${x}填实或逢${heOf(x)}合之日方应（《增删卜易·月破章》「出月则不破…实破之日则不破，合之日则不破」）。`, x);
  }
  // 三墓即「用爻入日墓、入动墓、动而化墓」，墓支同为用神五行之墓；墓神被日月动爻冲破者非真墓（墓库章「墓神破，日月动爻冲破，亦非真也」）
  const tombZhi = WUXING_MU[element];
  const movers = fullYaos.filter((item) => item.isChanging);
  const tombBroken = (byMovers: boolean) => LIU_CHONG[tombZhi] === monthZhi || LIU_CHONG[tombZhi] === dayZhi
    || (byMovers && movers.some((item) => item.naJia === LIU_CHONG[tombZhi]));
  const tombMover = yao && x !== tombZhi ? movers.find((item) => item.position !== yao.position && item.naJia === tombZhi) : undefined;
  const tombs = [
    ...(yao?.changSheng?.stage === '墓' ? [{ label: '入日墓', detail: '入日墓' }] : []),
    ...(tombMover && !tombBroken(true)
      ? [{ label: '入动墓', detail: `入动墓（${traditionalYaoName(tombMover.position, tombMover.type)}${tombMover.naJia}${tombMover.wuXing}发动）` }]
      : []),
    ...(changed === tombZhi && (selected.huaType === 'huaMu' || selected.huaType === 'huiTouKe') && !tombBroken(false)
      ? [{ label: '动而化墓', detail: '动而化墓' }]
      : []),
  ];
  if (tombs.length > 0) {
    const opener = LIU_CHONG[tombZhi];
    push('critical', `逢${opener}冲开墓库`, [`用神${tombs.map((tomb) => tomb.label).join('、')}`, '入三墓俱喜冲开'],
      `用神${target}${tombs.map((tomb) => tomb.detail).join('、')}，墓在${tombZhi}，逢${opener}冲开之日方应（总注「入三墓俱喜冲开」）。`, opener);
  }
  // 合住待冲：总注「主事爻与月作合，或动而化合，吉凶必待冲开之月日」；与日合者，《卜筮正宗·十八问答》第四问「如自化合或与日合…必待期冲」，
  // 《增删卜易·月将章》例酉金合辰日而应卯时，引黄金策「若逢合住，必待冲开」。日辰冲开者合即散（日辰章「逢合住遇日建以冲开，谓之冲合则散」），不再待冲
  const binder = LIU_CHONG[x] === dayZhi ? undefined
    : heOf(x) === monthZhi ? { zhi: monthZhi, label: '月合', openers: [LIU_CHONG[x], LIU_CHONG[monthZhi]], source: '总注「遇六合亦宜相击」' }
      : heOf(x) === dayZhi ? { zhi: dayZhi, label: '日合', openers: [LIU_CHONG[x]], source: '黄金策「若逢合住，必待冲开」，《增删卜易·月将章》《卜筮正宗》俱引' }
        : changed && heOf(x) === changed && LIU_CHONG[changed] !== dayZhi
          ? { zhi: changed, label: '动而化合', openers: [LIU_CHONG[x], LIU_CHONG[changed]], source: '总注「遇六合亦宜相击」' }
          : undefined;
  if (binder) {
    const openers = binder.openers.join('或');
    push('critical', `逢${openers}冲开`, [`用神${binder.label}`, '合待冲'],
      `用神${target}${binder.label}（${x}${binder.zhi}合），合住待冲，逢${openers}冲开之日应（${binder.source}）。`, LIU_CHONG[x]);
  }
  // 绝亦为病（《卜筮正宗·十八问答》第四问「如自化绝或绝于日者，必待期生，亦指一爻有病者而言也」），病在则不取常期
  // 变出之用神所带 huaType 是本爻的化变，不作用神自身的化绝、化进论
  const jue = yao?.changSheng?.stage === '绝' ? '日绝' : yao && selected.huaType === 'huaJue' ? '化绝' : undefined;
  const sick = recommendations.length > 0 || jue !== undefined;

  // 常期：动静旺衰
  const moving = selected.movementState === 'changing';
  if (moving && selected.huaType === 'huaTui' && changed) {
    push('unfavorable', `逢${changed}或${LIU_CHONG[changed]}`, ['化退神，忌值忌冲'],
      `用神${target}化退神，逢变爻${changed}之值或${LIU_CHONG[changed]}之冲，事多退缩（总注「化退神、忌值忌冲」）。`, changed);
  } else if (moving && !sick) {
    const advancing = yao !== undefined && selected.huaType === 'huaJin';
    const viaChanged = changed && changed !== x ? `；变出${changed}，亦有应于${changed}之日（总注「问有应于变爻动爻」）` : '';
    push('critical', `逢${x}值或逢${heOf(x)}合`, [advancing ? '化进神，逢值逢合' : '动而逢合逢值'],
      `用神${target}发动，应期多在逢值、逢合之日（总注「${advancing ? '化进神、逢值逢合' : '动而逢合逢值'}」）${viaChanged}。`, x);
  } else if (selected.movementState === 'hidden_moving' && !sick) {
    push('critical', `逢${heOf(x)}合`, ['暗动，冲待合'], `用神${target}暗动，冲而待合，逢${heOf(x)}合之日应（《卜筮正宗·伏神正传》「冲待合」）。`, heOf(x));
  } else if (!moving && !sick && selected.strength !== 'weak') {
    const overflowing = selected.strength === 'strong' && (DIZHI_WUXING[monthZhi] === element || DIZHI_WUXING[dayZhi] === element);
    if (overflowing) {
      push('critical', `逢${WUXING_MU[element]}入墓或逢${LIU_CHONG[x]}冲`, ['太旺者逢墓逢冲'],
        `用神${target}得月日帮扶而太旺，应期多在逢${WUXING_MU[element]}入墓、逢${LIU_CHONG[x]}冲之日（总注「太旺者逢墓逢冲」）。`, LIU_CHONG[x]);
    } else {
      push('critical', `逢${x}值或逢${LIU_CHONG[x]}冲`, ['静而逢值逢冲'], `用神${target}安静，应期多在逢值、逢冲之日（总注「静而逢值逢冲」）。`, x);
    }
  }
  // 衰绝待生旺：总注「衰绝者，遇生遇旺」
  if ((selected.strength === 'weak' || jue) && !isYuePo && kong !== 'kong_static') {
    const nourisher = WUXING_BEI_SHENG[element];
    const state = jue ? `${selected.strength === 'weak' ? '休囚无气，又' : ''}${jue}` : '休囚无气';
    push('favorable', `遇${WUXING_BRANCHES[nourisher]}相生或${WUXING_SEASON[element]}`, jue ? [`用神${jue}`, '绝待期生'] : ['衰绝者遇生遇旺'],
      `用神${target}${state}，待遇${nourisher}（${WUXING_BRANCHES[nourisher]}）之月日相生，或至${WUXING_SEASON[element]}${element}旺之时（总注「衰绝者，遇生遇旺」${jue ? '，《卜筮正宗》「自化绝或绝于日者，必待期生」' : ''}）。`);
  }

  // 受克：总注「大象吉而受克，须待克神受克；大象凶而受克，须防克者逢生」
  const attackers = new Set<WuXing>([
    ...(selected.huaType === 'huiTouKe' && changed ? [DIZHI_WUXING[changed]] : []),
    ...(yao ? (movingHarmByPosition.get(yao.position) ?? []).map((actor) => actor.wuXing) : []),
  ]);
  for (const attacker of attackers) {
    if (selected.strength === 'weak') {
      const feeder = WUXING_BEI_SHENG[attacker];
      push('unfavorable', `逢${WUXING_BRANCHES[attacker]}或${WUXING_BRANCHES[feeder]}`, ['大象凶而受克，防克者逢生'],
        `用神${target}无气又受${attacker}克，逢${WUXING_BRANCHES[attacker]}（克神值）或${WUXING_BRANCHES[feeder]}（生克神）之日为凶（总注「大象凶而受克，须防克者逢生」）。`);
    } else {
      const breaker = WUXING_BEI_KE[attacker];
      push('favorable', `逢${WUXING_BRANCHES[breaker]}克去克神`, ['大象吉而受克，待克神受克'],
        `用神${target}有气而受${attacker}克，逢${WUXING_BRANCHES[breaker]}之日克去克神则吉（总注「大象吉而受克，须待克神受克」）。`);
    }
  }

  // 用神多现，空破之爻另主应期：小畜例「却得于辰土出空之日」、豫之归妹例「两爻巳火逢月破许巳年脱厄」
  for (const sibling of group.candidates) {
    if (!sibling.naJia || sibling.naJia === x || (sibling.source !== 'visible' && sibling.source !== 'changed')) continue;
    const label = `${sibling.liuQin}${sibling.naJia}${sibling.element}`;
    if (sibling.specialStatus === 'yuePo') {
      push('critical', `逢${sibling.naJia}实破或逢${heOf(sibling.naJia)}合`, ['用神多现，应乎月破'],
        `同类${label}月破，应期多在实破、逢合之日（《卜筮正宗》「舍其不破而用月破」）。`, sibling.naJia);
    } else if (isKongPending(sibling.kongWangState)) {
      push('critical', sibling.kongWangState === 'kong_static' ? `待${LIU_CHONG[sibling.naJia]}冲空或${sibling.naJia}填实` : `逢${sibling.naJia}出空`, ['用神多现，应乎旬空'],
        `同类${label}旬空，应期多在出空、填实之日（《增删卜易·两现章》「舍其不空，而用旬空」）。`, sibling.naJia);
    }
  }
  return recommendations;
}

/** 凶吉警告只列卦级分析未写明的断语与告诫：冲合转换、成局三合已见卦级分析，不再重复 */
function buildWarnings(groups: YongShenGroup[], sanHeAnalysis: SanHeAnalysis, guaFanFuYin: GuaFanFuYinInfo): string[] {
  const warnings: string[] = [];
  const fanFuYinReading = formatGuaFanFuYinReading(guaFanFuYin);
  if (fanFuYinReading) warnings.push(fanFuYinReading);
  for (const group of groups) {
    if (group.selectionStatus === 'ambiguous') {
      warnings.push(`用神${group.targetLiuQin}多现而取舍条件皆同，需并看而非强取一爻。`);
    }
    if (group.selected.kongWangState === 'kong_static') {
      warnings.push(`用神${group.targetLiuQin}真空，到底为空，须待冲空填实。`);
    }
    // 动爻亦论月破，以 specialStatus 为准，不看动静状态
    if (group.selected.specialStatus === 'yuePo') {
      warnings.push(`用神${group.targetLiuQin}月破，月内无功，须出月、逢合或实破之日方可论吉凶。`);
    } else if (group.selected.specialStatus === 'riPo') {
      warnings.push(`用神${group.targetLiuQin}日破，休囚无力，须得生扶方能有用。`);
    }
  }
  warnings.push(...(sanHeAnalysis.unformedSanHe ?? []).map((item) => item.description));
  if (sanHeAnalysis.hasBanHe) {
    warnings.push('卦中见半合，只能作辅助证据，不能单独代替用神旺衰。');
  }
  return warnings;
}

export function performFullAnalysis(
  yaos: YaoInput[],
  hexagramCode: string,
  changedCode: string | undefined,
  question: string,
  date: Date,
  options?: FullAnalysisOptions
): LiuYaoFullAnalysis {
  const targets = resolveYongShenTargets(question, options?.yongShenTargets);
  const ganZhiTime = calculateGanZhiTime(date);
  const monthZhi = ganZhiTime.month.zhi;
  const dayZhi = ganZhiTime.day.zhi;
  const kongWangByPillar = calculateKongWangByPillar(ganZhiTime);
  const kongWang = kongWangByPillar.day;
  const palace = findPalace(hexagramCode);
  const gongElement = palace?.element || '土';

  const baseYaos = calculateFullYaoInfo(yaos, hexagramCode, ganZhiTime.day.gan);
  const changedBranchOf = (yao: FullYaoInfo): DiZhi | undefined => (
    changedCode && yao.change === 'changing' ? getNaJiaByHexagram(changedCode, yao.position) : undefined
  );
  const factsOf = (yao: FullYaoInfo, movingSupport: string[], movingHarm: string[]): LineFacts => {
    const changedZhi = changedBranchOf(yao);
    return {
      yaoZhi: yao.naJia,
      yaoWuXing: yao.wuXing,
      motion: yao.change === 'changing' ? 'moving' : 'static',
      changedKe: changedZhi !== undefined && WUXING_KE[DIZHI_WUXING[changedZhi]] === yao.wuXing,
      movingSupport,
      movingHarm,
    };
  };
  const analyzeChange = (yao: FullYaoInfo, judgement: LineJudgement): YaoChangeAnalysis | undefined => {
    const changedZhi = changedBranchOf(yao);
    return changedZhi
      ? analyzeYaoChange(yao.naJia, changedZhi, yao.wuXing, DIZHI_WUXING[changedZhi], kongWang, judgement.rooted)
      : undefined;
  };

  // 先只论日月，定暗动、化变，据以判断哪些动爻有力生克他爻；再计入他爻生扶克制，得各爻定论。
  // 他爻有力与否只按日月论，不再循环回代。
  const actors = baseYaos.filter((yao) => {
    const judgement = judgeLine(factsOf(yao, [], []), monthZhi, dayZhi, kongWang);
    return canActOnOthers(yao, judgement, analyzeChange(yao, judgement), monthZhi);
  });
  const describeActor = (yao: FullYaoInfo) => `${traditionalYaoName(yao.position, yao.type)}${yao.naJia}${yao.wuXing}`;

  const movingHarmByPosition = new Map<number, FullYaoInfo[]>();
  const fullYaos: FullYaoInfoExtended[] = baseYaos.map((yao) => {
    const others = actors.filter((actor) => actor.position !== yao.position);
    const movingSupport = others
      .filter((actor) => actor.wuXing === yao.wuXing || WUXING_SHENG[actor.wuXing] === yao.wuXing)
      .map(describeActor);
    const movingHarm = others.filter((actor) => WUXING_KE[actor.wuXing] === yao.wuXing);
    movingHarmByPosition.set(yao.position, movingHarm);
    const judgement = judgeLine(factsOf(yao, movingSupport, movingHarm.map(describeActor)), monthZhi, dayZhi, kongWang);
    const { strength, kongWangState, dayStage } = judgement;
    const movementState = getYaoMovementState(yao, strength);
    const extended: FullYaoInfoExtended = {
      ...yao,
      isChanging: yao.change === 'changing',
      movementState,
      movementLabel: getYaoMovementLabel(movementState, strength),
      kongWangState,
      influence: getYaoInfluence(yao.naJia, monthZhi, dayZhi),
      strength,
      changedYao: null,
      shenSha: [],
      ...(dayStage ? { changSheng: { stage: dayStage, strength: CHANG_SHENG_STRENGTH[dayStage] } } : {}),
    };
    const changeAnalysis = analyzeChange(yao, judgement);
    if (changedCode && changeAnalysis) {
      extended.changeAnalysis = changeAnalysis;
      extended.changedYao = calculateChangedYaoDetail(hexagramCode, changedCode, yao.position, gongElement, extended, changeAnalysis);
    }
    return extended;
  });

  const shenShaContext = {
    yearStem: ganZhiTime.year.gan,
    yearBranch: ganZhiTime.year.zhi,
    monthStem: ganZhiTime.month.gan,
    monthBranch: ganZhiTime.month.zhi,
    dayStem: ganZhiTime.day.gan,
    dayBranch: ganZhiTime.day.zhi,
    hourStem: ganZhiTime.hour.gan,
    hourBranch: ganZhiTime.hour.zhi,
    kongWang: {
      xun: kongWang.xun,
      kongZhi: [kongWang.kongDizhi[0], kongWang.kongDizhi[1]] as [string, string],
    },
  };

  for (const yao of fullYaos) {
    yao.shenSha = calculateBranchShenSha(shenShaContext, yao.naJia);
  }

  // 计算每爻位的飞伏神
  const perYaoFuShen = calculatePerYaoFuShen(hexagramCode, baseYaos, gongElement);
  for (const yao of fullYaos) {
    const fs = perYaoFuShen.get(yao.position);
    if (fs) {
      yao.fuShen = fs;
    }
  }

  const fuShenByTarget = new Map<LiuQinType, JudgedFuShen[]>();
  for (const target of targets) {
    fuShenByTarget.set(target, calculateFuShen(hexagramCode, fullYaos, actors, target, gongElement, monthZhi, dayZhi, kongWang));
  }

  const yongShen = buildYongShenGroups(targets, { fullYaos, fuShenByTarget, gongElement, monthZhi, dayZhi, kongWang, movingHarmByPosition });
  const shenSystemByYongShen = yongShen.map((group) => ({
    targetLiuQin: group.targetLiuQin,
    ...calculateShenSystem(group, fullYaos, gongElement),
  }));
  const sanHeAnalysis = analyzeSanHe(fullYaos, monthZhi, dayZhi, kongWang.kongDizhi);
  const liuChongGuaInfo = checkLiuChongGua(baseYaos);
  const liuHeGuaInfo = checkLiuHeGua(baseYaos);
  const chongHeTransition = checkChongHeTransition(baseYaos, changedCode);
  const guaFanFuYin = checkGuaFanFuYin(hexagramCode, changedCode);
  const timeRecommendations = calculateTimeRecommendations(yongShen, { fullYaos, monthZhi, dayZhi, movingHarmByPosition });
  const globalShenSha = calculateGlobalShenSha(shenShaContext);
  const warnings = buildWarnings(yongShen, sanHeAnalysis, guaFanFuYin);
  const fuShen = Array.from(fuShenByTarget.values()).flat().map((item) => item.fuShen);

  return {
    ganZhiTime,
    kongWang,
    kongWangByPillar,
    fullYaos,
    yongShen,
    fuShen: fuShen.length > 0 ? fuShen : undefined,
    shenSystemByYongShen,
    globalShenSha,
    timeRecommendations,
    liuChongGuaInfo,
    liuHeGuaInfo,
    chongHeTransition,
    guaFanFuYin,
    sanHeAnalysis,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export function getHexagramContext(code: string): { hexagram?: Hexagram; palace?: { name: string; element: WuXing; order: number; }; guaCi?: string; xiangCi?: string; } {
  const hexagram = getHexagramByCode(code);
  return {
    hexagram,
    palace: findPalace(code),
    guaCi: hexagram ? GUA_CI[hexagram.name] : undefined,
    xiangCi: hexagram ? XIANG_CI[hexagram.name] : undefined,
  };
}

const NUMBER_TO_TRIGRAM: Record<number, string> = {
  1: '乾', 2: '兑', 3: '离', 4: '震',
  5: '巽', 6: '坎', 7: '艮', 8: '坤',
};

const TRIGRAM_LINES: Record<string, [number, number, number]> = {
  乾: [1, 1, 1], 兑: [1, 1, 0], 离: [1, 0, 1], 震: [1, 0, 0],
  巽: [0, 1, 1], 坎: [0, 1, 0], 艮: [0, 0, 1], 坤: [0, 0, 0],
};

function calculateChangedLines(mainCode: string, changedCode: string): number[] {
  const lines: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    if (mainCode[index] !== changedCode[index]) {
      lines.push(index + 1);
    }
  }
  return lines;
}

function calculateChangedHexagram(code: string, changedLines: number[]): string {
  const chars = code.split('');
  for (const line of changedLines) {
    const index = line - 1;
    chars[index] = chars[index] === '1' ? '0' : '1';
  }
  return chars.join('');
}

function divineFromValues(values: number[]): { yaos: YaoInput[]; hexagramCode: string; changedLines: number[]; } {
  if (values.length !== 6) throw new CoreInputError('yaoValues', '必须按初爻至上爻提供六个爻值');
  const yaos: YaoInput[] = values.map((value, index) => {
    assertInteger(value, 'yaoValues[' + index + ']', 6, 9);
    return { position: index + 1, type: (value % 2) as YaoType,
      change: value === 6 || value === 9 ? 'changing' : 'stable' };
  });
  return { yaos, hexagramCode: yaos.map(yao => yao.type).join(''),
    changedLines: yaos.filter(yao => yao.change === 'changing').map(yao => yao.position) };
}

/** Classical yarrow probability model: 6/7/8/9 have weights 1/5/7/3 out of 16. */
export function sampleYarrowValue(rng: () => number): number {
  const bucket = Math.floor(rng() * 16);
  return bucket === 0 ? 6 : bucket < 6 ? 7 : bucket < 13 ? 8 : 9;
}

function divine(rng: () => number, yarrow = false): { yaos: YaoInput[]; hexagramCode: string; changedLines: number[]; } {
  const values = Array.from({ length: 6 }, () => yarrow ? sampleYarrowValue(rng) :
    [rng(), rng(), rng()].reduce((sum, value) => sum + (value > 0.5 ? 3 : 2), 0));
  return divineFromValues(values);
}

function divineByTime(date: Date): { yaos: YaoInput[]; hexagramCode: string; changedLines: number[]; } {
  const solar = Solar.fromDate(date);
  const lunar = solar.getLunar();

  const yearBranch = lunar.getYearShengXiao();
  const zodiacToBranch: Record<string, number> = {
    鼠: 1, 牛: 2, 虎: 3, 兔: 4, 龙: 5, 蛇: 6,
    马: 7, 羊: 8, 猴: 9, 鸡: 10, 狗: 11, 猪: 12,
  };
  const yearBranchNum = zodiacToBranch[yearBranch] || 1;

  const lunarMonth = Math.abs(lunar.getMonth());
  const lunarDay = lunar.getDay();
  const hour = date.getHours();
  const hourBranchIndex = Math.floor((hour + 1) / 2) % 12;
  const hourBranchNum = hourBranchIndex + 1;

  let upperNum = (yearBranchNum + lunarMonth + lunarDay) % 8;
  if (upperNum === 0) upperNum = 8;

  let lowerNum = (yearBranchNum + lunarMonth + lunarDay + hourBranchNum) % 8;
  if (lowerNum === 0) lowerNum = 8;

  let movingLine = (yearBranchNum + lunarMonth + lunarDay + hourBranchNum) % 6;
  if (movingLine === 0) movingLine = 6;

  const upperTrigram = NUMBER_TO_TRIGRAM[upperNum];
  const lowerTrigram = NUMBER_TO_TRIGRAM[lowerNum];
  const lowerLines = TRIGRAM_LINES[lowerTrigram];
  const upperLines = TRIGRAM_LINES[upperTrigram];
  const lines: number[] = [...lowerLines, ...upperLines];
  const hexagramCode = lines.join('');

  const changedLines = [movingLine];
  const yaos: YaoInput[] = lines.map((line, index) => ({
    type: line as YaoType,
    change: (index + 1) === movingLine ? 'changing' : 'stable',
    position: index + 1,
  }));

  return { yaos, hexagramCode, changedLines };
}

function divineByNumber(numbers: number[]): { yaos: YaoInput[]; hexagramCode: string; changedLines: number[]; } {
  if (numbers.length < 2 || numbers.length > 3) {
    throw new Error('数字起卦需要提供2或3个数字');
  }
  if (!numbers.every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('数字起卦的 numbers 必须是正整数');
  }

  let upperNum: number;
  let lowerNum: number;
  let movingLine: number;

  if (numbers.length === 2) {
    upperNum = numbers[0] % 8;
    if (upperNum === 0) upperNum = 8;
    lowerNum = numbers[1] % 8;
    if (lowerNum === 0) lowerNum = 8;
    movingLine = (numbers[0] % 6 + numbers[1] % 6) % 6;
    if (movingLine === 0) movingLine = 6;
  } else {
    upperNum = numbers[0] % 8;
    if (upperNum === 0) upperNum = 8;
    lowerNum = numbers[1] % 8;
    if (lowerNum === 0) lowerNum = 8;
    movingLine = numbers[2] % 6;
    if (movingLine === 0) movingLine = 6;
  }

  const upperTrigram = NUMBER_TO_TRIGRAM[upperNum];
  const lowerTrigram = NUMBER_TO_TRIGRAM[lowerNum];
  const lowerLines = TRIGRAM_LINES[lowerTrigram];
  const upperLines = TRIGRAM_LINES[upperTrigram];
  const lines: number[] = [...lowerLines, ...upperLines];
  const hexagramCode = lines.join('');

  const changedLines = [movingLine];
  const yaos: YaoInput[] = lines.map((line, index) => ({
    type: line as YaoType,
    change: (index + 1) === movingLine ? 'changing' : 'stable',
    position: index + 1,
  }));

  return { yaos, hexagramCode, changedLines };
}

function toLiuyaoOutput(params: {
  question: string;
  hexagramCode: string;
  changedCode?: string;
  analysisDate: Date;
  yaos: YaoInput[];
  changedLines: number[];
  selectedTargets: ReturnType<typeof normalizeYongShenTargets>;
}): LiuyaoOutput {
  const { question, hexagramCode, changedCode, analysisDate, yaos } = params;
  const baseHexagram = findHexagram(hexagramCode);
  const changedHexagram = changedCode ? findHexagram(changedCode) : undefined;
  const basePalace = getPalaceInfo(hexagramCode);
  const changedPalace = changedCode ? getPalaceInfo(changedCode) : undefined;

  if (!baseHexagram) {
    throw new Error(`未找到卦象：${hexagramCode}`);
  }

  const analysis = performFullAnalysis(
    yaos,
    hexagramCode,
    changedCode,
    question,
    analysisDate,
    { yongShenTargets: params.selectedTargets },
  );

  const fullYaos: LiuyaoOutput['fullYaos'] = analysis.fullYaos.map((item) => {
    const { change: omittedChange, ...yao } = item;
    void omittedChange;
    return {
      ...yao,
      yaoCi: YAO_CI[baseHexagram.name]?.[yao.position - 1],
    };
  });

  const { nuclearHexagram, oppositeHexagram, reversedHexagram } = calculateDerivedHexagrams(hexagramCode);
  const guaShen = calculateGuaShen(hexagramCode);

  return {
    question,
    hexagramName: baseHexagram.name,
    hexagramGong: basePalace?.name || '',
    hexagramElement: baseHexagram.element,
    hexagramBrief: baseHexagram.nature,
    guaCi: GUA_CI[baseHexagram.name],
    xiangCi: XIANG_CI[baseHexagram.name],
    changedHexagramName: changedHexagram?.name,
    changedHexagramGong: changedPalace?.name,
    changedHexagramElement: changedHexagram?.element,
    changedGuaCi: changedHexagram ? GUA_CI[changedHexagram.name] : undefined,
    changedXiangCi: changedHexagram ? XIANG_CI[changedHexagram.name] : undefined,
    ganZhiTime: analysis.ganZhiTime,
    kongWang: analysis.kongWang,
    kongWangByPillar: analysis.kongWangByPillar,
    fullYaos,
    yongShen: analysis.yongShen,
    fuShen: analysis.fuShen,
    shenSystemByYongShen: analysis.shenSystemByYongShen,
    globalShenSha: analysis.globalShenSha,
    liuChongGuaInfo: analysis.liuChongGuaInfo,
    liuHeGuaInfo: analysis.liuHeGuaInfo,
    chongHeTransition: analysis.chongHeTransition,
    guaFanFuYin: analysis.guaFanFuYin,
    sanHeAnalysis: analysis.sanHeAnalysis,
    warnings: analysis.warnings,
    timeRecommendations: analysis.timeRecommendations,
    nuclearHexagram,
    oppositeHexagram,
    reversedHexagram,
    guaShen,
  };
}

export async function calculateLiuyaoData(input: LiuyaoInput): Promise<LiuyaoOutput> {
  resolveEnum(input.method, ['auto', 'select', 'time', 'number', 'coins', 'yarrow'], 'auto', 'method');
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) {
    throw new Error('请先明确问题后再解卦');
  }
  if (hasInvalidYongShenTargets(input.yongShenTargets)) {
    throw new Error('yongShenTargets 含非法值');
  }
  const selectedTargets = normalizeYongShenTargets(input.yongShenTargets);
  if (selectedTargets.length === 0) {
    throw new Error('请至少选择一个分析目标');
  }

  const {
    method = 'auto',
    hexagramName,
    changedHexagramName,
    date,
  } = input;

  if (!date) {
    throw new Error('date 为必填项，请提供占卜日期时间（格式：YYYY-MM-DDTHH:MM 或 YYYY-MM-DD HH:MM:SS）');
  }
  if (typeof date !== 'string') throw new CoreInputError('date', '必须是日期时间字符串');
  const trimmedDate = date.trim();
  const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?([zZ]|[+-]\d{2}:\d{2})?$/;
  if (!DATE_TIME_RE.test(trimmedDate)) {
    throw new Error('date 格式无效，必须包含时间，请使用 YYYY-MM-DDTHH:MM[:SS] 或带时区偏移的 ISO 时间');
  }

  const normalizedDateInput = trimmedDate.replace(' ', 'T');
  const datePart = normalizedDateInput.slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);
  const civil = { year, month, day, hour: Number(normalizedDateInput.slice(11, 13)), minute: Number(normalizedDateInput.slice(14, 16)),
    second: normalizedDateInput[16] === ':' ? Number(normalizedDateInput.slice(17, 19)) : 0 };
  validateCivilDateTime(civil);
  const timezone = input.timezone ?? DEFAULT_DIVINATION_TIMEZONE;
  const instant = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalizedDateInput)
    ? new Date(normalizedDateInput) : zonedTimeToUtc(civil, timezone);
  if (Number.isNaN(instant.getTime())) {
    throw new Error('date 日期无效，请检查年月日时分是否合理');
  }
  const analysisDate = zonedInstantToSystemDate(instant, timezone);

  const dateKey = `${analysisDate.getFullYear()}-${String(analysisDate.getMonth() + 1).padStart(2, '0')}-${String(analysisDate.getDate()).padStart(2, '0')}T${String(analysisDate.getHours()).padStart(2, '0')}`;
  const seed = resolveSeed(
    input.seed,
    `${dateKey}|${question}|${method}|${hexagramName || ''}|${changedHexagramName || ''}`,
    input.seedScope,
  );
  const rng = createSeededRng(seed);

  let yaos: YaoInput[];
  let hexagramCode: string;
  let changedCode: string | undefined;
  let changedLines: number[] = [];

  if (method === 'coins') {
    if (!Array.isArray(input.yaoValues)) throw new CoreInputError('yaoValues', '手工爻值模式必须提供 yaoValues');
    const result = divineFromValues(input.yaoValues);
    yaos = result.yaos;
    hexagramCode = result.hexagramCode;
    changedLines = result.changedLines;
    if (changedLines.length > 0) changedCode = calculateChangedHexagram(hexagramCode, changedLines);
  } else if (method === 'select') {
    if (!hexagramName) {
      throw new Error('select 模式必须提供 hexagramName');
    }
    const baseHexagram = findHexagram(hexagramName);
    if (!baseHexagram) {
      throw new Error(`未找到卦象：${hexagramName}`);
    }
    hexagramCode = baseHexagram.code;
    if (changedHexagramName) {
      const changedHexagram = findHexagram(changedHexagramName);
      if (!changedHexagram) {
        throw new Error(`未找到变卦：${changedHexagramName}`);
      }
      changedCode = changedHexagram.code;
      changedLines = calculateChangedLines(hexagramCode, changedCode);
    }
    yaos = hexagramCode.split('').map((char, index) => ({
      type: Number.parseInt(char, 10) as YaoType,
      change: changedLines.includes(index + 1) ? 'changing' : 'stable',
      position: index + 1,
    }));
  } else if (method === 'time') {
    const result = divineByTime(analysisDate);
    yaos = result.yaos;
    hexagramCode = result.hexagramCode;
    changedLines = result.changedLines;
    if (changedLines.length > 0) {
      changedCode = calculateChangedHexagram(hexagramCode, changedLines);
    }
  } else if (method === 'number') {
    if (!input.numbers || input.numbers.length < 2) {
      throw new Error('数字起卦需要提供 numbers 数组（2或3个数字）');
    }
    const result = divineByNumber(input.numbers);
    yaos = result.yaos;
    hexagramCode = result.hexagramCode;
    changedLines = result.changedLines;
    if (changedLines.length > 0) {
      changedCode = calculateChangedHexagram(hexagramCode, changedLines);
    }
  } else {
    const result = divine(rng, method === 'yarrow');
    yaos = result.yaos;
    hexagramCode = result.hexagramCode;
    changedLines = result.changedLines;
    if (changedLines.length > 0) {
      changedCode = calculateChangedHexagram(hexagramCode, changedLines);
    }
  }

  const output = toLiuyaoOutput({
    question,
    hexagramCode,
    changedCode,
    analysisDate,
    yaos,
    changedLines,
    selectedTargets,
  });

  return {
    ...output,
    seed: method === 'auto' || method === 'yarrow' || input.seed || input.seedScope ? seed : undefined,
    calculationOptions: { method, timezone: input.timezone ?? DEFAULT_DIVINATION_TIMEZONE, date: input.date, dayBoundary: 'zi', ...(method === 'coins' ? { yaoValues: [...input.yaoValues!] } : {}), ...(method === 'yarrow' ? { distribution: '6:1/16,7:5/16,8:7/16,9:3/16' } : {}), ruleVersion: 'liuyao-2026.10' },
  };
}
