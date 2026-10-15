/**
 * 大六壬排盘核心引擎
 * 核心算法使用 liuren-ts-lib，补充课体细分、十二长生、五行旺衰等
 */

import * as liurenLib from 'liuren-ts-lib';
import { Body, Observer, Equator, Horizon } from 'astronomy-engine';
import { Solar } from 'lunar-javascript';
import { assertFiniteNumber, assertInteger, CoreInputError, parseCivilDate, resolveEnum } from '../../shared/validation.js';
import { resolveBaziCalendarContext } from '../bazi/calculate.js';
import { DEFAULT_DIVINATION_TIMEZONE, zonedWallClockToSystemDate } from '../../shared/timezone-utils.js';
import {
  DI_ZHI,
  TIAN_JIANG_SHORT,
  YUE_JIANG_NAMES,
  ZHI_WUXING,
  calcBenMingXingNian,
  classifyKeTi,
  generateKeName,
  getChangSheng,
  getTaoHua,
  getWangShuai,
  resolveSingleKeMisclassifiedAsMaoXing,
  yearGanZhi,
} from './supplements.js';
import type {
  DaliurenDateInfo,
  DaliurenInput,
  DaliurenOutput,
  DaliurenSanChuan,
  DaliurenShenSha,
  DaliurenSiKe,
  DaliurenTianDiPan,
  GongInfo,
} from './types.js';

// These helpers are exported by liuren-ts-lib at runtime but omitted from its
// package-level declaration surface. Keep the adapter typed locally so the
// correction reuses the library's own pan lookup and filling logic.
type RawLiuRen = ReturnType<typeof liurenLib.getLiuRenByDate>;
type RawDate = NonNullable<RawLiuRen['dateInfo']>;
type RawPan = NonNullable<RawLiuRen['tiandipan']>;
type LiuRenInternalApi = {
  getDateByObj: (date: Date) => RawDate;
  getTianDiPan: (date: RawDate) => RawPan;
  getYinYangGuiRen: (date: RawDate, pan: RawPan) => { 阳贵人: RawPan['天将']; 阴贵人: RawPan['天将']; };
  getSiKe: (date: RawDate, pan: RawPan) => NonNullable<RawLiuRen['siKe']>;
  getDunGan: (date: RawDate, pan: RawPan) => NonNullable<RawLiuRen['dunGan']>;
  getJianChu: (date: RawDate, pan: RawPan) => NonNullable<RawLiuRen['jianChu']>;
  getSanChuan: (lessons: NonNullable<RawLiuRen['siKe']>, pan: RawPan) => NonNullable<RawLiuRen['sanChuan']>;
  getShenSha: (date: RawDate) => DaliurenShenSha[];
  getShangShen: (tianDiPan: unknown, zhi: string) => string;
  fillSanChuan: (
    sanChuan: { 初传: string[]; 中传: string[]; 末传: string[]; 课体: string },
    tianDiPan: unknown,
    dunGan: unknown,
    riGan: string,
  ) => { 初传: string[]; 中传: string[]; 末传: string[]; 课体: string };
};

const liurenInternal = liurenLib as unknown as LiuRenInternalApi;

/**
 * 大六壬排盘主函数
 */
export function calculateDaliurenData(input: DaliurenInput): DaliurenOutput {
  const { date, hour, minute = 0, question, birthYear, gender } = input;
  const timezone = input.timezone ?? DEFAULT_DIVINATION_TIMEZONE;

  // 1. 构造 Date 对象
  const { year: y, month: m, day: d } = parseCivilDate(date);
  assertInteger(hour, 'hour', 0, 23);
  assertInteger(minute, 'minute', 0, 59);
  if ((birthYear === undefined) !== (gender === undefined)) throw new CoreInputError('birthYear/gender', '必须同时提供');
  if (birthYear !== undefined) assertInteger(birthYear, 'birthYear', 1, y);
  if (gender !== undefined) resolveEnum(gender, ['male', 'female'], 'male', 'gender');
  const dayNight = resolveEnum(input.dayNight, ['shichen', 'day', 'night', 'sunrise'] as const, 'shichen', 'dayNight');
  if (input.monthGeneral !== undefined && !(DI_ZHI as readonly string[]).includes(input.monthGeneral)) throw new CoreInputError('monthGeneral', '必须是十二地支之一');
  const dateObj = zonedWallClockToSystemDate({ year: y, month: m, day: d, hour, minute }, timezone);

  // 2. 调用 liuren-ts-lib 核心排盘
  const calendar = resolveBaziCalendarContext({ birthYear: y, birthMonth: m, birthDay: d, birthHour: hour, birthMinute: minute, gender: 'male', timezone });
  const sourceDate = liurenInternal.getDateByObj(dateObj);
  const termEightChar = calendar.termLunar.getEightChar();
  const pillars = sourceDate.bazi.split(' ');
  pillars[0] = termEightChar.getYear();
  pillars[1] = termEightChar.getMonth();
  sourceDate.bazi = pillars.join(' ');
  const computedShenSha = liurenInternal.getShenSha(sourceDate);
  const tianMa = computedShenSha?.find(star => star.name === '天马')?.value;
  if (!tianMa) throw new Error('无法计算月支天马');
  sourceDate.tianma = tianMa;
  const generals: Record<string, string> = { 大寒: '子', 雨水: '亥', 春分: '戌', 谷雨: '酉', 小满: '申', 夏至: '未', 大暑: '午', 处暑: '巳', 秋分: '辰', 霜降: '卯', 小雪: '寅', 冬至: '丑' };
  sourceDate.yuejiang = input.monthGeneral ?? generals[calendar.termLunar.getPrevQi().getName()];
  if (!sourceDate.yuejiang) throw new Error('无法确定当前中气月将');
  let diurnal = dayNight === 'day' || (dayNight === 'shichen' && hour >= 5 && hour < 17);
  if (dayNight === 'sunrise') {
    assertFiniteNumber(input.latitude, 'latitude', -90, 90);
    assertFiniteNumber(input.longitude, 'longitude', -180, 180);
    const observer = new Observer(input.latitude, input.longitude, 0);
    const sun = Equator(Body.Sun, dateObj, observer, true, true);
    diurnal = Horizon(dateObj, observer, sun.ra, sun.dec).altitude >= -0.833;
  }
  const pan = liurenInternal.getTianDiPan(sourceDate);
  const guiRen = liurenInternal.getYinYangGuiRen(sourceDate, pan);
  pan.天将 = diurnal ? guiRen.阳贵人 : guiRen.阴贵人;
  const lessons = liurenInternal.getSiKe(sourceDate, pan);
  const dunGan = liurenInternal.getDunGan(sourceDate, pan);
  const raw = {
    dateInfo: sourceDate,
    tiandipan: pan,
    siKe: lessons,
    dunGan,
    jianChu: liurenInternal.getJianChu(sourceDate, pan),
    sanChuan: liurenInternal.fillSanChuan(liurenInternal.getSanChuan(lessons, pan), pan, dunGan, pillars[2][0]),
    shenSha: computedShenSha,
  };

  // 3. 解析基础信息
  const bazi = raw.dateInfo?.bazi || '';
  const baziParts = bazi.split(' ');
  const riGanZhi = baziParts[2] || '';
  const riGan = riGanZhi[0] || '甲';
  const riZhi = riGanZhi[1] || '子';
  const yueGanZhi = baziParts[1] || '';
  const yueZhi = yueGanZhi[1] || '子';
  const yueJiang = raw.dateInfo?.yuejiang || '亥';

  // 4. 构建 dateInfo
  const dateInfo: DaliurenDateInfo = {
    solarDate: raw.dateInfo?.date || `${y}年${m}月${d}日 ${hour}时${minute}分`,
    bazi,
    ganZhi: {
      year: baziParts[0] || '',
      month: baziParts[1] || '',
      day: baziParts[2] || '',
      hour: baziParts[3] || '',
    },
    yueJiang,
    yueJiangName: YUE_JIANG_NAMES[yueJiang] || yueJiang,
    xun: raw.dateInfo?.xun || '',
    kongWang: (raw.dateInfo?.kong as [string, string]) || ['', ''],
    yiMa: raw.dateInfo?.yima || '',
    dingMa: raw.dateInfo?.dingma || '',
    tianMa: raw.dateInfo?.tianma || '',
    diurnal,
    lunarDate: Solar.fromYmdHms(y, m, d, hour, minute, 0).getLunar().toString(),
  };

  // 5. 天地盘
  const tianDiPan: DaliurenTianDiPan = {
    diPan: raw.tiandipan?.['地盘'] || {},
    tianPan: raw.tiandipan?.['天盘'] || {},
    tianJiang: raw.tiandipan?.['天将'] || {},
  };

  // 6. 四课
  const siKe: DaliurenSiKe = {
    yiKe: raw.siKe?.['一课'] || [],
    erKe: raw.siKe?.['二课'] || [],
    sanKe: raw.siKe?.['三课'] || [],
    siKe: raw.siKe?.['四课'] || [],
  };

  // 7. 三传
  const rawSanChuan = raw.sanChuan || {};
  let sanChuan: DaliurenSanChuan = {
    chu: rawSanChuan['初传'] || [],
    zhong: rawSanChuan['中传'] || [],
    mo: rawSanChuan['末传'] || [],
    method: rawSanChuan['课体'] || '',
  };

  // liuren-ts-lib 1.9.0 uses a static sanchuan table. Validate its昴星
  // fallback against the actual four lessons before exposing the result.
  const keCorrection = resolveSingleKeMisclassifiedAsMaoXing(
    sanChuan.method,
    {
      ganYang: extractShangShen(siKe.yiKe),
      ganYing: extractShangShen(siKe.erKe),
      zhiYang: extractShangShen(siKe.sanKe),
      zhiYing: extractShangShen(siKe.siKe),
      gan: riGan,
      zhi: riZhi,
    },
  );
  if (keCorrection && raw.tiandipan && raw.dunGan) {
    const zhong = liurenInternal.getShangShen(raw.tiandipan, keCorrection.chu);
    const mo = liurenInternal.getShangShen(raw.tiandipan, zhong);
    const corrected = liurenInternal.fillSanChuan(
      {
        初传: [keCorrection.chu, '', '', ''],
        中传: [zhong, '', '', ''],
        末传: [mo, '', '', ''],
        课体: keCorrection.method,
      },
      raw.tiandipan,
      raw.dunGan,
      riGan,
    );
    sanChuan = {
      chu: corrected.初传,
      zhong: corrected.中传,
      mo: corrected.末传,
      method: corrected.课体,
    };
  }

  // 8. 课体细分
  // 从四课数据中提取上神
  const ganYang = extractShangShen(siKe.yiKe);
  const ganYing = extractShangShen(siKe.erKe);
  const zhiYang = extractShangShen(siKe.sanKe);
  const zhiYing = extractShangShen(siKe.siKe);

  const keTi = classifyKeTi(
    sanChuan.method,
    { ganYang, ganYing, zhiYang, zhiYing, gan: riGan, zhi: riZhi },
    { chu: sanChuan.chu[0] || '', zhong: sanChuan.zhong[0] || '', mo: sanChuan.mo[0] || '' },
  );

  // 9. 课名
  const keName = generateKeName(riGanZhi, ganYang);

  // 10. 神煞（库提供 + 补充桃花和游都）
  const shenSha: DaliurenShenSha[] = (raw.shenSha || []).map((s: { name: string; value: string; description?: string; }) => ({
    name: s.name,
    value: s.value,
    description: s.description,
  }));

  // 补充桃花
  const taoHua = getTaoHua(riZhi);
  if (taoHua && !shenSha.find(s => s.name === '桃花')) {
    shenSha.push({ name: '桃花', value: taoHua, description: '主桃花、感情、人缘。' });
  }

  // 11. 十二宫详情（含十二长生、五行旺衰）
  const gongInfos: GongInfo[] = DI_ZHI.map((diZhi, idx) => {
    const key = String(idx);
    const tianZhi = tianDiPan.tianPan[key] || diZhi;
    const tianJiang = tianDiPan.tianJiang[key] || '';
    const dunGan = raw.dunGan?.[diZhi] || '';
    const tianZhiWx = ZHI_WUXING[tianZhi] || '';

    return {
      diZhi,
      tianZhi,
      tianJiang,
      tianJiangShort: TIAN_JIANG_SHORT[tianJiang] || tianJiang,
      dunGan,
      changSheng: getChangSheng(riGan, tianZhi),
      wuXing: tianZhiWx,
      wangShuai: getWangShuai(yueZhi, tianZhiWx),
      jianChu: raw.jianChu?.[diZhi] || '',
    };
  });

  // 12. 本命与行年
  let benMing: string | undefined;
  let xingNian: string | undefined;
  if (birthYear && gender) {
    // 行年随岁年而转：年柱以立春换年，立春前的一月仍属上一岁年
    const suiYear = yearGanZhi(y) === pillars[0] ? y : y - 1;
    const result = calcBenMingXingNian(birthYear, suiYear, gender);
    benMing = result.benMing;
    xingNian = result.xingNian;
  }

  return {
    dateInfo,
    tianDiPan,
    siKe,
    sanChuan,
    keTi,
    keName,
    shenSha,
    gongInfos,
    dunGan: raw.dunGan || {},
    jianChu: raw.jianChu || {},
    benMing,
    xingNian,
    question,
    calculationOptions: { timezone, monthGeneral: yueJiang, monthGeneralSource: input.monthGeneral === undefined ? 'solar-term' : 'manual', dayNight, ...(dayNight === 'sunrise' ? { latitude: input.latitude, longitude: input.longitude } : {}), ruleVersion: 'daliuren-2026.10' },
  };
}

/** 从四课数组中提取上神（第一个字符对的第一个字） */
function extractShangShen(ke: string[]): string {
  if (!ke || ke.length === 0) return '';
  const pair = ke[0] || '';
  return pair[0] || '';
}

// Re-export types
export type {
  DaliurenDateInfo, DaliurenInput,
  DaliurenOutput, DaliurenSanChuan,
  DaliurenShenSha, DaliurenSiKe, DaliurenTianDiPan, GongInfo,
  KetiInfo
} from './types.js';
