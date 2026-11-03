'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fieldClass } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

export type ComboBoxOption<Value extends string | number> = {
    value: Value;
    label: string;
    description?: string;
};

export interface ComboBoxProps<Value extends string | number> {
    value: Value;
    options: readonly ComboBoxOption<Value>[];
    onChange: (value: Value) => void;
    ariaLabel: string;
    placeholder?: string;
    suffix?: string;
    className?: string;
    inputMode?: 'text' | 'numeric';
    maxLength?: number;
    disabled?: boolean;
}

/** 可输入的下拉框：键入或点选，业务层不直接引用 Base UI。 */
export function ComboBox<Value extends string | number>({
    value,
    options,
    onChange,
    ariaLabel,
    placeholder,
    suffix,
    className,
    inputMode = 'text',
    maxLength,
    disabled,
}: ComboBoxProps<Value>) {
    const selectedLabel = options.find(option => option.value === value)?.label ?? '';
    const [draft, setDraft] = useState(selectedLabel);
    const focused = useRef(false);

    useEffect(() => {
        if (!focused.current) setDraft(selectedLabel);
    }, [selectedLabel]);

    const pick = (text: string): ComboBoxOption<Value> | undefined => {
        const trimmed = text.trim();
        if (!trimmed) return undefined;
        const byLabel = options.find(option => option.label === trimmed);
        if (byLabel) return byLabel;
        if (inputMode !== 'numeric') return options.find(option => String(option.value) === trimmed);
        const numeric = Number(trimmed);
        return Number.isInteger(numeric) ? options.find(option => option.value === numeric) : undefined;
    };

    const commit = () => {
        const picked = pick(draft);
        if (picked) {
            onChange(picked.value);
            setDraft(picked.label);
        } else {
            setDraft(selectedLabel);
        }
    };

    return (
        <ComboboxPrimitive.Root
            items={options.map(option => option.value)}
            value={value}
            onValueChange={next => {
                if (next == null) return;
                const picked = options.find(option => option.value === next);
                if (picked) setDraft(picked.label);
                onChange(next);
            }}
            itemToStringLabel={item => options.find(option => option.value === item)?.label ?? String(item)}
            autoHighlight
            disabled={disabled}
        >
            <div className="relative min-w-0">
                <ComboboxPrimitive.Input
                    aria-label={ariaLabel}
                    value={draft}
                    inputMode={inputMode}
                    placeholder={placeholder}
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={event => {
                        const next = inputMode === 'numeric'
                            ? event.target.value.replace(/\D/gu, '').slice(0, maxLength ?? 4)
                            : event.target.value;
                        setDraft(next);
                        const picked = pick(next);
                        if (picked) onChange(picked.value);
                    }}
                    onFocus={event => { focused.current = true; event.currentTarget.select(); }}
                    onBlur={() => { focused.current = false; commit(); }}
                    onKeyDown={event => {
                        if (event.key === 'Enter') { event.preventDefault(); commit(); }
                    }}
                    aria-invalid={draft.trim() !== '' && !pick(draft)}
                    maxLength={maxLength}
                    className={cn('h-11 w-full rounded-xl px-3 text-sm text-foreground tabular-nums', fieldClass, suffix ? 'pr-12' : 'pr-9', className)}
                />
                {suffix && (
                    <span aria-hidden="true" className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-[13px] text-foreground-tertiary">
                        {suffix}
                    </span>
                )}
                <ComboboxPrimitive.Trigger
                    aria-label={`展开${ariaLabel}列表`}
                    disabled={disabled}
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-foreground-tertiary transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </ComboboxPrimitive.Trigger>
            </div>
            <ComboboxPrimitive.Portal>
                <ComboboxPrimitive.Positioner side="bottom" align="start" sideOffset={4} positionMethod="fixed" className="z-[var(--z-popup)] outline-none">
                    <ComboboxPrimitive.Popup className="max-h-[min(14rem,var(--available-height))] w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-hidden rounded-xl bg-surface p-1 text-foreground shadow-[var(--shadow-panel-popover)] transition-[opacity,scale] duration-[var(--duration-snap)] ease-[var(--ease-out)] data-ending-style:opacity-0 data-ending-style:scale-[0.98] data-starting-style:opacity-0 data-starting-style:scale-[0.98]">
                        <ComboboxPrimitive.List className="max-h-[min(14rem,var(--available-height))] overflow-y-auto overscroll-contain">
                            {optionValue => {
                                const option = options.find(item => item.value === optionValue);
                                if (!option) return null;
                                return (
                                    <ComboboxPrimitive.Item
                                        key={String(option.value)}
                                        value={option.value}
                                        className="relative flex min-h-8 cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 pr-8 text-sm text-foreground-secondary outline-none select-none data-highlighted:bg-fill-ghost-hover data-highlighted:text-foreground data-selected:text-foreground"
                                    >
                                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                                        {option.description ? <span className="text-xs text-foreground-tertiary">{option.description}</span> : null}
                                        <ComboboxPrimitive.ItemIndicator className="pointer-events-none absolute right-2.5 flex h-4 w-4 items-center justify-center text-accent">
                                            <Check className="h-4 w-4" aria-hidden="true" />
                                        </ComboboxPrimitive.ItemIndicator>
                                    </ComboboxPrimitive.Item>
                                );
                            }}
                        </ComboboxPrimitive.List>
                    </ComboboxPrimitive.Popup>
                </ComboboxPrimitive.Positioner>
            </ComboboxPrimitive.Portal>
        </ComboboxPrimitive.Root>
    );
}
