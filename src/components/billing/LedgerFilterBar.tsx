/**
 * 用量日志的筛选：类型、来源、时间范围；模型由点选汇总表或详情里的模型设定，在这里显示为可移除的标签。
 */
'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { BILLING_SOURCE_LABELS, LEDGER_KIND_LABELS, type LedgerKind } from '@/lib/billing/config';

export type LedgerRange = 'all' | 'today' | '7d' | '30d';
export type LedgerFilterState = { kind: LedgerKind | 'all'; source: string; range: LedgerRange; model: string | null; query: string };

export const EMPTY_LEDGER_FILTERS: LedgerFilterState = { kind: 'all', source: 'all', range: 'all', model: null, query: '' };

const RANGES: ReadonlyArray<{ value: LedgerRange; label: string }> = [
    { value: 'all', label: '全部时间' }, { value: 'today', label: '今天' }, { value: '7d', label: '近 7 天' }, { value: '30d', label: '近 30 天' },
];
const USAGE_SOURCES = ['chat', 'analysis', 'enhance', 'image', 'agent'];

/** The query a filter state asks the ledger endpoints for; the range starts from the moment it is called. */
export function ledgerFilterQuery(filters: LedgerFilterState, now = new Date()): URLSearchParams {
    const query = new URLSearchParams();
    if (filters.kind !== 'all') query.set('kind', filters.kind);
    if (filters.source !== 'all') query.set('source', filters.source);
    if (filters.model) query.set('model', filters.model);
    if (filters.query.trim()) query.set('q', filters.query.trim());
    if (filters.range !== 'all') {
        const from = new Date(now);
        if (filters.range === 'today') from.setHours(0, 0, 0, 0);
        else from.setDate(from.getDate() - (filters.range === '7d' ? 7 : 30));
        query.set('from', from.toISOString());
    }
    return query;
}

export function LedgerFilterBar({ value, onChange, kinds, children }: {
    value: LedgerFilterState;
    onChange: (next: LedgerFilterState) => void;
    /** The kinds offered in the type filter. */
    kinds: readonly LedgerKind[];
    children?: ReactNode;
}) {
    const kindOptions = [{ value: 'all' as const, label: '全部类型' }, ...kinds.map(kind => ({ value: kind, label: LEDGER_KIND_LABELS[kind] }))];
    const sourceOptions = [{ value: 'all', label: '全部来源' }, ...USAGE_SOURCES.map(source => ({ value: source, label: BILLING_SOURCE_LABELS[source] }))];
    // 输入停 300ms 才查询，边打字边发请求会打乱列表。
    const [search, setSearch] = useState(value.query);
    const latest = useRef({ value, onChange });
    useEffect(() => { latest.current = { value, onChange }; });
    useEffect(() => { void Promise.resolve().then(() => setSearch(value.query)); }, [value.query]);
    useEffect(() => {
        if (search === latest.current.value.query) return;
        const timer = setTimeout(() => latest.current.onChange({ ...latest.current.value, query: search }), 300);
        return () => clearTimeout(timer);
    }, [search]);
    return (
        <div className="flex flex-wrap items-center gap-2">
            {children}
            <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-tertiary" />
                <Input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索说明或模型"
                    aria-label="搜索日志" className="w-56 pl-8" size="sm" />
            </div>
            <Select ariaLabel="类型" value={value.kind} options={kindOptions} onChange={kind => onChange({ ...value, kind })} className="w-32" />
            <Select ariaLabel="来源" value={value.source} options={sourceOptions} onChange={source => onChange({ ...value, source })} className="w-32" />
            <Select ariaLabel="时间范围" value={value.range} options={RANGES} onChange={range => onChange({ ...value, range })} className="w-32" />
            {value.model ? (
                <span className="inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-border bg-surface pl-3 pr-1 text-[13px] text-foreground">
                    <span className="truncate font-mono text-xs">{value.model}</span>
                    <Button unstyled type="button" aria-label="不再按模型筛选" onClick={() => onChange({ ...value, model: null })}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-foreground-tertiary hover:bg-fill-ghost-hover hover:text-foreground">
                        <X aria-hidden="true" className="h-3.5 w-3.5" />
                    </Button>
                </span>
            ) : null}
        </div>
    );
}
