/**
 * 详查工具的规范文本：默认只给所查事实；判定口径每次相同，只在 detailLevel=full 时附在正文后。
 * 计算规则只进 JSON（审计与复现），不写进文本。JSON 不分详略，始终带口径与计算规则。
 * 按内容筛掉的事实不静默丢弃：用「未列出」写明条数、类型与取回方式。
 */

import { normalizeDetailLevelBinary } from '../../shared/render-utils.js';
import type { DetailLevel } from './types.js';

export interface DrilldownTextOptions {
  detailLevel?: DetailLevel;
}

/** 筛选后没有列出的事实：总条数、按类型计数与取回方式 */
export interface DrilldownOmittedJSON {
  条数: number;
  按类型: Array<{ 类型: string; 条数: number }>;
  提示: string;
}

/**
 * 详查文本：`render(result, full)` 给出正文（full 时可带更完整的上下文），
 * detailLevel=full（或 more）时再追加「## 口径」。
 */
export function drilldownText<Result extends object>(
  notes: readonly string[],
  render: (result: Result, full: boolean) => string,
): (result: Result, options?: DrilldownTextOptions) => string {
  return (result, options) => {
    const full = normalizeDetailLevelBinary(options?.detailLevel) === 'full';
    const body = render(result, full);
    return full ? `${body}\n\n## 口径\n\n${notes.map((note) => `- ${note}`).join('\n')}` : body;
  };
}

/**
 * 每条被筛掉的事实记一个类型，按类型计数；类型按 `order` 排列，不在其中的按首次出现排在后面。
 * 没有筛掉的返回 undefined。
 */
export function omittedSummary(types: readonly string[], hint: string, order: readonly string[] = []): DrilldownOmittedJSON | undefined {
  if (!types.length) return undefined;
  const counts = new Map<string, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
  const rank = (type: string) => (order.includes(type) ? order.indexOf(type) : order.length);
  const sorted = [...counts].sort(([a], [b]) => rank(a) - rank(b));
  return { 条数: types.length, 按类型: sorted.map(([类型, 条数]) => ({ 类型, 条数 })), 提示: hint };
}

/** 「- 另有 5 条（六合 1、相刑 2）；去掉 types 可看全部」 */
export function omittedLine(omitted: DrilldownOmittedJSON): string {
  return `- 另有 ${omitted.条数} 条（${omitted.按类型.map((item) => `${item.类型} ${item.条数}`).join('、')}）；${omitted.提示}`;
}
