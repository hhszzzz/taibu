import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import { DAYUN_YEAR_SHIFT_NOTE, dayunYearText, type DayunOutput } from './types.js';
import type {
  DayunCanonicalTextOptions
} from '../shared/text-options.js';

export function renderDayunCanonicalText(result: DayunOutput, options: DayunCanonicalTextOptions = {}): string {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  if (detailLevel === 'full') {
    return renderDayunCanonicalFullText(result);
  }

  return renderDayunCanonicalDefaultText(result);
}

/** 起运信息：时辰未知时起运时刻写成当天最早到最晚出生的范围，另写交运年份的推迟 */
function startLines(result: DayunOutput): string[] {
  const range = result.startRange ? ` 至 ${result.startRange.latestStartSolar} 之间` : '';
  return [
    `- 起运年龄：${result.startAge}岁`,
    `- 起运详情：${result.startAgeDetail}`,
    ...(result.startSolar ? [`- 起运时刻：${result.startSolar}${range}（${result.calculationOptions?.startSolarTimezone ?? 'Asia/Shanghai'}）`] : []),
    ...(result.startRange?.yearShift ? [`- 交运年份：${DAYUN_YEAR_SHIFT_NOTE}`] : []),
    ...(result.direction ? [`- 顺逆：${result.direction === 'forward' ? '顺行' : '逆行'}`] : []),
  ];
}

function renderDayunCanonicalDefaultText(result: DayunOutput): string {
  const shift = result.startRange?.yearShift;
  const lines: string[] = [
    '# 大运流年',
    '',
    '## 起运信息',
    '',
    ...startLines(result),
    '',
    '## 大运列表',
    '',
    '| 起运年份 | 起运年龄 | 干支 | 天干十神 | 藏干 |',
    '|----------|----------|------|----------|------|',
  ];

  for (const dayun of result.list) {
    const hiddenStemsText = dayun.hiddenStems && dayun.hiddenStems.length > 0
      ? dayun.hiddenStems.map((hs) => `${hs.stem}(${hs.tenGod})`).join(' ')
      : '-';
    lines.push(`| ${dayunYearText(dayun.startYear, shift)} | ${dayunYearText(dayun.startAge, shift, '岁')} | ${dayun.ganZhi} | ${dayun.tenGod || '-'} | ${hiddenStemsText} |`);
  }

  return lines.join('\n');
}

function renderDayunCanonicalFullText(result: DayunOutput): string {
  const shift = result.startRange?.yearShift;
  const lines: string[] = [
    '# 大运流年',
    '',
    '## 起运信息',
    '',
    ...startLines(result),
  ];

  if (result.xiaoYun.length > 0) {
    lines.push('');
    lines.push('## 小运');
    lines.push('');
    lines.push('| 年龄 | 干支 | 天干十神 |');
    lines.push('|------|------|----------|');
    for (const item of result.xiaoYun) {
      lines.push(`| ${item.age}岁 | ${item.ganZhi} | ${item.tenGod || '-'} |`);
    }
  }

  lines.push('');
  lines.push('## 大运列表');
  lines.push('');
  lines.push('| 起运年份 | 起运年龄 | 干支 | 天干十神 | 地支主气十神 | 藏干 | 地势 | 纳音 | 神煞 | 原局关系 |');
  lines.push('|----------|----------|------|----------|--------------|------|------|------|------|----------|');
  for (const dayun of result.list) {
    const hiddenStemsText = dayun.hiddenStems.length > 0
      ? dayun.hiddenStems.map((hs) => `${hs.stem}(${hs.tenGod})`).join('、')
      : '-';
    const shenShaText = dayun.shenSha.length > 0 ? dayun.shenSha.join('、') : '-';
    const relationText = dayun.branchRelations.length > 0 ? dayun.branchRelations.map((item) => item.description).join('；') : '-';
    lines.push(`| ${dayunYearText(dayun.startYear, shift)} | ${dayunYearText(dayun.startAge, shift, '岁')} | ${dayun.ganZhi} | ${dayun.tenGod || '-'} | ${dayun.branchTenGod || '-'} | ${hiddenStemsText} | ${dayun.diShi || '-'} | ${dayun.naYin || '-'} | ${shenShaText} | ${relationText} |`);
  }

  for (const [index, dayun] of result.list.entries()) {
    const endYear = result.list[index + 1]?.startYear ? result.list[index + 1]!.startYear - 1 : dayun.startYear + 9;
    lines.push('');
    lines.push(`### ${dayun.startYear}-${endYear} ${dayun.ganZhi}`);
    lines.push(`- 起运年龄: ${dayunYearText(dayun.startAge, shift, '岁')}`);
    if (dayun.branchRelations.length > 0) {
      lines.push(`- 原局关系: ${dayun.branchRelations.map((item) => item.description).join('；')}`);
    }
    lines.push('');
    lines.push('| 流年 | 年龄 | 干支 | 天干十神 | 藏干 | 地势 | 纳音 | 神煞 | 地支关系 | 太岁 |');
    lines.push('|------|------|------|----------|------|------|------|------|----------|------|');
    for (const liunian of dayun.liunianList) {
      const hiddenStemsText = liunian.hiddenStems.length > 0
        ? liunian.hiddenStems.map((hs) => `${hs.stem}(${hs.tenGod})`).join('、')
        : '-';
      const shenShaText = liunian.shenSha.length > 0 ? liunian.shenSha.join('、') : '-';
      const relationText = liunian.branchRelations.length > 0 ? liunian.branchRelations.map((item) => item.description).join('；') : '-';
      const taiSuiText = liunian.taiSui.length > 0 ? liunian.taiSui.join('、') : '-';
      lines.push(`| ${liunian.year} | ${liunian.age}岁 | ${liunian.ganZhi} | ${liunian.tenGod || '-'} | ${hiddenStemsText} | ${liunian.diShi || '-'} | ${liunian.nayin || '-'} | ${shenShaText} | ${relationText} | ${taiSuiText} |`);
    }
  }

  return lines.join('\n');
}
