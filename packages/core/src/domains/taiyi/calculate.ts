import { NineStar, Solar } from 'lunar-javascript';

import { DEFAULT_DIVINATION_TIMEZONE, zonedWallClockToSystemDate } from '../../shared/timezone-utils.js';
import { GAN_WUXING, getElementRelation } from '../../shared/utils.js';
import { CoreInputError, parseCivilDate, resolveEnum } from '../../shared/validation.js';
import { calculateTraditionalTaiyi } from './traditional.js';

import type {
  TaiyiDatetimeContext,
  TaiyiDerivedIndicators,
  TaiyiInput,
  TaiyiJudgementAnchors,
  TaiyiMinuteRefinement,
  TaiyiMode,
  TaiyiOutput,
  TaiyiStarSnapshot,
} from './types.js';

export type {
  TaiyiBoardMeta,
  TaiyiDatetimeContext,
  TaiyiDerivedIndicators,
  TaiyiInput,
  TaiyiJudgementAnchors,
  TaiyiMinuteRefinement,
  TaiyiMode,
  TaiyiOutput,
  TaiyiStarSnapshot,
} from './types.js';

const DEFAULT_HOUR = 12;
const DEFAULT_MINUTE = 0;

const MODE_LABELS: Record<TaiyiMode, string> = {
  year: '年盘',
  month: '月盘',
  day: '日盘',
  hour: '时盘',
  minute: '分钟细化',
};

const POSITIVE_DAY_OFFICERS = new Set(['开', '成', '满', '定', '生']);
const NEGATIVE_DAY_OFFICERS = new Set(['闭', '破', '危', '收']);

const ELEMENT_RELATION_LABELS: Record<string, string> = {
  same: '主星五行与日干同气',
  produce: '主星五行生扶日干',
  produced: '主星五行受日干所生',
  control: '主星五行克制日干',
  controlled: '主星五行受日干所克',
};

function ensureHour(hour: number | undefined, mode: TaiyiMode): number {
  if (mode === 'hour' || mode === 'minute') {
    if (!Number.isInteger(hour) || hour == null || hour < 0 || hour > 23) {
      throw new Error('hour 必须是 0-23 的整数');
    }
    return hour;
  }
  if (hour == null) return DEFAULT_HOUR;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('hour 必须是 0-23 的整数');
  }
  return hour;
}

function ensureMinute(minute: number | undefined, mode: TaiyiMode): number {
  if (mode === 'minute') {
    if (!Number.isInteger(minute) || minute == null || minute < 0 || minute > 59) {
      throw new Error('minute 必须是 0-59 的整数');
    }
    return minute;
  }
  if (minute == null) return DEFAULT_MINUTE;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('minute 必须是 0-59 的整数');
  }
  return minute;
}

function formatSolarDateTime(year: number, month: number, day: number, hour: number, minute: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function buildTaiyiStarSnapshot(
  star: NineStar,
  scale: TaiyiMode | 'support',
  scaleLabel: string,
): TaiyiStarSnapshot {
  return {
    scale,
    scaleLabel,
    index: star.getIndex() + 1,
    number: star.getNumber(),
    color: star.getColor(),
    wuXing: star.getWuXing(),
    position: star.getPosition(),
    positionDesc: star.getPositionDesc(),
    beidouName: star.getNameInBeiDou(),
    xuankongName: star.getNameInXuanKong(),
    qimenName: star.getNameInQiMen(),
    qimenLuck: star.getLuckInQiMen(),
    qimenYinYang: star.getYinYangInQiMen(),
    qimenGate: star.getBaMenInQiMen() || undefined,
    taiyiName: star.getNameInTaiYi(),
    taiyiType: star.getTypeInTaiYi(),
    song: star.getSongInTaiYi(),
  };
}

function buildMinuteRefinement(hourStar: NineStar, minute: number): TaiyiMinuteRefinement {
  const slot = Math.floor(minute / 10) + 1;
  const refinedIndex = (hourStar.getIndex() + slot - 1) % 9;
  const refinedStar = NineStar.fromIndex(refinedIndex);
  return {
    slot,
    startMinute: (slot - 1) * 10,
    endMinute: Math.min(slot * 10 - 1, 59),
    refinedStar: buildTaiyiStarSnapshot(refinedStar, 'minute', MODE_LABELS.minute),
    note: '分钟细化在时盘基础上按 10 分钟顺推九星，用于细分节奏，不替代年月日时四层主盘。',
  };
}

function buildDatetimeContext(
  lunar: ReturnType<Solar['getLunar']>,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): TaiyiDatetimeContext {
  return {
    solarDateTime: formatSolarDateTime(year, month, day, hour, minute),
    lunarDate: lunar.toString(),
    jieQi: lunar.getJieQi() || undefined,
    // 月柱与年、月九星都以立春日换年；年柱若按春节换年，立春到春节之间会出现「癸卯年 丙寅月」
    yearGanZhi: lunar.getYearInGanZhiByLiChun(),
    monthGanZhi: lunar.getMonthInGanZhi(),
    dayGanZhi: lunar.getDayInGanZhi(),
    hourGanZhi: lunar.getTimeInGanZhi(),
    xiu: lunar.getXiu(),
    xiuLuck: lunar.getXiuLuck(),
    dayOfficer: lunar.getZhiXing(),
    tianShen: lunar.getDayTianShen(),
    tianShenLuck: lunar.getDayTianShenLuck(),
  };
}

function buildDerivedIndicators(primaryStar: TaiyiStarSnapshot, context: TaiyiDatetimeContext): TaiyiDerivedIndicators {
  const favorableSignals: string[] = [];
  const cautionSignals: string[] = [];

  if (primaryStar.taiyiType === '吉神') favorableSignals.push(`主星 ${primaryStar.taiyiName} 属吉神`);
  if (primaryStar.taiyiType === '凶神') cautionSignals.push(`主星 ${primaryStar.taiyiName} 属凶神`);
  if (context.tianShenLuck === '吉') favorableSignals.push(`日天神 ${context.tianShen} 属吉`);
  if (context.tianShenLuck === '凶') cautionSignals.push(`日天神 ${context.tianShen} 属凶`);
  if (context.xiuLuck === '吉') favorableSignals.push(`宿曜 ${context.xiu} 为吉`);
  if (context.xiuLuck === '凶') cautionSignals.push(`宿曜 ${context.xiu} 为凶`);
  if (POSITIVE_DAY_OFFICERS.has(context.dayOfficer)) favorableSignals.push(`建除值星 ${context.dayOfficer} 偏利成事`);
  if (NEGATIVE_DAY_OFFICERS.has(context.dayOfficer)) cautionSignals.push(`建除值星 ${context.dayOfficer} 偏需谨慎`);

  const dayStem = context.dayGanZhi.charAt(0);
  const dayElement = GAN_WUXING[dayStem] || primaryStar.wuXing;
  const elementRelation = getElementRelation(primaryStar.wuXing, dayElement);

  if (elementRelation === 'same' || elementRelation === 'produce') {
    favorableSignals.push(ELEMENT_RELATION_LABELS[elementRelation]);
  } else if (elementRelation === 'control' || elementRelation === 'controlled') {
    cautionSignals.push(ELEMENT_RELATION_LABELS[elementRelation]);
  }

  if (favorableSignals.length === 0) favorableSignals.push('主盘中性，宜结合问题轻重判断');
  if (cautionSignals.length === 0) cautionSignals.push('未见强烈阻滞信号，但仍需结合主诉审慎定性');

  return {
    favorableSignals,
    cautionSignals,
    elementRelation: ELEMENT_RELATION_LABELS[elementRelation] || '主星与日干五行关系中性',
    directionalHint: `${primaryStar.position} (${primaryStar.positionDesc})`,
  };
}

function buildJudgementAnchors(
  primaryStar: TaiyiStarSnapshot,
  context: TaiyiDatetimeContext,
  mode: TaiyiMode,
  minuteRefinement?: TaiyiMinuteRefinement,
): TaiyiJudgementAnchors {
  const summary = [
    `${MODE_LABELS[mode]}主星为 ${primaryStar.taiyiName}，属${primaryStar.taiyiType}，落 ${primaryStar.positionDesc}。`,
    `宿曜 ${context.xiu}${context.xiuLuck ? `（${context.xiuLuck}）` : ''}，值星 ${context.dayOfficer}，天神 ${context.tianShen}${context.tianShenLuck ? `（${context.tianShenLuck}）` : ''}。`,
    `四柱取 ${context.yearGanZhi}年 ${context.monthGanZhi}月 ${context.dayGanZhi}日 ${context.hourGanZhi}时。`,
  ];
  const modeNotes = [
    '本域当前实现为太乙九星视角：按年、月、日、时切换观测尺度，优先输出可解释的九星主盘与断事锚点。',
  ];
  if (minuteRefinement) {
    modeNotes.push(`分钟细化落在第 ${minuteRefinement.slot} 段（${String(minuteRefinement.startMinute).padStart(2, '0')}-${String(minuteRefinement.endMinute).padStart(2, '0')} 分）。`);
  }
  return {
    summary,
    primarySong: primaryStar.song,
    modeNotes,
  };
}

export function calculateTaiyi(input: TaiyiInput): TaiyiOutput {
  const { question, timezone = DEFAULT_DIVINATION_TIMEZONE } = input;
  const mode = resolveEnum(input.mode, ['year', 'month', 'day', 'hour', 'minute'] as const, 'hour', 'mode');
  const system = resolveEnum(input.system, ['nine-star', 'traditional'] as const, 'nine-star', 'system');
  if (system === 'nine-star' && [input.tradition, input.accumulatedNumber, input.dunType].some(value => value !== undefined)) throw new CoreInputError('system', '传统参数需选择 traditional');
  const { year, month, day } = parseCivilDate(input.date);
  const hour = ensureHour(input.hour, mode);
  const minute = ensureMinute(input.minute, mode);

  const systemDate = zonedWallClockToSystemDate({ year, month, day, hour, minute }, timezone);
  const solar = Solar.fromDate(systemDate);
  const lunar = solar.getLunar();

  const datetimeContext = buildDatetimeContext(lunar, year, month, day, hour, minute);
  if (system === 'traditional') {
    const traditionalBoard = calculateTraditionalTaiyi({ ...input, mode }, solar);
    return {
      ...(question ? { question } : {}),
      boardMeta: { system: 'taiyi_traditional', systemLabel: '太乙七十二局', mode, modeLabel: MODE_LABELS[mode], timezone, ruleVersion: traditionalBoard.ruleVersion },
      datetimeContext, traditionalBoard,
      derivedIndicators: { favorableSignals: [], cautionSignals: [], elementRelation: '', directionalHint: traditionalBoard.taiyi.position },
      judgementAnchors: {
        summary: [`${traditionalBoard.dun === 'yang' ? '阳' : '阴'}遁${traditionalBoard.bureau}局，太乙在${traditionalBoard.taiyi.position}。`, `文昌${traditionalBoard.wenChang}，始击${traditionalBoard.shiJi}，计神${traditionalBoard.jiShen}。`, `主算${traditionalBoard.home.count}，客算${traditionalBoard.away.count}。`],
        primarySong: '',
        modeNotes: ['七十二局立成采用《太乙金镜式经》四库本；自动积数采用现代公历日差和农历月序适配，闰月复用本月。可输入积数复核其他历书。'],
      },
    };
  }

  const yearStar = buildTaiyiStarSnapshot(lunar.getYearNineStar(), 'year', MODE_LABELS.year);
  const monthStar = buildTaiyiStarSnapshot(lunar.getMonthNineStar(), 'month', MODE_LABELS.month);
  const dayStar = buildTaiyiStarSnapshot(lunar.getDayNineStar(), 'day', MODE_LABELS.day);
  const hourStar = buildTaiyiStarSnapshot(lunar.getTimeNineStar(), 'hour', MODE_LABELS.hour);
  const minuteRefinement = mode === 'minute' ? buildMinuteRefinement(lunar.getTimeNineStar(), minute) : undefined;

  const primaryStar = mode === 'year'
    ? yearStar
    : mode === 'month'
      ? monthStar
      : mode === 'day'
        ? dayStar
        : mode === 'hour'
          ? hourStar
          : minuteRefinement!.refinedStar;

  const derivedIndicators = buildDerivedIndicators(primaryStar, datetimeContext);
  const judgementAnchors = buildJudgementAnchors(primaryStar, datetimeContext, mode, minuteRefinement);

  return {
    ...(question ? { question } : {}),
    boardMeta: {
      system: 'taiyi_nine_star',
      systemLabel: '太乙九星推演',
      mode,
      modeLabel: MODE_LABELS[mode],
      timezone,
      ruleVersion: 'taiyi-nine-star-2026.10',
      ...(minuteRefinement ? { minuteSlot: minuteRefinement.slot, minuteStrategy: minuteRefinement.note } : {}),
    },
    datetimeContext,
    coreBoard: {
      primaryStar,
      yearStar,
      monthStar,
      dayStar,
      hourStar,
      ...(minuteRefinement ? { minuteRefinement } : {}),
    },
    derivedIndicators,
    judgementAnchors,
  };
}
