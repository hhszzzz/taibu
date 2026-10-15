/**
 * 结果页桌面端「更多操作」：次要操作收进三点浮层，标题区只保留主操作。
 * 移动端同一组操作由顶栏三点菜单（HeaderMenuContext）承载。
 *
 * 'use client'：浮层开合需要 ref 与本地状态。
 */
'use client';

import { useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import type { HeaderMenuItem } from '@/components/layout/HeaderMenuContext';

export function ResultMoreActions({ actions, label }: { actions: HeaderMenuItem[]; label: string }) {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    if (actions.length === 0) return null;

    return (
        <>
            <button
                ref={anchorRef}
                type="button"
                aria-label="更多操作"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="flex size-10 items-center justify-center rounded-[10px] border-[0.5px] border-border-hover bg-surface text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"
            >
                <MoreHorizontal className="size-[18px]" strokeWidth={1.8} />
            </button>
            <FloatingPanel open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} label={label} align="end" className="w-48">
                {actions.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        disabled={item.disabled}
                        onClick={() => { setOpen(false); item.onClick(); }}
                        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm transition-colors hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {item.icon}
                        {item.label}
                    </button>
                ))}
            </FloatingPanel>
        </>
    );
}
