import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export type TextareaProps = React.ComponentProps<'textarea'>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
    return (
        <textarea
            ref={ref}
            className={cn(
                'flex min-h-24 w-full min-w-0 resize-y rounded-xl border-[0.5px] border-border bg-surface px-3 py-2.5 text-sm leading-relaxed text-foreground transition-colors placeholder:text-foreground-tertiary focus-visible:border-[var(--control-focus,var(--accent))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger',
                className,
            )}
            {...props}
        />
    );
});
