import { normalizeDetailLevelBinary } from '../../shared/render-utils.js';
import { GAN_WUXING } from '../../shared/utils.js';

import type { TaiyiCanonicalTextOptions } from '../shared/text-options.js';
import type { TaiyiOutput, TaiyiStarSnapshot } from './types.js';
import { renderTaiyiCanonicalJSON } from './json.js';

function formatMappingReference(star: TaiyiStarSnapshot): string {
  return `${star.qimenName} / ${star.xuankongName}`;
}

function formatScaleLabel(star: TaiyiStarSnapshot): string {
  return star.scale === 'minute' ? '分钟主星' : star.scaleLabel;
}

function buildEnergyInteraction(result: TaiyiOutput): string {
  if (!result.coreBoard) throw new Error('太乙九星结果缺少 coreBoard');
  const dayStem = result.datetimeContext.dayGanZhi.charAt(0);
  const dayElement = GAN_WUXING[dayStem] || '';
  const dayStemLabel = dayElement ? `${dayStem}(${dayElement})` : dayStem;
  return `当前主星【${result.coreBoard.primaryStar.taiyiName}(${result.coreBoard.primaryStar.wuXing})】${result.derivedIndicators.elementRelation.replace('主星五行', '')}【${dayStemLabel}】`;
}

export function renderTaiyiCanonicalText(
  result: TaiyiOutput,
  options: TaiyiCanonicalTextOptions = {},
): string {
  normalizeDetailLevelBinary(options.detailLevel);
  if (result.traditionalBoard) {
    const json = renderTaiyiCanonicalJSON(result, options);
    const board = json.太乙七十二局!;
    return [
      '# 太乙七十二局', '', `- 时间: ${json.问卜与时空底盘.时间}`, `- 农历: ${json.问卜与时空底盘.农历}`,
      ...(result.question ? [`- 占问: ${result.question}`] : []),
      `- 流派: ${board.流派}`, `- 积数: ${board.积数}（${board.积数来源}）`, `- 局式: ${board.局式}`, `- 太乙: ${board.太乙}（${board.太乙宫}宫）`,
      `- 文昌: ${board.文昌}；始击: ${board.始击}；计神: ${board.计神}；合神: ${board.合神}；太岁: ${board.太岁}`,
      `- 主算: ${board.主算}；主大将: ${board.主大将}；主参将: ${board.主参将}`,
      `- 客算: ${board.客算}；客大将: ${board.客大将}；客参将: ${board.客参将}`, '',
      '| 宫位 | 宫神 | 星将 |', '|---|---|---|', ...board.十六宫.map(palace => `| ${palace.宫位} | ${palace.宫神} | ${palace.星将.join('、') || '-'} |`), '',
      ...board.采用口径.map(note => `- ${note}`),
    ].join('\n');
  }
  if (!result.coreBoard) throw new Error('太乙九星结果缺少 coreBoard');
  const timeLabel = `${result.datetimeContext.solarDateTime}（${result.datetimeContext.yearGanZhi}年 ${result.datetimeContext.monthGanZhi}月 ${result.datetimeContext.dayGanZhi}日 ${result.datetimeContext.hourGanZhi}时）`;
  const lines: string[] = [
    '# 太乙九星主证据',
    '',
    '## 问卜与时空底盘',
    ...(result.question ? [`- 占问: ${result.question}`] : []),
    `- 时间: ${timeLabel}`,
    `- 农历: ${result.datetimeContext.lunarDate}`,
    ...(result.datetimeContext.jieQi ? [`- 节气: ${result.datetimeContext.jieQi}`] : []),
    `- 四柱: ${result.datetimeContext.yearGanZhi} ${result.datetimeContext.monthGanZhi} ${result.datetimeContext.dayGanZhi} ${result.datetimeContext.hourGanZhi}`,
    ...(result.coreBoard.minuteRefinement
      ? [`- 分钟段: 第 ${result.coreBoard.minuteRefinement.slot} 段（${String(result.coreBoard.minuteRefinement.startMinute).padStart(2, '0')}-${String(result.coreBoard.minuteRefinement.endMinute).padStart(2, '0')} 分）`]
      : []),
    '',
    '## 外部时空环境',
    `- 值星: ${result.datetimeContext.dayOfficer}（建除十二值星）`,
    `- 天神: ${result.datetimeContext.tianShen}${result.datetimeContext.tianShenLuck ? `（${result.datetimeContext.tianShenLuck}）` : ''}`,
    `- 星宿: ${result.datetimeContext.xiu}${result.datetimeContext.xiuLuck ? `（${result.datetimeContext.xiuLuck}）` : ''}`,
    '',
    '## 九星阵列',
    '| 观测层级 | 太乙名(神性) | 北斗名 | 映射参考 | 五行 | 方位(宫位) |',
    '|----------|--------------|--------|----------|------|------------|',
  ];

  for (const star of [
    result.coreBoard.yearStar,
    result.coreBoard.monthStar,
    result.coreBoard.dayStar,
    result.coreBoard.hourStar,
    ...(result.coreBoard.minuteRefinement ? [result.coreBoard.minuteRefinement.refinedStar] : []),
  ]) {
    lines.push(`| ${formatScaleLabel(star)} | ${star.taiyiName}(${star.taiyiType}) | ${star.beidouName} | ${formatMappingReference(star)} | ${star.wuXing} | ${star.positionDesc}(${star.position}) |`);
  }

  lines.push('');
  lines.push('## 核心物理关系');
  lines.push(`- 能量交互: ${buildEnergyInteraction(result)}`);

  lines.push('');
  lines.push('## 古典参考');
  // 「原文仅供意象联想」的使用提示是给读者的说明，留在 JSON 供界面展示，不写进给模型读的文本
  lines.push(`- 主诀原文: ${result.judgementAnchors.primarySong}`);

  return lines.join('\n');
}
