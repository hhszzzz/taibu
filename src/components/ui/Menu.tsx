'use client';

import { forwardRef, createContext, useContext, useRef, useState } from 'react';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Check, ChevronRight } from 'lucide-react';
import { findMenuShortcut } from '@/lib/motion/menu-shortcut';
import { cn } from '@/lib/utils';

/** Where the popup lands: inside the enclosing native dialog so it is not hidden behind the top layer. */
const PortalTarget = createContext<((node: HTMLElement | null) => void) | null>(null);
const PortalContainer = createContext<HTMLElement | null>(null);

export function Menu<Payload = unknown>({ children, modal = false, onOpenChange, ...props }: MenuPrimitive.Root.Props<Payload>) {
    const [container, setContainer] = useState<HTMLElement | null>(null);
    const sync = (node: HTMLElement | null) => setContainer(current => current === node ? current : node);
    return (
        <PortalContainer.Provider value={container}>
            <PortalTarget.Provider value={sync}>
                <MenuPrimitive.Root<Payload>
                    modal={modal}
                    // 分离触发器在 Root 子树之外；打开事件仍带着触发元素，用它决定浮层落在哪个对话框里。
                    onOpenChange={(open, details) => {
                        if (open) sync(details.trigger?.closest<HTMLElement>('dialog, [role="dialog"]') ?? null);
                        onOpenChange?.(open, details);
                    }}
                    {...props}
                >{children}</MenuPrimitive.Root>
            </PortalTarget.Provider>
        </PortalContainer.Provider>
    );
}

/** Detached triggers: rows pass their payload while one root renders the content. */
export const createMenuHandle = MenuPrimitive.createHandle;
export type MenuHandle<Payload> = MenuPrimitive.Handle<Payload>;

function callRef<T>(ref: React.Ref<T> | undefined, node: T | null) {
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
}

export const MenuTrigger = forwardRef<HTMLButtonElement, MenuPrimitive.Trigger.Props>(function MenuTrigger(props, ref) {
    const sync = useContext(PortalTarget);
    return (
        <MenuPrimitive.Trigger
            {...props}
            ref={(node: HTMLButtonElement | null) => {
                sync?.(node?.closest('dialog, [role="dialog"]') ?? null);
                // 组合渲染（Tooltip 等）会把自己的 ref 作为 prop 传入；spread 之后再接线，避免被覆盖。
                callRef((props as { ref?: React.Ref<HTMLButtonElement> }).ref, node);
                callRef(ref, node);
            }}
        />
    );
});

const menuItemClass = 'relative flex min-h-8 cursor-default items-center gap-2 rounded-lg px-2.5 text-sm text-foreground-secondary outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-45 data-highlighted:bg-fill-ghost-hover data-highlighted:text-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0';

export function MenuContent({
    className,
    align = 'start',
    alignOffset = 0,
    side = 'bottom',
    sideOffset = 4,
    letterShortcuts = false,
    onKeyDown,
    ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'> & {
    /** claude 菜单的字母键：按 <kbd> 标注的单字符直接触发对应项。 */
    letterShortcuts?: boolean;
}) {
    const container = useContext(PortalContainer);
    const popupRef = useRef<HTMLDivElement>(null);
    return (
        <MenuPrimitive.Portal container={container ?? undefined}>
            <MenuPrimitive.Positioner
                align={align}
                alignOffset={alignOffset}
                side={side}
                sideOffset={sideOffset}
                className="z-[var(--z-popup)] outline-none"
            >
                <MenuPrimitive.Popup
                    ref={popupRef}
                    onKeyDown={(event) => {
                        onKeyDown?.(event);
                        if (!letterShortcuts || event.defaultPrevented || !popupRef.current) return;
                        const item = findMenuShortcut(popupRef.current, event.nativeEvent);
                        if (!item) return;
                        event.preventDefault();
                        item.click();
                    }}
                    className={cn(
                        'max-h-[var(--available-height)] min-w-32 max-w-[min(20rem,calc(100vw-1rem))] origin-[var(--transform-origin)] overflow-y-auto overscroll-contain rounded-xl bg-surface p-1 text-foreground shadow-[var(--shadow-panel-popover)] outline-none transition-[opacity,scale] duration-[var(--duration-snap)] ease-[var(--ease-out)] data-ending-style:opacity-0 data-ending-style:scale-[0.98] data-starting-style:opacity-0 data-starting-style:scale-[0.98]',
                        className,
                    )}
                    {...props}
                />
            </MenuPrimitive.Positioner>
        </MenuPrimitive.Portal>
    );
}

/** A group label only exists inside its group (Base UI throws otherwise), so pass it as `label`. */
export function MenuGroup({ label, children, ...props }: MenuPrimitive.Group.Props & { label?: React.ReactNode }) {
    return (
        <MenuPrimitive.Group {...props}>
            {label ? <MenuLabel>{label}</MenuLabel> : null}
            {children}
        </MenuPrimitive.Group>
    );
}

export function MenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
    return <MenuPrimitive.GroupLabel className={cn('px-2.5 pb-1 pt-1.5 text-xs font-medium text-foreground-tertiary', className)} {...props} />;
}

export function MenuItem({ className, tone = 'default', ...props }: MenuPrimitive.Item.Props & { tone?: 'default' | 'danger' }) {
    return (
        <MenuPrimitive.Item
            className={cn(menuItemClass, tone === 'danger' && 'text-danger data-highlighted:bg-danger/10 data-highlighted:text-danger', className)}
            {...props}
        />
    );
}

export function MenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
    return <MenuPrimitive.SubmenuRoot {...props} />;
}

export function MenuSubTrigger({ className, children, ...props }: MenuPrimitive.SubmenuTrigger.Props) {
    return (
        <MenuPrimitive.SubmenuTrigger className={cn(menuItemClass, className)} {...props}>
            {children}
            <ChevronRight className="ml-auto" aria-hidden="true" />
        </MenuPrimitive.SubmenuTrigger>
    );
}

export function MenuSubContent({ className, ...props }: React.ComponentProps<typeof MenuContent>) {
    return <MenuContent align="start" alignOffset={-3} side="right" sideOffset={2} className={cn('min-w-24', className)} {...props} />;
}

export function MenuCheckboxItem({ className, children, ...props }: MenuPrimitive.CheckboxItem.Props) {
    return (
        <MenuPrimitive.CheckboxItem className={cn(menuItemClass, 'pr-8', className)} {...props}>
            {children}
            <MenuPrimitive.CheckboxItemIndicator className="pointer-events-none absolute right-2.5 flex text-accent">
                <Check aria-hidden="true" />
            </MenuPrimitive.CheckboxItemIndicator>
        </MenuPrimitive.CheckboxItem>
    );
}

export function MenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
    return <MenuPrimitive.RadioGroup {...props} />;
}

export function MenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
    return (
        <MenuPrimitive.RadioItem className={cn(menuItemClass, 'pr-8', className)} {...props}>
            {children}
            <MenuPrimitive.RadioItemIndicator className="pointer-events-none absolute right-2.5 flex text-accent">
                <Check aria-hidden="true" />
            </MenuPrimitive.RadioItemIndicator>
        </MenuPrimitive.RadioItem>
    );
}

export function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
    return <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export function MenuShortcut({ className, ...props }: React.ComponentProps<'kbd'>) {
    return <kbd className={cn('ml-auto font-sans text-xs text-foreground-tertiary', className)} {...props} />;
}
