'use client';
// 需要 useState（搜索词）+ 点击事件（固定/取消固定）

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Pin, Search } from 'lucide-react';
import { filterNavItems, groupDivinationItems, isNavHrefActive, type NavItemDef } from '@/lib/navigation/registry';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';

/** Row body shared by the grouped list and the fortune footer. */
function DivinationRowContent({ item, active, pinned, onTogglePin, onNavigate, label }: {
    item: NavItemDef;
    active: boolean;
    pinned: boolean;
    onTogglePin: (id: string) => void;
    onNavigate: () => void;
    label: ReactNode;
}) {
    const Icon = item.icon;
    return (
        <>
            <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className="all-divinations-item"
            >
                <span className="all-divinations-icon"><Icon size={18} aria-hidden="true" /></span>
                {label}
            </Link>
            <IconButton
                onClick={() => onTogglePin(item.id)}
                aria-pressed={pinned}
                label={pinned ? `取消固定${item.label}` : `固定${item.label}到侧栏`}
                className="all-divinations-pin"
                expand="none"
                data-pinned={pinned || undefined}
            >
                <Pin size={13} fill={pinned ? 'currentColor' : 'none'} aria-hidden />
            </IconButton>
        </>
    );
}

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
                <Input
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
                                return (
                                    <li key={item.id} className="all-divinations-row">
                                        <DivinationRowContent
                                            item={item}
                                            active={isNavHrefActive(pathname, item.href)}
                                            pinned={pinned}
                                            onTogglePin={onTogglePin}
                                            onNavigate={onNavigate}
                                            label={<span className="truncate">{item.label}</span>}
                                        />
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
                        const pinned = pins.includes(item.id);
                        return (
                            <div key={item.id} className="all-divinations-row">
                                <DivinationRowContent
                                    item={item}
                                    active={isNavHrefActive(pathname, item.href)}
                                    pinned={pinned}
                                    onTogglePin={onTogglePin}
                                    onNavigate={onNavigate}
                                    label={<span>{item.description ?? item.label}</span>}
                                />
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
