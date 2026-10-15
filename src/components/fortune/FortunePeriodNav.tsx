import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface FortunePeriodNavProps {
    /** 桌面端页面标题；移动端标题由顶栏承担。 */
    title: string;
    /** 当前周期：日运为日期选择按钮，月运为月份文本。 */
    current: ReactNode;
    prevLabel: string;
    nextLabel: string;
    onPrev: () => void;
    onNext: () => void;
    /** 到达可选范围边界时禁用。 */
    prevDisabled?: boolean;
    nextDisabled?: boolean;
    /** 不在当前周期时显示「回到今天 / 回到本月」（移动端用短文案）；null 表示已在当前周期。 */
    reset?: { label: string; shortLabel: string; onClick: () => void } | null;
}

/** 当前周期块的外观（日运日期按钮在此基础上加 hover）。 */
export const PERIOD_NAV_CURRENT_CLASS = 'flex h-9 items-center gap-2 rounded-[10px] px-2.5 text-[0.9375rem] font-medium tabular-nums lg:h-10 lg:border-[0.5px] lg:border-border-hover lg:bg-surface lg:px-3.5 lg:text-sm lg:font-normal';

const NAV_BUTTON_CLASS = 'flex size-9 items-center justify-center rounded-[10px] text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent lg:size-10 lg:border-[0.5px] lg:border-border-hover lg:bg-surface';
const RESET_BUTTON_CLASS = 'h-9 rounded-[10px] px-2.5 text-[13px] text-accent transition-colors hover:bg-accent-light lg:h-10';

/**
 * 日运 / 月运页头：桌面端标题居左、周期切换居右；移动端三栏居中（左空位、切换、右侧回到当前）。
 */
export function FortunePeriodNav({ title, current, prevLabel, nextLabel, onPrev, onNext, prevDisabled = false, nextDisabled = false, reset = null }: FortunePeriodNavProps) {
    return (
        <header className="grid grid-cols-[1fr_auto_1fr] items-center lg:flex lg:justify-between lg:gap-4">
            <h1 className="hidden font-display text-[32px] font-normal leading-tight lg:block">{title}</h1>
            <span aria-hidden="true" className="lg:hidden" />
            <div className="flex items-center gap-1 lg:gap-2">
                <button type="button" aria-label={prevLabel} onClick={onPrev} disabled={prevDisabled} className={NAV_BUTTON_CLASS}>
                    <ChevronLeft className="size-4" />
                </button>
                {current}
                <button type="button" aria-label={nextLabel} onClick={onNext} disabled={nextDisabled} className={NAV_BUTTON_CLASS}>
                    <ChevronRight className="size-4" />
                </button>
                {reset && (
                    <button type="button" onClick={reset.onClick} className={`hidden lg:block ${RESET_BUTTON_CLASS}`}>
                        {reset.label}
                    </button>
                )}
            </div>
            {reset && (
                <button type="button" onClick={reset.onClick} className={`justify-self-end lg:hidden ${RESET_BUTTON_CLASS}`}>
                    {reset.shortLabel}
                </button>
            )}
        </header>
    );
}
