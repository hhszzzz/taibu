import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const inputVariants = cva(
    'flex w-full min-w-0 border-[0.5px] border-border bg-surface px-3 text-foreground transition-colors placeholder:text-foreground-tertiary focus-visible:border-[var(--control-focus,var(--accent))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger',
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
