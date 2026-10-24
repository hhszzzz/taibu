/**
 * 黄历择日筛选：在不超过 92 天的区间内逐日取黄历，按事项（宜忌逐条匹配）与
 * 冲煞（生肖或地支的六冲）筛选候选日，只陈列条文与统计，不评定吉凶等级。
 */

import { calculateDailyAlmanac } from './calculate.js';
import { DEFAULT_DIVINATION_TIMEZONE } from '../../shared/timezone-utils.js';
import { CoreInputError, parseCivilDate } from '../../shared/validation.js';
import type { AlmanacSelectDayJSON, AlmanacSelectInput, AlmanacSelectOutput } from './select-types.js';

export const ALMANAC_SELECT_RULE_VERSION = 'almanac-select-2026.10';
export const ALMANAC_SELECT_MAX_DAYS = 92;

/** 十二地支与生肖一一对应 */
export const ZHI_SHENG_XIAO: Record<string, string> = {
  子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇',
  午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪',
};

/** 六冲：子午、丑未、寅申、卯酉、辰戌、巳亥 */
const ZHI_CHONG: Record<string, string> = {
  子: '午', 午: '子', 丑: '未', 未: '丑', 寅: '申', 申: '寅',
  卯: '酉', 酉: '卯', 辰: '戌', 戌: '辰', 巳: '亥', 亥: '巳',
};

export const ALMANAC_SELECT_NOTES = [
  '宜忌取黄历条文，事项按逐条包含匹配（如「开市」可命中「开市交易」），不另立择日体系',
  '冲煞排除按六冲推算：给出的是目标生肖或地支（可多个，如新人双方），当日地支冲其中任何一个即排除，不解析冲煞文本',
  '逐日结果与黄历工具同源，含农历、建除、黄黑道、二十八宿与纳音',
  '候选日按日期升序；只陈列条文与统计，不评定吉凶等级，也不推算具体吉时',
];

function resolveClashBranch(value: string, path: string): string {
  const text = value.trim();
  if (text in ZHI_CHONG) return text;
  const found = Object.entries(ZHI_SHENG_XIAO).find(([, animal]) => animal === text);
  if (!found) throw new CoreInputError(path, '必须为十二生肖（如 牛）或十二地支（如 丑）之一');
  return found[0];
}

/** 要避冲的地支，按十二地支顺序去重（生肖与地支可混写，同一支只算一次） */
function resolveClashBranches(values: string[] | undefined): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values) || !values.length) throw new CoreInputError('excludeClash', '至少给出一个生肖或地支');
  const branches = new Set(values.map((value, index) => resolveClashBranch(String(value), `excludeClash[${index}]`)));
  return Object.keys(ZHI_SHENG_XIAO).filter((branch) => branches.has(branch));
}

function civilDates(startDate: string, endDate: string): string[] {
  const start = parseCivilDate(startDate, 'startDate');
  const end = parseCivilDate(endDate, 'endDate');
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  if (endMs < startMs) throw new CoreInputError('endDate', '结束日期不能早于开始日期');
  const days = (endMs - startMs) / 86_400_000 + 1;
  if (days > ALMANAC_SELECT_MAX_DAYS) throw new CoreInputError('endDate', `区间最多 ${ALMANAC_SELECT_MAX_DAYS} 天，本次共 ${days} 天`);
  return Array.from({ length: days }, (_, index) => new Date(startMs + index * 86_400_000).toISOString().slice(0, 10));
}

/** 事项与条文互相包含即算命中，避免「开市」漏掉「开市交易」这类长条文 */
function matchesActivity(items: string[], activity: string): boolean {
  return items.some((item) => item.includes(activity) || activity.includes(item));
}

export async function calculateAlmanacSelection(input: AlmanacSelectInput): Promise<AlmanacSelectOutput> {
  const dates = civilDates(input.startDate, input.endDate);
  const activity = input.activity?.trim();
  if (input.activity !== undefined && !activity) throw new CoreInputError('activity', '事项不能为空');
  const clashBranches = resolveClashBranches(input.excludeClash);
  const timezone = input.timezone ?? DEFAULT_DIVINATION_TIMEZONE;

  const candidates: AlmanacSelectDayJSON[] = [];
  const excluded = { 犯忌: 0, 无对应宜: 0, 冲煞: 0 };
  for (const date of dates) {
    const day = await calculateDailyAlmanac({ date, timezone });
    const info = day.almanac;
    if (clashBranches.includes(ZHI_CHONG[day.dayInfo.branch])) {
      excluded.冲煞 += 1;
      continue;
    }
    if (activity) {
      if (matchesActivity(info.avoid, activity)) {
        excluded.犯忌 += 1;
        continue;
      }
      if (!matchesActivity(info.suitable, activity)) {
        excluded.无对应宜 += 1;
        continue;
      }
    }
    candidates.push({
      日期: date,
      日干支: day.dayInfo.ganZhi,
      农历: info.lunarDate || `${info.lunarMonth}${info.lunarDay}`,
      生肖: info.zodiac,
      建除: info.dayOfficer || '-',
      天神: `${info.tianShen || '-'}（${info.tianShenType || '-'}）`,
      天神吉凶: info.tianShenLuck || '-',
      星宿: info.lunarMansion || '-',
      星宿吉凶: info.lunarMansionLuck || '-',
      纳音: info.nayin || '-',
      冲煞: info.chongSha || '-',
      宜: [...info.suitable],
      忌: [...info.avoid],
    });
  }

  return {
    sections: {
      查询: {
        起止日期: `${dates[0]} 至 ${dates[dates.length - 1]}`,
        天数: dates.length,
        ...(activity ? { 事项: activity } : {}),
        ...(clashBranches.length ? { 排除冲煞: clashBranches.map((branch) => `${branch}${ZHI_SHENG_XIAO[branch]}（冲${ZHI_CHONG[branch]}）`) } : {}),
      },
      候选日: candidates,
      排除统计: { 候选数: candidates.length, ...excluded },
      口径: [...ALMANAC_SELECT_NOTES],
    },
    calculationOptions: { timezone, ruleVersion: ALMANAC_SELECT_RULE_VERSION },
  };
}
