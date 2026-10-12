/**
 * 干支五行着色（Tailwind token 类名），八字、三式等盘面共用
 *
 * 只做展示映射：五行归属仍由 `@/lib/divination/display-helpers` 计算，
 * 这里把五行转换为主题变量驱动的 `text-wood|fire|earth|metal|water` 等类名，
 * 保证浅色 / 深色主题下颜色一致。
 */
import { getBranchElement, getStemElement } from '@/lib/divination/display-helpers';
import type { FiveElement } from '@/types';

const ELEMENT_TEXT_CLASS: Record<FiveElement, string> = {
    木: 'text-wood',
    火: 'text-fire',
    土: 'text-earth',
    金: 'text-metal',
    水: 'text-water',
};

const ELEMENT_SOFT_CLASS: Record<FiveElement, string> = {
    木: 'bg-wood-soft text-wood',
    火: 'bg-fire-soft text-fire',
    土: 'bg-earth-soft text-earth',
    金: 'bg-metal-soft text-metal',
    水: 'bg-water-soft text-water',
};

const FIVE_ELEMENTS = Object.keys(ELEMENT_TEXT_CLASS) as FiveElement[];

/** canonical JSON 的「五行」字段是普通字符串，取色前先收窄。 */
export function isFiveElement(value: unknown): value is FiveElement {
    return typeof value === 'string' && (FIVE_ELEMENTS as readonly string[]).includes(value);
}

/** 天干或地支所属五行；非干支字符返回 null。 */
export function getGanZhiElement(char: string): FiveElement | null {
    return getStemElement(char) ?? getBranchElement(char);
}

/** 五行文字色类名；未知五行回退为正文色。 */
export function elementTextClass(element: FiveElement | null | undefined): string {
    return element ? ELEMENT_TEXT_CLASS[element] : 'text-foreground';
}

/** 单个天干/地支的文字色类名。 */
export function ganZhiTextClass(char: string): string {
    return elementTextClass(getGanZhiElement(char));
}

/** 单个天干/地支的柔和底色 + 文字色类名（用于选择按钮、徽标）。 */
export function ganZhiSoftClass(char: string): string {
    const element = getGanZhiElement(char);
    return element ? ELEMENT_SOFT_CLASS[element] : 'bg-background-secondary text-foreground';
}
