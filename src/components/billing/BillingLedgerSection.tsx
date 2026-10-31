/**
 * 设置中心的账单明细：按类型、来源、时间与模型筛选，每页 20 条，向下加载更多。
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { LedgerEntryRow } from '@/components/billing/LedgerEntryRow';
import { EMPTY_LEDGER_FILTERS, LedgerFilterBar, ledgerFilterQuery, type LedgerFilterState } from '@/components/billing/LedgerFilterBar';
import { fetchBillingLedger } from '@/lib/billing/client';
import { LEDGER_KINDS, type LedgerEntryView } from '@/lib/billing/config';

const PAGE_SIZE = 20;

export function BillingLedgerSection({ refreshKey }: { refreshKey: number }) {
    const [filters, setFilters] = useState<LedgerFilterState>(EMPTY_LEDGER_FILTERS);
    const [entries, setEntries] = useState<LedgerEntryView[]>([]);
    const [nextOffset, setNextOffset] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // 只采用最近一次请求的结果：改了筛选后，较早发出的请求不能覆盖新列表。
    const seq = useRef(0);

    const load = useCallback(async (offset: number) => {
        const current = ++seq.current;
        setLoading(true);
        const query = ledgerFilterQuery(filters);
        query.set('offset', String(offset));
        query.set('limit', String(PAGE_SIZE));
        try {
            const page = await fetchBillingLedger(query);
            if (current !== seq.current) return;
            setEntries(list => (offset ? [...list, ...page.entries] : page.entries));
            setNextOffset(page.nextOffset);
            setError(null);
        } catch (failure) {
            if (current === seq.current) setError(failure instanceof Error ? failure.message : '读取账单失败');
        } finally {
            if (current === seq.current) setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        void Promise.resolve().then(() => load(0));
    }, [load, refreshKey]);

    const filtered = filters.kind !== 'all' || filters.source !== 'all' || filters.range !== 'all' || !!filters.model;
    return (
        <section aria-labelledby="billing-ledger-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 id="billing-ledger-heading" className="text-[13px] font-medium text-foreground-tertiary">账单明细</h3>
                <LedgerFilterBar value={filters} onChange={setFilters} kinds={LEDGER_KINDS} />
            </div>
            {error ? (
                <div role="alert" className="settings-alert">
                    <span className="min-w-0 flex-1">{error}</span>
                    <Button variant="ghost" size="xs" onClick={() => void load(0)}>重试</Button>
                </div>
            ) : null}
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
                {entries.length ? (
                    <>
                        <ul aria-label="账单明细">
                            {entries.map(entry => <LedgerEntryRow key={entry.id} entry={entry} onModel={model => setFilters(value => ({ ...value, model }))} />)}
                        </ul>
                        {nextOffset !== null ? (
                            <Button unstyled type="button" disabled={loading} onClick={() => void load(nextOffset)}
                                className="h-11 w-full border-t border-border text-sm text-foreground-secondary transition-colors duration-150 hover:bg-background-secondary hover:text-foreground">
                                {loading ? '加载中…' : '查看更多'}
                            </Button>
                        ) : null}
                    </>
                ) : loading ? (
                    Array.from({ length: 3 }, (_, index) => (
                        <div key={index} className={`h-[68px] animate-pulse bg-background-secondary/60 ${index ? 'border-t border-border' : ''}`} />
                    ))
                ) : error ? null : (
                    <p className="px-4 py-8 text-sm text-foreground-secondary">{filtered ? '没有符合筛选条件的记录。' : '还没有账单记录。'}</p>
                )}
            </div>
        </section>
    );
}
