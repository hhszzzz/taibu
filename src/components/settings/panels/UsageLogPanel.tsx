/**
 * 用量日志：每次平台模型调用的用量与费用，以及充值、兑换、订阅等资金变动；上方是筛选范围内的消费合计与按模型汇总，
 * 点一行看详情。每页 20 条，向下加载更多。
 *
 * 'use client' 标记说明：
 * - 需要会话状态与 hooks 维护筛选、分页、请求顺序与详情弹窗
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { LedgerDetailDialog } from '@/components/billing/LedgerDetailDialog';
import { LedgerTable } from '@/components/billing/LedgerTable';
import { EMPTY_LEDGER_FILTERS, LedgerFilterBar, ledgerFilterQuery, type LedgerFilterState } from '@/components/billing/LedgerFilterBar';
import { UsageTotalsCard } from '@/components/billing/UsageSummary';
import { Button } from '@/components/ui/Button';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { TablePagination } from '@/components/ui/TablePagination';
import { fetchBillingLedger } from '@/lib/billing/client';
import { LEDGER_KINDS, type LedgerEntryView, type UsageByModel, type UsageTotals } from '@/lib/billing/config';

const DEFAULT_PAGE_SIZE = 20;

function UsageLogContent() {
    const [filters, setFilters] = useState<LedgerFilterState>(EMPTY_LEDGER_FILTERS);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [entries, setEntries] = useState<LedgerEntryView[]>([]);
    const [sums, setSums] = useState<{ totals: UsageTotals; byModel: UsageByModel[] } | null>(null);
    const [nextOffset, setNextOffset] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detail, setDetail] = useState<LedgerEntryView | null>(null);
    // 只采用最近一次请求的结果：改了筛选后，较早发出的请求不能覆盖新列表。
    const seq = useRef(0);

    const load = useCallback(async (target: number, size: number) => {
        const current = ++seq.current;
        setLoading(true);
        const query = ledgerFilterQuery(filters);
        query.set('offset', String((target - 1) * size));
        query.set('limit', String(size));
        try {
            const result = await fetchBillingLedger(query);
            if (current !== seq.current) return;
            setEntries(result.entries);
            if (result.totals) setSums({ totals: result.totals, byModel: result.byModel ?? [] });
            setNextOffset(result.nextOffset);
            setError(null);
        } catch (failure) {
            if (current === seq.current) setError(failure instanceof Error ? failure.message : '读取用量日志失败');
        } finally {
            if (current === seq.current) setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        void Promise.resolve().then(() => load(1, pageSize));
    }, [load, pageSize]);

    const filterModel = (model: string) => {
        setFilters(value => ({ ...value, model }));
        setDetail(null);
    };
    const filtered = filters.kind !== 'all' || filters.source !== 'all' || filters.range !== 'all' || !!filters.model;
    return (
        <div className="space-y-6">
            {sums ? <UsageTotalsCard totals={sums.totals} /> : null}
            <div className="flex flex-wrap items-center gap-2">
                <LedgerFilterBar value={filters} onChange={setFilters} kinds={LEDGER_KINDS} />
                <Button variant="secondary" size="sm" onClick={() => void load(page, pageSize)} className="ml-auto">
                    <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />刷新
                </Button>
            </div>
            {error ? (
                <div role="alert" className="settings-alert">
                    <span className="min-w-0 flex-1">{error}</span>
                    <Button variant="ghost" size="xs" onClick={() => void load(page, pageSize)}>重试</Button>
                </div>
            ) : null}
            <section aria-labelledby="usage-log-entries-heading" className="flex flex-col gap-3">
                <h3 id="usage-log-entries-heading" className="text-[13px] font-medium text-foreground-tertiary">明细</h3>
                <div className="overflow-hidden rounded-2xl border border-border bg-surface">
                    {entries.length ? (
                        <>
                            <LedgerTable entries={entries} label="用量日志" onOpen={setDetail} onModel={filterModel} />
                            <div className="border-t border-border">
                                <TablePagination page={page} pageSize={pageSize} hasNext={nextOffset !== null} loading={loading}
                                    onPage={next => { setPage(next); void load(next, pageSize); }}
                                    onPageSize={size => { setPageSize(size); setPage(1); }} />
                            </div>
                        </>
                    ) : loading ? (
                        Array.from({ length: 3 }, (_, index) => (
                            <div key={index} className={`h-[52px] animate-pulse bg-background-secondary/60 ${index ? 'border-t border-border' : ''}`} />
                        ))
                    ) : error ? null : (
                        <p className="px-4 py-8 text-sm text-foreground-secondary">{filtered ? '没有符合筛选条件的记录。' : '还没有用量记录。'}</p>
                    )}
                </div>
            </section>
            <LedgerDetailDialog entry={detail} onClose={() => setDetail(null)} onModel={filterModel} />
        </div>
    );
}

export default function UsageLogPanel() {
    const { user, loading } = useSessionSafe();
    if (loading) {
        return <div className="flex min-h-[240px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
    }
    if (!user) return <SettingsLoginRequired title="请先登录后查看用量日志" />;
    return <UsageLogContent key={user.id} />;
}
