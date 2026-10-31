'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '@/lib/utils';

export function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
    return <TabsPrimitive.Root className={cn('flex flex-col gap-4', className)} {...props} />;
}

export function TabsList({ className, children, activateOnFocus = true, indicator = true, ref, ...props }: TabsPrimitive.List.Props & { indicator?: boolean; ref?: React.Ref<HTMLDivElement> }) {
    return (
        <TabsPrimitive.List
            ref={ref}
            activateOnFocus={activateOnFocus}
            className={cn('relative inline-flex h-8 items-center gap-1 self-start rounded-lg bg-fill-field p-0.5', className)}
            {...props}
        >
            {indicator ? <TabsPrimitive.Indicator className="pointer-events-none absolute left-0 top-0 h-full w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] rounded-md bg-segmented-control-thumb shadow-[var(--shadow-thumb)] transition-[translate,width] duration-[var(--duration-base)] ease-[var(--ease-snap)]" /> : null}
            {children}
        </TabsPrimitive.List>
    );
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
    return (
        <TabsPrimitive.Tab
            className={cn(
                'relative z-10 flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm text-foreground-secondary transition-colors duration-[var(--duration-snap)] hover:text-foreground focus-visible:outline-offset-0 data-active:text-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50',
                className,
            )}
            {...props}
        />
    );
}

export function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
    return <TabsPrimitive.Panel className={cn('min-w-0 outline-none', className)} {...props} />;
}
