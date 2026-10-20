import { normalizeDetailLevelBinary } from '../../shared/render-utils.js';
import type { DetailLevel } from '../shared/types.js';
import type { XiaoliurenOutput } from './types.js';

export interface XiaoliurenCanonicalTextOptions {
  /** 输出细节级别 */
  detailLevel?: DetailLevel;
  /** 是否显示诗诀；默认跟随 detailLevel，full=true，default=false */
  showPoem?: boolean;
}

export function toXiaoliurenText(
  output: XiaoliurenOutput,
  options: XiaoliurenCanonicalTextOptions = {},
): string {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const showPoem = options.showPoem ?? detailLevel === 'full';
  const showReference = detailLevel === 'full';
  const lines: string[] = [];

  lines.push('# 小六壬主证据');
  lines.push('');

  lines.push('## 起课信息');
  if (output.question) {
    lines.push(`- 占问: ${output.question}`);
  }
  if (output.input.date) lines.push(`- 公历日期: ${output.input.date}`);
  lines.push(`- 农历月: ${output.input.isLeapMonth ? '闰' : ''}${output.input.lunarMonth}月`);
  lines.push(`- 农历日: ${output.input.lunarDay}日`);
  lines.push(`- 时辰: ${output.input.shichen}`);
  if (output.input.isLeapMonth) lines.push(`- 闰月取法: ${output.input.leapMonthStrategy === 'advance' ? '闰月递进一月' : '闰月沿用同月'}`);
  if (detailLevel === 'full' && output.input.hourType) lines.push(`- 小时输入口径: ${output.input.hourType}`);
  lines.push('');

  lines.push('## 推演链');
  lines.push(`- 月上起: ${output.monthStatus}`);
  lines.push(`- 日上落: ${output.dayStatus}`);
  lines.push(`- 时上落: ${output.hourStatus}`);
  lines.push('');

  lines.push('## 最终落点');
  lines.push(`- 落宫: ${output.result.name}`);
  lines.push(`- 五行: ${output.result.element}`);
  lines.push(`- 方位: ${output.result.direction}`);
  lines.push(`- 性质: ${output.result.nature}`);

  if (showReference) {
    lines.push('');
    lines.push('## 参考释义');
    lines.push(`- ${output.result.description}`);
  }

  if (showPoem) {
    lines.push('');
    lines.push('## 诗诀');
    lines.push(output.result.poem);
  }

  return lines.join('\n');
}
