'use client';
// 需要 useState（搜索词）+ 点击事件（固定/取消固定）

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Pin, Search } from 'lucide-react';
import { filterNavItems, groupDivinationItems, type NavItemDef } from '@/lib/navigation/registry';
import { BUILT_IN_SIDEBAR_PINS } from '@/lib/navigation/sidebar-pins';

const isActiveHref = (pathname: string | null, href: string) => pathname === href || !!pathname?.startsWith(`${href}/`);

/**
 * "全部占术" flyout body：claude 菜单形态的分组列表（32px 行、28px 前导槽、悬停图钉）。
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
        <div className="all-divinations">
            <div className="all-divinations-head">
                <h2>全部占术</h2>
                <span>点图钉固定到侧栏</span>
            </div>
            <label className="all-divinations-search">
                <Search size={16} aria-hidden />
                <span className="sr-only">搜索占术</span>
                <input
                    type="search"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="搜索占术"
                />
            </label>

            <div className="all-divinations-scroll">
                {groups.length === 0 ? (
                    <p className="all-divinations-empty">没有匹配的占术</p>
                ) : groups.map(group => (
                    <section key={group.id} aria-label={group.label}>
                        <h3 className="all-divinations-group-label">{group.label}</h3>
                        <ul>
                            {group.items.map(item => {
                                const pinned = pins.includes(item.id);
                                const active = isActiveHref(pathname, item.href);
                                const Icon = item.icon;
                                return (
                                    <li key={item.id} className="all-divinations-row">
                                        <Link
                                            href={item.href}
                                            onClick={onNavigate}
                                            aria-current={active ? 'page' : undefined}
                                            className="all-divinations-item"
                                        >
                                            <span className="all-divinations-icon"><Icon size={18} aria-hidden="true" /></span>
                                            <span className="truncate">{item.label}</span>
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() => onTogglePin(item.id)}
                                            aria-pressed={pinned}
                                            aria-label={pinned ? `取消固定${item.label}` : `固定${item.label}到侧栏`}
                                            className="all-divinations-pin"
                                            data-pinned={pinned || undefined}
                                        >
                                            <Pin size={13} fill={pinned ? 'currentColor' : 'none'} aria-hidden />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))}
            </div>

            {fortuneItems.length > 0 ? (
                <div className="all-divinations-fortune">
                    {fortuneItems.map(item => {
                        const Icon = item.icon;
                        const active = isActiveHref(pathname, item.href);
                        const fixed = BUILT_IN_SIDEBAR_PINS.includes(item.id);
                        return (
                            <Link
                                key={item.id}
                                href={item.href}
                                onClick={onNavigate}
                                aria-current={active ? 'page' : undefined}
                                className="all-divinations-item"
                            >
                                <span className="all-divinations-icon"><Icon size={18} aria-hidden="true" /></span>
                                <span>{item.description ?? item.label}</span>
                                {fixed ? (
                                    <span className="all-divinations-fixed" title="已固定到侧栏，不可取消">
                                        <Pin size={13} fill="currentColor" aria-hidden />
                                        <span className="sr-only">已固定到侧栏，不可取消</span>
                                    </span>
                                ) : null}
                            </Link>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
