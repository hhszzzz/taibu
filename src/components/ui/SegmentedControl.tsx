'use client';

import { useRef, type ComponentType, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SegmentedControlMode = 'radio' | 'toggle' | 'tabs';

export type SegmentedOption<T extends string> = {
    value: T;
    label: ReactNode;
    icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
    disabled?: boolean;
    title?: string;
};

type SegmentedControlProps<T extends string> = {
    ariaLabel: string;
    value: T;
    onChange: (value: T) => void;
    options: readonly SegmentedOption<T>[];
    mode?: SegmentedControlMode;
    size?: 'sm' | 'md';
    indicator?: boolean;
    gap?: 0 | 1;
    className?: string;
    optionClassName?: string;
    indicatorClassName?: string;
    maxWidth?: number;
};

const TRACK_SIZE_CLASS = { md: 'h-11', sm: 'h-10' } as const;
const GRID_COLS_CLASS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };
const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const;

/** 分段选择：radio（互斥选项）、toggle（筛选/开关组）或 tabs（视图切换）。 */
export function SegmentedControl<T extends string>({
    ariaLabel,
    value,
    onChange,
    options,
    mode = 'radio',
    size = 'md',
    indicator = true,
    gap = 1,
    className,
    optionClassName,
    indicatorClassName,
    maxWidth,
}: SegmentedControlProps<T>) {
    const listRef = useRef<HTMLDivElement>(null);
    const activeIndex = options.findIndex(option => option.value === value);
    const lastIndex = options.length - 1;
    const thumbStyle: CSSProperties = {
        width: `calc((100% - 0.5rem - ${lastIndex} * ${gap * 0.25}rem) / ${options.length})`,
        transform: `translateX(calc(${Math.max(activeIndex, 0)} * (100% + ${gap * 0.25}rem)))`,
    };
    // A value outside the options (or a disabled one) still leaves one segment reachable by Tab.
    const tabStop = activeIndex >= 0 && !options[activeIndex]?.disabled ? activeIndex : options.findIndex(option => !option.disabled);
    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!KEYS.includes(event.key as (typeof KEYS)[number])) return;
        const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? [])];
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'Home';
        let index = event.key === 'Home' ? -1 : event.key === 'End' ? options.length : buttons.indexOf(event.currentTarget);
        // Disabled segments are skipped, wrapping around like the arrow keys do.
        for (let step = 0; step < options.length; step += 1) {
            index = (index + (forward ? 1 : -1) + options.length) % options.length;
            if (!options[index]?.disabled) break;
        }
        const next = options[index];
        if (!next || next.disabled) return;
        event.preventDefault();
        onChange(next.value);
        buttons[index]?.focus();
    };

    return (
        <div
            ref={listRef}
            role={mode === 'tabs' ? 'tablist' : mode === 'radio' ? 'radiogroup' : 'group'}
            aria-label={ariaLabel}
            className={cn(
                'relative grid rounded-xl bg-fill-field p-1',
                gap === 0 ? 'gap-0' : 'gap-1',
                GRID_COLS_CLASS[options.length] ?? 'grid-flow-col auto-cols-fr',
                TRACK_SIZE_CLASS[size],
                className,
            )}
            style={maxWidth ? { maxWidth } : undefined}
        >
            {indicator && activeIndex >= 0 ? <span
                aria-hidden="true"
                className={cn('pointer-events-none absolute inset-y-1 left-1 rounded-md bg-segmented-control-thumb shadow-[var(--shadow-thumb)] transition-transform duration-[var(--duration-base)] ease-[var(--ease-snap)] motion-reduce:transition-none', indicatorClassName)}
                style={thumbStyle}
            /> : null}
            {options.map((option, index) => {
                const active = option.value === value;
                const Icon = option.icon;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role={mode === 'tabs' ? 'tab' : mode === 'radio' ? 'radio' : undefined}
                        aria-selected={mode === 'tabs' ? active : undefined}
                        aria-checked={mode === 'radio' ? active : undefined}
                        aria-pressed={mode === 'toggle' ? active : undefined}
                        tabIndex={mode === 'toggle' ? undefined : index === tabStop ? 0 : -1}
                        disabled={option.disabled}
                        title={option.title}
                        onClick={() => onChange(option.value)}
                        onKeyDown={handleKeyDown}
                        className={cn(
                            'relative z-10 flex min-w-0 items-center justify-center gap-1.5 truncate rounded-md px-2 text-sm transition-colors duration-[var(--duration-snap)] focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
                            active ? 'font-medium text-foreground' : 'text-foreground-secondary enabled:hover:text-foreground',
                            optionClassName,
                            active && 'is-active',
                        )}
                    >
                        {Icon ? <Icon aria-hidden="true" className="h-4 w-4" /> : null}
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
