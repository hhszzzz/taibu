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
    return (
        <div
            role="tablist"
            aria-label="命盘视图"
            className="grid h-10 grid-cols-3 gap-1 rounded-[10px] bg-background-secondary p-1 lg:flex lg:h-auto lg:gap-6 lg:rounded-none lg:border-b-[0.5px] lg:border-border lg:bg-transparent lg:p-0"
        >
            {RESULT_TAB_OPTIONS.map((option) => {
                const active = option.value === activeTab;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange(option.value)}
                        className={`min-w-0 truncate rounded-[7px] px-2 text-sm transition-colors duration-150 lg:-mb-px lg:h-11 lg:rounded-none lg:border-b-2 lg:px-0 lg:text-[15px] ${active
                            ? 'bg-surface font-medium text-foreground shadow-sm lg:border-foreground lg:bg-transparent lg:shadow-none'
                            : 'text-foreground-secondary hover:text-foreground lg:border-transparent'
                            }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
