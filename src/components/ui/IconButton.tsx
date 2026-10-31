import { forwardRef } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const iconButtonVariants = cva(
    'relative inline-flex shrink-0 items-center justify-center transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50',
    {
        variants: {
            variant: {
                ghost: 'text-foreground-secondary hover:bg-fill-ghost-hover hover:text-foreground data-popup-open:bg-fill-ghost-hover data-popup-open:text-foreground aria-pressed:bg-accent-soft aria-pressed:text-accent',
                secondary: 'border-[0.5px] border-border bg-surface text-foreground hover:border-border-hover hover:bg-fill-ghost-hover data-popup-open:border-border-hover data-popup-open:bg-fill-ghost-hover',
            },
            size: {
                xs: 'h-6 w-6 rounded-md [&_svg]:h-3.5 [&_svg]:w-3.5',
                sm: 'h-7 w-7 rounded-sm [&_svg]:h-4 [&_svg]:w-4',
                md: 'h-8 w-8 rounded-lg [&_svg]:h-4 [&_svg]:w-4',
            },
            tone: {
                default: '',
                danger: 'text-danger hover:bg-danger/10 hover:text-danger',
            },
            expand: {
                default: 'after:absolute after:-inset-2 after:content-[""]',
                none: '',
            },
        },
        defaultVariants: { variant: 'ghost', size: 'md', tone: 'default', expand: 'default' },
    },
);

export interface IconButtonProps extends Omit<BaseButton.Props, 'className'>, VariantProps<typeof iconButtonVariants> {
    className?: string;
    label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
    className,
    variant,
    size,
    tone,
    expand,
    label,
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
            aria-label={label}
            className={cn(iconButtonVariants({ variant, size, tone, expand }), className)}
            {...props}
        >
            {children}
        </BaseButton>
    );
});
