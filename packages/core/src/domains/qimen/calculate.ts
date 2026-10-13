/**
 * 奇门遁甲排盘核心引擎
 */

import { Solar } from 'lunar-javascript';
import { DI_ZHI, GAN_WUXING, TIAN_GAN, YI_MA_MAP } from '../../data/ganzhi.js';
import { DEFAULT_DIVINATION_TIMEZONE, getZonedDateTimeParts, zonedTimeToUtc } from '../../shared/timezone-utils.js';
import { CoreInputError, assertInteger, resolveEnum, validateCivilDateTime } from '../../shared/validation.js';
import type { QimenInput, QimenOutput, QimenPalaceInfo } from './types.js';
import { getElementRelation, getKongWang } from '../../shared/utils.js';
import { calculateFlyingBoard, getQimenBureau, QIMEN_HIDDEN_JIA } from './rules.js';

export type { QimenInput, QimenOutput } from './types.js';

type TaobiPalaceLike = {
  getStar(humanReadable: boolean): string[] | string;
  getECS(humanReadable: boolean): string[];
  getHCS(humanReadable: boolean): string[];
  getDoor(humanReadable: boolean): string;
  getDivinity(humanReadable: boolean): string;
};

type TaobiChartLike = {
  round: number;
  year: { cs(humanReadable: boolean): string; tb(humanReadable: boolean): string; };
  month: { cs(humanReadable: boolean): string; tb(humanReadable: boolean): string; };
  date: { cs(humanReadable: boolean): string; tb(humanReadable: boolean): string; };
  hour: { cs(humanReadable: boolean): string; tb(humanReadable: boolean): string; };
  getSolarTerms(humanReadable: boolean): string;
  during?: Date[];
  ELEMENTS?: number[];
  getSymbol(humanReadable: boolean): string;
  mandate: number;
  acquired: TaobiPalaceLike[];
};

type TaobiConstructor = new (
  date: Date,
  yearConfig: unknown,
  monthConfig: unknown,
  followOption: number,
  options: { elements: number; },
) => TaobiChartLike;

let taobiConstructorPromise: Promise<TaobiConstructor> | null = null;

// 互斥锁：保护 process.env.TZ 全局变异区间，防止并发竞争
let tzMutexQueue: Promise<void> = Promise.resolve();

function withTzMutex<T>(fn: () => T): Promise<T> {
  let release: () => void = () => {};
  const next = new Promise<void>(resolve => { release = resolve; });
  const prev = tzMutexQueue;
  tzMutexQueue = next;
  return prev.catch(() => {}).then(() =>{
    try {
      return fn();
    } finally {
      release();
    }
  });
}

async function loadTaobiConstructor(): Promise<TaobiConstructor> {
  if (!taobiConstructorPromise) {
    taobiConstructorPromise = import('taobi').then((module) => {
      const ctor = module.TheArtOfBecomingInvisible ?? module.default?.TheArtOfBecomingInvisible;
      if (!ctor) {
        throw new Error('taobi 未导出 TheArtOfBecomingInvisible');
      }
      return ctor as TaobiConstructor;
    });
  }

  return taobiConstructorPromise;
}

// ===== 常量 =====

const PALACE_NAMES = ['坎', '坤', '震', '巽', '中', '乾', '兑', '艮', '离'];
const PALACE_DIRECTIONS = ['正北', '西南', '正东', '东南', '中央', '西北', '正西', '东北', '正南'];
const PALACE_ELEMENTS = ['水', '土', '木', '木', '土', '金', '金', '土', '火'];

const STAR_ELEMENTS: Record<string, string> = {
  '天蓬星': '水', '天芮星': '土', '天冲星': '木', '天辅星': '木', '天禽星': '土',
  '天心星': '金', '天柱星': '金', '天任星': '土', '天英星': '火',
};

const DOOR_NAMES = ['休门', '死门', '伤门', '杜门', '', '开门', '惊门', '生门', '景门'];
const DOOR_ELEMENTS: Record<string, string> = {
  '休门': '水', '死门': '土', '伤门': '木', '杜门': '木',
  '开门': '金', '惊门': '金', '生门': '土', '景门': '火',
};

// 九星、八门原始宫位（用于伏吟/反吟判断）
const STAR_ORIGINAL_PALACE: Record<string, number> = {
  '天蓬星': 0, '天芮星': 1, '天冲星': 2, '天辅星': 3, '天禽星': 4,
  '天心星': 5, '天柱星': 6, '天任星': 7, '天英星': 8,
};
const GATE_ORIGINAL_PALACE: Record<string, number> = Object.fromEntries(
  DOOR_NAMES.flatMap((gate, palace) => (gate ? [[gate, palace] as const] : [])),
);

// 对冲宫位
const OPPOSITE_PALACE: Record<number, number> = { 0: 8, 8: 0, 1: 7, 7: 1, 2: 6, 6: 2, 3: 5, 5: 3 };
const OUTER_PALACES = [0, 1, 2, 3, 5, 6, 7, 8];

// 《烟波钓叟歌》“就中伏吟为最凶……八门返伏皆如此”：星与门各论伏吟、反吟
const FU_FAN_YIN = ['星伏吟', '星反吟', '门伏吟', '门反吟'] as const;

// 地支→宫位映射
const BRANCH_TO_PALACE: Record<string, number> = {
  '子': 0, '丑': 7, '寅': 7, '卯': 2, '辰': 3, '巳': 3,
  '午': 8, '未': 1, '申': 1, '酉': 6, '戌': 5, '亥': 5,
};

// 入墓：天干→墓库地支（乙从《遁甲演义》“六乙日奇下临二宫”取未）
const RU_MU_MAP: Record<string, string> = {
  '甲': '未', '乙': '未', '丙': '戌', '丁': '丑',
  '戊': '戌', '己': '丑', '庚': '丑', '辛': '辰', '壬': '辰', '癸': '未',
};

// 六仪击刑：六仪→所刑宫位（甲子戊震3、甲戌己坤2、甲申庚艮8、甲午辛离9、甲辰壬巽4、甲寅癸巽4）
const JI_XING_PALACE: Record<string, number> = { 戊: 3, 己: 2, 庚: 8, 辛: 9, 壬: 4, 癸: 4 };

// 时干入墓：《遁甲演义》列丙戌、壬辰、丁丑、癸未、戊戌、己丑六时
const HOUR_IN_TOMB = new Set(['丙戌', '壬辰', '丁丑', '癸未', '戊戌', '己丑']);

// 三奇得使：“乙逢犬马丙鼠猴，六丁玉女骑龙虎”，即天盘三奇加地盘对应旬首六仪
const QI_DE_SHI: Record<string, readonly string[]> = { 乙: ['己', '辛'], 丙: ['戊', '庚'], 丁: ['壬', '癸'] };

// 五行旺衰（季节→五行→状态）
const SEASON_WANG_SHUAI: Record<string, Record<string, string>> = {
  '春': { '木': '旺', '火': '相', '水': '休', '金': '囚', '土': '死' },
  '夏': { '火': '旺', '土': '相', '木': '休', '水': '囚', '金': '死' },
  '四季土': { '土': '旺', '金': '相', '火': '休', '木': '囚', '水': '死' },
  '秋': { '金': '旺', '水': '相', '土': '休', '火': '囚', '木': '死' },
  '冬': { '水': '旺', '木': '相', '金': '休', '土': '囚', '火': '死' },
};

// 三元
const YUAN_NAMES = ['上元', '中元', '下元'];
const FORMATION_MAP: Record<string, string> = {
  // Directional relations from《遁甲演义》and《烟波钓叟歌》.
  '庚+丙': '太白入荧', '丙+庚': '荧入太白',
  '辛+乙': '白虎猖狂', '乙+辛': '青龙逃走',
  '丁+癸': '朱雀投江', '癸+丁': '腾蛇夭矫',
  // “庚加癸兮为大格，加己为刑最不宜，加壬之时为上格”（《遁甲演义》称加壬为小格）
  '庚+癸': '大格', '庚+己': '刑格', '庚+壬': '上格',
};

/** 天盘干加地盘干时参与比对的盘面干；甲不上盘，一律取其所遁六仪 */
interface FormationContext {
  /** 时旬首所遁六仪，即值符 */
  hiddenJia: string;
  dayStem: string;
  yearStem: string;
  monthStem: string;
  hourStem: string;
}

// ===== 辅助函数 =====

function getSeason(monthBranch: string): string {
  if (['寅', '卯'].includes(monthBranch)) return '春';
  if (['巳', '午'].includes(monthBranch)) return '夏';
  if (['辰', '戌', '丑', '未'].includes(monthBranch)) return '四季土';
  if (['申', '酉'].includes(monthBranch)) return '秋';
  return '冬';
}

function getWangShuai(element: string, season: string): string {
  return SEASON_WANG_SHUAI[season]?.[element] || '';
}

function buildMonthPhaseMap(season: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const stem of TIAN_GAN) {
    const element = GAN_WUXING[stem] || '';
    result[stem] = element ? getWangShuai(element, season) : '';
  }
  return result;
}

/** 柱干上盘的位置：甲遁于本旬六仪 */
function visibleStem(pillar: string): string {
  return pillar.startsWith('甲') ? QIMEN_HIDDEN_JIA[pillar] ?? '' : pillar.charAt(0);
}

// 格局判断：同宫天盘干（含寄干）逐一加于地盘干（含寄干）
function getFormations(heavenStems: readonly string[], earthStems: readonly string[], gate: string, deity: string, context: FormationContext, dutyGate: boolean): string[] {
  const formations = new Set<string>();
  // 星伏吟时寄宫天地两盘同为本宫干与中五干，各干自临本位，不交叉论格
  const stemsAtHome = heavenStems.length === earthStems.length && heavenStems.every(stem => earthStems.includes(stem));
  const pairs = stemsAtHome ? [] : heavenStems.flatMap(heaven => earthStems.map(earth => [heaven, earth] as const))
    .filter(([heaven, earth]) => heaven && earth && heaven !== earth);
  const has = (predicate: (heaven: string, earth: string) => boolean) => pairs.some(([heaven, earth]) => predicate(heaven, earth));

  for (const [heaven, earth] of pairs) {
    const fixed = FORMATION_MAP[`${heaven}+${earth}`];
    if (fixed) formations.add(fixed);
  }
  // “甲加丙兮龙回首”“丙加甲兮鸟跌穴”：甲即值符所带旬首六仪
  if (has((heaven, earth) => heaven === context.hiddenJia && earth === '丙')) formations.add('青龙返首');
  if (has((heaven, earth) => heaven === '丙' && earth === context.hiddenJia)) formations.add('飞鸟跌穴');
  if (gate === '生门' && has((heaven, earth) => heaven === '丙' && earth === '丁')) formations.add('天遁');
  if (gate === '开门' && has((heaven, earth) => heaven === '乙' && earth === '己')) formations.add('地遁');
  if (gate === '休门' && deity === '太阴' && heavenStems.includes('丁')) formations.add('人遁');
  if (dutyGate && earthStems.includes('丁')) formations.add('玉女守门');
  if (has((heaven, earth) => QI_DE_SHI[heaven]?.includes(earth) ?? false)) formations.add('三奇得使');
  // “庚加日干为伏干，日干加庚飞干格……庚加值符天乙伏，值符加庚天乙飞……又嫌岁月日时逢”；日格即伏干格
  if (has((heaven, earth) => heaven === '庚' && earth === context.hiddenJia)) formations.add('伏宫格');
  if (has((heaven, earth) => heaven === context.hiddenJia && earth === '庚')) formations.add('飞宫格');
  if (has((heaven, earth) => heaven === '庚' && earth === context.dayStem)) formations.add('伏干格');
  if (has((heaven, earth) => heaven === context.dayStem && earth === '庚')) formations.add('飞干格');
  if (has((heaven, earth) => heaven === '庚' && earth === context.yearStem)) formations.add('岁格');
  if (has((heaven, earth) => heaven === '庚' && earth === context.monthStem)) formations.add('月格');
  if (has((heaven, earth) => heaven === '庚' && earth === context.hourStem)) formations.add('时格');

  return [...formations];
}

// 五不遇时：“时干来克日干上”，阳克阳、阴克阴（《遁甲演义》）
function isWuBuYuShi(dayStem: string, hourStem: string): boolean {
  const dayIndex = TIAN_GAN.indexOf(dayStem as typeof TIAN_GAN[number]);
  const hourIndex = TIAN_GAN.indexOf(hourStem as typeof TIAN_GAN[number]);
  if (dayIndex < 0 || hourIndex < 0 || dayIndex % 2 !== hourIndex % 2) return false;
  return getElementRelation(GAN_WUXING[hourStem], GAN_WUXING[dayStem]) === 'control';
}

// 星门伏吟、反吟：转盘九星八门整体旋转，八宫同时成立时只作一条全盘格局
function getBoardFormations(palaces: readonly QimenPalaceInfo[], dayStem: string, hourPillar: string): string[] {
  const outer = OUTER_PALACES.map(index => palaces[index]);
  const board: string[] = FU_FAN_YIN.filter(name => outer.every(palace => palace.formations.includes(name)));
  if (isWuBuYuShi(dayStem, hourPillar.charAt(0))) board.push('五不遇时');
  if (HOUR_IN_TOMB.has(hourPillar)) board.push('时干入墓');
  return board;
}

// 计算旬首
function getXunShou(dayStem: string, dayBranch: string): string {
  const ganIdx = TIAN_GAN.indexOf(dayStem as typeof TIAN_GAN[number]);
  const zhiIdx = DI_ZHI.indexOf(dayBranch as typeof DI_ZHI[number]);
  if (ganIdx < 0 || zhiIdx < 0) return '甲子';
  const startZhiIdx = (zhiIdx - ganIdx + 12) % 12;
  return `甲${DI_ZHI[startZhiIdx]}`;
}

/** 六十甲子序号（甲子为 0） */
function sexagenaryIndex(stem: string, branch: string): number {
  const stemIndex = TIAN_GAN.indexOf(stem as typeof TIAN_GAN[number]);
  const branchIndex = DI_ZHI.indexOf(branch as typeof DI_ZHI[number]);
  if (stemIndex < 0 || branchIndex < 0 || stemIndex % 2 !== branchIndex % 2) throw new Error('奇门日干支不可用');
  return stemIndex + ((stemIndex - branchIndex + 12) % 12) * 5;
}

// taobi cannot accept pillar-only input without its ephemeris side data. A
// modern Jia-Zi cycle supplies the same day/hour without its pre-1970 offset bug.
function taobiCalendarDate(dayIndex: number, hour: number, minute: number, dayShift = 0): Date {
  // 2024-01-01 is Jia-Zi; this date is used only for rotation with an explicit bureau.
  // taobi 按运行环境本地钟面取日时柱，浏览器又不能改 TZ：用本地时间构造，任何时区下钟面都是目标日时
  // （此段日期各时区均无夏令时切换；Node 中 TZ 已设为北京时间，所得时刻与原先一致）。
  return new Date(2024, 0, 1 + dayIndex + dayShift, hour === 23 ? 0 : hour, minute);
}

// ===== 核心推演函数 =====

// 注意：taobi 库依赖 process.env.TZ 来正确解析 Date 对象。
// 允许在进入 TZ 变异区间之前懒加载依赖，但从设置 process.env.TZ 到 finally 恢复期间绝对不能有 await。
export function calculateQimenData(input: QimenInput): Promise<QimenOutput> {
  const { year, month, day, hour, minute = 0 } = input;
  const timezone = input.timezone ?? DEFAULT_DIVINATION_TIMEZONE;
  validateCivilDateTime({ year, month, day, hour, minute });
  assertInteger(year, 'year', 1900, 2100);
  const panType = resolveEnum(input.panType, ['zhuan', 'fei'], 'zhuan', 'panType');
  const juMethod = resolveEnum(input.juMethod, ['chaibu', 'maoshan', 'equal'], 'chaibu', 'juMethod');
  const zhiFuJiGong = resolveEnum(input.zhiFuJiGong, ['ji_liuyi', 'ji_wugong'], 'ji_liuyi', 'zhiFuJiGong');
  const flyStarMethod = resolveEnum(input.flyStarMethod, ['forward', 'yin-reverse'], 'yin-reverse', 'flyStarMethod');
  if (input.juNumber !== undefined) assertInteger(input.juNumber, 'juNumber', 1, 9);
  if (input.dunType !== undefined) resolveEnum(input.dunType, ['yang', 'yin'], 'yang', 'dunType');
  if (panType === 'zhuan' && input.flyStarMethod !== undefined) throw new CoreInputError('flyStarMethod', '仅飞盘可以设置飞星法');
  const instant = zonedTimeToUtc({ year, month, day, hour, minute }, timezone);
  const clockEightChar = Solar.fromYmdHms(year, month, day, hour, minute, 0).getLunar().getEightChar();
  clockEightChar.setSect(1);
  const bureau = getQimenBureau(input, instant, clockEightChar.getDayGan(), clockEightChar.getDayZhi());
  const elementsOption = juMethod === 'maoshan' ? 2 : juMethod === 'equal' ? 0 : 1;
  const followOption = zhiFuJiGong === 'ji_wugong' ? 0 : 1;
  return (panType === 'fei' ? Promise.resolve(null) : loadTaobiConstructor()).then((TheArtOfBecomingInvisible) => {
    // 通过互斥锁串行化 TZ 变异区间，防止并发请求之间的竞争条件
    return withTzMutex(() => {
    // WARNING: process.env.TZ 全局变异区间 —— 此区间内禁止 await！
    // taobi receives a civil calendar and an explicit bureau, not the physical term instant.
    const previousTimeZone = process.env.TZ;
    if (TheArtOfBecomingInvisible) process.env.TZ = DEFAULT_DIVINATION_TIMEZONE;
    try {
      const date = instant;
      let t: TaobiChartLike | null = null;
      try {
        if (TheArtOfBecomingInvisible) {
          const dayIndex = sexagenaryIndex(clockEightChar.getDayGan(), clockEightChar.getDayZhi());
          const build = (dayShift: number) => new TheArtOfBecomingInvisible(
            taobiCalendarDate(dayIndex, hour, minute, dayShift), bureau.round, null, followOption, { elements: elementsOption });
          t = build(0);
          // tao_calendar 的纪日起点按运行时区的历史地方时换算（只为北京时间校正过），浏览器不在北京时间时会整日错位：按差值平移一次
          const drift = ((dayIndex - sexagenaryIndex(t.date.cs(true), t.date.tb(true))) % 60 + 90) % 60 - 30;
          if (drift !== 0) t = build(drift);
          if (t.date.cs(true) !== clockEightChar.getDayGan() || t.date.tb(true) !== clockEightChar.getDayZhi()
            || t.hour.cs(true) !== clockEightChar.getTimeGan() || t.hour.tb(true) !== clockEightChar.getTimeZhi()) {
            throw new Error('转盘日时干支与历法不一致');
          }
        }
      } catch (err) {
        throw new Error(`奇门排盘失败: ${err instanceof Error ? err.message : String(err)}`);
      }

    // 基本信息
    const round = bureau.round;
    const dunType: 'yang' | 'yin' = round > 0 ? 'yang' : 'yin';
    const juNumber = Math.abs(round);

    // 四柱：tao_calendar 的子/丑月偏移及按天交节有误，年/月柱复用八字历法。
    // lunar-javascript 的节气时刻采用北京时间（UTC+8）；先转换输入时区的实际时刻。
    const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const eightChar = Solar.fromYmdHms(
      beijingTime.getUTCFullYear(), beijingTime.getUTCMonth() + 1, beijingTime.getUTCDate(),
      beijingTime.getUTCHours(), beijingTime.getUTCMinutes(), beijingTime.getUTCSeconds(),
    ).getLunar().getEightChar();
    const yearGan = eightChar.getYearGan();
    const yearZhi = eightChar.getYearZhi();
    const monthGan = eightChar.getMonthGan();
    const monthZhi = eightChar.getMonthZhi();
    const dayGan = clockEightChar.getDayGan();
    const dayZhi = clockEightChar.getDayZhi();
    const hourGan = clockEightChar.getTimeGan();
    const hourZhi = clockEightChar.getTimeZhi();

    // 节气
    const solarTerm = bureau.solarTerm;

    // 节气时间范围
    const solarTermRange = `${formatDateStr(bureau.start, timezone)} ~ ${formatDateStr(bureau.end, timezone)}`;

    // 旬首（奇门遁甲以时柱旬首为准）
    const xunShou = getXunShou(hourGan, hourZhi);

    // 三元（从 taobi 获取）
    const yuanIdx = bureau.yuan;
    const yuan = YUAN_NAMES[yuanIdx] || '上元';

    // 值符值使
    const flying = panType === 'fei' ? calculateFlyingBoard(round, hourGan, xunShou, flyStarMethod) : null;
    const zhiFuStar = flying ? flying.zhiFu.star : t!.getSymbol(true);
    const mandateIdx = t?.mandate ?? 0; // 值使门的原宫，不能用作落宫

    // 值符所在宫位：找到值符星当前在哪个宫
    let zhiFuPalace = flying ? flying.zhiFu.palace - 1 : 0;
    for (let i = 0; t && i < 9; i++) {
      const p = t.acquired[i];
      const stars = p.getStar(true) as string[];
      if (stars && stars.includes(zhiFuStar)) {
        zhiFuPalace = i;
        break;
      }
    }

    // 值使门名：从 mandate 索引获取
    const zhiShiGate = flying ? flying.zhiShi.gate : DOOR_NAMES[mandateIdx] || '';
    const zhiShiPalace = flying ? flying.zhiShi.palace : t!.acquired.findIndex(p => p.getDoor(true) === zhiShiGate) + 1;
    if (!zhiShiPalace) throw new Error('值使门落宫不可用');

    // 月支季节
    const season = getSeason(monthZhi);
    const monthPhase = buildMonthPhaseMap(season);

    // 空亡计算
    const dayKong = getKongWang(dayGan, dayZhi);
    const hourKong = getKongWang(hourGan, hourZhi);

    const dayKongPalaces = dayKong.kongZhi.map(b => BRANCH_TO_PALACE[b]).filter(p => p !== undefined);
    const hourKongPalaces = hourKong.kongZhi.map(b => BRANCH_TO_PALACE[b]).filter(p => p !== undefined);

    // 驿马
    const yiMaBranch = YI_MA_MAP[dayZhi] || '';
    const yiMaPalace = BRANCH_TO_PALACE[yiMaBranch] ?? -1;

    // 农历日期
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();
    const lunarDate = `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;

    // 构建九宫数据
    const palaces: QimenPalaceInfo[] = [];
    const formationContext: FormationContext = {
      hiddenJia: QIMEN_HIDDEN_JIA[xunShou],
      dayStem: visibleStem(`${dayGan}${dayZhi}`),
      yearStem: visibleStem(`${yearGan}${yearZhi}`),
      monthStem: visibleStem(`${monthGan}${monthZhi}`),
      hourStem: visibleStem(`${hourGan}${hourZhi}`),
    };

    // 转盘中五地盘干寄于天禽所随之星的本宫（坤二或艮八）；taobi 只在中宫列出该干
    const centerHostStar = t?.acquired.map(palace => [palace.getStar(true)].flat())
      .find((stars, index) => index !== 4 && stars.slice(1).includes('天禽星'))?.[0];
    const centerHostPalace = centerHostStar ? STAR_ORIGINAL_PALACE[centerHostStar] : -1;
    const centerEarthStem = t?.acquired[4].getECS(true)[0] ?? '';

    for (let i = 0; i < 9; i++) {
      const p = t?.acquired[i];
      const earthStems = flying ? [flying.earth[i]]
        : [...p!.getECS(true), ...(i === centerHostPalace && centerEarthStem ? [centerEarthStem] : [])];
      const heavenStems = flying ? [flying.heaven[i]] : p!.getHCS(true);
      const stars = flying ? flying.stars[i] : p!.getStar(true);
      const door = flying ? flying.gates[i] : p!.getDoor(true);
      const deity = flying ? flying.gods[i] : p!.getDivinity(true);

      const earthStem = earthStems?.[0] || '';
      const heavenStem = heavenStems?.[0] || '';
      const starName = Array.isArray(stars) ? stars[0] || '' : (stars || '');
      const palaceName = PALACE_NAMES[i];

      // 格局判断
      const formations: string[] = [];
      if (heavenStem && earthStem && (panType === 'fei' || i !== 4)) {
        formations.push(...getFormations(heavenStems, earthStems, door, deity, formationContext, i + 1 === zhiShiPalace));
      }

      // 伏吟：星、门回到原始宫位；反吟：星、门到对冲宫位
      const starHome = starName ? STAR_ORIGINAL_PALACE[starName] : undefined;
      const gateHome = door ? GATE_ORIGINAL_PALACE[door] : undefined;
      if (starHome === i) formations.push('星伏吟');
      if (starHome !== undefined && OPPOSITE_PALACE[starHome] === i) formations.push('星反吟');
      if (gateHome === i) formations.push('门伏吟');
      if (gateHome !== undefined && OPPOSITE_PALACE[gateHome] === i) formations.push('门反吟');

      // 旺衰
      const stemElement = GAN_WUXING[heavenStem] || '';
      const stemWangShuai = stemElement ? getWangShuai(stemElement, season) : undefined;
      const elementState = getWangShuai(PALACE_ELEMENTS[i], season);

      // 空亡
      const isKongWang = dayKongPalaces.includes(i);

      // 驿马
      const isYiMa = yiMaPalace === i;

      // 入墓、击刑：寄干随天禽同落本宫，一并参看
      const isRuMu = heavenStems.some(stem => RU_MU_MAP[stem] !== undefined && BRANCH_TO_PALACE[RU_MU_MAP[stem]] === i);
      const isMenPo = Boolean(door && getElementRelation(DOOR_ELEMENTS[door], PALACE_ELEMENTS[i]) === 'control');
      const isJiXing = heavenStems.some(stem => JI_XING_PALACE[stem] === i + 1);
      if (isMenPo) formations.push('门迫');
      if (isJiXing) formations.push('六仪击刑');

      palaces.push({
        palaceIndex: i + 1,
        palaceName,
        direction: PALACE_DIRECTIONS[i],
        element: PALACE_ELEMENTS[i],
        earthStem,
        earthStemElement: GAN_WUXING[earthStem] || '',
        heavenStem,
        heavenStemElement: GAN_WUXING[heavenStem] || '',
        star: starName,
        starElement: STAR_ELEMENTS[starName] || '',
        gate: door || '',
        gateElement: DOOR_ELEMENTS[door] || '',
        deity: deity || '',
        formations,
        stemWangShuai,
        elementState,
        isKongWang,
        isYiMa,
        isRuMu,
        isMenPo,
        isJiXing,
        ...(Array.isArray(stars) && stars.length > 1 ? { hostedStars: stars.slice(1) } : {}),
        ...(heavenStems.length > 1 ? { hostedHeavenStems: heavenStems.slice(1) } : {}),
        ...(earthStems.length > 1 ? { hostedEarthStems: earthStems.slice(1) } : {}),
      });
    }

    // 全盘格局只列一次，其余按宫列出
    const boardFormations = getBoardFormations(palaces, dayGan, `${hourGan}${hourZhi}`);
    const globalFormations = [
      ...boardFormations.map(name => `全盘: ${name}`),
      ...palaces.flatMap(palace => palace.formations
        .filter(name => !boardFormations.includes(name))
        .map(name => `${palace.palaceName}宫: ${name}`)),
    ];

      return {
      dateInfo: {
        solarDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        lunarDate,
        solarTerm,
        solarTermRange,
      },
      siZhu: {
        year: `${yearGan}${yearZhi}`,
        month: `${monthGan}${monthZhi}`,
        day: `${dayGan}${dayZhi}`,
        hour: `${hourGan}${hourZhi}`,
      },
      dunType,
      juNumber,
      yuan,
      xunShou,
      zhiFu: { star: zhiFuStar, palace: zhiFuPalace + 1 },
      zhiShi: { gate: zhiShiGate, palace: zhiShiPalace },
      palaces,
      kongWang: {
        dayKong: {
          branches: [...dayKong.kongZhi],
          palaces: dayKongPalaces.map(p => p + 1),
        },
        hourKong: {
          branches: [...hourKong.kongZhi],
          palaces: hourKongPalaces.map(p => p + 1),
        },
      },
      yiMa: { branch: yiMaBranch, palace: yiMaPalace >= 0 ? yiMaPalace + 1 : 0 },
      globalFormations,
      boardFormations,
      panType: panType === 'fei' ? '飞盘' : '转盘',
      juMethod: input.juNumber !== undefined ? '手工定局' : juMethod === 'maoshan' ? '茅山法' : juMethod === 'equal' ? '等时均分法' : '拆补法',
      question: input.question,
      monthPhase,
      inputSnapshot: { year, month, day, hour, minute, timezone, panType, juMethod, zhiFuJiGong,
        ...(panType === 'fei' ? { flyStarMethod } : {}),
        ...(input.juNumber === undefined ? {} : { juNumber: input.juNumber, dunType: input.dunType }), ruleVersion: 'qimen-hour-2026.10' },
      };
    } finally {
      if (previousTimeZone == null) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
    }); // withTzMutex
  });
}

function formatDateStr(d: Date, timezone: string): string {
  const parts = getZonedDateTimeParts(d, timezone);
  const y = parts.year;
  const m = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  const hh = String(parts.hour).padStart(2, '0');
  const mm = String(parts.minute).padStart(2, '0');
  return `${y}-${m}-${dd} ${hh}:${mm}`;
}
