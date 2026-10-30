/**
 * 结果页桌面端「更多操作」：次要操作收进三点浮层，标题区只保留主操作。
 * 移动端同一组操作由顶栏三点菜单（HeaderMenuContext）承载。
 *
 * 'use client'：浮层由共享 Menu 管理开合与键盘路径。
 */
'use client';

import { MoreHorizontal } from 'lucide-react';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import type { HeaderMenuItem } from '@/components/layout/HeaderMenuContext';

export function ResultMoreActions({ actions, label }: { actions: HeaderMenuItem[]; label: string }) {
    if (actions.length === 0) return null;

    return (
        <Menu>
            <MenuTrigger
                aria-label="更多操作"
                className="flex size-8 items-center justify-center rounded-md border-[0.5px] border-border-hover bg-surface text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground data-popup-open:bg-background-secondary data-popup-open:text-foreground"
            >
                <MoreHorizontal className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </MenuTrigger>
            <MenuContent align="end" className="w-48" aria-label={label}>
                {actions.map((item) => (
                    <MenuItem
                        key={item.id}
                        disabled={item.disabled}
                        onClick={item.onClick}
                        className="w-full gap-2.5 px-2.5 py-2"
                    >
                        {item.icon}
                        {item.label}
                    </MenuItem>
                ))}
            </MenuContent>
        </Menu>
    );
}
