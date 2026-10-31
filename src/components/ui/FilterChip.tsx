/**
 * 胶囊筛选按钮：选中态由 aria-pressed 表达，样式随之切换。
 *
 * 命理记录、通知等列表页的筛选共用这一套外观。
 */
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const FILTER_CHIP_CLASS = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border-[0.5px] border-border-hover bg-surface px-3 text-[13px] text-foreground-secondary transition-colors enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-transparent aria-pressed:bg-foreground aria-pressed:text-background';

export function FilterChip({ pressed, className, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'aria-pressed'> & { pressed: boolean }) {
    return <button type="button" aria-pressed={pressed} className={cn(FILTER_CHIP_CLASS, className)} {...props} />;
}
