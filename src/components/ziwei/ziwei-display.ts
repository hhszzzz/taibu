/**
 * 紫微命盘展示用的纯样式映射（无业务逻辑）。
 *
 * 颜色全部走主题 token（globals.css 中的五行 / 四化变量），以便深浅色主题一致。
 */
import { getBranchElement, getStemElement } from '@/lib/divination/display-helpers';
import type { FiveElement } from '@/types';

/** 命盘容器查询名：宽于 @2xl（672px）时使用竖排星曜的完整盘，否则使用紧凑盘 + 详情卡。 */
export const ZIWEI_CONTAINER_CLASS = '@container/ziwei';

const ELEMENT_TEXT_CLASS: Record<FiveElement, string> = {
    木: 'text-wood',
    火: 'text-fire',
    土: 'text-earth',
    金: 'text-metal',
    水: 'text-water',
};

/** 天干或地支对应的五行文字色；无法识别时返回空串（继承父级颜色）。 */
export function getGanZhiCharClass(char: string | undefined): string {
    if (!char) return '';
    const element = getStemElement(char) ?? getBranchElement(char);
    return element ? ELEMENT_TEXT_CLASS[element] : '';
}

/** 生年四化：实心徽标底色（文字用 text-surface，浅色主题为白、深色主题为深底色）。 */
export const MUTAGEN_BADGE_CLASS: Record<string, string> = {
    禄: 'bg-wood',
    权: 'bg-hua-quan',
    科: 'bg-water',
    忌: 'bg-fire',
};

/** 自化（离心 ↓ / 向心 ↑）与运限四化的文字色。 */
export const MUTAGEN_TEXT_CLASS: Record<string, string> = {
    禄: 'text-wood',
    权: 'text-hua-quan',
    科: 'text-water',
    忌: 'text-fire',
};

/** 飞星连线的描边色，与四化徽标同色。 */
export const MUTAGEN_STROKE_CLASS: Record<string, string> = {
    禄: 'stroke-wood',
    权: 'stroke-hua-quan',
    科: 'stroke-water',
    忌: 'stroke-fire',
};

/** 图例中的四化飞线色块（需完整类名，供 Tailwind 静态扫描）。 */
export const MUTAGEN_BORDER_CLASS: Record<string, string> = {
    禄: 'border-wood',
    权: 'border-hua-quan',
    科: 'border-water',
    忌: 'border-fire',
};

/** 禄权科忌的固定展示顺序。 */
export const MUTAGEN_ORDER = ['禄', '权', '科', '忌'] as const;

/** 六煞星：在辅星中以 danger 色区分。 */
export const MALEFIC_MINOR_STARS: ReadonlySet<string> = new Set(['擎羊', '陀罗', '火星', '铃星', '地空', '地劫']);

/** 神煞数组顺序（core 输出）：长生十二神、博士十二神、将前十二神、岁前十二神。 */
export const SHENSHA_GROUP_LABELS = ['长生', '博士', '将前', '岁前'] as const;

/** 大限 "4~13" → "4–13"，用于展示。 */
export function formatDecadalRange(range: string | undefined): string {
    return range ? range.replace('~', '–') : '';
}

/** 宫位标签（大限 / 流年 / 三合 / 对宫 / 身宫 / 来因 等）的统一外观。 */
export type PalaceTagTone = 'accent' | 'strong' | 'muted';

/** muted 标签在紧凑盘上字号仅 9px，统一用深底保证可读；完整盘再退为浅底。 */
export const PALACE_TAG_TONE_CLASS: Record<PalaceTagTone, string> = {
    accent: 'bg-accent text-on-accent',
    strong: 'bg-foreground text-background',
    muted: 'bg-foreground text-background @2xl/ziwei:bg-background-tertiary @2xl/ziwei:text-foreground/80',
};
