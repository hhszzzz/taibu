/**
 * 日运 / 月运共用的纯展示映射（无业务逻辑）。颜色全部走主题 token，深浅色一致。
 */
import { isLevelFavorable } from '@/lib/divination/fortune';
import type { FortuneLevel } from '@/types';

export type FortuneTone = 'favorable' | 'neutral' | 'unfavorable';

/** 运势等级 → 语义色调：中吉及以上为吉，平为中性，其余为凶。 */
export function getFortuneTone(level: FortuneLevel): FortuneTone {
    if (isLevelFavorable(level)) return 'favorable';
    return level === '平' ? 'neutral' : 'unfavorable';
}

/** 等级色调 → 小圆点（图例）与浅底标签（月历）。 */
export const FORTUNE_TONE_DOT_CLASS: Record<FortuneTone, string> = {
    favorable: 'bg-wood',
    neutral: 'bg-foreground-tertiary',
    unfavorable: 'bg-fire',
};

export const FORTUNE_TONE_BADGE_CLASS: Record<FortuneTone, string> = {
    favorable: 'bg-wood-soft text-wood',
    neutral: 'bg-background-secondary text-foreground-secondary',
    unfavorable: 'bg-fire-soft text-fire',
};

/** 某日的日运页链接（月历与关键日跳转共用）。 */
export function getDailyHref(year: number, month: number, day: number): string {
    return `/daily?date=${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 页面通用卡片外观。 */
export const FORTUNE_CARD_CLASS = 'rounded-2xl border-[0.5px] border-border bg-surface';
export const FORTUNE_SECONDARY_BUTTON_CLASS = 'inline-flex items-center justify-center gap-1.5 rounded-[10px] border-[0.5px] border-border-hover bg-surface text-sm text-foreground transition-colors hover:bg-background-secondary';
