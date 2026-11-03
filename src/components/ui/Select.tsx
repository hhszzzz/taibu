'use client';

import { useRef, useState } from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { fieldClass } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

export type SelectOption<Value extends string | number> = {
    value: Value;
    label: string;
    description?: string;
    disabled?: boolean;
};

/** The nearest box that scrolls, e.g. the body of the dialog the trigger sits in. */
function scrollContainerOf(node: Element | null): HTMLElement | null {
    for (let parent = node?.parentElement ?? null; parent; parent = parent.parentElement) {
        if (parent.scrollHeight > parent.clientHeight + 1 && /(auto|scroll)/u.test(getComputedStyle(parent).overflowY)) return parent;
    }
    return null;
}

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

    // 弹层获得焦点时浏览器会把它滚进视野，在对话框里会顺带把整块内容往上推。触发器本来就看得见时，开合的两帧内把滚动位置顶回去；
    // 触发器在视野外就照常滚过去。
    const onOpenChange = (open: boolean) => {
        if (!open) return;
        const trigger = triggerRef.current;
        const scroller = scrollContainerOf(trigger);
        if (!trigger || !scroller) return;
        const box = scroller.getBoundingClientRect();
        const rect = trigger.getBoundingClientRect();
        if (rect.top < box.top || rect.bottom > box.bottom) return;
        const top = scroller.scrollTop;
        const restore = () => { if (scroller.scrollTop !== top) scroller.scrollTop = top; };
        scroller.addEventListener('scroll', restore, { passive: true });
        requestAnimationFrame(() => requestAnimationFrame(() => {
            scroller.removeEventListener('scroll', restore);
            restore();
        }));
    };

    return (
        <SelectPrimitive.Root
            value={value}
            onValueChange={next => { if (next !== null) onChange(next); }}
            onOpenChange={onOpenChange}
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
                    'group flex h-[2.375rem] w-full min-w-0 items-center justify-between gap-2 rounded-xl px-3 text-left text-sm data-placeholder:text-foreground-tertiary',
                    fieldClass,
                    className,
                )}
            >
                <SelectPrimitive.Value placeholder={placeholder} className="min-w-0 flex-1 truncate" />
                {hideIcon ? null : <SelectPrimitive.Icon><ChevronDown className="h-4 w-4 shrink-0 text-foreground-tertiary transition-transform duration-[var(--duration-base)] ease-[var(--ease-snap)] group-data-popup-open:rotate-180" aria-hidden="true" /></SelectPrimitive.Icon>}
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Portal container={portalContainer ?? undefined}>
                <SelectPrimitive.Positioner
                    side="bottom"
                    align="start"
                    sideOffset={4}
                    alignItemWithTrigger={false}
                    // 对话框本身就是滚动容器：浮层按视口定位，才不会被对话框的滚动偏移带跑
                    // （absolute 首帧会按未滚动的坐标落一次，再把对话框横向顶出去）。
                    positionMethod={portalContainer ? 'fixed' : 'absolute'}
                    className="z-[var(--z-popup)] outline-none"
                >
                    <SelectPrimitive.Popup
                        className={cn(
                            'max-h-[var(--available-height)] w-max min-w-[max(var(--anchor-width),11rem)] max-w-[min(24rem,calc(100vw-1rem))] origin-[var(--transform-origin)] overflow-hidden rounded-xl bg-surface p-1 text-foreground shadow-[var(--shadow-panel-popover)] transition-[opacity,scale] duration-[var(--duration-snap)] ease-[var(--ease-out)] data-ending-style:opacity-0 data-ending-style:scale-[0.98] data-starting-style:opacity-0 data-starting-style:scale-[0.98]',
                            popupClassName,
                        )}
                    >
                        {/* 滚动交给列表本身：浮层里不放上下箭头，免得挡住首尾选项。 */}
                        <SelectPrimitive.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain">
                            {options.map(option => (
                                <SelectPrimitive.Item
                                    key={String(option.value)}
                                    value={option.value}
                                    disabled={option.disabled}
                                    className="relative flex min-h-8 cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 pr-8 text-sm text-foreground-secondary outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-45 data-highlighted:bg-fill-ghost-hover data-highlighted:text-foreground data-selected:text-foreground"
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
                    </SelectPrimitive.Popup>
                </SelectPrimitive.Positioner>
            </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
    );
}
