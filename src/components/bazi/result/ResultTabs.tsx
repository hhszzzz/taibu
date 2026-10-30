import { useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { useTabIndicator } from '@/lib/motion/tab-indicator';

export type ResultTab = 'basic' | 'professional' | 'notes';

const RESULT_TAB_OPTIONS: readonly { value: ResultTab; label: string }[] = [
    { value: 'professional', label: '专业排盘' },
    { value: 'basic', label: '基本信息' },
    { value: 'notes', label: '断事笔记' },
];

/** 命盘视图切换：移动端为分段控件，桌面端为下划线标签（与设计稿一致）。 */
export function ResultTabs({
    activeTab,
    onChange,
}: {
    activeTab: ResultTab;
    onChange: (tab: ResultTab) => void;
}) {
    const listRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
    useTabIndicator(listRef);
    const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const current = RESULT_TAB_OPTIONS.findIndex(option => option.value === activeTab);
        const next = event.key === 'Home' ? 0
            : event.key === 'End' ? RESULT_TAB_OPTIONS.length - 1
                : (current + (event.key === 'ArrowRight' ? 1 : -1) + RESULT_TAB_OPTIONS.length) % RESULT_TAB_OPTIONS.length;
        event.preventDefault();
        onChange(RESULT_TAB_OPTIONS[next].value);
        tabRefs.current[next]?.focus();
    };
    return (
        <div
            ref={listRef}
            role="tablist"
            aria-label="命盘视图"
            onKeyDown={move}
            className="motion-tabs motion-tabs--result grid h-10 grid-cols-3 gap-1 rounded-xl bg-background-secondary p-1 lg:flex lg:h-auto lg:gap-6 lg:rounded-none lg:border-b-[0.5px] lg:border-border lg:bg-transparent lg:p-0"
        >
            {RESULT_TAB_OPTIONS.map((option, index) => {
                const active = option.value === activeTab;
                return (
                    <Button unstyled
                        key={option.value}
                        ref={(node) => { tabRefs.current[index] = node; }}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(option.value)}
                        className={`min-w-0 truncate rounded-[7px] px-2 text-sm transition-colors duration-150 lg:-mb-px lg:h-11 lg:rounded-none lg:border-b-2 lg:px-0 lg:text-[15px] ${active
                            ? 'bg-surface font-medium text-foreground shadow-sm lg:border-foreground lg:bg-transparent lg:shadow-none'
                            : 'text-foreground-secondary hover:text-foreground lg:border-transparent'
                            }`}
                    >
                        {option.label}
                    </Button>
                );
            })}
        </div>
    );
}
