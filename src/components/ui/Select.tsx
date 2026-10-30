'use client';

import { useRef, useState } from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SelectOption<Value extends string | number> = {
    value: Value;
    label: string;
    description?: string;
    disabled?: boolean;
};

export interface SelectProps<Value extends string | number> {
    value: Value | null;
    onChange: (value: Value) => void;
    options: readonly SelectOption<Value>[];
    id?: string;
    name?: string;
    form?: string;
    required?: boolean;
    disabled?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    className?: string;
    popupClassName?: string;
    hideIcon?: boolean;
    title?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean | 'false' | 'true' | 'grammar' | 'spelling';
}

export function Select<Value extends string | number>({
    value,
    onChange,
    options,
    id,
    name,
    form,
    required,
    disabled,
    placeholder = '请选择',
    ariaLabel,
    className,
    popupClassName,
    hideIcon = false,
    title,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
}: SelectProps<Value>) {
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

    return (
        <SelectPrimitive.Root
            value={value}
            onValueChange={next => { if (next !== null) onChange(next); }}
            items={options}
            name={name}
            form={form}
            required={required}
            disabled={disabled}
            modal={false}
        >
            <SelectPrimitive.Trigger
                ref={node => {
                    triggerRef.current = node;
                    const dialog = node?.closest<HTMLElement>('dialog, [role="dialog"]') ?? null;
                    if (dialog !== portalContainer) setPortalContainer(dialog);
                }}
                id={id}
                title={title}
                aria-label={ariaLabel}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className={cn(
                    'flex h-[2.375rem] w-full min-w-0 items-center justify-between gap-2 rounded-xl border-[0.5px] border-border bg-surface px-3 text-left text-sm text-foreground transition-colors focus-visible:border-[var(--control-focus,var(--accent))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger data-placeholder:text-foreground-tertiary',
                    className,
                )}
            >
                <SelectPrimitive.Value placeholder={placeholder} className="min-w-0 flex-1 truncate" />
                {hideIcon ? null : <SelectPrimitive.Icon><ChevronDown className="h-4 w-4 shrink-0 text-foreground-tertiary" aria-hidden="true" /></SelectPrimitive.Icon>}
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Portal container={portalContainer ?? undefined}>
                <SelectPrimitive.Positioner
                    side="bottom"
                    align="start"
                    sideOffset={4}
                    alignItemWithTrigger={false}
                    className="z-[var(--z-popup)] outline-none"
                >
                    <SelectPrimitive.Popup
                        className={cn(
                            'max-h-[var(--available-height)] w-[var(--anchor-width)] min-w-44 origin-[var(--transform-origin)] overflow-hidden rounded-xl border-[0.5px] border-border bg-surface p-1 text-foreground shadow-[var(--shadow-panel-popover)] transition-[opacity,transform] duration-150 data-ending-style:opacity-0 data-ending-style:scale-[0.98] data-starting-style:opacity-0 data-starting-style:scale-[0.98]',
                            popupClassName,
                        )}
                    >
                        <SelectPrimitive.ScrollUpArrow className="flex h-6 items-center justify-center bg-surface text-foreground-tertiary">
                            <ChevronUp className="h-4 w-4" aria-hidden="true" />
                        </SelectPrimitive.ScrollUpArrow>
                        <SelectPrimitive.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain">
                            {options.map(option => (
                                <SelectPrimitive.Item
                                    key={String(option.value)}
                                    value={option.value}
                                    disabled={option.disabled}
                                    className="relative flex min-h-9 cursor-default items-center gap-2 rounded-lg px-2.5 pr-8 text-sm text-foreground-secondary outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-45 data-highlighted:bg-fill-field data-highlighted:text-foreground data-selected:text-foreground"
                                >
                                    <SelectPrimitive.ItemText className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate">{option.label}</span>
                                        {option.description ? <span className="text-xs leading-4 text-foreground-tertiary">{option.description}</span> : null}
                                    </SelectPrimitive.ItemText>
                                    <SelectPrimitive.ItemIndicator
                                        render={<span className="pointer-events-none absolute right-2.5 flex h-4 w-4 items-center justify-center text-accent" />}
                                    >
                                        <Check className="h-4 w-4" aria-hidden="true" />
                                    </SelectPrimitive.ItemIndicator>
                                </SelectPrimitive.Item>
                            ))}
                        </SelectPrimitive.List>
                        <SelectPrimitive.ScrollDownArrow className="flex h-6 items-center justify-center bg-surface text-foreground-tertiary">
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        </SelectPrimitive.ScrollDownArrow>
                    </SelectPrimitive.Popup>
                </SelectPrimitive.Positioner>
            </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
    );
}
