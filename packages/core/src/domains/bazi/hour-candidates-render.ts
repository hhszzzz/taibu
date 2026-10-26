import { withRulesJSON } from '../../shared/calculation-rules.js';
import { drilldownText } from '../shared/drilldown-render.js';
import type { GanzhiRelationFact } from '../shared/ganzhi-relations.js';
import type { HiddenStemJSON } from '../shared/json-types.js';
import { ganzhiRelationRow, type GanzhiRelationRowJSON } from './relations-render.js';
import type { BaziHourCandidate, BaziHourCandidatesOutput } from './hour-candidates.js';

export interface BaziHourCandidateEventJSON {
  年份: number;
  流年: string;
  /** 这一年所在的大运（起运前为小运） */
  大运?: string;
  关系: GanzhiRelationRowJSON[];
  岁运提示: string[];
}

export interface BaziHourCandidateJSON {
  序号: number;
  时辰: string;
  钟表时间: { 开始: string; 结束: string; 结束不含: true; 分钟数: number; };
  真太阳时?: { 开始: string; 结束: string; };
  四柱: Array<{ 柱: string; 干支: string; }>;
  时柱: { 干支: string; 天干十神: string; 藏干: HiddenStemJSON[]; 地势: string; 纳音: string; 神煞: string[]; 空亡?: '是'; };
  时柱关系: GanzhiRelationRowJSON[];
  命宫: string;
  日主之根: string;
  月令透时干: string[];
  缺失五行: string[];
  起运: string;
  首步大运?: { 干支: string; 起运年份: number; 起运年龄: number; };
  排盘参数: { 出生时: number; 出生分: number; 夏令时策略?: 'earlier' | 'later'; };
  前事?: BaziHourCandidateEventJSON[];
}

export interface BaziHourCandidatesCanonicalJSON {
  出生日期: { 公历: string; 农历: string; 性别: string; 时区: string; 经度?: number; };
  共有柱: Array<{ 柱: string; 干支: string; }>;
  日主?: string;
  当天交节?: string;
  钟表时段?: string;
  候选数量: number;
  候选: BaziHourCandidateJSON[];
  前事年份?: Array<{ 年份: number; 流年: string; }>;
  口径: string[];
}

const HOUR_CANDIDATE_NOTES = [
  '逐分钟排出出生当天各时刻的四柱，四柱相同的连续时段合为一个候选时辰；钟表时间为出生地时区的时钟，开始含、结束不含',
  '子时分早晚：0 点为早子时，23 点为晚子时；午夜换日时晚子时日柱仍取当日、时干按次日起，23 点换日时晚子时日柱取次日',
  '给了经度时按真太阳时定日柱与时柱，各候选的钟表时段随之偏移，开头或末尾可能是前一日或次日的时辰',
  '当天交节时，交节前后的年柱或月柱不同，同一时辰分作两个候选',
  '排盘参数取时段中点：同一候选内四柱相同，只有起运时刻相差几天；钟表时间因夏令时出现两次时另给夏令时策略',
  '日主之根：时支藏干中与日主同五行者；月令透时干：月令藏干与时干同字',
  '前事只列区分候选的关系：涉及时柱以及各候选不同的年、月、日柱的关系；这一年各候选的大运不同时，也列涉及大运的关系。各候选共有的关系对每个时辰都一样，不列',
  '只列事实，不判断哪个时辰更可能',
];

const GENDER = { male: '男', female: '女' } as const;

/** 「月支丑·时支子」 */
function cells(fact: GanzhiRelationFact): string {
  return fact.participants.map((p) => `${p.label.replace(/柱$/u, '')}${p.part === '天干' ? '干' : '支'}${p.char}`).join('·');
}

const relationText = (fact: GanzhiRelationFact) => `${fact.description}（${cells(fact)}）`;

function rootText(candidate: BaziHourCandidate): string {
  const dayStem = candidate.pillars[2].ganZhi[0];
  return candidate.dayMasterRoot
    ? `日主${dayStem}通根于时支${candidate.branch}（藏${candidate.dayMasterRoot.hidden}·${candidate.dayMasterRoot.qiType}）`
    : `日主${dayStem}在时支${candidate.branch}无根`;
}

const firstLuckText = (first: NonNullable<BaziHourCandidate['luck']['first']>) => `${first.ganZhi}（${first.startYear}年起，${first.startAge}岁）`;

function termChangeText(result: BaziHourCandidatesOutput): string | undefined {
  const change = result.termChange;
  if (!change) return undefined;
  const at = change.beijingTime ? `北京时间 ${change.beijingTime}` : '';
  return `${change.name}交节${at ? `（${at}）` : ''}，钟表 ${change.localTime} 起为交节后`;
}

function candidateJSON(candidate: BaziHourCandidate, index: number, result: BaziHourCandidatesOutput): BaziHourCandidateJSON {
  const hour = candidate.hour;
  return {
    序号: index + 1,
    时辰: candidate.label,
    钟表时间: { 开始: candidate.clock.start, 结束: candidate.clock.end, 结束不含: true, 分钟数: candidate.clock.minutes },
    ...(candidate.trueSolar ? { 真太阳时: { 开始: candidate.trueSolar.start, 结束: candidate.trueSolar.end } } : {}),
    四柱: candidate.pillars.map((pillar) => ({ 柱: pillar.label, 干支: pillar.ganZhi })),
    时柱: {
      干支: `${hour.stem}${hour.branch}`,
      天干十神: hour.tenGod ?? '',
      藏干: hour.hiddenStems.map((item) => ({ 天干: item.stem, 十神: item.tenGod, 气性: item.qiType })),
      地势: hour.diShi ?? '',
      纳音: hour.naYin ?? '',
      神煞: [...hour.shenSha],
      ...(hour.kongWang.isKong ? { 空亡: '是' as const } : {}),
    },
    时柱关系: candidate.relations.map(ganzhiRelationRow),
    命宫: candidate.mingGong,
    日主之根: rootText(candidate),
    月令透时干: [...candidate.monthRevealed],
    缺失五行: [...candidate.missingElements],
    起运: candidate.luck.detail,
    ...(candidate.luck.first ? { 首步大运: { 干支: candidate.luck.first.ganZhi, 起运年份: candidate.luck.first.startYear, 起运年龄: candidate.luck.first.startAge } } : {}),
    排盘参数: { 出生时: candidate.birthHour, 出生分: candidate.birthMinute, ...(candidate.disambiguation ? { 夏令时策略: candidate.disambiguation } : {}) },
    ...(candidate.events ? {
      前事: candidate.events.map((event, eventIndex) => ({
        年份: event.year,
        流年: result.events?.[eventIndex]?.ganZhi ?? '',
        ...(event.fortune ? { 大运: `${event.fortune.ganZhi}（${event.fortune.label}）` } : {}),
        关系: event.relations.map(ganzhiRelationRow),
        岁运提示: [...event.hints],
      })),
    } : {}),
  };
}

function renderJSONBase(result: BaziHourCandidatesOutput): BaziHourCandidatesCanonicalJSON {
  const longitude = result.calculationOptions.longitude;
  const termChange = termChangeText(result);
  return {
    出生日期: {
      公历: result.date.solar,
      农历: result.date.lunar,
      性别: GENDER[result.gender],
      时区: String(result.calculationOptions.timezone),
      ...(typeof longitude === 'number' ? { 经度: longitude } : {}),
    },
    共有柱: result.shared.map((pillar) => ({ 柱: pillar.label, 干支: pillar.ganZhi })),
    ...(result.dayMaster ? { 日主: `${result.dayMaster.stem}${result.dayMaster.element}` } : {}),
    ...(termChange ? { 当天交节: termChange } : {}),
    ...(result.window ? { 钟表时段: `${String(result.window.fromHour).padStart(2, '0')}:00–${String(result.window.toHour).padStart(2, '0')}:00` } : {}),
    候选数量: result.candidates.length,
    候选: result.candidates.map((candidate, index) => candidateJSON(candidate, index, result)),
    ...(result.events ? { 前事年份: result.events.map((event) => ({ 年份: event.year, 流年: event.ganZhi })) } : {}),
    口径: HOUR_CANDIDATE_NOTES,
  };
}

/** 文本里的时刻：与出生日期同日时只写钟点，次日 0 点写作 24:00，其余写全日期 */
function timeText(value: string, solarDate: string): string {
  const [date, time] = value.split(' ');
  if (date === solarDate) return time;
  return time === '00:00' && date > solarDate ? '24:00' : value;
}

function eventLine(candidate: BaziHourCandidate, result: BaziHourCandidatesOutput): string[] {
  return (candidate.events ?? []).map((event, index) => {
    const fortune = event.fortune ? `，${event.fortune.label}${event.fortune.ganZhi}` : '';
    const facts = [...event.relations.map(relationText), ...event.hints];
    return `- 前事 ${event.year}（流年${result.events?.[index]?.ganZhi ?? ''}${fortune}）：${facts.length ? facts.join('；') : '没有区分候选的关系'}`;
  });
}

function renderTextBase(result: BaziHourCandidatesOutput, full: boolean): string {
  const lines = ['# 推算出生时辰', ''];
  lines.push(`- 出生日期：公历 ${result.date.solar}（农历${result.date.lunar}），${GENDER[result.gender]}`);
  if (result.shared.length) {
    lines.push(`- 各候选共有：${result.shared.map((pillar) => `${pillar.label}${pillar.ganZhi}`).join('、')}${result.dayMaster ? `（日主${result.dayMaster.stem}${result.dayMaster.element}）` : ''}`);
  }
  const termChange = termChangeText(result);
  if (termChange) lines.push(`- 当天交节：${termChange}`);
  const window = result.window ? `与钟表 ${String(result.window.fromHour).padStart(2, '0')}:00–${String(result.window.toHour).padStart(2, '0')}:00 相交的` : '';
  lines.push(`- ${window}候选 ${result.candidates.length} 个；钟表时间为 ${result.calculationOptions.timezone}，开始含、结束不含`);
  if (result.events) lines.push(`- 前事年份：${result.events.map((event) => `${event.year} ${event.ganZhi}`).join('、')}`);

  for (const candidate of result.candidates) {
    const hour = candidate.hour;
    const range = `${timeText(candidate.clock.start, result.date.solar)}–${timeText(candidate.clock.end, result.date.solar)}`;
    const trueSolar = candidate.trueSolar ? `（真太阳时 ${timeText(candidate.trueSolar.start, result.date.solar)}–${timeText(candidate.trueSolar.end, result.date.solar)}）` : '';
    const hidden = hour.hiddenStems.map((item) => `${item.stem}（${item.tenGod}·${item.qiType}）`).join(' ');
    lines.push('', `## ${candidate.label} ${range}${trueSolar}`, '');
    lines.push(`- 四柱：${candidate.pillars.map((pillar) => pillar.ganZhi).join(' ')}`);
    lines.push(`- 时柱${hour.stem}${hour.branch}：天干${hour.tenGod || '-'}；藏干${hidden}；日主坐${hour.diShi || '-'}；纳音${hour.naYin || '-'}${hour.kongWang.isKong ? '；空亡' : ''}${full && hour.shenSha.length ? `；神煞${hour.shenSha.join('、')}` : ''}`);
    lines.push(`- 时柱关系：${candidate.relations.length ? candidate.relations.map(relationText).join('；') : '无'}`);
    lines.push(`- 命宫${candidate.mingGong || '-'}；${rootText(candidate)}；月令透时干：${candidate.monthRevealed.join('、') || '无'}；缺失五行：${candidate.missingElements.join('、') || '无'}`);
    lines.push(`- 起运：${candidate.luck.detail}${candidate.luck.first ? `；首步大运${firstLuckText(candidate.luck.first)}` : ''}`);
    lines.push(`- 排盘：birthHour ${candidate.birthHour}，birthMinute ${candidate.birthMinute}${candidate.disambiguation ? `，disambiguation ${candidate.disambiguation}` : ''}`);
    lines.push(...eventLine(candidate, result));
  }
  return lines.join('\n');
}

export const toBaziHourCandidatesJson = withRulesJSON(renderJSONBase);
export const toBaziHourCandidatesText = drilldownText(HOUR_CANDIDATE_NOTES, renderTextBase);
