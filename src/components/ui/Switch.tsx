'use client';

import { forwardRef } from 'react';
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from '@/lib/utils';

export interface SwitchProps extends Omit<SwitchPrimitive.Root.Props, 'className'> {
    className?: string;
}

export const Switch = forwardRef<HTMLElement, SwitchProps>(function Switch({ className, ...props }, ref) {
    return (
        <SwitchPrimitive.Root
            ref={ref}
            render={<button type="button" />}
            nativeButton
            className={cn(
                'inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-fill-control p-0.5 transition-colors data-checked:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-50',
                className,
            )}
            {...props}
        >
            <SwitchPrimitive.Thumb className="h-4 w-4 rounded-full bg-surface shadow-sm transition-transform data-checked:translate-x-4" />
        </SwitchPrimitive.Root>
    );
});
