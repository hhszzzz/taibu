'use client';

import { forwardRef, createContext, useContext, useState } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from '@/lib/utils';

/** Where the popup lands: inside the enclosing native dialog so it is not hidden behind the top layer. */
const PortalTarget = createContext<((node: HTMLElement | null) => void) | null>(null);
const PortalContainer = createContext<HTMLElement | null>(null);

export function Popover({ children, onOpenChange, ...props }: PopoverPrimitive.Root.Props) {
    const [container, setContainer] = useState<HTMLElement | null>(null);
    const sync = (node: HTMLElement | null) => setContainer(current => current === node ? current : node);
    return (
        <PortalContainer.Provider value={container}>
            <PortalTarget.Provider value={sync}>
                <PopoverPrimitive.Root
                    onOpenChange={(open, details) => {
                        if (open) sync(details.trigger?.closest<HTMLElement>('dialog, [role="dialog"]') ?? null);
                        onOpenChange?.(open, details);
                    }}
                    {...props}
                >{children}</PopoverPrimitive.Root>
            </PortalTarget.Provider>
        </PortalContainer.Provider>
    );
}

function callRef<T>(ref: React.Ref<T> | undefined, node: T | null) {
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
}

export const PopoverTrigger = forwardRef<HTMLButtonElement, PopoverPrimitive.Trigger.Props>(function PopoverTrigger(props, ref) {
    const sync = useContext(PortalTarget);
    return (
        <PopoverPrimitive.Trigger
            {...props}
            ref={(node: HTMLButtonElement | null) => {
                sync?.(node?.closest('dialog, [role="dialog"]') ?? null);
                // 组合渲染（Tooltip 等）会把自己的 ref 作为 prop 传入；spread 之后再接线，避免被覆盖。
                callRef((props as { ref?: React.Ref<HTMLButtonElement> }).ref, node);
                callRef(ref, node);
            }}
        />
    );
});

export function PopoverContent({
    className,
    side = 'bottom',
    sideOffset = 4,
    align = 'start',
    alignOffset = 0,
    children,
    ...props
}: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, 'side' | 'sideOffset' | 'align' | 'alignOffset'>) {
    const container = useContext(PortalContainer);
    return (
        <PopoverPrimitive.Portal container={container ?? undefined}>
            <PopoverPrimitive.Positioner
                side={side}
                sideOffset={sideOffset}
                align={align}
                alignOffset={alignOffset}
                className="z-[var(--z-popup)] outline-none"
            >
                <PopoverPrimitive.Popup
                    className={cn(
                        'max-h-[var(--available-height)] max-w-[calc(100vw-1rem)] origin-[var(--transform-origin)] overflow-y-auto rounded-xl border-[0.5px] border-border bg-surface p-3 text-foreground shadow-[var(--shadow-panel-popover)] outline-none transition-[opacity,transform] duration-150 data-ending-style:opacity-0 data-ending-style:scale-[0.98] data-starting-style:opacity-0 data-starting-style:scale-[0.98]',
                        className,
                    )}
                    {...props}
                >
                    {children}
                </PopoverPrimitive.Popup>
            </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
    );
}

export function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
    return <PopoverPrimitive.Title className={cn('text-sm font-medium text-foreground', className)} {...props} />;
}

export function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
    return <PopoverPrimitive.Description className={cn('mt-1 text-[13px] leading-relaxed text-foreground-secondary', className)} {...props} />;
}

export const PopoverClose = PopoverPrimitive.Close;
