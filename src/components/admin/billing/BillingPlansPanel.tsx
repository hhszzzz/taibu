/**
 * 套餐：价格、时长、每期额度与重置周期、每人限购；停用后不再展示和出售，已售出的订阅不受影响。
 * 改动只影响之后的开通：已售出的订阅保留开通时的名称、额度与重置周期。
 *
 * 'use client' 标记说明：
 * - 需要 useState / useEffect 加载列表，维护编辑弹窗与删除确认
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { deleteAdminPlan, fetchAdminPlans, saveAdminPlan } from '@/lib/billing/client';
import {
    DURATION_UNITS, DURATION_UNIT_LABELS, SUBSCRIPTION_WINDOWS, SUBSCRIPTION_WINDOW_LABELS, describePlanDuration, parsePlanInput,
    type DurationUnit, type SubscriptionPlanView, type SubscriptionWindow,
} from '@/lib/billing/config';
import { formatUsd, microsToUsd, usdToMicros } from '@/lib/billing/money';

const CARD = 'rounded-2xl border border-border bg-surface';

type DraftLimit = { period: SubscriptionWindow; allowanceUsd: string };
type Draft = {
    title: string; subtitle: string; features: string; priceUsd: string;
    durationUnit: DurationUnit; durationValue: string; limits: DraftLimit[]; maxPerUser: string;
    sortOrder: string; purchasable: boolean; enabled: boolean;
};

const draftOf = (plan: SubscriptionPlanView | null): Draft => ({
    title: plan?.title ?? '', subtitle: plan?.subtitle ?? '', features: plan?.features.join('\n') ?? '',
    priceUsd: plan ? String(plan.priceUsd) : '',
    durationUnit: plan?.durationUnit ?? 'month', durationValue: String(plan?.durationValue ?? 1),
    limits: plan?.limits.length
        ? plan.limits.map(limit => ({ period: limit.period, allowanceUsd: String(microsToUsd(limit.allowanceMicros)) }))
        : [{ period: 'monthly', allowanceUsd: '' }],
    maxPerUser: plan?.maxPerUser == null ? '' : String(plan.maxPerUser),
    sortOrder: String(plan?.sortOrder ?? 0), purchasable: plan?.purchasable ?? true, enabled: plan?.enabled ?? true,
});

const bodyOf = (draft: Draft) => ({
    title: draft.title, subtitle: draft.subtitle, features: draft.features.split('\n').map(line => line.trim()).filter(Boolean),
    priceUsd: draft.priceUsd.trim() === '' ? NaN : Number(draft.priceUsd),
    durationUnit: draft.durationUnit, durationValue: Number(draft.durationValue),
    limits: draft.limits.map(limit => ({ period: limit.period, allowanceUsd: Number(limit.allowanceUsd) })),
    maxPerUser: draft.maxPerUser.trim() === '' ? null : Number(draft.maxPerUser), sortOrder: Number(draft.sortOrder || 0),
    purchasable: draft.purchasable, enabled: draft.enabled,
});

function PlanEditor({ plan, onClose, onSaved }: { plan: SubscriptionPlanView | null; onClose: () => void; onSaved: () => void }) {
    const { showToast } = useToast();
    const [draft, setDraft] = useState(() => draftOf(plan));
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));

    const save = async () => {
        const body = bodyOf(draft);
        const parsed = parsePlanInput(body);
        if ('error' in parsed) {
            setError(parsed.error);
            return;
        }
        setSaving(true);
        try {
            await saveAdminPlan(plan?.id ?? null, body);
            showToast('success', plan ? '套餐已保存' : '套餐已创建');
            onSaved();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : '保存套餐失败');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onClose={() => { if (!saving) onClose(); }} busy={saving} className="dialog-lg" title={plan ? `编辑「${plan.title}」` : '新建套餐'}
            description="已售出的订阅保留开通时的名称与额度周期，改动只影响之后的开通。"
            footer={<>
                {error ? <p role="alert" className="mr-auto self-center text-[13px] text-danger">{error}</p> : null}
                <Button variant="ghost" size="lg" disabled={saving} onClick={onClose}>取消</Button>
                <Button size="lg" loading={saving} onClick={() => void save()}>{plan ? '保存' : '创建'}</Button>
            </>}>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="名称" required className="sm:col-span-2">
                    <Input value={draft.title} maxLength={60} onChange={event => set({ title: event.target.value })} placeholder="月度订阅" />
                </Field>
                <Field label="副标题" className="sm:col-span-2">
                    <Input value={draft.subtitle} maxLength={200} onChange={event => set({ subtitle: event.target.value })} placeholder="适合日常使用" />
                </Field>
                <Field label="价格（美元）" description="0 表示免费开通。">
                    <Input inputMode="decimal" value={draft.priceUsd} onChange={event => set({ priceUsd: event.target.value.trim() })} placeholder="9.90" />
                </Field>
                <Field label="有效期">
                    {props => (
                        <div className="flex gap-2">
                            <Input {...props} inputMode="numeric" value={draft.durationValue} onChange={event => set({ durationValue: event.target.value.trim() })} className="w-24" />
                            <Select ariaLabel="有效期单位" value={draft.durationUnit} onChange={durationUnit => set({ durationUnit })}
                                options={DURATION_UNITS.map(unit => ({ value: unit, label: DURATION_UNIT_LABELS[unit] }))} className="w-28" />
                        </div>
                    )}
                </Field>
                <Field label="额度" description="一个周期一行，从开通时刻起滚动重置；「整个订阅期」不重置。调用先扣最短的周期。" className="sm:col-span-2">
                    <div className="flex flex-col gap-2">
                        {draft.limits.map((limit, index) => (
                            <div key={index} className="flex items-center gap-2">
                                <Select ariaLabel={`第 ${index + 1} 个额度周期`} value={limit.period}
                                    onChange={period => set({ limits: draft.limits.map((item, at) => at === index ? { ...item, period } : item) })}
                                    options={SUBSCRIPTION_WINDOWS.filter(period => period === limit.period || !draft.limits.some(item => item.period === period))
                                        .map(period => ({ value: period, label: SUBSCRIPTION_WINDOW_LABELS[period] }))}
                                    className="w-40" />
                                <Input aria-label={`第 ${index + 1} 个额度金额`} inputMode="decimal" placeholder="美元"
                                    value={limit.allowanceUsd}
                                    onChange={event => set({ limits: draft.limits.map((item, at) => at === index ? { ...item, allowanceUsd: event.target.value.trim() } : item) })} />
                                {draft.limits.length > 1 ? (
                                    <IconButton label={`删除第 ${index + 1} 个额度`} onClick={() => set({ limits: draft.limits.filter((_, at) => at !== index) })}>
                                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    </IconButton>
                                ) : null}
                            </div>
                        ))}
                        {draft.limits.length < SUBSCRIPTION_WINDOWS.length ? (
                            <Button variant="ghost" size="sm" className="self-start"
                                onClick={() => set({ limits: [...draft.limits, { period: SUBSCRIPTION_WINDOWS.find(period => !draft.limits.some(item => item.period === period)) ?? 'total', allowanceUsd: '' }] })}>
                                <Plus className="h-4 w-4" aria-hidden="true" />添加周期
                            </Button>
                        ) : null}
                    </div>
                </Field>
                <Field label="每人限购" description="留空表示不限。">
                    <Input inputMode="numeric" value={draft.maxPerUser} onChange={event => set({ maxPerUser: event.target.value.trim() })} placeholder="不限" />
                </Field>
                <Field label="排序" description="小的在前。">
                    <Input inputMode="numeric" value={draft.sortOrder} onChange={event => set({ sortOrder: event.target.value.trim() })} />
                </Field>
                <Field label="套餐亮点" description="每行一条，最多 12 条。" className="sm:col-span-2">
                    <Textarea rows={3} value={draft.features} onChange={event => set({ features: event.target.value })} />
                </Field>
                <div className="flex items-center justify-between gap-3 sm:col-span-2">
                    <span className="text-sm text-foreground">可购买<span className="ml-2 text-[13px] text-foreground-secondary">关闭后只能通过兑换码或管理员赠送开通</span></span>
                    <SettingsSwitch label="可购买" checked={draft.purchasable} onToggle={() => set({ purchasable: !draft.purchasable })} />
                </div>
                <div className="flex items-center justify-between gap-3 sm:col-span-2">
                    <span className="text-sm text-foreground">启用<span className="ml-2 text-[13px] text-foreground-secondary">停用后用户看不到这个套餐</span></span>
                    <SettingsSwitch label="启用" checked={draft.enabled} onToggle={() => set({ enabled: !draft.enabled })} />
                </div>
            </div>
        </Dialog>
    );
}

export function BillingPlansPanel() {
    const { showToast } = useToast();
    const [plans, setPlans] = useState<SubscriptionPlanView[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ plan: SubscriptionPlanView | null } | null>(null);
    const [deleting, setDeleting] = useState<SubscriptionPlanView | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setPlans((await fetchAdminPlans()).plans);
            setError(null);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : '读取套餐失败');
        }
    }, []);

    useEffect(() => {
        void Promise.resolve().then(load);
    }, [load]);

    const remove = async () => {
        if (!deleting) return;
        setBusy(true);
        try {
            await deleteAdminPlan(deleting.id);
            showToast('success', `已删除「${deleting.title}」`);
            setDeleting(null);
            await load();
        } catch (failure) {
            showToast('error', failure instanceof Error ? failure.message : '删除套餐失败');
        } finally {
            setBusy(false);
        }
    };

    if (!plans) {
        return error ? (
            <div role="alert" className="settings-alert">
                <span className="min-w-0 flex-1">{error}</span>
                <Button variant="ghost" size="xs" onClick={() => void load()}>重试</Button>
            </div>
        ) : <SoundWaveLoader variant="block" />;
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="settings-help">用户在「钱包」里看到启用的套餐；可以用余额购买，开启在线支付后也能直接付款。</p>
                <Button size="sm" onClick={() => setEditing({ plan: null })}><Plus size={14} aria-hidden="true" />新建套餐</Button>
            </div>
            {plans.length ? (
                <ul aria-label="套餐" className={`overflow-hidden ${CARD}`}>
                    {plans.map(plan => (
                        <li key={plan.id} className="flex items-start justify-between gap-4 border-t border-border px-5 py-4 first:border-t-0">
                            <div className="flex min-w-0 flex-col gap-1">
                                <span className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-sm font-medium text-foreground">{plan.title}</span>
                                    {plan.enabled ? null : <Badge variant="neutral">已停用</Badge>}
                                    {plan.purchasable ? null : <Badge variant="neutral">仅兑换</Badge>}
                                </span>
                                <span className="text-[13px] text-foreground-secondary">
                                    {plan.priceUsd ? formatUsd(usdToMicros(plan.priceUsd)) : '免费'} / {describePlanDuration(plan)}
                                    {` · 额度 ${plan.limits.map(limit => `${SUBSCRIPTION_WINDOW_LABELS[limit.period]} ${formatUsd(limit.allowanceMicros)}`).join('，')}`}
                                    {plan.maxPerUser ? ` · 每人限 ${plan.maxPerUser} 次` : ''}
                                </span>
                                {plan.subtitle ? <span className="text-xs text-foreground-tertiary">{plan.subtitle}</span> : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <IconButton label={`编辑「${plan.title}」`} size="sm" onClick={() => setEditing({ plan })}><Pencil aria-hidden="true" /></IconButton>
                                <IconButton label={`删除「${plan.title}」`} tone="danger" size="sm" onClick={() => setDeleting(plan)}><Trash2 aria-hidden="true" /></IconButton>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className={`flex flex-col items-center gap-1.5 px-6 py-12 text-center ${CARD}`}>
                    <p className="text-[15px] text-foreground">还没有套餐</p>
                    <p className="text-[13px] text-foreground-secondary">新建一个套餐，用户就能在「钱包」里开通。</p>
                </div>
            )}
            {editing ? <PlanEditor key={editing.plan?.id ?? 'new'} plan={editing.plan} onClose={() => setEditing(null)}
                onSaved={() => { setEditing(null); void load(); }} /> : null}
            <ConfirmDialog
                isOpen={!!deleting}
                onClose={() => { if (!busy) setDeleting(null); }}
                onConfirm={remove}
                loading={busy}
                title={deleting ? `删除「${deleting.title}」` : ''}
                description="已开通的订阅不受影响。有支付订单或兑换码引用的套餐不能删除，请改为停用。"
                confirmText="删除套餐"
            />
        </div>
    );
}
