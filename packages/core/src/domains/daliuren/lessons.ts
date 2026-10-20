/**
 * 大六壬课传详查：逐课列上下神生克、天将与神将交战、遁干、六亲；逐传列与日干关系、
 * 旺衰、空亡与递生递克；另给日干寄宫、本命行年上神与类神（地支或天将）落处。
 * 只读起课结果，不另取三传、不断吉凶。
 */

import { CoreInputError, resolveEnum } from '../../shared/validation.js';
import { DALIUREN_LESSON_LABELS, DALIUREN_TRANSMISSION_LABELS } from './json.js';
import {
  DI_ZHI, GAN_WUXING, TIAN_JIANG_SHORT, TIAN_JIANG_WUXING, ZHI_WUXING, getWangShuai, keRelation, shengRelation,
} from './supplements.js';
import type { DaliurenInput, DaliurenOutput } from './types.js';

export const DALIUREN_LESSONS_RULE_VERSION = 'daliuren-lessons-2026.10';
/** 全部=四课三传与本命行年；课 / 传只列其一；类神只列类神的落处与入课入传 */
export const DALIUREN_FOCUS = ['全部', '课', '传', '类神'] as const;
export const DALIUREN_GENERALS = Object.keys(TIAN_JIANG_SHORT);
/** 盘面写作「腾蛇」，也接受常见写法「螣蛇」 */
const TIAN_JIANG_ALIASES: Record<string, string> = { 螣蛇: '腾蛇' };

export interface DaliurenLessonsSelector {
  /** 省略时：给了类神取「类神」，否则取「全部」 */
  focus?: typeof DALIUREN_FOCUS[number];
  /** 类神：一个地支或天将名，定位其天盘落处与入课入传 */
  leiShen?: string;
}

/** 盘面位置，字段与规范 JSON 同名：课别 / 传序 / 地盘（可带部位） */
export type DaliurenPositionJSON =
  | { 课别: string }
  | { 传序: string }
  | { 地盘: string; 部位?: '天盘' | '地盘' | '天将' };

export interface DaliurenFactRowJSON {
  类型: string;
  位置: DaliurenPositionJSON[];
  结果?: string;
  说明: string;
}

export interface DaliurenLessonRowJSON {
  课别: string; 上神: string; 下神: string; 上下: string;
  天将: string; 神将: string; 遁干: string; 六亲: string;
  位置: DaliurenPositionJSON[];
}

export interface DaliurenTransmissionRowJSON {
  传序: string; 地支: string; 五行: string; 天将: string; 神将: string;
  遁干: string; 六亲: string; 与日干: string; 旺衰: string; 空亡: string;
  位置: DaliurenPositionJSON[];
}

export interface DaliurenLessonsSections {
  查询: { 范围: string; 类神?: string };
  基础: { 日干: string; 日干寄宫: string; 日支: string; 月建: string; 旬: string; 空亡: string[]; 课式: string };
  四课?: DaliurenLessonRowJSON[];
  三传?: DaliurenTransmissionRowJSON[];
  三传递进?: { 初传至中传: string; 中传至末传: string; 递进: string };
  /** 所列课传中的神将交战；与各行「神将」同源，只列不看课传时省略 */
  神将交战?: string[];
  本命行年?: DaliurenFactRowJSON[];
  类神?: DaliurenFactRowJSON[];
}

export interface DaliurenLessonsOutput {
  sections: DaliurenLessonsSections;
  calculationOptions: Record<string, unknown> & { ruleVersion: string };
}

const elementOf = (char: string) => ZHI_WUXING[char] ?? GAN_WUXING[char] ?? '';

/** 六亲以日干为我：生我父母、我生子孙、克我官鬼、我克妻财、同我兄弟 */
function liuQin(dayElement: string, element: string): string {
  if (!dayElement || !element) return '-';
  if (element === dayElement) return '兄弟';
  if (shengRelation(element, dayElement)) return '父母';
  if (shengRelation(dayElement, element)) return '子孙';
  if (keRelation(element, dayElement)) return '官鬼';
  return '妻财';
}

/** 课内上下：下克上为贼，上克下为克 */
function upperLower(upper: string, lower: string): string {
  const a = elementOf(upper), b = elementOf(lower);
  if (!a || !b) return '-';
  if (a === b) return '比和';
  if (keRelation(b, a)) return '下贼上';
  if (keRelation(a, b)) return '上克下';
  return shengRelation(a, b) ? '上生下' : '下生上';
}

/** 神将：神克将为内战，将克神为外战（《六壬大全》卷十曲直条「亥加卯作雀……雀内战也」） */
function spiritGeneral(spirit: string, general: string): string {
  const a = elementOf(spirit), b = TIAN_JIANG_WUXING[general] ?? '';
  if (!a || !b) return '-';
  if (a === b) return '比和';
  if (keRelation(a, b)) return '神克将（内战）';
  if (keRelation(b, a)) return '将克神（外战）';
  return shengRelation(a, b) ? '神生将' : '将生神';
}

function flow(from: string, to: string): string {
  const a = elementOf(from), b = elementOf(to);
  if (!a || !b) return '-';
  if (a === b) return `${from}${a}与${to}${b}比和`;
  if (shengRelation(a, b)) return `${from}${a}生${to}${b}`;
  if (keRelation(a, b)) return `${from}${a}克${to}${b}`;
  return shengRelation(b, a) ? `${to}${b}生${from}${a}` : `${to}${b}克${from}${a}`;
}

function toDay(branch: string, dayStem: string): string {
  const a = elementOf(branch), b = GAN_WUXING[dayStem] ?? '';
  if (!a || !b) return '-';
  if (a === b) return '比和';
  if (shengRelation(a, b)) return '生日干';
  if (keRelation(a, b)) return '克日干';
  return shengRelation(b, a) ? '日干生' : '日干克';
}

export function deriveDaliurenLessons(chart: DaliurenOutput, selector: DaliurenLessonsSelector, _baseInput: DaliurenInput): DaliurenLessonsOutput {
  const typed = selector.leiShen?.trim();
  const leiShen = typed ? TIAN_JIANG_ALIASES[typed] ?? typed : undefined;
  if (leiShen !== undefined && !(DI_ZHI as readonly string[]).includes(leiShen) && !DALIUREN_GENERALS.includes(leiShen)) {
    throw new CoreInputError('leiShen', '类神须为十二地支或十二天将之一');
  }
  const focus = resolveEnum(selector.focus, DALIUREN_FOCUS, leiShen ? '类神' : '全部', 'focus');
  if (focus === '类神' && !leiShen) throw new CoreInputError('leiShen', 'focus 为「类神」时须给出 leiShen（十二地支或十二天将，如 卯、贵人）');
  const showLessons = focus === '全部' || focus === '课';
  const showTransmissions = focus === '全部' || focus === '传';

  const dayStem = chart.dateInfo.ganZhi.day.charAt(0);
  const dayBranch = chart.dateInfo.ganZhi.day.charAt(1);
  const monthBranch = chart.dateInfo.ganZhi.month.charAt(1);
  const dayElement = GAN_WUXING[dayStem] ?? '';
  const kong = chart.dateInfo.kongWang.filter(Boolean);
  const tianPanOn = (earth: string) => chart.gongInfos.find(gong => gong.diZhi === earth);
  const seatOf = (heaven: string) => chart.gongInfos.find(gong => gong.tianZhi === heaven);
  const dunGanOf = (branch: string) => chart.dunGan[branch] || '-';
  const generalOf = (heaven: string) => seatOf(heaven)?.tianJiang ?? '';

  const lessons = [chart.siKe.yiKe, chart.siKe.erKe, chart.siKe.sanKe, chart.siKe.siKe].map((lesson, index) => {
    const pair = lesson[0] ?? '';
    const upper = pair.charAt(0), lower = pair.charAt(1);
    const general = lesson[1] || generalOf(upper);
    const seat = seatOf(upper);
    const row: DaliurenLessonRowJSON = {
      课别: DALIUREN_LESSON_LABELS[index], 上神: upper || '-', 下神: lower || '-', 上下: upperLower(upper, lower),
      天将: general || '-', 神将: spiritGeneral(upper, general), 遁干: dunGanOf(upper), 六亲: liuQin(dayElement, elementOf(upper)),
      位置: [{ 课别: DALIUREN_LESSON_LABELS[index] }, ...(seat ? [{ 地盘: seat.diZhi, 部位: '天盘' as const }] : [])],
    };
    return row;
  });

  const transmissions = [chart.sanChuan.chu, chart.sanChuan.zhong, chart.sanChuan.mo].map((step, index) => {
    const branch = step[0] ?? '';
    const general = step[1] || generalOf(branch);
    const seat = seatOf(branch);
    const row: DaliurenTransmissionRowJSON = {
      传序: DALIUREN_TRANSMISSION_LABELS[index], 地支: branch || '-', 五行: elementOf(branch) || '-', 天将: general || '-',
      神将: spiritGeneral(branch, general), 遁干: step[3] || dunGanOf(branch), 六亲: liuQin(dayElement, elementOf(branch)),
      与日干: toDay(branch, dayStem), 旺衰: elementOf(branch) ? getWangShuai(monthBranch, elementOf(branch)) : '-',
      空亡: kong.includes(branch) ? '旬空' : '否',
      位置: [{ 传序: DALIUREN_TRANSMISSION_LABELS[index] }, ...(seat ? [{ 地盘: seat.diZhi, 部位: '天盘' as const }] : [])],
    };
    return row;
  });

  const [chu, zhong, mo] = transmissions.map(row => row.地支);
  const forward = (kind: (a: string, b: string) => boolean) => kind(elementOf(chu), elementOf(zhong)) && kind(elementOf(zhong), elementOf(mo));
  const progression = forward(shengRelation) ? '递生（初生中、中生末）' : forward(keRelation) ? '递克（初克中、中克末）' : '无';

  // 日干寄宫：一课上神所临的地盘支
  const lodging = seatOf(lessons[0].上神)?.diZhi ?? '-';
  const sections: DaliurenLessonsSections = {
    查询: { 范围: focus, ...(leiShen ? { 类神: leiShen } : {}) },
    基础: {
      日干: dayStem, 日干寄宫: lodging, 日支: dayBranch, 月建: monthBranch, 旬: chart.dateInfo.xun, 空亡: kong,
      课式: `${chart.keName} / ${chart.keTi.method}课`,
    },
    ...(showLessons ? { 四课: lessons } : {}),
    ...(showTransmissions ? { 三传: transmissions, 三传递进: { 初传至中传: flow(chu, zhong), 中传至末传: flow(zhong, mo), 递进: progression } } : {}),
    ...(showLessons || showTransmissions ? {
      神将交战: [
        ...(showLessons ? lessons.map(row => [row.课别, row.上神, row.天将, row.神将] as const) : []),
        ...(showTransmissions ? transmissions.map(row => [row.传序, row.地支, row.天将, row.神将] as const) : []),
      ].filter(([, , , relation]) => relation.includes('战')).map(([label, spirit, general, relation]) => `${label.split(' ')[0]} ${spirit}乘${general}：${relation}`),
    } : {}),
  };

  const destiny: DaliurenFactRowJSON[] = [];
  for (const [type, ganZhi] of [['本命', chart.benMing], ['行年', chart.xingNian]] as const) {
    if (!ganZhi) continue;
    const earth = ganZhi.charAt(1);
    const gong = tianPanOn(earth);
    if (!gong) continue;
    destiny.push({ 类型: `${type}上神`, 位置: [{ 地盘: earth, 部位: '天盘' }], 结果: gong.tianZhi,
      说明: `${type}${ganZhi}，${earth}上见${gong.tianZhi}，乘${gong.tianJiang}，${liuQin(dayElement, elementOf(gong.tianZhi))}` });
  }
  if (focus === '全部' && destiny.length) sections.本命行年 = destiny;

  if (leiShen) {
    const gong = DALIUREN_GENERALS.includes(leiShen) ? chart.gongInfos.find(item => item.tianJiang === leiShen) : seatOf(leiShen);
    const rows: DaliurenFactRowJSON[] = [];
    if (gong) {
      const spirit = gong.tianZhi;
      rows.push({ 类型: '天盘落处', 位置: [{ 地盘: gong.diZhi, 部位: DALIUREN_GENERALS.includes(leiShen) ? '天将' : '天盘' }], 结果: gong.diZhi,
        说明: `${spirit}临${gong.diZhi}上，乘${gong.tianJiang}，遁干${dunGanOf(spirit)}，${liuQin(dayElement, elementOf(spirit))}${kong.includes(spirit) ? '，旬空' : ''}` });
      lessons.forEach(row => {
        if (row.上神 === spirit) rows.push({ 类型: '入课', 位置: [{ 课别: row.课别 }], 结果: row.课别.split(' ')[0], 说明: `${spirit}为${row.课别}上神` });
      });
      transmissions.forEach(row => {
        if (row.地支 === spirit) rows.push({ 类型: '入传', 位置: [{ 传序: row.传序 }], 结果: row.传序.split(' ')[0], 说明: `${spirit}为${row.传序}` });
      });
    }
    sections.类神 = rows;
  }

  return {
    sections,
    calculationOptions: { ...(chart.calculationOptions ?? {}), ruleVersion: DALIUREN_LESSONS_RULE_VERSION },
  };
}
