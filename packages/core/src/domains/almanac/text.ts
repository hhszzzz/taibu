import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  AlmanacOutput
} from './types.js';
import type {
  AlmanacCanonicalTextOptions
} from '../shared/text-options.js';

export function renderAlmanacCanonicalText(result: AlmanacOutput, options: AlmanacCanonicalTextOptions = {}): string {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const { date, dayInfo, tenGod, almanac } = result;
  const lines: string[] = [
    '# 每日黄历',
    '',
    '## 基础与个性化坐标',
    `- 日期: ${date} (${dayInfo.ganZhi}日)`,
  ];
  if (tenGod) lines.push(`- 流日十神 (针对命主): ${tenGod}`);

  if (almanac) {
    lines.push('');
    lines.push('## 传统黄历基调');
    lines.push(`- 农历: ${almanac.lunarDate || `${almanac.lunarMonth}${almanac.lunarDay}`} (生肖${almanac.zodiac})`);
    if (almanac.solarTerm) lines.push(`- 节气: ${almanac.solarTerm}`);
    if (almanac.chongSha) lines.push(`- 冲煞: ${almanac.chongSha.replace(' 煞', ' / 煞')}`);
    if (almanac.pengZuBaiJi) lines.push(`- 彭祖百忌: ${almanac.pengZuBaiJi.replace(/\s+/gu, ' / ')}`);
    if (almanac.taiShen) lines.push(`- 胎神占方: ${almanac.taiShen}`);
    if (almanac.dayNineStar) lines.push(`- 日九星: ${almanac.dayNineStar.description}`);

    lines.push('');
    lines.push('## 择日宜忌');
    lines.push(`- 宜: ${almanac.suitable.join(', ') || '无'}`);
    lines.push(`- 忌: ${almanac.avoid.join(', ') || '无'}`);

    if ((almanac.jishen && almanac.jishen.length > 0) || (almanac.xiongsha && almanac.xiongsha.length > 0)) {
      lines.push('');
      lines.push('## 神煞参考 (择日背景)');
      if (almanac.jishen && almanac.jishen.length > 0) {
        lines.push(`- 吉神宜趋: ${almanac.jishen.join(', ')}`);
      }
      if (almanac.xiongsha && almanac.xiongsha.length > 0) {
        lines.push(`- 凶煞宜忌: ${almanac.xiongsha.join(', ')}`);
      }
    }

    if (detailLevel === 'full') {
      lines.push('');
      lines.push('## 方位信息');
      lines.push(`- 财神: ${almanac.directions.caiShen}`);
      lines.push(`- 喜神: ${almanac.directions.xiShen}`);
      lines.push(`- 福神: ${almanac.directions.fuShen}`);
      lines.push(`- 阳贵人: ${almanac.directions.yangGui}`);
      lines.push(`- 阴贵人: ${almanac.directions.yinGui}`);

      lines.push('');
      lines.push('## 值日信息');
      if (almanac.dayOfficer) lines.push(`- 建除十二值星: ${almanac.dayOfficer}`);
      if (almanac.tianShen) lines.push(`- 天神: ${almanac.tianShen}${almanac.tianShenType || almanac.tianShenLuck ? ` (${[almanac.tianShenType, almanac.tianShenLuck].filter(Boolean).join(' / ')})` : ''}`);
      if (almanac.lunarMansion) lines.push(`- 二十八星宿: ${almanac.lunarMansion}${almanac.lunarMansionLuck ? ` (${almanac.lunarMansionLuck})` : ''}`);
      if (almanac.lunarMansionSong) lines.push(`- 星宿歌诀: ${almanac.lunarMansionSong}`);
      if (almanac.nayin) lines.push(`- 日柱纳音: ${almanac.nayin}`);

      if (almanac.hourlyFortune.length > 0) {
        lines.push('');
        lines.push('## 时辰吉凶');
        lines.push('| 时辰 | 天神 | 类型 | 吉凶 | 冲煞 | 宜 | 忌 |');
        lines.push('|------|------|------|------|------|------|------|');
        for (const hour of almanac.hourlyFortune) {
          const period = hour.startTime && hour.endTime ? ` ${hour.startTime}–${hour.endTime}` : '';
          lines.push(`| ${hour.ganZhi || '-'}${period} | ${hour.tianShen || '-'} | ${hour.tianShenType || '-'} | ${hour.tianShenLuck || '-'} | ${[hour.chong, hour.sha].filter(Boolean).join(' / ') || '-'} | ${hour.suitable.join('、') || '-'} | ${hour.avoid.join('、') || '-'} |`);
        }
      }
    }
  }

  return lines.join('\n');
}
