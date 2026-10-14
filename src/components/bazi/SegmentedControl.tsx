/**
 * 分段控件（八字 / 合盘共用的展示组件）
 *
 * 轨道 `bg-background-secondary`，选中项 `bg-surface shadow-sm`。
 * - mode="toggle"：按钮组，使用 aria-pressed（表单单选）
 * - mode="tabs"：视图切换，使用 tablist / tab / aria-selected
 */

export type SegmentedOption<T extends string> = {
    value: T;
    label: string;
};

type SegmentedControlProps<T extends string> = {
    options: readonly SegmentedOption<T>[];
    value: T | null | undefined;
    onChange: (value: T) => void;
    ariaLabel: string;
    mode?: 'toggle' | 'tabs';
    size?: 'md' | 'sm';
    className?: string;
};

const TRACK_SIZE_CLASS = {
    md: 'h-11',
    sm: 'h-10',
} as const;

const GRID_COLS_CLASS: Record<number, string> = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
};

export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
    mode = 'toggle',
    size = 'md',
    className = '',
}: SegmentedControlProps<T>) {
    const isTabs = mode === 'tabs';
    return (
        <div
            role={isTabs ? 'tablist' : 'group'}
            aria-label={ariaLabel}
            className={`grid ${GRID_COLS_CLASS[options.length] ?? 'grid-flow-col auto-cols-fr'} gap-1 rounded-[10px] bg-background-secondary p-1 ${TRACK_SIZE_CLASS[size]} ${className}`}
        >
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role={isTabs ? 'tab' : undefined}
                        aria-selected={isTabs ? active : undefined}
                        aria-pressed={isTabs ? undefined : active}
                        onClick={() => onChange(option.value)}
                        className={`min-w-0 truncate rounded-[7px] px-2 text-sm transition-colors duration-150 ${active
                            ? 'bg-surface font-medium text-foreground shadow-sm'
                            : 'text-foreground-secondary hover:text-foreground'
                            }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
