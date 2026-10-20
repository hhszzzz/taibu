import { withRulesJSON } from '../../shared/calculation-rules.js';
import { drilldownText } from '../shared/drilldown-render.js';
import {
  ZIWEI_SCOPE_LABELS,
  type ZiweiFlankPattern,
  type ZiweiMutagenFlight,
  type ZiweiPalaceFact,
  type ZiweiPalaceOutput,
  type ZiweiPalaceStarFact,
} from './palace.js';

/** 宫位或星曜定位：宫位名与基础命盘「十二宫位.宫位」一致，星曜名与其中「星名」一致 */
export interface ZiweiPositionJSON {
  宫位: string;
  星曜?: string;
}

export interface ZiweiPalaceStarRowJSON {
  星曜: string;
  组别: string;
  亮度?: string;
  生年四化?: string;
  离心自化?: string;
  向心自化?: string;
  位置: ZiweiPositionJSON[];
}

export interface ZiweiPalaceRelationRowJSON {
  类型: string;
  位置: ZiweiPositionJSON[];
  结果?: string;
  说明: string;
}

export interface ZiweiPalaceCanonicalJSON {
  查询: { 宫位: string; 层次: string; 目标日期?: string; 时辰序号?: number; };
  宫位概览: { 宫位: string; 干支: string; 宫位索引: number; 身宫: '是' | '否'; 来因宫: '是' | '否'; 空宫: '是' | '否'; };
  本宫星曜: ZiweiPalaceStarRowJSON[];
  借对宫?: { 对宫: string; 干支: string; 说明: string; 主星: ZiweiPalaceStarRowJSON[]; };
  三方四正: Array<{ 角色: string; 宫位: string; 干支: string; 主星: string; 辅星: string; 生年四化: string[]; 位置: ZiweiPositionJSON[]; }>;
  夹宫: { 两邻: string[]; 夹星: ZiweiPalaceRelationRowJSON[]; };
  宫干四化飞出: ZiweiPalaceRelationRowJSON[];
  四化飞入: ZiweiPalaceRelationRowJSON[];
  运限叠加?: {
    层次: string; 运限干支: string; 运限宫位: string; 落入本命宫位: string; 运限命宫落入?: string;
    目标日期: string; 时辰序号?: number; 运限四化: ZiweiPalaceRelationRowJSON[];
  };
  口径: string[];
}

const NOTES = [
  '只列星曜、四化与宫位关系事实，不判断吉凶',
  '三方四正取本宫、两个三合宫（本宫起顺数第五、第九宫）与对宫',
  '本宫无主星为空宫，借对宫主星（连同其亮度与生年四化）参看；辅星与杂曜不借',
  '夹宫只列两邻宫成对出现的左右、昌曲、魁钺、日月、羊陀、火铃、空劫',
  '宫干四化按命盘所用四化表（含自定义 mutagens）飞出；四化飞入列出十二宫宫干四化落入本宫者，来源为本宫即离心自化，来源为对宫即向心自化',
  '运限层次与 ziwei_horoscope 同口径；宫位参数指该运限的宫名，叠加回所落的本命宫位',
];

const yesNo = (value: boolean) => (value ? '是' : '否') as '是' | '否';
const starLabel = (star: ZiweiPalaceStarFact) => `${star.name}${star.brightness ? `(${star.brightness})` : ''}${star.mutagen ? `化${star.mutagen}` : ''}`;

function starRow(star: ZiweiPalaceStarFact): ZiweiPalaceStarRowJSON {
  return {
    星曜: star.name,
    组别: star.group,
    ...(star.brightness ? { 亮度: star.brightness } : {}),
    ...(star.mutagen ? { 生年四化: star.mutagen } : {}),
    ...(star.selfMutagen ? { 离心自化: star.selfMutagen } : {}),
    ...(star.oppositeMutagen ? { 向心自化: star.oppositeMutagen } : {}),
    位置: [{ 宫位: star.palace, 星曜: star.name }],
  };
}

function majorText(palace: ZiweiPalaceFact): string {
  const stars = palace.stars.filter((star) => star.group === '主星及四化');
  return stars.length ? stars.map(starLabel).join('、') : '无主星';
}

function minorText(palace: ZiweiPalaceFact): string {
  const stars = palace.stars.filter((star) => star.group === '辅星');
  return stars.length ? stars.map(starLabel).join('、') : '无';
}

function flightRow(flight: ZiweiMutagenFlight): ZiweiPalaceRelationRowJSON {
  const landing = flight.toPalace
    ? `入${flight.toPalace}${flight.fromPalace === flight.toPalace ? '（离心自化）' : ''}`
    : '（该星不在盘上）';
  return {
    类型: `化${flight.mutagen}`,
    位置: [{ 宫位: flight.fromPalace }, ...(flight.toPalace ? [{ 宫位: flight.toPalace, 星曜: flight.star }] : [])],
    结果: flight.star,
    说明: `${flight.fromPalace}${flight.fromStem}干${flight.star}化${flight.mutagen}${landing}`,
  };
}

function flankRow(pattern: ZiweiFlankPattern): ZiweiPalaceRelationRowJSON {
  const [first, second] = pattern.stars;
  return {
    类型: pattern.name,
    位置: pattern.stars.map((item) => ({ 宫位: item.palace, 星曜: item.star })),
    说明: `${first.palace}${first.star}、${second.palace}${second.star}相夹`,
  };
}

function renderZiweiPalaceJSONBase(result: ZiweiPalaceOutput): ZiweiPalaceCanonicalJSON {
  const target = result.palace;
  const overlay = result.overlay;
  return {
    查询: {
      宫位: result.query.palace,
      层次: ZIWEI_SCOPE_LABELS[result.query.scope],
      ...(result.query.targetDate !== undefined ? { 目标日期: result.query.targetDate } : {}),
      ...(result.query.targetTimeIndex !== undefined ? { 时辰序号: result.query.targetTimeIndex } : {}),
    },
    宫位概览: {
      宫位: target.name,
      干支: `${target.stem}${target.branch}`,
      宫位索引: target.index,
      身宫: yesNo(target.isBodyPalace),
      来因宫: yesNo(target.isOriginalPalace),
      空宫: yesNo(!target.stars.some((star) => star.group === '主星及四化')),
    },
    本宫星曜: target.stars.map(starRow),
    ...(result.borrowed ? {
      借对宫: {
        对宫: result.borrowed.from.name,
        干支: `${result.borrowed.from.stem}${result.borrowed.from.branch}`,
        说明: result.borrowed.stars.length ? `本宫无主星，借${result.borrowed.from.name}主星参看` : `本宫与对宫${result.borrowed.from.name}皆无主星`,
        主星: result.borrowed.stars.map(starRow),
      },
    } : {}),
    三方四正: result.sanFang.map(({ role, palace }) => ({
      角色: role,
      宫位: palace.name,
      干支: `${palace.stem}${palace.branch}`,
      主星: majorText(palace),
      辅星: minorText(palace),
      生年四化: palace.stars.filter((star) => star.mutagen).map((star) => `${star.name}化${star.mutagen}`),
      位置: [{ 宫位: palace.name }],
    })),
    夹宫: {
      两邻: result.flanks.palaces.map((palace) => `${palace.name} ${palace.stem}${palace.branch}`),
      夹星: result.flanks.patterns.map(flankRow),
    },
    宫干四化飞出: result.fliesOut.map(flightRow),
    四化飞入: result.fliesIn.map(flightRow),
    ...(overlay ? {
      运限叠加: {
        层次: overlay.label,
        运限干支: `${overlay.stem}${overlay.branch}`,
        运限宫位: `${overlay.label}${overlay.scopePalace}`,
        落入本命宫位: overlay.natalPalace,
        ...(overlay.soulInNatal ? { 运限命宫落入: overlay.soulInNatal } : {}),
        目标日期: overlay.targetDate,
        ...(overlay.targetTimeIndex !== undefined ? { 时辰序号: overlay.targetTimeIndex } : {}),
        运限四化: overlay.mutagens.map((item) => ({
          类型: `化${item.mutagen}`,
          位置: item.natalPalace ? [{ 宫位: item.natalPalace, 星曜: item.star }] : [],
          结果: item.star,
          说明: item.natalPalace
            ? `${overlay.label}${overlay.stem}干${item.star}化${item.mutagen}入本命${item.natalPalace}${item.scopePalace ? `（${overlay.label}${item.scopePalace}）` : ''}`
            : `${overlay.label}${overlay.stem}干${item.star}化${item.mutagen}（该星不在盘上）`,
        })),
      },
    } : {}),
    口径: NOTES,
  };
}

const rowLine = (row: ZiweiPalaceRelationRowJSON) => `- ${row.类型}｜${row.说明}`;

function renderZiweiPalaceTextBase(result: ZiweiPalaceOutput): string {
  const json = renderZiweiPalaceJSONBase(result);
  const overview = json.宫位概览;
  const lines = ['# 紫微宫位详查', '', '## 查询', ''];
  lines.push(`- 宫位：${json.查询.宫位}`, `- 层次：${json.查询.层次}`);
  if (json.查询.目标日期) lines.push(`- 目标日期：${json.查询.目标日期}`);
  if (json.查询.时辰序号 !== undefined) lines.push(`- 时辰序号：${json.查询.时辰序号}`);
  lines.push('', '## 宫位概览', '', `- ${overview.宫位}（${overview.干支}）${overview.身宫 === '是' ? '·身宫' : ''}${overview.来因宫 === '是' ? '·来因宫' : ''}${overview.空宫 === '是' ? '·空宫' : ''}`);
  lines.push('', '## 本宫星曜', '');
  if (!json.本宫星曜.length) lines.push('- 无');
  for (const star of json.本宫星曜) {
    const extras = [star.亮度, star.生年四化 && `生年化${star.生年四化}`, star.离心自化 && `离心自化${star.离心自化}`, star.向心自化 && `向心自化${star.向心自化}`].filter(Boolean);
    lines.push(`- ${star.组别}｜${star.星曜}${extras.length ? `｜${extras.join('、')}` : ''}`);
  }
  if (json.借对宫) {
    lines.push('', '## 借对宫', '', `- ${json.借对宫.说明}：${json.借对宫.主星.map((star) => `${star.星曜}${star.亮度 ? `(${star.亮度})` : ''}${star.生年四化 ? `化${star.生年四化}` : ''}`).join('、') || '无'}`);
  }
  // 本宫已在「本宫星曜」，星名已带「化X」，表里不再重复本宫行与生年四化列
  lines.push('', '## 三方四正', '', '| 角色 | 宫位 | 干支 | 主星 | 辅星 |', '|------|------|------|------|------|');
  for (const row of json.三方四正.filter((item) => item.角色 !== '本宫')) lines.push(`| ${row.角色} | ${row.宫位} | ${row.干支} | ${row.主星} | ${row.辅星} |`);
  lines.push('', '## 夹宫', '', `- 两邻：${json.夹宫.两邻.join('、')}`, ...(json.夹宫.夹星.length ? json.夹宫.夹星.map(rowLine) : ['- 无成对夹星']));
  lines.push('', '## 宫干四化飞出', '', ...json.宫干四化飞出.map(rowLine));
  lines.push('', '## 四化飞入', '', ...(json.四化飞入.length ? json.四化飞入.map(rowLine) : ['- 无']));
  if (json.运限叠加) {
    const overlay = json.运限叠加;
    lines.push('', '## 运限叠加', '', `- ${overlay.运限宫位}（${overlay.层次}${overlay.运限干支}）落入本命${overlay.落入本命宫位}`);
    if (overlay.运限命宫落入) lines.push(`- ${overlay.层次}命宫落入本命${overlay.运限命宫落入}`);
    lines.push(...overlay.运限四化.map(rowLine));
  }
  return lines.join('\n');
}

export const toZiweiPalaceJson = withRulesJSON(renderZiweiPalaceJSONBase);
export const toZiweiPalaceText = drilldownText(NOTES, renderZiweiPalaceTextBase);
