import type { DaliurenOutput } from './types.js';
import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  DaliurenCanonicalTextOptions
} from '../shared/text-options.js';

function formatDaliurenCoreStatus(result: DaliurenOutput): string {
  return `空亡(${result.dateInfo.kongWang.join(', ')}) / 驿马(${result.dateInfo.yiMa}) / 丁马(${result.dateInfo.dingMa}) / 天马(${result.dateInfo.tianMa})`;
}

function formatDaliurenTianPanLabel(item: DaliurenOutput['gongInfos'][number]): string {
  const suffix = [item.wuXing, item.wangShuai].filter(Boolean).join('·');
  return suffix ? `${item.tianZhi}(${suffix})` : item.tianZhi;
}

export function renderDaliurenCanonicalText(result: DaliurenOutput, options: DaliurenCanonicalTextOptions = {}): string {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const diurnalLabel = result.dateInfo.diurnal ? '昼占' : '夜占';
  const siKeLabels = ['一课 (干上)', '二课 (干阴)', '三课 (支上)', '四课 (支阴)'] as const;
  const siKeData = [result.siKe.yiKe, result.siKe.erKe, result.siKe.sanKe, result.siKe.siKe];
  const sanChuanLabels = ['初传 (发端)', '中传 (移易)', '末传 (归计)'] as const;
  const sanChuanData = [result.sanChuan.chu, result.sanChuan.zhong, result.sanChuan.mo];
  const lines: string[] = [
    '# 大六壬排盘',
    '',
    '## 基本信息',
    ...(result.question ? [`- 占事: ${result.question}`] : []),
    `- 占测时间: ${result.dateInfo.solarDate} (${diurnalLabel})`,
    `- 四柱: ${result.dateInfo.bazi}`,
    `- 课式: ${result.keName} / ${result.keTi.method}课`,
    `- 月将: ${result.dateInfo.yueJiang}`,
    `- 关键状态: ${formatDaliurenCoreStatus(result)}`,
  ];
  if (detailLevel === 'full') {
    if (result.dateInfo.lunarDate) lines.push(`- 农历: ${result.dateInfo.lunarDate}`);
    lines.push(`- 月将名称: ${result.dateInfo.yueJiangName}`);
    if (result.benMing) lines.push(`- 本命: ${result.benMing}`);
    if (result.xingNian) lines.push(`- 行年: ${result.xingNian}`);
    if (result.keTi.extraTypes.length > 0) lines.push(`- 附加课体: ${result.keTi.extraTypes.join('、')}`);
    if (result.keTi.subTypes.length > 0) lines.push(`- 细分课体: ${result.keTi.subTypes.join('、')}`);
  }
  lines.push('');
  lines.push('## 四课 (主客对立)');
  lines.push('');
  lines.push('| 课别 | 乘将 | 上神 (天盘) | 下神 (地盘) |');
  lines.push('|---|---|---|---|');
  for (let index = 0; index < siKeLabels.length; index += 1) {
    const item = siKeData[index];
    lines.push(`| ${siKeLabels[index]} | ${item[1] || '-'} | ${item[0]?.[0] || '-'} | ${item[0]?.[1] || '-'} |`);
  }
  lines.push('');
  lines.push('## 三传 (事态推演)');
  lines.push('');
  lines.push('| 传序 | 地支 | 天将 | 六亲 | 遁干 |');
  lines.push('|---|---|---|---|---|');
  for (let index = 0; index < sanChuanLabels.length; index += 1) {
    const item = sanChuanData[index];
    lines.push(`| ${sanChuanLabels[index]} | ${item[0] || '-'} | ${item[1] || '-'} | ${item[2] || '-'} | ${item[3] || '-'} |`);
  }
  lines.push('');
  if (result.gongInfos.length > 0) {
    lines.push('## 天地盘全图 (十二宫)');
    lines.push('');
    if (detailLevel === 'full') {
      lines.push('| 地盘 | 天盘 (五行·状态) | 天将 | 遁干 | 长生十二神 | 建除 |');
      lines.push('|---|---|---|---|---|---|');
    } else {
      lines.push('| 地盘 | 天盘 (五行·状态) | 天将 | 遁干 | 长生十二神 |');
      lines.push('|---|---|---|---|---|');
    }
    for (const item of result.gongInfos) {
      const row = [
        item.diZhi || '-',
        formatDaliurenTianPanLabel(item),
        item.tianJiang || '-',
        item.dunGan || '-',
        item.changSheng || '-',
      ];
      if (detailLevel === 'full') row.push(item.jianChu || '-');
      lines.push(`| ${row.join(' | ')} |`);
    }
  }
  if (detailLevel === 'full' && result.shenSha.length) {
    lines.push('', '## 神煞', '', ...result.shenSha.map(item => `- ${item.name}: ${item.value}${item.description ? `（${item.description}）` : ''}`));
  }
  return lines.join('\n');
}
