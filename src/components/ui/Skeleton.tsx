import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
    return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-fill-field', className)} {...props} />;
}
