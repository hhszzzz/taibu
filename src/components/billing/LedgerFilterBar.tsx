/**
 * 用量日志的查询栏：时间、类型、来源、模型与说明各占一格，点「查询」或回车才生效，「重置」清空全部条件。
 * 点表格里的模型或用户也会改写条件，这里跟着显示。
 */
'use client';

import type { ReactNode } from 'react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { BILLING_SOURCE_LABELS, LEDGER_KIND_LABELS, type LedgerKind } from '@/lib/billing/config';

export type LedgerRange = 'all' | 'today' | '7d' | '30d';
export type LedgerFilterState = { kind: LedgerKind | 'all'; source: string; range: LedgerRange; model: string | null; query: string; email: string };

export const EMPTY_LEDGER_FILTERS: LedgerFilterState = { kind: 'all', source: 'all', range: 'all', model: null, query: '', email: '' };

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
    if (filters.email.trim()) query.set('email', filters.email.trim().toLowerCase());
    if (filters.range !== 'all') {
        const from = new Date(now);
        if (filters.range === 'today') from.setHours(0, 0, 0, 0);
        else from.setDate(from.getDate() - (filters.range === '7d' ? 7 : 30));
        query.set('from', from.toISOString());
    }
    return query;
}

export function LedgerFilterBar({ value, onChange, kinds, showUser = false, onReset, actions, children }: {
    value: LedgerFilterState;
    onChange: (next: LedgerFilterState) => void;
    /** The kinds offered in the type filter. */
    kinds: readonly LedgerKind[];
    /** The administrator's log also narrows by user email. */
    showUser?: boolean;
    /** Extra conditions the page keeps outside this bar, cleared by 重置. */
    onReset?: () => void;
    /** Buttons the page adds at the end of the query row (e.g. 刷新). */
    actions?: ReactNode;
    children?: ReactNode;
}) {
    const kindOptions = [{ value: 'all' as const, label: '全部类型' }, ...kinds.map(kind => ({ value: kind, label: LEDGER_KIND_LABELS[kind] }))];
    const sourceOptions = [{ value: 'all', label: '全部来源' }, ...USAGE_SOURCES.map(source => ({ value: source, label: BILLING_SOURCE_LABELS[source] }))];
    const [draft, setDraft] = useState(value);
    // 表格里点模型、点用户会从外面改条件，输入框跟着变。
    useEffect(() => { void Promise.resolve().then(() => setDraft(value)); }, [value]);
    const set = (patch: Partial<LedgerFilterState>) => setDraft(current => ({ ...current, ...patch }));
    const apply = (event?: FormEvent) => {
        event?.preventDefault();
        onChange({ ...draft, model: draft.model?.trim() || null, query: draft.query.trim(), email: draft.email.trim().toLowerCase() });
    };
    const reset = () => {
        setDraft(EMPTY_LEDGER_FILTERS);
        onChange(EMPTY_LEDGER_FILTERS);
        onReset?.();
    };
    return (
        <form role="search" onSubmit={apply} className="flex flex-wrap items-center gap-2">
            {children}
            {showUser ? <Input value={draft.email} onChange={event => set({ email: event.target.value })} placeholder="用户邮箱（前缀）" aria-label="按用户邮箱筛选" className="w-44" size="sm" /> : null}
            <Select ariaLabel="时间范围" value={draft.range} options={RANGES} onChange={range => set({ range })} className="w-28" />
            <Select ariaLabel="类型" value={draft.kind} options={kindOptions} onChange={kind => set({ kind })} className="w-28" />
            <Select ariaLabel="来源" value={draft.source} options={sourceOptions} onChange={source => set({ source })} className="w-28" />
            <Input value={draft.model ?? ''} onChange={event => set({ model: event.target.value })} placeholder="模型 ID" aria-label="按模型筛选" className="w-40" size="sm" />
            <Input value={draft.query} onChange={event => set({ query: event.target.value })} placeholder="搜索说明" aria-label="搜索说明" className="w-44" size="sm" />
            <Button type="submit" variant="secondary" size="sm">查询</Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset}>重置</Button>
            {actions}
        </form>
    );
}
