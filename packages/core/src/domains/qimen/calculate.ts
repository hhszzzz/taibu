/**
 * 奇门遁甲排盘核心引擎
 */

import { Solar } from 'lunar-javascript';
import { DI_ZHI, GAN_WUXING, TIAN_GAN, YI_MA_MAP } from '../../data/ganzhi.js';
import { DEFAULT_DIVINATION_TIMEZONE, getTimeZoneOffsetMinutes } from '../../shared/timezone-utils.js';
import type { QimenInput, QimenOutput, QimenPalaceInfo } from './types.js';
import { getKongWang } from '../../shared/utils.js';

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

// 九星原始宫位（用于伏吟/反吟判断）
const STAR_ORIGINAL_PALACE: Record<string, number> = {
  '天蓬星': 0, '天芮星': 1, '天冲星': 2, '天辅星': 3, '天禽星': 4,
  '天心星': 5, '天柱星': 6, '天任星': 7, '天英星': 8,
};

// 对冲宫位
const OPPOSITE_PALACE: Record<number, number> = { 0: 8, 8: 0, 1: 7, 7: 1, 2: 6, 6: 2, 3: 5, 5: 3 };

// 地支→宫位映射
const BRANCH_TO_PALACE: Record<string, number> = {
  '子': 0, '丑': 7, '寅': 7, '卯': 2, '辰': 3, '巳': 3,
  '午': 8, '未': 1, '申': 1, '酉': 6, '戌': 5, '亥': 5,
};

// 入墓：天干→墓库地支
const RU_MU_MAP: Record<string, string> = {
  '甲': '未', '乙': '未', '丙': '戌', '丁': '戌',
  '戊': '戌', '庚': '丑', '辛': '丑', '壬': '辰', '癸': '辰',
};

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

// 格局判断（天盘干+地盘干组合）
function getFormations(heavenStem: string, earthStem: string): string[] {
  const formations: string[] = [];
  const key = `${heavenStem}+${earthStem}`;
  const reverseKey = `${earthStem}+${heavenStem}`;

  const FORMATION_MAP: Record<string, string> = {
    // 吉格
    '乙+丙': '奇仪相佐', '乙+丁': '奇仪相佐', '丙+丁': '星月相会',
    '丙+戊': '飞鸟跌穴', '丁+戊': '青龙返首', '乙+戊': '日出扶桑',
    // 五遁格
    '丙+己': '天遁', '丁+壬': '地遁', '丁+己': '人遁',
    '丙+壬': '神遁', '乙+癸': '鬼遁',
    // 凶格
    '庚+乙': '太白入荧', '庚+丙': '太白入荧', '庚+丁': '太白入荧',
    '辛+乙': '白虎猖狂',
    '乙+辛': '龙逃走',
    '癸+丁': '腾蛇夭矫', '癸+丙': '蛇矫入火',
    '庚+戊': '值符飞宫', '庚+壬': '上格', '庚+癸': '大格',
    // 其他重要格局
    '丁+癸': '玉女守门', '戊+壬': '小格', '戊+癸': '刑格',
    '己+庚': '刑格入狱', '辛+壬': '凶蛇入刑',
  };

  if (FORMATION_MAP[key]) formations.push(FORMATION_MAP[key]);
  if (FORMATION_MAP[reverseKey] && reverseKey !== key) formations.push(FORMATION_MAP[reverseKey]);

  return formations;
}

// 计算旬首
function getXunShou(dayStem: string, dayBranch: string): string {
  const ganIdx = TIAN_GAN.indexOf(dayStem as typeof TIAN_GAN[number]);
  const zhiIdx = DI_ZHI.indexOf(dayBranch as typeof DI_ZHI[number]);
  if (ganIdx < 0 || zhiIdx < 0) return '甲子';
  const startZhiIdx = (zhiIdx - ganIdx + 12) % 12;
  return `甲${DI_ZHI[startZhiIdx]}`;
}

function assertValidTimeZone(timeZone: string): void {
  try {
    getTimeZoneOffsetMinutes(timeZone, new Date());
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error('timezone 无效');
    }
    throw error;
  }
}

// ===== 核心推演函数 =====

// 注意：taobi 库依赖 process.env.TZ 来正确解析 Date 对象。
// 允许在进入 TZ 变异区间之前懒加载依赖，但从设置 process.env.TZ 到 finally 恢复期间绝对不能有 await。
export function calculateQimenData(input: QimenInput): Promise<QimenOutput> {
  const { year, month, day, hour, minute = 0 } = input;
  const timezone = input.timezone || DEFAULT_DIVINATION_TIMEZONE;
  const juMethod = input.juMethod || 'chaibu';
  const zhiFuJiGong = input.zhiFuJiGong || 'ji_liuyi';
  const elementsOption = juMethod === 'maoshan' ? 2 : 1;
  const followOption = zhiFuJiGong === 'ji_wugong' ? 0 : 1;
  assertValidTimeZone(timezone);
  return loadTaobiConstructor().then((TheArtOfBecomingInvisible) => {
    // 通过互斥锁串行化 TZ 变异区间，防止并发请求之间的竞争条件
    return withTzMutex(() => {
    // WARNING: process.env.TZ 全局变异区间 —— 此区间内禁止 await！
    // taobi 库内部使用 Date 的 UTC 时间戳，zonedWallClockToSystemDate 无法替代。
    const previousTimeZone = process.env.TZ;
    process.env.TZ = timezone;
    try {
      const date = new Date(year, month - 1, day, hour, minute);
      let t;
      try {
        t = new TheArtOfBecomingInvisible(date, null, null, followOption, { elements: elementsOption });
      } catch (err) {
        throw new Error(`奇门排盘失败: ${err instanceof Error ? err.message : String(err)}`);
      }

    // 基本信息
    const round = t.round as number;
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
    const dayGan = t.date.cs(true) as string;
    const dayZhi = t.date.tb(true) as string;
    const hourGan = t.hour.cs(true) as string;
    const hourZhi = t.hour.tb(true) as string;

    // 节气
    const solarTerm = t.getSolarTerms(true) as string;

    // 节气时间范围
    const during = t.during as Date[];
    let solarTermRange: string | undefined;
    if (during && during.length >= 2) {
      // 找到当前节气的起止时间
      const solarTermNames = [
        '小寒', '大寒', '立春', '雨水', '惊蛰', '春分',
        '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
        '小暑', '大暑', '立秋', '处暑', '白露', '秋分',
        '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
      ];
      const termIdx = solarTermNames.indexOf(solarTerm);
      if (termIdx >= 0 && termIdx < during.length - 1) {
        const start = during[termIdx];
        const end = during[termIdx + 1];
        solarTermRange = `${formatDateStr(start)} ~ ${formatDateStr(end)}`;
      }
    }

    // 旬首（奇门遁甲以时柱旬首为准）
    const xunShou = getXunShou(hourGan, hourZhi);

    // 三元（从 taobi 获取）
    const elementsArr = t.ELEMENTS as number[] | undefined;
    const yuanIdx = elementsArr ? elementsArr[elementsOption] : 0;
    const yuan = YUAN_NAMES[yuanIdx] || '上元';

    // 值符值使
    const zhiFuStar = t.getSymbol(true) as string;
    const mandateIdx = t.mandate as number; // 值使门所在宫位index

    // 值符所在宫位：找到值符星当前在哪个宫
    let zhiFuPalace = 0;
    for (let i = 0; i < 9; i++) {
      const p = t.acquired[i];
      const stars = p.getStar(true) as string[];
      if (stars && stars.includes(zhiFuStar)) {
        zhiFuPalace = i;
        break;
      }
    }

    // 值使门名：从 mandate 索引获取
    const zhiShiGate = DOOR_NAMES[mandateIdx] || '';

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
    const globalFormations: string[] = [];

    for (let i = 0; i < 9; i++) {
      const p = t.acquired[i];
      const earthStems = p.getECS(true) as string[];
      const heavenStems = p.getHCS(true) as string[];
      const stars = p.getStar(true) as string[] | string;
      const door = p.getDoor(true) as string;
      const deity = p.getDivinity(true) as string;

      const earthStem = earthStems?.[0] || '';
      const heavenStem = heavenStems?.[0] || '';
      const starName = Array.isArray(stars) ? stars[0] || '' : (stars || '');
      const palaceName = PALACE_NAMES[i];

      // 格局判断
      const formations: string[] = [];
      if (heavenStem && earthStem && i !== 4) {
        formations.push(...getFormations(heavenStem, earthStem));
      }

      // 伏吟判断：天盘星回到原始宫位
      if (starName && STAR_ORIGINAL_PALACE[starName] === i) {
        formations.push('伏吟');
      }
      // 反吟判断：天盘星到对冲宫位
      if (starName && OPPOSITE_PALACE[STAR_ORIGINAL_PALACE[starName]] === i) {
        formations.push('反吟');
      }

      // 旺衰
      const stemElement = GAN_WUXING[heavenStem] || '';
      const stemWangShuai = stemElement ? getWangShuai(stemElement, season) : undefined;
      const elementState = getWangShuai(PALACE_ELEMENTS[i], season);

      // 空亡
      const isKongWang = dayKongPalaces.includes(i);

      // 驿马
      const isYiMa = yiMaPalace === i;

      // 入墓
      const muBranch = RU_MU_MAP[heavenStem];
      const muPalace = muBranch ? BRANCH_TO_PALACE[muBranch] : undefined;
      const isRuMu = muPalace === i;

      if (formations.length > 0) {
        globalFormations.push(...formations.map(f => `${palaceName}宫: ${f}`));
      }

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
      });
    }

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
      zhiShi: { gate: zhiShiGate, palace: mandateIdx + 1 },
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
      panType: '转盘',
      juMethod: juMethod === 'maoshan' ? '茅山法' : '拆补法',
      question: input.question,
      monthPhase,
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

function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${dd} ${hh}:${mm}`;
}
