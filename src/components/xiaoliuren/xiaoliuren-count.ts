/**
 * 小六壬掐数明细（纯展示辅助）
 *
 * 只把引擎已给出的月/日/时落宫展开成逐指掐数的步骤，不重新排课。
 * 顺序与 `taibu-core` 的规则一致：大安→留连→速喜→赤口→小吉→空亡，
 * 每一步都从上一步的落宫起数（起点记作第 1）。
 *
 * 引擎是唯一事实来源：当按名义数字（如闰月按 `leapMonthStrategy: 'advance'`
 * 递进一月）数出的落宫与引擎结果不一致时，按引擎落宫补足步数，
 * 保证每一段明细都恰好停在引擎给出的宫位上。
 */

export const XIAOLIUREN_PALACES = ['大安', '留连', '速喜', '赤口', '小吉', '空亡'] as const;

export type XiaoliurenPalace = typeof XIAOLIUREN_PALACES[number];

export type XiaoliurenStageKey = 'month' | 'day' | 'hour';

/** 六宫传统吉凶，仅用于掌诀上的辅助标注（与引擎状态表一致）。 */
export const XIAOLIUREN_PALACE_NATURE: Record<XiaoliurenPalace, '吉' | '凶'> = {
  大安: '吉',
  留连: '凶',
  速喜: '吉',
  赤口: '凶',
  小吉: '吉',
  空亡: '凶',
};

export interface XiaoliurenCountStage {
  key: XiaoliurenStageKey;
  /** 本段起数的宫位（月段固定为大安）。 */
  start: XiaoliurenPalace;
  /** 名义数字：农历月 / 农历日 / 时辰序号。 */
  nominal: number;
  /** 实际掐数步数；仅在引擎规则（如闰月递进）使落宫偏移时与 nominal 不同。 */
  count: number;
  /** 本段落宫，恒等于引擎结果。 */
  landing: XiaoliurenPalace;
  /** 逐步经过的宫位，长度等于 count，最后一项即落宫。 */
  chips: XiaoliurenPalace[];
}

export interface XiaoliurenCountInput {
  lunarMonth: number;
  lunarDay: number;
  /** 时辰序号，子=1 … 亥=12。 */
  hour: number;
  monthStatus: string;
  dayStatus: string;
  hourStatus: string;
}

const NOMINAL_LIMITS: Record<XiaoliurenStageKey, number> = { month: 12, day: 30, hour: 12 };

export function isXiaoliurenPalace(value: unknown): value is XiaoliurenPalace {
  return typeof value === 'string' && (XIAOLIUREN_PALACES as readonly string[]).includes(value);
}

function palaceAt(index: number): XiaoliurenPalace {
  return XIAOLIUREN_PALACES[((index % 6) + 6) % 6];
}

function isValidNominal(key: XiaoliurenStageKey, value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= NOMINAL_LIMITS[key];
}

function buildStage(
  key: XiaoliurenStageKey,
  start: XiaoliurenPalace,
  nominal: number,
  landing: XiaoliurenPalace,
): XiaoliurenCountStage {
  const startIndex = XIAOLIUREN_PALACES.indexOf(start);
  const naturalIndex = (startIndex + nominal - 1) % 6;
  const shift = (XIAOLIUREN_PALACES.indexOf(landing) - naturalIndex + 6) % 6;
  const count = nominal + shift;
  const chips = Array.from({ length: count }, (_, step) => palaceAt(startIndex + step));
  return { key, start, nominal, count, landing, chips };
}

/**
 * 展开三段掐数。任一输入不合法（宫名未知、数字越界）时返回 null，
 * 调用方应隐藏明细而不是展示与引擎不一致的步骤。
 */
export function buildXiaoliurenCountStages(input: XiaoliurenCountInput): XiaoliurenCountStage[] | null {
  const { lunarMonth, lunarDay, hour, monthStatus, dayStatus, hourStatus } = input;
  if (!isXiaoliurenPalace(monthStatus) || !isXiaoliurenPalace(dayStatus) || !isXiaoliurenPalace(hourStatus)) return null;
  if (!isValidNominal('month', lunarMonth) || !isValidNominal('day', lunarDay) || !isValidNominal('hour', hour)) return null;
  return [
    buildStage('month', '大安', lunarMonth, monthStatus),
    buildStage('day', monthStatus, lunarDay, dayStatus),
    buildStage('hour', dayStatus, hour, hourStatus),
  ];
}
