import type {
  BaziPillarsResolveOutput
} from './types.js';

/** 每个候选只写农历、公历与时间区间；怎样接着排盘对所有候选相同，文末写一次 */
export function renderBaziPillarsResolveCanonicalText(result: BaziPillarsResolveOutput): string {
  const lines: string[] = [
    '# 四柱反推候选时间',
    '',
    '## 原始四柱',
    `- 年柱: ${result.pillars.yearPillar}`,
    `- 月柱: ${result.pillars.monthPillar}`,
    `- 日柱: ${result.pillars.dayPillar}`,
    `- 时柱: ${result.pillars.hourPillar}`,
    '',
    '## 候选数量',
    `- 总数: ${result.count}`,
  ];

  if (result.candidates.length === 0) {
    lines.push('');
    lines.push('## 候选列表');
    lines.push('- 无匹配候选');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('## 候选列表');
  for (const [index, candidate] of result.candidates.entries()) {
    lines.push('');
    lines.push(`### 候选 ${index + 1}`);
    // 农历文本已写出闰月（如「闰二月」），不另起一行
    lines.push(`- 农历: ${candidate.lunarText}`);
    lines.push(`- 公历: ${candidate.solarText}`);
    if (candidate.timeWindow) lines.push(`- 时间区间: [${candidate.timeWindow.start}, ${candidate.timeWindow.end}) ${candidate.timeWindow.timezone}（分钟精度，结束不含）`);
  }
  lines.push('');
  lines.push('## 下一步');
  lines.push('- 选定一个候选后，用它的公历日期与时间调用 `bazi`，并补充 gender');

  return lines.join('\n');
}
