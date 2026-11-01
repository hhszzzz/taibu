/**
 * 用量日志：全站每一条流水（模型调用、退回、充值、订阅、兑换、调整），按用户邮箱、类型、来源、模型、时间筛选；
 * 上方是筛选范围内的消费合计与按模型汇总，「详情」列打开流水详情。邮箱与模型点一下即按它筛选。
 * 免费模型的调用记为 $0；上游没报用量、按估算计费的调用带「估算」；自带密钥的调用记为 $0 并标「自带密钥」。
 *
 * 'use client' 标记说明：
 * - 需要 useState / useEffect 维护筛选、分页、请求顺序与详情弹窗
 */
'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { LedgerDetailDialog } from '@/components/billing/LedgerDetailDialog';
import { LedgerTable } from '@/components/billing/LedgerTable';
import { EMPTY_LEDGER_FILTERS, LedgerFilterBar, ledgerFilterQuery, type LedgerFilterState } from '@/components/billing/LedgerFilterBar';
import { UsageTotalsCard } from '@/components/billing/UsageSummary';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { TablePagination } from '@/components/ui/TablePagination';
import { fetchAdminUsage } from '@/lib/billing/client';
import { LEDGER_KINDS, type AdminUsageEntryView, type AdminUsagePage } from '@/lib/billing/config';

const DEFAULT_PAGE_SIZE = 50;
const CARD = 'rounded-2xl border border-border bg-surface';

export function BillingUsagePanel({ active = true }: { active?: boolean }) {
    const [filters, setFilters] = useState<LedgerFilterState>(EMPTY_LEDGER_FILTERS);
    const [emailInput, setEmailInput] = useState('');
    const [email, setEmail] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [page, setPage] = useState<AdminUsagePage | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detail, setDetail] = useState<AdminUsageEntryView | null>(null);
    // 只采用最近一次请求的结果：改了筛选后，较早发出的请求不能覆盖新列表。
    const seq = useRef(0);

    const load = useCallback(async (target: number, size = pageSize) => {
        const current = ++seq.current;
        setLoading(true);
        const query = ledgerFilterQuery(filters);
        if (email) query.set('email', email);
        query.set('offset', String((target - 1) * size));
        query.set('limit', String(size));
        try {
            const next = await fetchAdminUsage(query);
            if (current !== seq.current) return;
            setPage(next);
            setError(null);
        } catch (failure) {
            if (current === seq.current) setError(failure instanceof Error ? failure.message : '读取用量日志失败');
        } finally {
            if (current === seq.current) setLoading(false);
        }
    }, [filters, email, pageSize]);

    useEffect(() => {
        if (active) void Promise.resolve().then(() => load(1));
    }, [active, load]);

    const search = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setCurrentPage(1);
        setEmail(emailInput.trim().toLowerCase());
    };
    const filterModel = (model: string) => {
        setCurrentPage(1);
        setFilters(value => ({ ...value, model }));
        setDetail(null);
    };
    const filterUser = (address: string) => {
        setCurrentPage(1);
        setEmail(address.toLowerCase());
        setEmailInput(address);
        setDetail(null);
    };

    return (
        <div className="flex flex-col gap-4">
            <p className="settings-help">
                每条流水一行：模型调用、退回、充值、订阅、兑换与管理员调整；合计与按模型汇总只算调用与退回。免费模型记 $0，上游没报用量时按估算计费并标出。浏览器直连的自定义模型对话不经服务器，不在这里。
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <form role="search" onSubmit={search} className="flex items-center gap-1.5">
                    <Input type="search" value={emailInput} onChange={event => setEmailInput(event.target.value)} placeholder="用户邮箱（前缀）"
                        aria-label="按用户邮箱筛选" className="w-56" size="sm" />
                    <IconButton type="submit" label="按邮箱筛选" size="sm"><Search aria-hidden="true" className="h-4 w-4" /></IconButton>
                    {email ? (
                        <IconButton label="清除邮箱筛选" size="sm" onClick={() => { setEmail(''); setEmailInput(''); }}>
                            <X aria-hidden="true" className="h-4 w-4" />
                        </IconButton>
                    ) : null}
                </form>
                <LedgerFilterBar value={filters} onChange={setFilters} kinds={LEDGER_KINDS} />
                <Button variant="secondary" size="sm" onClick={() => void load(currentPage)} className="ml-auto">
                    <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />刷新
                </Button>
            </div>

            {error ? (
                <div role="alert" className="settings-alert">
                    <span className="min-w-0 flex-1">{error}</span>
                    <Button variant="ghost" size="xs" onClick={() => void load(currentPage)}>重试</Button>
                </div>
            ) : null}

            {!page ? (loading ? <SoundWaveLoader variant="block" /> : null) : (
                <>
                    <UsageTotalsCard totals={page.totals} />

                    <section aria-labelledby="usage-entries-heading" className="flex flex-col gap-2">
                        <h3 id="usage-entries-heading" className="text-[13px] font-medium text-foreground-tertiary">明细</h3>
                        {page.entries.length ? (
                            <div className={`overflow-hidden ${CARD}`}>
                                <LedgerTable entries={page.entries} label="用量明细" showUser onOpen={entry => setDetail(entry as AdminUsageEntryView)} onModel={filterModel} onUser={filterUser} />
                                <div className="border-t border-border">
                                    <TablePagination page={currentPage} pageSize={pageSize} hasNext={page.nextOffset !== null} loading={loading}
                                        onPage={next => { setCurrentPage(next); void load(next); }}
                                        onPageSize={size => { setPageSize(size); setCurrentPage(1); }} />
                                </div>
                            </div>
                        ) : (
                            <div className={`px-6 py-10 text-center text-sm text-foreground-secondary ${CARD}`}>
                                {loading ? '加载中…' : '没有符合筛选条件的流水。'}
                            </div>
                        )}
                    </section>
                </>
            )}
            <LedgerDetailDialog admin entry={detail} onClose={() => setDetail(null)} onModel={filterModel} onUser={filterUser} />
        </div>
    );
}
