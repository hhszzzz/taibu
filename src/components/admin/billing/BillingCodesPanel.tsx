/**
 * 兑换码：批量生成余额码或套餐码，按状态与类型查看，作废未使用的码。每个码只能兑换一次。
 *
 * 'use client' 标记说明：
 * - 需要 useState / useEffect 维护生成表单、筛选与列表
 */
'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FilterChip } from '@/components/ui/FilterChip';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { createAdminCodes, disableAdminCode, fetchAdminCodes, fetchAdminPlans } from '@/lib/billing/client';
import {
    REDEMPTION_BATCH_MAX, REDEMPTION_CODE_STATUS_LABELS, type RedemptionCodeKind, type RedemptionCodeStatus, type RedemptionCodeView, type SubscriptionPlanView,
} from '@/lib/billing/config';
import { formatBillingDay, formatBillingTime } from '@/lib/billing/format';
import { formatUsd } from '@/lib/billing/money';

const CARD = 'rounded-2xl border border-border bg-surface';
const TH = 'px-3 py-2.5 text-left text-xs font-medium text-foreground-tertiary';
const TD = 'px-3 py-2.5 text-[13px] text-foreground-secondary';
const STATUS_TONE: Record<RedemptionCodeStatus, 'success' | 'neutral' | 'warning'> = { unused: 'success', used: 'neutral', disabled: 'warning' };
const STATUS_FILTERS: ReadonlyArray<{ value: RedemptionCodeStatus | 'all'; label: string }> = [
    { value: 'all', label: '全部' }, { value: 'unused', label: '未使用' }, { value: 'used', label: '已使用' }, { value: 'disabled', label: '已作废' },
];

/** The end of the chosen day in the administrator's time zone. */
const endOfDay = (day: string) => {
    const date = new Date(`${day}T23:59:59`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function Generator({ plans, onCreated }: { plans: SubscriptionPlanView[]; onCreated: () => void }) {
    const { showToast } = useToast();
    const [kind, setKind] = useState<RedemptionCodeKind>('balance');
    const [amount, setAmount] = useState('');
    const [planId, setPlanId] = useState<string | null>(null);
    const [count, setCount] = useState('10');
    const [expires, setExpires] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [created, setCreated] = useState<string[]>([]);
    const countValid = /^\d+$/u.test(count) && Number(count) >= 1 && Number(count) <= REDEMPTION_BATCH_MAX;
    const contentValid = kind === 'balance' ? Number(amount) > 0 && Number(amount) <= 10_000 : !!planId;

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true);
        try {
            const { codes } = await createAdminCodes({
                kind, count: Number(count), batchNote: note.trim(), expiresAt: expires ? endOfDay(expires) : null,
                ...(kind === 'balance' ? { amountUsd: Number(amount) } : { planId }),
            });
            setCreated(codes);
            showToast('success', `已生成 ${codes.length} 个兑换码`);
            onCreated();
        } catch (failure) {
            showToast('error', failure instanceof Error ? failure.message : '生成兑换码失败');
        } finally {
            setBusy(false);
        }
    };

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(created.join('\n'));
            showToast('success', '已复制');
        } catch {
            showToast('error', '复制失败，请手动选择文本');
        }
    };

    return (
        <section aria-labelledby="billing-codes-create-heading" className={`flex flex-col gap-4 p-5 ${CARD}`}>
            <h3 id="billing-codes-create-heading" className="text-[15px] font-medium text-foreground">生成兑换码</h3>
            <form onSubmit={event => void submit(event)} className="flex flex-col gap-3">
                <SegmentedControl ariaLabel="兑换码类型" value={kind} onChange={setKind} size="sm" maxWidth={240}
                    options={[{ value: 'balance', label: '余额' }, { value: 'subscription', label: '套餐' }]} />
                <div className="flex flex-wrap items-end gap-3">
                    {kind === 'balance' ? (
                        <label className="settings-field">
                            <span>金额（美元）</span>
                            <Input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value.trim())} placeholder="10" className="w-32" size="sm" />
                        </label>
                    ) : (
                        <div className="settings-field">
                            <span>套餐</span>
                            <Select ariaLabel="套餐" value={planId} onChange={setPlanId} placeholder={plans.length ? '选择套餐' : '还没有套餐'} disabled={!plans.length}
                                options={plans.map(plan => ({ value: plan.id, label: plan.enabled ? plan.title : `${plan.title}（已停用）` }))} className="w-48" />
                        </div>
                    )}
                    <label className="settings-field">
                        <span>数量</span>
                        <Input inputMode="numeric" value={count} onChange={event => setCount(event.target.value.trim())} className="w-20" size="sm"
                            title={`1–${REDEMPTION_BATCH_MAX} 个`} />
                    </label>
                    <label className="settings-field">
                        <span>过期日期（可选）</span>
                        <Input type="date" value={expires} onChange={event => setExpires(event.target.value)} className="w-40" size="sm" />
                    </label>
                    <label className="settings-field min-w-0 flex-1">
                        <span>备注（可选）</span>
                        <Input value={note} onChange={event => setNote(event.target.value)} maxLength={200} placeholder="例如：十月活动" size="sm" />
                    </label>
                    <Button type="submit" loading={busy} disabled={busy || !contentValid || !countValid}>生成</Button>
                </div>
            </form>
            {created.length ? (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[13px] text-foreground-secondary">刚生成的 {created.length} 个兑换码</span>
                        <Button variant="secondary" size="xs" onClick={() => void copy()}><Copy aria-hidden="true" className="h-3.5 w-3.5" />复制全部</Button>
                    </div>
                    <Textarea readOnly rows={Math.min(created.length, 6)} value={created.join('\n')} aria-label="刚生成的兑换码" className="font-mono text-xs" />
                </div>
            ) : null}
        </section>
    );
}

export function BillingCodesPanel() {
    const { showToast } = useToast();
    const [plans, setPlans] = useState<SubscriptionPlanView[]>([]);
    const [status, setStatus] = useState<RedemptionCodeStatus | 'all'>('all');
    const [codes, setCodes] = useState<RedemptionCodeView[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [disabling, setDisabling] = useState<RedemptionCodeView | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const query = new URLSearchParams(status === 'all' ? {} : { status });
            setCodes((await fetchAdminCodes(query)).codes);
            setError(null);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : '读取兑换码失败');
        }
    }, [status]);

    useEffect(() => {
        void Promise.resolve().then(load);
    }, [load]);

    useEffect(() => {
        let current = true;
        fetchAdminPlans().then(result => { if (current) setPlans(result.plans); }, () => {});
        return () => { current = false; };
    }, []);

    const disable = async () => {
        if (!disabling) return;
        setBusy(true);
        try {
            await disableAdminCode(disabling.id);
            showToast('success', '兑换码已作废');
            setDisabling(null);
            await load();
        } catch (failure) {
            showToast('error', failure instanceof Error ? failure.message : '作废兑换码失败');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-5">
            <Generator plans={plans} onCreated={() => void load()} />

            <section aria-labelledby="billing-codes-list-heading" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 id="billing-codes-list-heading" className="text-[13px] font-medium text-foreground-tertiary">兑换码列表（最近 500 个）</h3>
                    <div role="group" aria-label="按状态筛选" className="flex flex-wrap gap-1.5">
                        {STATUS_FILTERS.map(filter => (
                            <FilterChip key={filter.value} pressed={status === filter.value} onClick={() => setStatus(filter.value)} className="settings-filter">
                                {filter.label}
                            </FilterChip>
                        ))}
                    </div>
                </div>
                {error ? (
                    <div role="alert" className="settings-alert">
                        <span className="min-w-0 flex-1">{error}</span>
                        <Button variant="ghost" size="xs" onClick={() => void load()}>重试</Button>
                    </div>
                ) : null}
                {!codes ? (error ? null : <SoundWaveLoader variant="block" />) : codes.length ? (
                    <div className={`relative overflow-x-auto ${CARD}`}>
                        <table className="w-full min-w-[48rem] border-collapse" aria-label="兑换码">
                            <thead>
                                <tr className="border-b border-border">
                                    <th scope="col" className={`${TH} pl-5`}>兑换码</th>
                                    <th scope="col" className={TH}>内容</th>
                                    <th scope="col" className={TH}>状态</th>
                                    <th scope="col" className={TH}>过期</th>
                                    <th scope="col" className={TH}>备注</th>
                                    <th scope="col" className={`${TH} pr-5`}><span className="sr-only">操作</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {codes.map(code => (
                                    <tr key={code.id} className="border-b border-border last:border-b-0">
                                        <td className={`${TD} select-all whitespace-nowrap pl-5 font-mono text-xs text-foreground`}>{code.code}</td>
                                        <td className={`${TD} whitespace-nowrap`}>
                                            {code.kind === 'balance' ? `余额 ${formatUsd(code.amountMicros ?? 0)}` : `套餐「${code.planTitle ?? '已删除'}」`}
                                        </td>
                                        <td className={TD}>
                                            <span className="flex flex-col items-start gap-0.5">
                                                <Badge variant={STATUS_TONE[code.status]}>{REDEMPTION_CODE_STATUS_LABELS[code.status]}</Badge>
                                                {code.usedAt ? <span className="whitespace-nowrap text-xs tabular-nums text-foreground-tertiary">{formatBillingTime(code.usedAt)}</span> : null}
                                            </span>
                                        </td>
                                        <td className={`${TD} whitespace-nowrap tabular-nums`}>{code.expiresAt ? formatBillingDay(code.expiresAt) : '不过期'}</td>
                                        <td className={`${TD} max-w-[12rem] truncate`} title={code.batchNote ?? undefined}>{code.batchNote ?? '—'}</td>
                                        <td className="py-2.5 pl-3 pr-5 text-right">
                                            {code.status === 'unused'
                                                ? <Button variant="ghost" size="xs" aria-label={`作废兑换码 ${code.code}`} onClick={() => setDisabling(code)}>作废</Button>
                                                : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className={`px-6 py-10 text-center text-sm text-foreground-secondary ${CARD}`}>
                        {status === 'all' ? '还没有兑换码。' : '没有这个状态的兑换码。'}
                    </div>
                )}
            </section>

            <ConfirmDialog
                isOpen={!!disabling}
                onClose={() => { if (!busy) setDisabling(null); }}
                onConfirm={disable}
                loading={busy}
                title="作废兑换码"
                description={disabling ? `${disabling.code} 作废后不能再兑换，也不能恢复。` : ''}
                confirmText="作废"
            />
        </div>
    );
}
