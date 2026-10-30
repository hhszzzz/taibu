import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex shrink-0 items-center gap-1', {
    variants: {
        variant: {
            quiet: 'translate-y-0.5 text-[9px] font-medium leading-none tracking-[0.04em] text-foreground-tertiary',
            neutral: 'rounded-md bg-fill-field px-1.5 py-0.5 text-xs leading-4 text-foreground-secondary',
            accent: 'rounded-md bg-accent-soft px-1.5 py-0.5 text-xs leading-4 text-accent',
            success: 'rounded-md bg-success/10 px-1.5 py-0.5 text-xs leading-4 text-success',
            warning: 'rounded-md bg-warning/10 px-1.5 py-0.5 text-xs leading-4 text-warning',
            danger: 'rounded-md bg-danger/10 px-1.5 py-0.5 text-xs leading-4 text-danger',
        },
    },
    defaultVariants: { variant: 'quiet' },
});

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
    return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
