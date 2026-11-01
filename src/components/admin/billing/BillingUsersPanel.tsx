/**
 * 用户账户：按邮箱查用户，查看余额、订阅与用量日志；可以加减余额、赠送套餐、取消订阅。
 *
 * 'use client' 标记说明：
 * - 需要 useState / useEffect 维护查找结果、选中的用户与各项操作的提交状态
 */
'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Search, X } from 'lucide-react';
import { LedgerDetailDialog } from '@/components/billing/LedgerDetailDialog';
import { LedgerEntryRow } from '@/components/billing/LedgerEntryRow';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import {
    cancelAdminSubscription, changeAdminUser, fetchAdminPlans, fetchAdminUser, searchAdminUsers, type AdminBillingUserDetail,
} from '@/lib/billing/client';
import {
    PAYMENT_ORDER_STATUS_LABELS, type AdminBillingUserView, type BillingSubscription, type LedgerEntryView, type SubscriptionPlanView,
} from '@/lib/billing/config';
import { formatBillingDay, formatBillingTime, windowLabel } from '@/lib/billing/format';
import { formatUsd, usdToMicros } from '@/lib/billing/money';

const CARD = 'rounded-2xl border border-border bg-surface';
const HEADING = 'text-[13px] font-medium text-foreground-tertiary';

const message = (failure: unknown, fallback: string) => (failure instanceof Error && failure.message ? failure.message : fallback);

function UserDetail({ userId, plans, onClose, onChanged }: {
    userId: string;
    plans: SubscriptionPlanView[];
    onClose: () => void;
    onChanged: (walletMicros: number) => void;
}) {
    const { showToast } = useToast();
    const [detail, setDetail] = useState<AdminBillingUserDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [planId, setPlanId] = useState<string | null>(null);
    const [grantNote, setGrantNote] = useState('');
    const [busy, setBusy] = useState<'adjust' | 'grant' | 'cancel' | null>(null);
    const [cancelling, setCancelling] = useState<BillingSubscription | null>(null);
    const [entry, setEntry] = useState<LedgerEntryView | null>(null);
    const seq = useRef(0);

    const load = useCallback(async () => {
        const current = ++seq.current;
        try {
            const next = await fetchAdminUser(userId);
            if (current !== seq.current) return;
            setDetail(next);
            setError(null);
            onChanged(next.summary.walletMicros);
        } catch (failure) {
            if (current === seq.current) setError(message(failure, '读取用户账户失败'));
        }
    }, [userId, onChanged]);

    useEffect(() => {
        void Promise.resolve().then(load);
    }, [load]);

    const more = async () => {
        if (!detail || detail.ledger.nextOffset === null) return;
        setLoadingMore(true);
        try {
            const next = await fetchAdminUser(userId, detail.ledger.nextOffset);
            setDetail(current => current && {
                ...current, ledger: { entries: [...current.ledger.entries, ...next.ledger.entries], nextOffset: next.ledger.nextOffset },
            });
        } catch (failure) {
            showToast('error', message(failure, '读取用量日志失败'));
        } finally {
            setLoadingMore(false);
        }
    };

    const adjust = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const usd = Number(amount);
        if (!amount.trim() || !Number.isFinite(usd) || usd === 0) {
            showToast('error', '请输入不为 0 的金额；负数表示扣减');
            return;
        }
        setBusy('adjust');
        try {
            await changeAdminUser(userId, { action: 'adjust', amountUsd: usd, description: note.trim() });
            showToast('success', usd > 0 ? `已加款 ${formatUsd(usdToMicros(usd))}` : `已扣减 ${formatUsd(usdToMicros(-usd))}`);
            setAmount('');
            setNote('');
            await load();
        } catch (failure) {
            showToast('error', message(failure, '调整余额失败'));
        } finally {
            setBusy(null);
        }
    };

    const grant = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!planId) return;
        setBusy('grant');
        try {
            await changeAdminUser(userId, { action: 'grant', planId, note: grantNote.trim() });
            showToast('success', '已开通套餐');
            setGrantNote('');
            await load();
        } catch (failure) {
            showToast('error', message(failure, '开通套餐失败'));
        } finally {
            setBusy(null);
        }
    };

    const cancel = async () => {
        if (!cancelling) return;
        setBusy('cancel');
        try {
            await cancelAdminSubscription(cancelling.id);
            showToast('success', `已取消「${cancelling.title}」`);
            setCancelling(null);
            await load();
        } catch (failure) {
            showToast('error', message(failure, '取消订阅失败'));
        } finally {
            setBusy(null);
        }
    };

    if (!detail) {
        return error ? (
            <div role="alert" className="settings-alert">
                <span className="min-w-0 flex-1">{error}</span>
                <Button variant="ghost" size="xs" onClick={() => void load()}>重试</Button>
            </div>
        ) : <SoundWaveLoader variant="block" />;
    }

    const { user, summary, ledger, orders } = detail;
    return (
        <section aria-label="用户账户" className={`flex flex-col gap-6 p-5 ${CARD}`}>
            <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="break-all text-[15px] font-medium text-foreground">{user.email ?? user.userId}</h3>
                    <p className="mt-0.5 text-xs text-foreground-tertiary">
                        {user.nickname ? `${user.nickname} · ` : ''}<span className="select-all font-mono">{user.userId}</span>
                    </p>
                </div>
                <IconButton label="关闭用户账户" size="sm" onClick={onClose}><X aria-hidden="true" className="h-4 w-4" /></IconButton>
            </header>

            <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-6 gap-y-3">
                {[
                    { label: '可用额度', micros: summary.spendableMicros },
                    { label: '余额', micros: summary.walletMicros },
                    { label: '订阅剩余', micros: summary.subscriptionMicros },
                ].map(({ label, micros }) => (
                    <div key={label}>
                        <dt className="text-xs text-foreground-tertiary">{label}</dt>
                        <dd className={`mt-0.5 text-[15px] font-medium tabular-nums ${micros < 0 ? 'text-warning' : 'text-foreground'}`}>
                            {formatUsd(micros, { precise: micros < 0 })}
                        </dd>
                    </div>
                ))}
            </dl>

            <div className="grid gap-4 lg:grid-cols-2">
                <form onSubmit={event => void adjust(event)} className="flex flex-col gap-2">
                    <span className={HEADING}>加减余额</span>
                    <div className="flex flex-wrap gap-2">
                        <Input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value.trim())} placeholder="美元，负数为扣减"
                            aria-label="调整金额（美元）" className="w-40 tabular-nums" size="sm" />
                        <Input value={note} onChange={event => setNote(event.target.value)} placeholder="说明（可选）" maxLength={200}
                            aria-label="调整说明" className="min-w-0 flex-1" size="sm" />
                        <Button type="submit" size="sm" loading={busy === 'adjust'} disabled={!!busy || !amount}>确定</Button>
                    </div>
                    <p className="text-xs text-foreground-tertiary">扣减不会让余额低于 0；用户会在用量日志里看到这条调整。</p>
                </form>
                <form onSubmit={event => void grant(event)} className="flex flex-col gap-2">
                    <span className={HEADING}>赠送套餐</span>
                    <div className="flex flex-wrap gap-2">
                        <Select ariaLabel="套餐" value={planId} placeholder={plans.length ? '选择套餐' : '还没有套餐'} disabled={!plans.length}
                            options={plans.map(plan => ({ value: plan.id, label: plan.enabled ? plan.title : `${plan.title}（已停用）` }))}
                            onChange={setPlanId} className="w-44" />
                        <Input value={grantNote} onChange={event => setGrantNote(event.target.value)} placeholder="备注（可选）" maxLength={200}
                            aria-label="赠送备注" className="min-w-0 flex-1" size="sm" />
                        <Button type="submit" size="sm" loading={busy === 'grant'} disabled={!!busy || !planId}>开通</Button>
                    </div>
                    <p className="text-xs text-foreground-tertiary">立即生效，不扣余额，不受每人限购限制。</p>
                </form>
            </div>

            <div className="flex flex-col gap-2">
                <span className={HEADING}>当前订阅</span>
                {summary.subscriptions.length ? (
                    <ul className="overflow-hidden rounded-xl border border-border">
                        {summary.subscriptions.map(subscription => (
                            <li key={subscription.id} className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0">
                                <div className="flex min-w-0 flex-col gap-0.5">
                                    <span className="text-sm text-foreground">{subscription.title}</span>
                                    <span className="text-xs text-foreground-tertiary">
                                        {subscription.limits.map(limit => `${windowLabel(limit.period)} ${formatUsd(limit.usedMicros)} / ${formatUsd(limit.allowanceMicros)}`).join(' · ')}
                                        {` · ${formatBillingDay(subscription.endsAt)} 到期`}
                                    </span>
                                </div>
                                <Button variant="ghost" size="xs" disabled={!!busy} onClick={() => setCancelling(subscription)}>取消订阅</Button>
                            </li>
                        ))}
                    </ul>
                ) : <p className="text-[13px] text-foreground-secondary">没有生效中的订阅。</p>}
            </div>

            <div className="flex flex-col gap-2">
                <span className={HEADING}>用量日志</span>
                {ledger.entries.length ? (
                    <div className="overflow-hidden rounded-xl border border-border">
                        <ul aria-label="用户用量日志">{ledger.entries.map(item => <LedgerEntryRow key={item.id} entry={item} onOpen={setEntry} />)}</ul>
                        {ledger.nextOffset !== null ? (
                            <Button unstyled type="button" disabled={loadingMore} onClick={() => void more()}
                                className="h-10 w-full border-t border-border text-sm text-foreground-secondary hover:bg-background-secondary hover:text-foreground">
                                {loadingMore ? '加载中…' : '查看更多'}
                            </Button>
                        ) : null}
                    </div>
                ) : <p className="text-[13px] text-foreground-secondary">还没有用量记录。</p>}
                <LedgerDetailDialog admin entry={entry && { ...entry, userId: user.userId, userEmail: user.email }} onClose={() => setEntry(null)} />
            </div>

            {orders.length ? (
                <div className="flex flex-col gap-2">
                    <span className={HEADING}>最近订单</span>
                    <ul className="overflow-hidden rounded-xl border border-border">
                        {orders.map(order => (
                            <li key={order.id} className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-[13px] first:border-t-0">
                                <span className="min-w-0 truncate text-foreground">
                                    {order.kind === 'topup' ? `充值 ${formatUsd(order.creditMicros ?? 0)}` : `购买「${order.planTitle ?? '套餐'}」`}
                                    <span className="ml-2 text-xs text-foreground-tertiary">{formatBillingTime(order.createdAt)}</span>
                                </span>
                                <span className="shrink-0 tabular-nums text-foreground-secondary">¥{order.payAmount.toFixed(2)} · {PAYMENT_ORDER_STATUS_LABELS[order.status]}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <ConfirmDialog
                isOpen={!!cancelling}
                onClose={() => { if (busy !== 'cancel') setCancelling(null); }}
                onConfirm={cancel}
                loading={busy === 'cancel'}
                title={cancelling ? `取消「${cancelling.title}」` : ''}
                description="取消后剩余额度立即作废，不退款。"
                confirmText="取消订阅"
            />
        </section>
    );
}

export function BillingUsersPanel() {
    const { showToast } = useToast();
    const [query, setQuery] = useState('');
    const [users, setUsers] = useState<AdminBillingUserView[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [plans, setPlans] = useState<SubscriptionPlanView[]>([]);

    useEffect(() => {
        let current = true;
        fetchAdminPlans().then(result => { if (current) setPlans(result.plans); }, () => {});
        return () => { current = false; };
    }, []);

    const search = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const email = query.trim();
        if (!email) return;
        setSearching(true);
        try {
            const result = await searchAdminUsers(email);
            setUsers(result.users);
            setSelected(result.users.length === 1 ? result.users[0].userId : null);
        } catch (failure) {
            showToast('error', message(failure, '查找用户失败'));
        } finally {
            setSearching(false);
        }
    };

    // The detail reports the balance it read, so the list beside it stays current after an adjustment.
    const walletChanged = useCallback((walletMicros: number) => {
        setUsers(list => list?.map(user => (user.userId === selected && user.walletMicros !== walletMicros ? { ...user, walletMicros } : user)) ?? list);
    }, [selected]);

    return (
        <div className="flex flex-col gap-4">
            <form role="search" onSubmit={event => void search(event)} className="flex items-center gap-1.5">
                <Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="用户邮箱（可只输前缀）"
                    aria-label="按邮箱查找用户" className="w-72 max-w-full" />
                <Button type="submit" variant="secondary" loading={searching} disabled={!query.trim()}>
                    <Search aria-hidden="true" className="h-3.5 w-3.5" />查找
                </Button>
            </form>

            {users ? (users.length ? (
                <ul aria-label="查找结果" className={`overflow-hidden ${CARD}`}>
                    {users.map(user => (
                        <li key={user.userId} className="border-t border-border first:border-t-0">
                            <Button unstyled type="button" aria-pressed={user.userId === selected} onClick={() => setSelected(user.userId === selected ? null : user.userId)}
                                className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-background-secondary/60 ${user.userId === selected ? 'bg-background-secondary/60' : ''}`}>
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm text-foreground">{user.email ?? user.userId}</span>
                                    {user.nickname ? <span className="truncate text-xs text-foreground-tertiary">{user.nickname}</span> : null}
                                </span>
                                <span className="flex shrink-0 items-center gap-2 text-[13px] tabular-nums text-foreground-secondary">
                                    余额 {formatUsd(user.walletMicros, { precise: user.walletMicros < 0 })}
                                    {user.walletMicros < 0 ? <Badge variant="warning">欠费</Badge> : null}
                                </span>
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : <p className="text-[13px] text-foreground-secondary">没有找到这个邮箱开头的用户。</p>) : null}

            {selected ? <UserDetail key={selected} userId={selected} plans={plans} onClose={() => setSelected(null)} onChanged={walletChanged} /> : null}
        </div>
    );
}
