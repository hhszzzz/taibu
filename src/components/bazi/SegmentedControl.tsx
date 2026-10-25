/**
 * 分段控件（八字 / 合盘共用的展示组件）
 *
 * 轨道 `bg-background-secondary`，选中项 `bg-surface shadow-sm`：白色滑块跟着选中项平移（与设置页 SegmentedChoice 同一手感）。
 * - mode="toggle"：按钮组，使用 aria-pressed（表单单选）
 * - mode="tabs"：视图切换，使用 tablist / tab / aria-selected
 */

import type { CSSProperties } from 'react';

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
    const activeIndex = options.findIndex((option) => option.value === value);
    // 滑块宽 = (轨道内宽 − 段间距) / 段数；位移一段 = 自身宽 + 1 个 gap（0.25rem）。
    const thumbStyle: CSSProperties = {
        width: `calc((100% - 0.5rem - ${options.length - 1} * 0.25rem) / ${options.length})`,
        transform: `translateX(calc(${Math.max(activeIndex, 0)} * (100% + 0.25rem)))`,
    };
    return (
        <div
            role={isTabs ? 'tablist' : 'group'}
            aria-label={ariaLabel}
            className={`relative grid ${GRID_COLS_CLASS[options.length] ?? 'grid-flow-col auto-cols-fr'} gap-1 rounded-xl bg-background-secondary p-1 ${TRACK_SIZE_CLASS[size]} ${className}`}
        >
            {activeIndex >= 0 && <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-1 left-1 rounded-[7px] bg-surface shadow-sm transition-transform duration-200 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none"
                style={thumbStyle}
            />}
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
                        className={`relative z-10 min-w-0 truncate rounded-[7px] px-2 text-sm transition-colors duration-150 ${active
                            ? 'font-medium text-foreground'
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
