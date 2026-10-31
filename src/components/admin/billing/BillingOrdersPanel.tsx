/**
 * 支付订单：全站在线充值与在线购买套餐的订单，按状态筛选。待支付的订单超过两小时由维护任务标为过期；
 * 过期后网关仍通知已付款的，照常到账。
 *
 * 'use client' 标记说明：
 * - 需要 useState / useEffect 维护筛选、分页与请求顺序
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FilterChip } from '@/components/ui/FilterChip';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { fetchAdminOrders, type AdminOrdersPage } from '@/lib/billing/client';
import { PAYMENT_ORDER_STATUS_LABELS, type PaymentOrderView } from '@/lib/billing/config';
import { formatBillingTime } from '@/lib/billing/format';
import { formatUsd } from '@/lib/billing/money';

const CARD = 'rounded-2xl border border-border bg-surface';
const TH = 'px-3 py-2.5 text-left text-xs font-medium text-foreground-tertiary';
const TD = 'px-3 py-2.5 text-[13px] text-foreground-secondary';
const PAGE_SIZE = 50;
const STATUS_TONE: Record<PaymentOrderView['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
    paid: 'success', pending: 'warning', expired: 'neutral', failed: 'danger',
};
const FILTERS: ReadonlyArray<{ value: PaymentOrderView['status'] | 'all'; label: string }> = [
    { value: 'all', label: '全部' }, { value: 'paid', label: '已支付' }, { value: 'pending', label: '待支付' }, { value: 'expired', label: '已过期' },
];
const METHOD_LABELS: Record<string, string> = { alipay: '支付宝', wxpay: '微信支付', qqpay: 'QQ 钱包' };

export function BillingOrdersPanel({ active = true }: { active?: boolean }) {
    const [status, setStatus] = useState<PaymentOrderView['status'] | 'all'>('all');
    const [page, setPage] = useState<AdminOrdersPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const seq = useRef(0);

    const load = useCallback(async (offset: number) => {
        const current = ++seq.current;
        setLoading(true);
        const query = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE), ...(status === 'all' ? {} : { status }) });
        try {
            const next = await fetchAdminOrders(query);
            if (current !== seq.current) return;
            setPage(previous => (offset && previous ? { orders: [...previous.orders, ...next.orders], nextOffset: next.nextOffset } : next));
            setError(null);
        } catch (failure) {
            if (current === seq.current) setError(failure instanceof Error ? failure.message : '读取订单失败');
        } finally {
            if (current === seq.current) setLoading(false);
        }
    }, [status]);

    useEffect(() => {
        if (active) void Promise.resolve().then(() => load(0));
    }, [active, load]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="settings-help">在线充值与在线购买套餐的订单。未开启在线支付时这里没有记录。</p>
                <div role="group" aria-label="按状态筛选" className="flex flex-wrap gap-1.5">
                    {FILTERS.map(filter => (
                        <FilterChip key={filter.value} pressed={status === filter.value} onClick={() => setStatus(filter.value)} className="settings-filter">
                            {filter.label}
                        </FilterChip>
                    ))}
                </div>
            </div>
            {error ? (
                <div role="alert" className="settings-alert">
                    <span className="min-w-0 flex-1">{error}</span>
                    <Button variant="ghost" size="xs" onClick={() => void load(0)}>重试</Button>
                </div>
            ) : null}
            {!page ? (loading ? <SoundWaveLoader variant="block" /> : null) : page.orders.length ? (
                <div className={`relative overflow-x-auto ${CARD}`}>
                    <table className="w-full min-w-[52rem] border-collapse" aria-label="支付订单">
                        <thead>
                            <tr className="border-b border-border">
                                <th scope="col" className={`${TH} pl-5`}>时间</th>
                                <th scope="col" className={TH}>用户</th>
                                <th scope="col" className={TH}>内容</th>
                                <th scope="col" className={TH}>支付</th>
                                <th scope="col" className={TH}>状态</th>
                                <th scope="col" className={`${TH} pr-5`}>订单号</th>
                            </tr>
                        </thead>
                        <tbody>
                            {page.orders.map(order => (
                                <tr key={order.id} className="border-b border-border last:border-b-0">
                                    <td className={`${TD} whitespace-nowrap pl-5 tabular-nums`}>{formatBillingTime(order.createdAt)}</td>
                                    <td className={`${TD} max-w-[13rem] truncate`} title={order.userEmail ?? order.userId}>
                                        {order.userEmail ?? <span className="font-mono text-xs">{order.userId.slice(0, 8)}</span>}
                                    </td>
                                    <td className={`${TD} whitespace-nowrap text-foreground`}>
                                        {order.kind === 'topup' ? `充值 ${formatUsd(order.creditMicros ?? 0)}` : `套餐「${order.planTitle ?? '已删除'}」`}
                                    </td>
                                    <td className={`${TD} whitespace-nowrap tabular-nums`}>
                                        {order.payCurrency === 'CNY' ? '¥' : `${order.payCurrency} `}{order.payAmount.toFixed(2)}
                                        {order.payMethod ? ` · ${METHOD_LABELS[order.payMethod] ?? order.payMethod}` : ''}
                                    </td>
                                    <td className={TD}>
                                        <span className="flex flex-col items-start gap-0.5">
                                            <Badge variant={STATUS_TONE[order.status]}>{PAYMENT_ORDER_STATUS_LABELS[order.status]}</Badge>
                                            {order.paidAt ? <span className="whitespace-nowrap text-xs tabular-nums text-foreground-tertiary">{formatBillingTime(order.paidAt)}</span> : null}
                                        </span>
                                    </td>
                                    <td className={`${TD} select-all whitespace-nowrap pr-5 font-mono text-xs`}>{order.tradeNo}</td>
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
                <div className={`px-6 py-10 text-center text-sm text-foreground-secondary ${CARD}`}>{loading ? '加载中…' : '没有订单。'}</div>
            )}
        </div>
    );
}
