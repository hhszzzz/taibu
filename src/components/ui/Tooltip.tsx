'use client';

import { isValidElement, useState, type ReactNode } from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from '@/lib/utils';

export function TooltipProvider({ delay = 400, ...props }: TooltipPrimitive.Provider.Props) {
    return <TooltipPrimitive.Provider delay={delay} {...props} />;
}

export function Tooltip({ label, children, side = 'top' }: {
    label: string;
    children: ReactNode;
    side?: 'top' | 'bottom';
}) {
    const trigger = isValidElement(children) ? children : <span className="inline-flex items-center">{children}</span>;
    // A popup portaled to <body> sits behind an open native modal's top layer; keep it in the dialog instead.
    const [container, setContainer] = useState<HTMLElement | null>(null);

    return (
        <TooltipPrimitive.Provider delay={400}>
        <TooltipPrimitive.Root>
            <TooltipPrimitive.Trigger
                ref={(node: HTMLElement | null) => {
                    const dialog = node?.closest<HTMLElement>('dialog, [role="dialog"]') ?? null;
                    setContainer(current => current === dialog ? current : dialog);
                }}
                render={trigger}
                delay={400}
            />
            <TooltipPrimitive.Portal container={container ?? undefined}>
                <TooltipPrimitive.Positioner side={side} sideOffset={6} align="center" className="z-[var(--z-tooltip)]">
                    <TooltipPrimitive.Popup
                        role="tooltip"
                        className={cn(
                            'pointer-events-none max-w-[calc(100vw-16px)] origin-[var(--transform-origin)] overflow-hidden text-ellipsis whitespace-nowrap rounded-md border-[0.5px] border-border bg-surface px-2 py-[3px] text-center text-[13px] font-normal leading-[18px] text-foreground-secondary shadow-[var(--shadow-raised)] transition-[opacity,transform] duration-120 data-ending-style:opacity-0 data-ending-style:scale-[0.96] data-starting-style:opacity-0 data-starting-style:scale-[0.96]',
                        )}
                    >
                        {label}
                    </TooltipPrimitive.Popup>
                </TooltipPrimitive.Positioner>
            </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
    );
}
