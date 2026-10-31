/**
 * 充值设置：充值档位、最低充值金额与人民币汇率，以及在线支付是否开启。
 * 易支付的商户地址、商户号与密钥只从服务器环境变量读取，不在这里填写。
 *
 * 'use client' 标记说明：
 * - 草稿、保存状态与未保存提醒
 */
'use client';

import { useEffect, useState } from 'react';
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsControls';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { fetchAdminSettings, saveAdminSettings } from '@/lib/billing/client';
import { normalizeBillingSettings, type BillingPaymentView, type BillingSettings } from '@/lib/billing/config';

type Draft = { options: string; minimum: string; rate: string };
type State =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; saved: Draft; draft: Draft; payment: BillingPaymentView };

const draftOf = (settings: BillingSettings): Draft => ({
    options: settings.topupOptionsUsd.join(', '), minimum: String(settings.minTopupUsd), rate: String(settings.cnyPerUsd),
});

const settingsOf = (draft: Draft) => normalizeBillingSettings({
    topupOptionsUsd: draft.options.split(/[,，\s]+/u).filter(Boolean).map(Number),
    minTopupUsd: Number(draft.minimum), cnyPerUsd: Number(draft.rate),
}, true);

export function BillingSettingsPanel() {
    const { showToast } = useToast();
    const [state, setState] = useState<State>({ status: 'loading' });
    const [reload, setReload] = useState(0);
    const [saving, setSaving] = useState(false);
    const dirty = state.status === 'ready' && JSON.stringify(state.draft) !== JSON.stringify(state.saved);
    useUnsavedSettingsGuard(dirty);

    useEffect(() => {
        let current = true;
        fetchAdminSettings().then(
            ({ settings, payment }) => { if (current) setState({ status: 'ready', saved: draftOf(settings), draft: draftOf(settings), payment }); },
            error => { if (current) setState({ status: 'error', message: error instanceof Error ? error.message : '读取计费设置失败' }); },
        );
        return () => { current = false; };
    }, [reload]);

    if (state.status === 'loading') return <SoundWaveLoader variant="block" />;
    if (state.status === 'error') {
        return (
            <div role="alert" className="settings-alert">
                <span className="min-w-0 flex-1">{state.message}</span>
                <Button variant="ghost" size="xs" onClick={() => { setState({ status: 'loading' }); setReload(value => value + 1); }}>重试</Button>
            </div>
        );
    }

    const change = (patch: Partial<Draft>) => setState(current => current.status === 'ready' ? { ...current, draft: { ...current.draft, ...patch } } : current);
    const save = async () => {
        const settings = settingsOf(state.draft);
        if ('error' in settings) {
            showToast('error', settings.error);
            return;
        }
        setSaving(true);
        try {
            const saved = draftOf((await saveAdminSettings(settings)).settings);
            setState(current => current.status === 'ready' ? { ...current, saved, draft: saved } : current);
            showToast('success', '计费设置已保存');
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : '保存计费设置失败');
        } finally {
            setSaving(false);
        }
    };

    const { draft, payment } = state;
    return (
        <div className="flex flex-col gap-2">
            <SettingsSection title="在线支付" description="易支付（支付宝 / 微信）。商户地址、商户号与密钥在服务器环境变量里配置，重启后生效。">
                <SettingsRow label="状态" description={payment.enabled
                    ? `可用方式：${payment.methods.map(method => method.label).join('、')}。异步通知地址是站点地址加 /api/billing/epay/notify。`
                    : '填写 EPAY_API_URL、EPAY_PID、EPAY_KEY 后开启。未开启时，用户只能通过兑换码、管理员加款充值，用余额购买套餐。'}
                    control={payment.enabled ? <Badge variant="success">已开启</Badge> : <Badge variant="neutral">未开启</Badge>} />
            </SettingsSection>
            <SettingsSection title="充值" description="只在在线支付开启时向用户展示；兑换码与管理员加款不受这里限制。">
                <SettingsRow label="充值档位" description="用户可以一键选择的金额（美元），用逗号分隔，最多 8 个。" control={(
                    <Input value={draft.options} onChange={event => change({ options: event.target.value })} aria-label="充值档位" className="w-56" disabled={saving} />
                )} />
                <SettingsRow label="最低充值" description="自定义金额的下限（美元）。" control={(
                    <Input inputMode="decimal" value={draft.minimum} onChange={event => change({ minimum: event.target.value.trim() })} aria-label="最低充值（美元）" className="w-28" disabled={saving} />
                )} />
                <SettingsRow label="汇率" description="1 美元按多少元人民币支付；支付金额四舍五入到分。" control={(
                    <Input inputMode="decimal" value={draft.rate} onChange={event => change({ rate: event.target.value.trim() })} aria-label="人民币汇率" className="w-28" disabled={saving} />
                )} />
            </SettingsSection>
            <div className="settings-actions mt-4">
                <Button loading={saving} disabled={saving || !dirty} onClick={() => { void save(); }}>保存</Button>
                <Button variant="ghost" disabled={!dirty || saving}
                    onClick={() => setState(current => current.status === 'ready' ? { ...current, draft: current.saved } : current)}>还原</Button>
            </div>
        </div>
    );
}
