/**
 * 五行 → 主题色 class 映射（纯展示）。
 * 颜色全部来自 globals.css 的五行 token，深浅色主题自动切换；未知五行回退为中性色。
 */
import { elementSoftClass, elementTextClass, isFiveElement } from '@/components/bazi/element-classes';
import type { FiveElement } from '@/types';

export type WuXingName = FiveElement;

function toWuXing(value: string | null | undefined): WuXingName | null {
  const char = value?.trim().slice(-1);
  return isFiveElement(char) ? char : null;
}

/** 文字着色；接受「水」或「亥水」「乾金」这类以五行收尾的写法。 */
export function wuxingTextClass(value: string | null | undefined): string {
  const wuxing = toWuXing(value);
  return wuxing ? elementTextClass(wuxing) : '';
}

/** 浅底标签着色；未知时返回中性灰底。 */
export function wuxingChipClass(value: string | null | undefined): string {
  const wuxing = toWuXing(value);
  return wuxing ? elementSoftClass(wuxing) : 'bg-background-secondary text-foreground-secondary';
}
