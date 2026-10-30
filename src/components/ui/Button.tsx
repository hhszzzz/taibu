import { forwardRef, type ReactNode } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed',
    {
        variants: {
            variant: {
                primary: 'bg-accent text-on-accent hover:bg-accent-hover',
                secondary: 'border-[0.5px] border-border bg-surface text-foreground hover:border-border-hover hover:bg-background-secondary',
                ghost: 'bg-transparent text-foreground-secondary hover:bg-fill-ghost-hover hover:text-foreground',
                danger: 'bg-danger text-background hover:bg-danger/90',
            },
            size: {
                xs: 'h-6 rounded-md px-2 text-xs',
                sm: 'h-7 rounded-md px-2.5 text-[13px]',
                md: 'h-8 rounded-lg px-3 text-sm',
                lg: 'h-[2.375rem] rounded-xl px-3.5 text-sm',
            },
        },
        defaultVariants: { variant: 'primary', size: 'md' },
    },
);

export interface ButtonProps extends Omit<BaseButton.Props, 'className'>, VariantProps<typeof buttonVariants> {
    className?: string;
    loading?: boolean;
    loadingText?: ReactNode;
    /** Domain surfaces keep their measured classes; the shared component still owns button semantics. */
    unstyled?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
    className,
    variant,
    size,
    loading = false,
    loadingText,
    unstyled = false,
    disabled,
    onClick,
    type = 'button',
    nativeButton,
    children,
    ...props
}, ref) {
    return (
        <BaseButton
            ref={ref}
            type={nativeButton === false ? undefined : type}
            nativeButton={nativeButton}
            disabled={disabled}
            aria-disabled={loading || undefined}
            aria-busy={loading || undefined}
            className={cn(unstyled ? 'disabled:cursor-not-allowed' : buttonVariants({ variant, size }), className)}
            onClick={loading ? event => event.preventDefault() : onClick}
            {...props}
        >
            {loading ? <SoundWaveLoader variant="inline" /> : null}
            {loading && loadingText !== undefined ? loadingText : children}
        </BaseButton>
    );
});
