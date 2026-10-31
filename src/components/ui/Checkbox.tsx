'use client';

import { forwardRef } from 'react';
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<CheckboxPrimitive.Root.Props, 'className'> {
    className?: string;
}

export const Checkbox = forwardRef<HTMLElement, CheckboxProps>(function Checkbox({ className, indeterminate, render, nativeButton, ...props }, ref) {
    return (
        <CheckboxPrimitive.Root
            ref={ref}
            render={render ?? <button type="button" />}
            nativeButton={nativeButton ?? true}
            indeterminate={indeterminate}
            className={cn(
                'relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] after:absolute after:-inset-1 after:content-[""] border-[0.5px] border-border-hover bg-surface text-on-accent transition-colors data-checked:border-accent data-checked:bg-accent data-indeterminate:border-accent data-indeterminate:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-50',
                className,
            )}
            {...props}
        >
            <CheckboxPrimitive.Indicator className="flex items-center justify-center">
                {indeterminate ? <Minus className="h-3 w-3" aria-hidden="true" /> : <Check className="h-3 w-3" aria-hidden="true" />}
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    );
});
