/**
 * 订阅与余额：可用额度（余额 + 订阅剩余）、当前订阅、套餐、在线充值、兑换码、账单明细与支付订单。
 *
 * 'use client' 标记说明：
 * - 需要会话状态与 hooks 加载账户、处理兑换与购买，并在从支付页跳回时提示结果
 */
'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { BillingLedgerSection } from '@/components/billing/BillingLedgerSection';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FilterChip } from '@/components/ui/FilterChip';
import { Input } from '@/components/ui/Input';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { buyPlan, fetchBillingOrders, fetchBillingOverview, redeemCode, startCheckout, submitCheckout } from '@/lib/billing/client';
import {
    PAYMENT_ORDER_STATUS_LABELS, cnyForUsd, describePlanDuration,
    type BillingOverview, type BillingSummary, type PaymentOrderView, type SubscriptionPlanView,
} from '@/lib/billing/config';
import { formatBillingDay, formatBillingTime, resetPeriodLabel } from '@/lib/billing/format';
import { formatUsd, usdToMicros } from '@/lib/billing/money';

const SECTION_HEADING = 'text-[13px] font-medium text-foreground-tertiary';
const CARD = 'rounded-2xl border border-border bg-surface';
const MAX_TOPUP_USD = 10_000;

const PAYMENT_RESULT: Record<string, { tone: 'success' | 'info' | 'error'; message: string }> = {
    success: { tone: 'success', message: '支付成功，已到账' },
    pending: { tone: 'info', message: '支付结果确认中，到账后余额会自动更新' },
    fail: { tone: 'error', message: '没能确认支付结果；如已付款，稍后刷新即可看到到账' },
};

const ORDER_TONE: Record<PaymentOrderView['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
    paid: 'success', pending: 'warning', expired: 'neutral', failed: 'danger',
};

function BalanceCard({ summary }: { summary: BillingSummary }) {
    return (
        <section aria-label="可用额度" className={`flex flex-col gap-4 p-6 ${CARD}`}>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-col gap-1.5">
                    <span className="text-[13px] text-foreground-secondary">可用额度</span>
                    <span className="font-display text-[2.5rem] leading-none tabular-nums text-foreground">{formatUsd(summary.spendableMicros)}</span>
                </div>
                <dl className="flex gap-8 text-[13px]">
                    <div>
                        <dt className="text-foreground-tertiary">余额</dt>
                        <dd className="mt-0.5 tabular-nums text-foreground">{formatUsd(summary.walletMicros)}</dd>
                    </div>
                    <div>
                        <dt className="text-foreground-tertiary">订阅剩余</dt>
                        <dd className="mt-0.5 tabular-nums text-foreground">{formatUsd(summary.subscriptionMicros)}</dd>
                    </div>
                </dl>
            </div>
            {summary.walletMicros < 0 ? (
                <p className="text-[13px] leading-relaxed text-warning">
                    上一次调用超出了余额，欠 {formatUsd(-summary.walletMicros, { precise: true })}，下次充值或兑换时抵扣。
                </p>
            ) : null}
            <p className="text-[13px] leading-relaxed text-foreground-secondary">免费模型与自定义模型（自带 API Key）不计费。</p>
        </section>
    );
}

function Subscriptions({ summary }: { summary: BillingSummary }) {
    if (!summary.subscriptions.length) return null;
    return (
        <section aria-labelledby="billing-subscriptions-heading" className="flex flex-col gap-3">
            <h3 id="billing-subscriptions-heading" className={SECTION_HEADING}>我的订阅</h3>
            <ul className={`overflow-hidden ${CARD}`}>
                {summary.subscriptions.map(subscription => {
                    const left = Math.max(subscription.allowanceMicros - subscription.usedMicros, 0);
                    const used = subscription.allowanceMicros ? Math.min(subscription.usedMicros / subscription.allowanceMicros, 1) * 100 : 100;
                    return (
                        <li key={subscription.id} className="flex flex-col gap-2 border-t border-border p-4 first:border-t-0">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                <span className="text-sm font-medium text-foreground">{subscription.title}</span>
                                <span className="text-[13px] tabular-nums text-foreground-secondary">
                                    剩余 {formatUsd(left)} / {formatUsd(subscription.allowanceMicros)}
                                </span>
                            </div>
                            <div role="progressbar" aria-label={`「${subscription.title}」已用额度`} aria-valuemin={0} aria-valuemax={100}
                                aria-valuenow={Math.round(used)} className="h-1.5 overflow-hidden rounded-full bg-background-secondary">
                                <div className="h-full rounded-full bg-accent" style={{ width: `${used}%` }} />
                            </div>
                            <p className="text-xs text-foreground-tertiary">
                                {resetPeriodLabel(subscription.resetPeriod)}
                                {subscription.nextResetAt ? ` · ${formatBillingTime(subscription.nextResetAt)} 重置` : ''}
                                {` · ${formatBillingDay(subscription.endsAt)} 到期`}
                            </p>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function PlanCard({ plan, payment, busy, onBuy, onPay }: {
    plan: SubscriptionPlanView;
    payment: BillingOverview['payment'];
    busy: string | null;
    onBuy: (plan: SubscriptionPlanView) => void;
    onPay: (plan: SubscriptionPlanView, method: string) => void;
}) {
    return (
        <div className={`flex flex-col gap-3 p-[18px] ${CARD}`}>
            <div className="flex flex-col gap-1">
                <span className="font-display text-xl text-foreground">{plan.title}</span>
                {plan.subtitle ? <span className="text-pretty text-[13px] text-foreground-secondary">{plan.subtitle}</span> : null}
            </div>
            <div className="flex items-baseline gap-1.5">
                <span className="font-display text-2xl tabular-nums text-foreground">{plan.priceUsd ? formatUsd(usdToMicros(plan.priceUsd)) : '免费'}</span>
                <span className="text-[13px] text-foreground-tertiary">/ {describePlanDuration(plan)}</span>
            </div>
            <ul className="text-[13px] leading-[1.7] text-foreground">
                <li>额度 {formatUsd(plan.allowanceMicros)}{plan.resetPeriod === 'never' ? '' : `，${resetPeriodLabel(plan.resetPeriod)}`}</li>
                {plan.features.map(feature => <li key={feature}>{feature}</li>)}
            </ul>
            <div className="mt-auto flex flex-wrap gap-2 pt-1">
                {plan.purchasable ? (
                    <>
                        <Button size="sm" disabled={!!busy} onClick={() => onBuy(plan)}>{plan.priceUsd ? '用余额购买' : '免费开通'}</Button>
                        {payment.enabled && plan.priceUsd > 0 ? payment.methods.map(method => (
                            <Button key={method.id} variant="secondary" size="sm" disabled={!!busy} loading={busy === `${plan.id}:${method.id}`}
                                onClick={() => onPay(plan, method.id)}>{method.label}</Button>
                        )) : null}
                    </>
                ) : <span className="text-[13px] text-foreground-tertiary">仅可通过兑换码开通</span>}
            </div>
        </div>
    );
}

function Orders({ orders }: { orders: PaymentOrderView[] }) {
    if (!orders.length) return null;
    return (
        <section aria-labelledby="billing-orders-heading" className="flex flex-col gap-3">
            <h3 id="billing-orders-heading" className={SECTION_HEADING}>支付订单</h3>
            <ul className={`overflow-hidden ${CARD}`}>
                {orders.map(order => (
                    <li key={order.id} className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 first:border-t-0">
                        <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate text-sm text-foreground">
                                {order.kind === 'topup' ? `充值 ${formatUsd(order.creditMicros ?? 0)}` : `购买「${order.planTitle ?? '套餐'}」`}
                            </span>
                            <span className="truncate text-xs text-foreground-tertiary">{formatBillingTime(order.createdAt)} · {order.tradeNo}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <span className="text-sm tabular-nums text-foreground">{order.payCurrency === 'CNY' ? '¥' : `${order.payCurrency} `}{order.payAmount.toFixed(2)}</span>
                            <Badge variant={ORDER_TONE[order.status]}>{PAYMENT_ORDER_STATUS_LABELS[order.status]}</Badge>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** What is wrong with a typed top-up amount, or null. */
function topupError(value: string, minimum: number): string | null {
    const usd = Number(value);
    if (!value.trim() || !Number.isFinite(usd)) return '请输入充值金额';
    if (Math.round(usd * 100) !== usd * 100) return '最多两位小数';
    if (usd < minimum || usd > MAX_TOPUP_USD) return `金额需要在 $${minimum} 到 $${MAX_TOPUP_USD} 之间`;
    return null;
}

function BillingContent() {
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const paymentResult = searchParams.get('payment');
    const [overview, setOverview] = useState<BillingOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [orders, setOrders] = useState<PaymentOrderView[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [code, setCode] = useState('');
    const [redeeming, setRedeeming] = useState(false);
    const [buying, setBuying] = useState<SubscriptionPlanView | null>(null);
    const [buyingBusy, setBuyingBusy] = useState(false);
    const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
    const [amount, setAmount] = useState('');

    const load = useCallback(async () => {
        try {
            const [next, orderPage] = await Promise.all([fetchBillingOverview(), fetchBillingOrders().catch(() => null)]);
            setOverview(next);
            setError(null);
            if (orderPage) setOrders(orderPage.orders);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : '读取账户失败');
        }
    }, []);

    useEffect(() => {
        void Promise.resolve().then(load);
    }, [load, refreshKey]);

    // 从支付页跳回：提示结果、去掉地址里的参数，再刷新余额与订单。
    useEffect(() => {
        const result = paymentResult ? PAYMENT_RESULT[paymentResult] : null;
        if (!paymentResult) return;
        void Promise.resolve().then(() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('payment');
            window.history.replaceState(window.history.state, '', url.toString());
            if (result) showToast(result.tone, result.message);
            setRefreshKey(key => key + 1);
        });
    }, [paymentResult, showToast]);

    const updated = (summary: BillingSummary | null) => {
        if (summary) setOverview(current => (current ? { ...current, summary } : current));
        setRefreshKey(key => key + 1);
    };

    const redeem = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!code.trim() || redeeming) return;
        setRedeeming(true);
        try {
            const { result, summary } = await redeemCode(code);
            setCode('');
            showToast('success', result.kind === 'subscription'
                ? `已开通「${result.planTitle ?? '套餐'}」`
                : `已到账 ${formatUsd(result.amountMicros)}`);
            updated(summary);
        } catch (failure) {
            showToast('error', failure instanceof Error ? failure.message : '兑换失败');
        } finally {
            setRedeeming(false);
        }
    };

    const confirmBuy = async () => {
        if (!buying) return;
        setBuyingBusy(true);
        try {
            const { summary } = await buyPlan(buying.id);
            showToast('success', `已开通「${buying.title}」`);
            setBuying(null);
            updated(summary);
        } catch (failure) {
            showToast('error', failure instanceof Error ? failure.message : '购买失败');
        } finally {
            setBuyingBusy(false);
        }
    };

    const checkout = async (key: string, input: Parameters<typeof startCheckout>[0]) => {
        setCheckoutBusy(key);
        try {
            submitCheckout(await startCheckout(input));
        } catch (failure) {
            showToast('error', failure instanceof Error ? failure.message : '创建支付订单失败');
            setCheckoutBusy(null);
        }
    };

    if (!overview) {
        return error ? (
            <div role="alert" className="settings-alert">
                <span className="min-w-0 flex-1">{error}</span>
                <Button variant="ghost" size="xs" onClick={() => void load()}>重试</Button>
            </div>
        ) : <div className="flex min-h-[240px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
    }

    const { summary, plans, settings, payment } = overview;
    const amountError = amount ? topupError(amount, settings.minTopupUsd) : null;
    return (
        <div className="space-y-8">
            <BalanceCard summary={summary} />
            <Subscriptions summary={summary} />

            {plans.length ? (
                <section aria-labelledby="billing-plans-heading" className="flex flex-col gap-3">
                    <h3 id="billing-plans-heading" className={SECTION_HEADING}>订阅套餐</h3>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
                        {plans.map(plan => (
                            <PlanCard key={plan.id} plan={plan} payment={payment} busy={checkoutBusy} onBuy={setBuying}
                                onPay={(target, method) => void checkout(`${target.id}:${method}`, { kind: 'subscription', planId: target.id, method })} />
                        ))}
                    </div>
                </section>
            ) : null}

            {payment.enabled ? (
                <section aria-labelledby="billing-topup-heading" className="flex flex-col gap-3">
                    <h3 id="billing-topup-heading" className={SECTION_HEADING}>充值</h3>
                    <div className={`flex flex-col gap-4 p-[18px] ${CARD}`}>
                        <div role="group" aria-label="充值金额" className="flex flex-wrap gap-2">
                            {settings.topupOptionsUsd.map(usd => (
                                <FilterChip key={usd} pressed={amount === String(usd)} onClick={() => setAmount(String(usd))} className="settings-filter">
                                    ${usd}
                                </FilterChip>
                            ))}
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="billing-topup-amount" className="text-sm font-medium text-foreground">金额（美元）</label>
                            <Input id="billing-topup-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value.trim())}
                                placeholder={`最低 $${settings.minTopupUsd}`} aria-invalid={amountError ? true : undefined} className="max-w-xs tabular-nums" />
                            <p className={`text-[13px] ${amountError ? 'text-danger' : 'text-foreground-secondary'}`}>
                                {amountError ?? (amount ? `需支付 ¥${cnyForUsd(Number(amount), settings).toFixed(2)}` : `按 1 美元 = ${settings.cnyPerUsd} 元人民币支付`)}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {payment.methods.map(method => (
                                <Button key={method.id} size="sm" disabled={!amount || !!amountError || !!checkoutBusy} loading={checkoutBusy === `topup:${method.id}`}
                                    onClick={() => void checkout(`topup:${method.id}`, { kind: 'topup', amountUsd: Number(amount), method: method.id })}>
                                    {method.label}
                                </Button>
                            ))}
                        </div>
                    </div>
                </section>
            ) : null}

            <section aria-labelledby="billing-redeem-heading" className="flex flex-col gap-3">
                <h3 id="billing-redeem-heading" className={SECTION_HEADING}>兑换码</h3>
                <form onSubmit={event => void redeem(event)} className="flex flex-wrap items-center gap-2">
                    <Input value={code} onChange={event => setCode(event.target.value)} placeholder="tb-xxxxxxxxxxxxxxxxxxxx" aria-label="兑换码"
                        autoComplete="off" spellCheck={false} className="max-w-sm font-mono" />
                    <Button type="submit" loading={redeeming} disabled={!code.trim()}>兑换</Button>
                </form>
            </section>

            <BillingLedgerSection refreshKey={refreshKey} />
            <Orders orders={orders} />

            <ConfirmDialog
                isOpen={!!buying}
                onClose={() => { if (!buyingBusy) setBuying(null); }}
                onConfirm={confirmBuy}
                variant="default"
                loading={buyingBusy}
                title={buying ? `开通「${buying.title}」` : ''}
                description={buying
                    ? `${buying.priceUsd ? `将从余额扣除 ${formatUsd(usdToMicros(buying.priceUsd))}，` : ''}立即生效，有效期 ${describePlanDuration(buying)}。`
                    : ''}
                confirmText={buying?.priceUsd ? '确认购买' : '确认开通'}
            />
        </div>
    );
}

export default function BillingPanel() {
    const { user, loading } = useSessionSafe();
    if (loading) {
        return <div className="flex min-h-[240px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
    }
    if (!user) return <SettingsLoginRequired title="请先登录后查看订阅与余额" />;
    return <BillingContent key={user.id} />;
}
