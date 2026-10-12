'use client';
// 需要 useState（搜索词）+ 点击事件（固定/取消固定）

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Pin, Search } from 'lucide-react';
import { filterNavItems, groupDivinationItems, type NavItemDef } from '@/lib/navigation/registry';

const isActiveHref = (pathname: string | null, href: string) => pathname === href || !!pathname?.startsWith(`${href}/`);

/**
 * "全部占术" flyout body: grouped divination list with per-item pin toggles.
 * Fortune entries (日运 / 月运) are rendered as a footer instead of a group.
 */
export function AllDivinationsPanel({ items, pins, pathname, onTogglePin, onNavigate }: {
    items: readonly NavItemDef[];
    pins: readonly string[];
    pathname: string | null;
    onTogglePin: (id: string) => void;
    onNavigate: () => void;
}) {
    const [query, setQuery] = useState('');

    const groups = useMemo(
        () => groupDivinationItems(filterNavItems(items, query).filter(item => item.group !== 'fortune')),
        [items, query],
    );
    const fortuneItems = useMemo(() => items.filter(item => item.group === 'fortune'), [items]);

    return (
        <div className="flex w-[min(440px,calc(100vw-32px))] flex-col">
            <div className="px-4 pb-3 pt-3.5">
                <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-lg text-foreground">全部占术</h2>
                    <span className="text-xs text-foreground-secondary">点图钉固定到侧栏</span>
                </div>
                <label className="mt-3 flex h-9 items-center gap-2 rounded-lg bg-background-secondary px-3 text-foreground-tertiary focus-within:ring-2 focus-within:ring-accent/40">
                    <Search className="h-4 w-4 flex-shrink-0" aria-hidden />
                    <span className="sr-only">搜索占术</span>
                    <input
                        type="search"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="搜索占术"
                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none focus-visible:outline-none placeholder:text-foreground-tertiary"
                    />
                </label>
            </div>

            <div className="flex max-h-[min(520px,calc(100dvh-200px))] flex-col gap-4 overflow-y-auto px-2 pb-3">
                {groups.length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm text-foreground-secondary">没有匹配的占术</p>
                ) : groups.map(group => (
                    <section key={group.id} aria-label={group.label}>
                        <h3 className="px-2 pb-1 text-xs text-foreground-secondary">{group.label}</h3>
                        <ul className="grid grid-cols-2 gap-0.5">
                            {group.items.map(item => {
                                const pinned = pins.includes(item.id);
                                const active = isActiveHref(pathname, item.href);
                                const Icon = item.icon;
                                return (
                                    <li key={item.id} className="group relative">
                                        <Link
                                            href={item.href}
                                            onClick={onNavigate}
                                            aria-current={active ? 'page' : undefined}
                                            className={`flex h-10 items-center gap-2.5 rounded-lg pl-2.5 pr-9 text-sm transition-colors ${active
                                                ? 'bg-background-tertiary font-medium text-foreground'
                                                : 'text-foreground hover:bg-background-secondary'}`}
                                        >
                                            <Icon className={`h-[18px] w-[18px] flex-shrink-0 ${active ? 'text-accent' : 'text-foreground-secondary'}`} />
                                            <span className="truncate">{item.label}</span>
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() => onTogglePin(item.id)}
                                            aria-pressed={pinned}
                                            aria-label={pinned ? `取消固定${item.label}` : `固定${item.label}到侧栏`}
                                            className={`absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-opacity hover:bg-background-tertiary ${pinned
                                                ? 'text-accent opacity-100'
                                                : 'text-foreground-tertiary opacity-0 focus-visible:opacity-100 group-hover:opacity-100'}`}
                                        >
                                            <Pin className="h-3.5 w-3.5" fill={pinned ? 'currentColor' : 'none'} aria-hidden />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))}
            </div>

            {fortuneItems.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 border-t border-border px-3 py-3">
                    {fortuneItems.map(item => {
                        const Icon = item.icon;
                        const active = isActiveHref(pathname, item.href);
                        return (
                            <Link
                                key={item.id}
                                href={item.href}
                                onClick={onNavigate}
                                aria-current={active ? 'page' : undefined}
                                className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm transition-colors ${item.id === 'daily'
                                    ? 'bg-accent-light text-accent-strong hover:bg-accent-soft'
                                    : 'bg-background-secondary text-foreground hover:bg-background-tertiary'}`}
                            >
                                <Icon className="h-4 w-4" />
                                {item.description ?? item.label}
                            </Link>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
