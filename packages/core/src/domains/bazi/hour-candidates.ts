/**
 * 推算出生时辰：出生时辰未知时，逐分钟排出出生当天各时刻的四柱，四柱相同的连续时段合为一个候选时辰，
 * 逐个列出区分各候选的事实——时柱的十神、藏干、地势与纳音，时柱参与的原局干支关系，命宫，日主在时支的根，
 * 月令藏干透时干，缺失五行与起运；给了前事年份时，再列这些年的流年、大运与各候选不同柱位的关系。
 * 只陈述事实，不判断哪个时辰更可能：由用户核对六亲与前事后确认，确认后用该候选的排盘参数正式排盘。
 */

import { Solar } from 'lunar-javascript';
import { STEM_ELEMENTS } from '../../shared/utils.js';
import { DEFAULT_DIVINATION_TIMEZONE, getTimeZoneOffsetMinutes, getZonedDateTimeParts, zonedTimeToUtc } from '../../shared/timezone-utils.js';
import { CoreInputError, assertInteger } from '../../shared/validation.js';
import { calculateDayunData, getYearGanZhi } from '../bazi-dayun/calculate.js';
import { analyzeGanzhiRelations, type GanzhiRelationFact } from '../shared/ganzhi-relations.js';
import { baziPillarEntries, calculateBaziData, resolveBaziCalendarContext, resolveBaziGanZhi } from './calculate.js';
import { deriveBaziRelations } from './relations.js';
import { deriveBaziWuxing } from './wuxing.js';
import type { BaziInput, PillarInfo } from './types.js';

export const BAZI_HOUR_CANDIDATES_RULE_VERSION = 'bazi-hour-candidates-2026.10';
/** 一次最多核对的前事年份 */
export const BAZI_HOUR_EVENT_YEARS_MAX = 8;

/** 出生日期与排盘口径同 bazi，但不给出生时间：时辰正是要推的 */
export interface BaziHourCandidatesInput extends Omit<BaziInput, 'birthHour' | 'birthMinute' | 'disambiguation'> {
  /** 只列与钟表时段 [fromHour:00, toHour:00) 相交的候选；用户记得大致时段时用，默认全天 */
  fromHour?: number;
  toHour?: number;
  /** 前事年份（公历）：逐个候选列出这些年的流年、大运与候选之间不同柱位的关系 */
  eventYears?: number[];
}

export interface BaziHourCandidateEvent {
  year: number;
  /** 这一年所在的大运，起运前为小运 */
  fortune?: { layer: '大运' | '小运'; ganZhi: string; label: string; };
  /** 涉及本候选与其他候选不同之柱的关系（总含时柱）；这一年各候选的大运不同时，也含涉及大运的关系 */
  relations: GanzhiRelationFact[];
  hints: string[];
}

export interface BaziHourCandidate {
  /** 早子时、丑时……晚子时；同一时辰被交节或日界分成两段时注明是哪一段 */
  label: string;
  branch: string;
  /** 出生地钟表时间，开始含、结束不含 */
  clock: { start: string; end: string; minutes: number; };
  /** 给了经度时，这段钟表时间对应的真太阳时 */
  trueSolar?: { start: string; end: string; };
  /** 确认后正式排盘用的时刻（时段中点）；钟表时间因夏令时重复时另给 disambiguation */
  birthHour: number;
  birthMinute: number;
  disambiguation?: 'earlier' | 'later';
  pillars: Array<{ label: string; ganZhi: string; }>;
  hour: PillarInfo;
  /** 时柱参与的原局干支关系 */
  relations: GanzhiRelationFact[];
  mingGong: string;
  /** 日主在时支的根：时支藏干中与日主同五行者；没有即无根 */
  dayMasterRoot?: { hidden: string; qiType: string; };
  /** 透于时干的月令藏干 */
  monthRevealed: string[];
  missingElements: string[];
  luck: { detail: string; first?: { ganZhi: string; startYear: number; startAge: number; }; };
  events?: BaziHourCandidateEvent[];
}

export interface BaziHourCandidatesOutput {
  gender: BaziInput['gender'];
  date: { solar: string; lunar: string; };
  /** 所列候选共有的柱；日柱共有时附日主 */
  shared: Array<{ label: string; ganZhi: string; }>;
  dayMaster?: { stem: string; element: string; };
  /** 出生当天交节：交节前后的候选年柱或月柱不同 */
  termChange?: { name: string; beijingTime: string; localTime: string; };
  window?: { fromHour: number; toHour: number; };
  candidates: BaziHourCandidate[];
  events?: Array<{ year: number; ganZhi: string; }>;
  calculationOptions: Record<string, unknown> & { ruleVersion: string; };
}

type Clock = { year: number; month: number; day: number; hour: number; minute: number; };

/** 逐分钟取样：这一刻的钟表时间与四柱 */
interface Sample {
  instant: number;
  clock: Clock;
  /** 钟表时间因夏令时出现两次时，这一刻是哪一次 */
  disambiguation?: 'earlier' | 'later';
  pillars: [string, string, string, string];
  /** 定日柱、时柱用的时间：给了经度时为真太阳时 */
  effective: Clock;
}

const PILLAR_LABELS = ['年柱', '月柱', '日柱', '时柱'] as const;
const pad = (value: number, width = 2) => String(value).padStart(width, '0');
const civil = (clock: Clock) => `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)} ${pad(clock.hour)}:${pad(clock.minute)}`;
const solarClock = (solar: Solar): Clock => ({ year: solar.getYear(), month: solar.getMonth(), day: solar.getDay(), hour: solar.getHour(), minute: solar.getMinute() });

function validate(input: BaziHourCandidatesInput): void {
  for (const key of ['birthHour', 'birthMinute']) {
    if ((input as unknown as Record<string, unknown>)[key] !== undefined) {
      throw new CoreInputError(key, '推算出生时辰时不给出生时间；记得大致时段时用 fromHour、toHour');
    }
  }
  if (input.fromHour !== undefined) assertInteger(input.fromHour, 'fromHour', 0, 23);
  if (input.toHour !== undefined) assertInteger(input.toHour, 'toHour', 1, 24);
  if ((input.fromHour ?? 0) >= (input.toHour ?? 24)) throw new CoreInputError('toHour', '须晚于 fromHour');
  if (input.eventYears === undefined) return;
  if (!Array.isArray(input.eventYears) || input.eventYears.length < 1 || input.eventYears.length > BAZI_HOUR_EVENT_YEARS_MAX) {
    throw new CoreInputError('eventYears', `须为 1–${BAZI_HOUR_EVENT_YEARS_MAX} 个年份`);
  }
  input.eventYears.forEach((year, index) => assertInteger(year, `eventYears.${index}`, 1, 9998));
  if (new Set(input.eventYears).size !== input.eventYears.length) throw new CoreInputError('eventYears', '年份不能重复');
}

/** 子时分早晚：定时柱的时间在 0 点为早子时，23 点为晚子时；23 点换日时两者相连则不分 */
function hourLabel(branch: string, samples: readonly Sample[]): string {
  if (branch !== '子') return `${branch}时`;
  const hours = new Set(samples.map((sample) => sample.effective.hour));
  return hours.size > 1 ? '子时' : hours.has(23) ? '晚子时' : '早子时';
}

/** 时段中点；中点的钟表时间因夏令时重复时，改取段内最近的不重复时刻（没有再给 disambiguation） */
function representative(samples: readonly Sample[]): Sample {
  const middle = Math.floor(samples.length / 2);
  if (!samples[middle].disambiguation) return samples[middle];
  const plain = samples.filter((sample) => !sample.disambiguation);
  return plain.length ? plain.reduce((best, sample) => (Math.abs(sample.instant - samples[middle].instant) < Math.abs(best.instant - samples[middle].instant) ? sample : best)) : samples[middle];
}

export function calculateBaziHourCandidates(input: BaziHourCandidatesInput): BaziHourCandidatesOutput {
  validate(input);
  const { fromHour, toHour, eventYears, ...birth } = input;
  // 出生当天的公历日期：按当天 00:00 校验出生信息、换算农历（日期本身不做真太阳时校正）
  const calendar = resolveBaziCalendarContext({ ...birth, birthHour: 0, birthMinute: 0, disambiguation: 'compatible', longitude: undefined });
  const date = { year: calendar.solar.getYear(), month: calendar.solar.getMonth(), day: calendar.solar.getDay() };
  const events = eventYears?.map((year) => {
    if (year < date.year) throw new CoreInputError('eventYears', `前事年份不能早于出生年 ${date.year}`);
    return { year, ganZhi: getYearGanZhi(year) };
  });
  const timezone = birth.timezone ?? DEFAULT_DIVINATION_TIMEZONE;
  // 逐分钟按公历排：农历生日已换成当天的公历日期，两者排出的盘相同
  const base: BaziInput = { ...birth, calendarType: 'solar', isLeapMonth: false, birthYear: date.year, birthMonth: date.month, birthDay: date.day };
  const next = Solar.fromYmd(date.year, date.month, date.day).next(1);
  const start = zonedTimeToUtc({ ...date, hour: 0, minute: 0 }, timezone, 'compatible').getTime();
  const end = zonedTimeToUtc({ year: next.getYear(), month: next.getMonth(), day: next.getDay(), hour: 0, minute: 0 }, timezone, 'compatible').getTime();
  // 当天有夏令时切换时，才需要逐分钟核对钟表时间是否出现两次
  const shifts = getTimeZoneOffsetMinutes(timezone, new Date(start)) !== getTimeZoneOffsetMinutes(timezone, new Date(end - 60000));

  const sampleAt = (instant: number): Sample => {
    const parts = getZonedDateTimeParts(new Date(instant), timezone);
    const clock = { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
    let disambiguation: Sample['disambiguation'];
    if (shifts) {
      const earlier = zonedTimeToUtc(clock, timezone, 'earlier').getTime();
      if (earlier !== zonedTimeToUtc(clock, timezone, 'later').getTime()) disambiguation = instant === earlier ? 'earlier' : 'later';
    }
    const context = resolveBaziCalendarContext({ ...base, birthYear: clock.year, birthMonth: clock.month, birthDay: clock.day, birthHour: clock.hour, birthMinute: clock.minute, disambiguation: disambiguation ?? 'reject' });
    const g = resolveBaziGanZhi(context, base.dayBoundary);
    return {
      instant, clock, ...(disambiguation ? { disambiguation } : {}),
      pillars: [`${g.yearStem}${g.yearBranch}`, `${g.monthStem}${g.monthBranch}`, `${g.dayStem}${g.dayBranch}`, `${g.hourStem}${g.hourBranch}`],
      effective: solarClock(context.solar),
    };
  };

  // 四柱相同的连续时刻合为一段
  const groups: Sample[][] = [];
  for (let instant = start; instant < end; instant += 60000) {
    const sample = sampleAt(instant);
    const last = groups.at(-1);
    if (last && last[0].pillars.join() === sample.pillars.join()) last.push(sample);
    else groups.push([sample]);
  }
  const dayEnd = sampleAt(end);
  const inWindow = (sample: Sample) => sample.clock.hour >= (fromHour ?? 0) && sample.clock.hour < (toHour ?? 24);
  const listed = groups.map((samples, index) => ({ samples, after: groups[index + 1]?.[0] ?? dayEnd }))
    .filter(({ samples }) => samples.some(inWindow));

  // 交节：相邻两段的年柱或月柱不同；交节时刻取历法库的节气时刻（北京时间）
  let termChange: BaziHourCandidatesOutput['termChange'];
  for (let index = 1; index < groups.length; index++) {
    const [before, after] = [groups[index - 1][0], groups[index][0]];
    if (before.pillars[1] === after.pillars[1]) continue;
    const context = resolveBaziCalendarContext({ ...base, birthHour: after.clock.hour, birthMinute: after.clock.minute, disambiguation: after.disambiguation ?? 'reject' });
    const jie = context.termLunar.getPrevJie();
    termChange = { name: jie?.getName() ?? '交节', beijingTime: jie ? jie.getSolar().toYmdHms().slice(0, 16) : '', localTime: civil(after.clock) };
  }

  const charts = listed.map(({ samples, after }) => {
    const chosen = representative(samples);
    const candidateInput: BaziInput = { ...base, birthHour: chosen.clock.hour, birthMinute: chosen.clock.minute, ...(chosen.disambiguation ? { disambiguation: chosen.disambiguation } : {}) };
    return { samples, after, chosen, candidateInput, chart: calculateBaziData(candidateInput), dayun: calculateDayunData(candidateInput) };
  });
  const sharedIndices = [0, 1, 2].filter((index) => charts.every(({ samples }) => samples[0].pillars[index] === charts[0].samples[0].pillars[index]));
  const distinct = new Set(PILLAR_LABELS.filter((_, index) => !sharedIndices.includes(index)));

  // 同名时辰（被交节或日界分成两段）注明是哪一段
  const labels = charts.map(({ samples }) => hourLabel(samples[0].pillars[3][1], samples));
  const named = labels.map((label, index) => {
    const twin = labels.findIndex((other, i) => i !== index && other === label);
    if (twin < 0) return label;
    const [mine, theirs] = [charts[index].samples[0].pillars, charts[twin].samples[0].pillars];
    if (mine[1] !== theirs[1] && termChange) return `${label}（${termChange.name}${index < twin ? '前' : '后'}）`;
    return `${label}（日柱${mine[2]}）`;
  });

  // 各候选每个前事年份的岁运关系；大运是否因时辰而不同，要看齐全部候选才知道
  const yearly = charts.map(({ chart, candidateInput, dayun }) => (events ?? []).map(({ year }) => deriveBaziRelations(chart, { year }, candidateInput, dayun)));
  const fortuneOf = (result: ReturnType<typeof deriveBaziRelations>) => result.pillars.find((pillar) => pillar.layer === '大运' || pillar.layer === '小运');

  const candidates = charts.map(({ samples, after, chosen, chart, dayun }, index): BaziHourCandidate => {
    const hour = chart.fourPillars.hour!;
    const pillars = baziPillarEntries(chart);
    const relations = analyzeGanzhiRelations(pillars.map(({ label, pillar }) => ({ label, layer: '原局' as const, stem: pillar.stem, branch: pillar.branch })))
      .filter((fact) => fact.participants.some((p) => p.label === '时柱'));
    const wuxing = deriveBaziWuxing(chart, { sections: ['通根'] });
    const root = wuxing.stemRoots?.[0]?.roots.find((fact) => fact.cells[1].pillar === '时柱');
    const first = dayun.list[0];
    const candidateEvents = events?.map(({ year }, yearIndex): BaziHourCandidateEvent => {
      const result = yearly[index][yearIndex];
      const fortune = fortuneOf(result);
      // 这一年各候选的大运不同（交运年份随时辰变化、交节前后大运不同）时，涉及大运的关系也是区分事实
      const fortuneDiffers = new Set(yearly.map((results) => {
        const other = fortuneOf(results[yearIndex]);
        return other ? `${other.label}${other.stem}${other.branch}` : '';
      })).size > 1;
      const own = (labels: readonly string[]) => labels.some((label) => distinct.has(label as typeof PILLAR_LABELS[number]) || (fortuneDiffers && label === fortune?.label));
      return {
        year,
        ...(fortune ? {
          fortune: {
            layer: fortune.layer as '大运' | '小运',
            ganZhi: `${fortune.stem}${fortune.branch}`,
            label: result.query.dayun ? `第${result.query.dayun.index}步大运` : `小运（虚岁${result.query.xiaoYun?.age}）`,
          },
        } : {}),
        relations: result.overlayRelations.filter((fact) => own(fact.participants.map((p) => p.label))),
        hints: result.fortuneHints.filter((hint) => own(hint.labels)).map((hint) => hint.description),
      };
    });
    return {
      label: named[index],
      branch: hour.branch,
      clock: { start: civil(samples[0].clock), end: civil(after.clock), minutes: samples.length },
      ...(base.longitude === undefined ? {} : { trueSolar: { start: civil(samples[0].effective), end: civil(after.effective) } }),
      birthHour: chosen.clock.hour,
      birthMinute: chosen.clock.minute,
      ...(chosen.disambiguation ? { disambiguation: chosen.disambiguation } : {}),
      pillars: pillars.map(({ label, pillar }) => ({ label, ganZhi: `${pillar.stem}${pillar.branch}` })),
      hour,
      relations,
      mingGong: chart.mingGong ?? '',
      ...(root ? { dayMasterRoot: { hidden: root.hidden, qiType: root.result } } : {}),
      monthRevealed: wuxing.monthCommand.hiddenStems.filter((hidden) => hidden.revealedIn.includes('时干')).map((hidden) => hidden.stem),
      missingElements: wuxing.missingElements,
      luck: { detail: dayun.startAgeDetail, ...(first ? { first: { ganZhi: first.ganZhi, startYear: first.startYear, startAge: first.startAge } } : {}) },
      ...(candidateEvents ? { events: candidateEvents } : {}),
    };
  });

  const shared = sharedIndices.map((index) => ({ label: PILLAR_LABELS[index], ganZhi: charts[0].samples[0].pillars[index] }));
  const dayStem = sharedIndices.includes(2) ? charts[0].samples[0].pillars[2][0] : undefined;
  return {
    gender: base.gender,
    date: { solar: `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`, lunar: `${calendar.lunar.getYearInChinese()}年${calendar.lunar.getMonthInChinese()}月${calendar.lunar.getDayInChinese()}` },
    shared,
    ...(dayStem ? { dayMaster: { stem: dayStem, element: STEM_ELEMENTS[dayStem] } } : {}),
    ...(termChange ? { termChange } : {}),
    ...(fromHour !== undefined || toHour !== undefined ? { window: { fromHour: fromHour ?? 0, toHour: toHour ?? 24 } } : {}),
    candidates,
    ...(events ? { events } : {}),
    calculationOptions: {
      timezone,
      dayBoundary: base.dayBoundary ?? 'midnight',
      solarTermBasis: 'instant',
      ...(base.longitude === undefined ? {} : { longitude: base.longitude }),
      ruleVersion: BAZI_HOUR_CANDIDATES_RULE_VERSION,
    },
  };
}
