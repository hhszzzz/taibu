/**
 * 用量日志：全站每次平台模型调用与退回，按用户邮箱、来源、模型、时间筛选；上方是筛选范围内的合计与按模型汇总。
 * 免费模型的调用记为 $0；上游没报用量、按估算计费的调用带「估算」。浏览器直连的自带密钥对话不经服务器，这里看不到。
 *
 * 'use client' 标记说明：
 * - 需要 useState / useEffect 维护筛选、分页与请求顺序
 */
'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { LedgerAmount, LedgerMarks } from '@/components/billing/LedgerEntryRow';
import { EMPTY_LEDGER_FILTERS, LedgerFilterBar, ledgerFilterQuery, type LedgerFilterState } from '@/components/billing/LedgerFilterBar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { fetchAdminUsage } from '@/lib/billing/client';
import type { AdminUsagePage, UsageTotals } from '@/lib/billing/config';
import { billingSourceLabel, describeUsage, formatBillingTime, formatCount, ledgerEntryTitle } from '@/lib/billing/format';
import { formatUsd } from '@/lib/billing/money';

const PAGE_SIZE = 50;
const CARD = 'rounded-2xl border border-border bg-surface';
const TH = 'px-3 py-2.5 text-left text-xs font-medium text-foreground-tertiary';
const TD = 'px-3 py-2.5 text-[13px] text-foreground-secondary';

function Totals({ totals }: { totals: UsageTotals }) {
    const items = [
        { label: '消费', value: formatUsd(totals.spentMicros, { precise: true }) },
        { label: '调用', value: formatCount(totals.calls) },
        { label: '输入 token', value: formatCount(totals.input) },
        { label: '输出 token', value: formatCount(totals.output) },
        { label: '缓存读', value: formatCount(totals.cacheRead) },
        { label: '缓存写', value: formatCount(totals.cacheWrite) },
        ...(totals.images ? [{ label: '图片', value: formatCount(totals.images) }] : []),
    ];
    return (
        <dl aria-label="筛选范围合计" className={`grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-6 gap-y-3 p-5 ${CARD}`}>
            {items.map(item => (
                <div key={item.label} className="min-w-0">
                    <dt className="text-xs text-foreground-tertiary">{item.label}</dt>
                    <dd className="mt-0.5 text-[15px] font-medium tabular-nums text-foreground">{item.value}</dd>
                </div>
            ))}
        </dl>
    );
}

export function BillingUsagePanel({ active = true }: { active?: boolean }) {
    const [filters, setFilters] = useState<LedgerFilterState>(EMPTY_LEDGER_FILTERS);
    const [emailInput, setEmailInput] = useState('');
    const [email, setEmail] = useState('');
    const [page, setPage] = useState<AdminUsagePage | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // 只采用最近一次请求的结果：改了筛选后，较早发出的请求不能覆盖新列表。
    const seq = useRef(0);

    const load = useCallback(async (offset: number) => {
        const current = ++seq.current;
        setLoading(true);
        const query = ledgerFilterQuery(filters);
        if (email) query.set('email', email);
        query.set('offset', String(offset));
        query.set('limit', String(PAGE_SIZE));
        try {
            const next = await fetchAdminUsage(query);
            if (current !== seq.current) return;
            setPage(previous => (offset && previous ? { ...next, entries: [...previous.entries, ...next.entries] } : next));
            setError(null);
        } catch (failure) {
            if (current === seq.current) setError(failure instanceof Error ? failure.message : '读取用量日志失败');
        } finally {
            if (current === seq.current) setLoading(false);
        }
    }, [filters, email]);

    useEffect(() => {
        if (active) void Promise.resolve().then(() => load(0));
    }, [active, load]);

    const search = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setEmail(emailInput.trim().toLowerCase());
    };
    const filterModel = (model: string) => setFilters(value => ({ ...value, model }));

    return (
        <div className="flex flex-col gap-4">
            <p className="settings-help">
                每次平台模型调用记一条：免费模型记 $0，上游没报用量时按估算计费并标出。浏览器直连的自定义模型对话不经服务器，不在这里。
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
                <LedgerFilterBar value={filters} onChange={setFilters} kinds={['usage', 'refund']} />
                <Button variant="secondary" size="sm" onClick={() => void load(0)} className="ml-auto">
                    <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />刷新
                </Button>
            </div>

            {error ? (
                <div role="alert" className="settings-alert">
                    <span className="min-w-0 flex-1">{error}</span>
                    <Button variant="ghost" size="xs" onClick={() => void load(0)}>重试</Button>
                </div>
            ) : null}

            {!page ? (loading ? <SoundWaveLoader variant="block" /> : null) : (
                <>
                    <Totals totals={page.totals} />

                    {page.byModel.length ? (
                        <section aria-labelledby="usage-by-model-heading" className="flex flex-col gap-2">
                            <h3 id="usage-by-model-heading" className="text-[13px] font-medium text-foreground-tertiary">按模型汇总</h3>
                            <div className={`relative max-h-80 overflow-auto ${CARD}`}>
                                <table className="w-full min-w-[40rem] border-collapse" aria-label="按模型汇总">
                                    <thead>
                                        <tr className="border-b border-border">
                                            <th scope="col" className={`${TH} pl-5`}>模型</th>
                                            <th scope="col" className={TH}>调用</th>
                                            <th scope="col" className={TH}>输入</th>
                                            <th scope="col" className={TH}>输出</th>
                                            <th scope="col" className={TH}>缓存读 / 写</th>
                                            <th scope="col" className={`${TH} pr-5 text-right`}>消费</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {page.byModel.map(row => (
                                            <tr key={row.model} className="border-b border-border last:border-b-0">
                                                <th scope="row" className="max-w-[16rem] py-2.5 pl-5 pr-3 text-left font-normal">
                                                    <Button unstyled type="button" title="只看这个模型" onClick={() => filterModel(row.model)}
                                                        className="max-w-full truncate font-mono text-xs text-foreground hover:underline">{row.model}</Button>
                                                </th>
                                                <td className={`${TD} tabular-nums`}>{formatCount(row.calls)}{row.images ? ` · ${formatCount(row.images)} 张` : ''}</td>
                                                <td className={`${TD} tabular-nums`}>{formatCount(row.input)}</td>
                                                <td className={`${TD} tabular-nums`}>{formatCount(row.output)}</td>
                                                <td className={`${TD} tabular-nums`}>{formatCount(row.cacheRead)} / {formatCount(row.cacheWrite)}</td>
                                                <td className={`${TD} pr-5 text-right tabular-nums text-foreground`}>{formatUsd(row.spentMicros, { precise: true })}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    ) : null}

                    <section aria-labelledby="usage-entries-heading" className="flex flex-col gap-2">
                        <h3 id="usage-entries-heading" className="text-[13px] font-medium text-foreground-tertiary">调用明细</h3>
                        {page.entries.length ? (
                            // relative 让表头里 sr-only 的绝对定位文字也被滚动容器裁剪，否则手机上会撑宽整页。
                            <div className={`relative overflow-x-auto ${CARD}`}>
                                <table className="w-full min-w-[52rem] border-collapse" aria-label="调用明细">
                                    <thead>
                                        <tr className="border-b border-border">
                                            <th scope="col" className={`${TH} pl-5`}>时间</th>
                                            <th scope="col" className={TH}>用户</th>
                                            <th scope="col" className={TH}>来源</th>
                                            <th scope="col" className={TH}>模型</th>
                                            <th scope="col" className={TH}>用量</th>
                                            <th scope="col" className={`${TH} pr-5 text-right`}>金额</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {page.entries.map(entry => (
                                            <tr key={entry.id} className="border-b border-border align-top last:border-b-0">
                                                <td className={`${TD} whitespace-nowrap pl-5 tabular-nums`}>{formatBillingTime(entry.createdAt)}</td>
                                                <td className={`${TD} max-w-[13rem] truncate`} title={entry.userEmail ?? entry.userId}>
                                                    {entry.userEmail ?? <span className="font-mono text-xs">{entry.userId.slice(0, 8)}</span>}
                                                </td>
                                                <td className={`${TD} whitespace-nowrap`}>
                                                    {entry.kind === 'usage' ? billingSourceLabel(entry.source) : ledgerEntryTitle(entry)}
                                                </td>
                                                <td className={`${TD} max-w-[14rem]`}>
                                                    {entry.modelKey ? (
                                                        <Button unstyled type="button" title="只看这个模型" onClick={() => filterModel(entry.modelKey as string)}
                                                            className="max-w-full truncate font-mono text-xs hover:text-foreground hover:underline">{entry.modelKey}</Button>
                                                    ) : '—'}
                                                </td>
                                                <td className={TD}>
                                                    <span className="flex flex-wrap items-center gap-1.5">
                                                        {describeUsage(entry.usage) ?? '—'}
                                                        <LedgerMarks entry={entry} />
                                                    </span>
                                                </td>
                                                <td className="py-2.5 pl-3 pr-5 text-right"><LedgerAmount micros={entry.amountMicros} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {page.nextOffset !== null ? (
                                    <Button unstyled type="button" disabled={loading} onClick={() => void load(page.nextOffset as number)}
                                        className="h-11 w-full border-t border-border text-sm text-foreground-secondary transition-colors duration-150 hover:bg-background-secondary hover:text-foreground">
                                        {loading ? '加载中…' : '查看更多'}
                                    </Button>
                                ) : null}
                            </div>
                        ) : (
                            <div className={`px-6 py-10 text-center text-sm text-foreground-secondary ${CARD}`}>
                                {loading ? '加载中…' : '没有符合筛选条件的调用。'}
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
