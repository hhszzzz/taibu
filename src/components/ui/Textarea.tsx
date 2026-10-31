import { forwardRef } from 'react';
import { fieldClass } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

export type TextareaProps = React.ComponentProps<'textarea'>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
    return (
        <textarea
            ref={ref}
            className={cn(
                'flex min-h-24 w-full min-w-0 resize-y rounded-xl px-3 py-2.5 text-sm leading-relaxed placeholder:text-foreground-tertiary',
                fieldClass,
                className,
            )}
            {...props}
        />
    );
});
