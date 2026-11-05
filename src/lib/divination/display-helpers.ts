import { STEM_ELEMENTS, ZHI_WUXING } from 'taibu-core/utils';
import type { EarthlyBranch, FiveElement, HeavenlyStem } from '@/types';

const STEM_ELEMENTS_MAP = STEM_ELEMENTS as Record<HeavenlyStem, FiveElement>;
const BRANCH_ELEMENTS_MAP = ZHI_WUXING as Record<EarthlyBranch, FiveElement>;

export function getStemElement(stem: string): FiveElement | null {
    return STEM_ELEMENTS_MAP[stem as HeavenlyStem] || null;
}

export function getBranchElement(branch: string): FiveElement | null {
    return BRANCH_ELEMENTS_MAP[branch as EarthlyBranch] || null;
}

const ELEMENT_COLOR_TOKENS: Record<FiveElement, { token: string; fallback: string }> = {
    '金': { token: '--element-metal', fallback: '#FFD700' },
    '木': { token: '--element-wood', fallback: '#228B22' },
    '水': { token: '--element-water', fallback: '#1E90FF' },
    '火': { token: '--element-fire', fallback: '#FF4500' },
    '土': { token: '--element-earth', fallback: '#8B4513' },
};

/**
 * Inline-style color for an element. Surfaces that define the --element-* tokens
 * (the chat workspace uses an accessible palette with dark variants) override
 * the historical colors; every other page keeps the fallback.
 */
export function getElementColor(element: FiveElement): string {
    const { token, fallback } = ELEMENT_COLOR_TOKENS[element];
    return `var(${token}, ${fallback})`;
}

/** 本地日期 `YYYY-MM-DD`，月/日补零。 */
export function formatDateParts(year: number, month: number, day: number): string {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 本地钟点 `HH:mm`，补零。 */
export function formatClockTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 本地日期 `YYYY-MM`，月份补零。 */
export function formatYearMonth(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
}

/** 按浏览器本地时区输出 `YYYY-MM-DD`，不做时区换算。 */
export function formatLocalDate(date: Date): string {
    return formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** 按浏览器本地时区输出 `YYYY-MM-DD HH:mm`，不做时区换算。 */
export function formatLocalDateTime(date: Date): string {
    return `${formatLocalDate(date)} ${formatClockTime(date.getHours(), date.getMinutes())}`;
}
