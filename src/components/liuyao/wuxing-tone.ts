/**
 * 五行 → 主题色 class 映射（纯展示）。
 * 颜色全部来自 globals.css 的五行 token，深浅色主题自动切换；未知五行回退为中性色。
 */

export type WuXingName = '木' | '火' | '土' | '金' | '水';

const WUXING_TEXT_CLASS: Record<WuXingName, string> = {
  木: 'text-wood',
  火: 'text-fire',
  土: 'text-earth',
  金: 'text-metal',
  水: 'text-water',
};

const WUXING_CHIP_CLASS: Record<WuXingName, string> = {
  木: 'bg-wood-soft text-wood',
  火: 'bg-fire-soft text-fire',
  土: 'bg-earth-soft text-earth',
  金: 'bg-metal-soft text-metal',
  水: 'bg-water-soft text-water',
};

const NEUTRAL_CHIP_CLASS = 'bg-background-secondary text-foreground-secondary';

function toWuXing(value: string | null | undefined): WuXingName | null {
  const char = value?.trim().slice(-1);
  return char && char in WUXING_TEXT_CLASS ? (char as WuXingName) : null;
}

/** 文字着色；接受「水」或「亥水」「乾金」这类以五行收尾的写法。 */
export function wuxingTextClass(value: string | null | undefined): string {
  const wuxing = toWuXing(value);
  return wuxing ? WUXING_TEXT_CLASS[wuxing] : '';
}

/** 浅底标签着色；未知时返回中性灰底。 */
export function wuxingChipClass(value: string | null | undefined): string {
  const wuxing = toWuXing(value);
  return wuxing ? WUXING_CHIP_CLASS[wuxing] : NEUTRAL_CHIP_CLASS;
}
