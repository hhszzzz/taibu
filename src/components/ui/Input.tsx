import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** Field surface shared by Input, Textarea and Select: focus draws a 1px outer ring in --control-focus, invalid swaps it to danger. */
export const fieldClass = 'border-[0.5px] border-border bg-surface text-foreground transition-colors duration-[var(--duration-snap)] ease-[var(--ease-out)] hover:border-border-hover focus-visible:border-[var(--control-focus,var(--accent))] focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-[color:var(--control-focus,var(--accent))] disabled:cursor-not-allowed disabled:border-border disabled:bg-fill-disabled disabled:text-disabled aria-invalid:border-danger aria-invalid:[--control-focus:var(--danger)]';

const inputVariants = cva(
    `flex w-full min-w-0 px-3 placeholder:text-foreground-tertiary ${fieldClass}`,
    {
        variants: {
            size: {
                sm: 'h-8 rounded-lg text-sm',
                md: 'h-[2.375rem] rounded-xl text-sm',
                lg: 'h-[2.625rem] rounded-xl px-3.5 text-[0.9375rem]',
            },
        },
        defaultVariants: { size: 'md' },
    },
);

export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'>, VariantProps<typeof inputVariants> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, size, ...props }, ref) {
    return <input ref={ref} className={cn(inputVariants({ size }), className)} {...props} />;
});
