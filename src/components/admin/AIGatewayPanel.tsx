/**
 * AI 网关管理：网关地址与密钥（只写，保存后只显示提示）、连通测试。模型经网关调用，见 AIModelPanel。
 */
'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Eye, EyeOff, Plus, RefreshCw, Server, X } from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { useListMotion } from '@/lib/motion/list';
import { parseGatewayInput, type AdminGateway, type AdminGatewayInput, type GatewayProbeResult } from '@/lib/admin/ai-catalog';
import './ai-catalog.css';
import { Input } from '@/components/ui/Input';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function probeGateway(body: { gatewayId?: string; baseUrl: string; apiKey?: string }) {
    return requestBrowserData<GatewayProbeResult>('/api/admin/ai-gateways/probe',
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }, { fallbackMessage: '测试网关失败' });
}

export function probeSummary(result: GatewayProbeResult) {
    if (!result.ok) return result.message ?? '连接失败';
    return `已连通${result.latencyMs !== undefined ? ` · ${result.latencyMs} ms` : ''} · ${result.models.length} 个模型`;
}

function hostOf(url: string) {
    try { return new URL(url).host; } catch { return url; }
}

type Draft = { gatewayKey: string; displayName: string; baseUrl: string; notes: string; isEnabled: boolean; apiKey: string; clearKey: boolean };

const draftOf = (gateway: AdminGateway | null): Draft => ({
    gatewayKey: gateway?.gatewayKey ?? '', displayName: gateway?.displayName ?? '', baseUrl: gateway?.baseUrl ?? '',
    notes: gateway?.notes ?? '', isEnabled: gateway?.isEnabled ?? true, apiKey: '', clearKey: false,
});

function GatewayEditor({ gateway, onClose, onSaved }: { gateway: AdminGateway | null; onClose: () => void; onSaved: () => void }) {
    const titleId = useId();
    const { showToast } = useToast();
    const [draft, setDraft] = useState(() => draftOf(gateway));
    const [baseline] = useState(draft);
    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [probe, setProbe] = useState<{ busy: boolean; result?: GatewayProbeResult }>({ busy: false });
    const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);
    const firstField = useRef<HTMLInputElement>(null);
    const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
    useUnsavedSettingsGuard(dirty);
    const patch = (change: Partial<Draft>) => { setDraft(current => ({ ...current, ...change })); setError(null); };
    const hasKey = !!gateway?.apiKeyHint && !draft.clearKey;

    const payload = (): Record<string, unknown> => ({
        gatewayKey: draft.gatewayKey, displayName: draft.displayName, baseUrl: draft.baseUrl, notes: draft.notes, isEnabled: draft.isEnabled,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : draft.clearKey ? { apiKey: null } : {}),
    });
    const save = async () => {
        const parsed = parseGatewayInput(payload(), { creating: !gateway });
        if ('error' in parsed) { setError(parsed.error); return; }
        setSaving(true);
        try {
            await requestBrowserData(gateway ? `/api/admin/ai-gateways/${gateway.id}` : '/api/admin/ai-gateways', {
                method: gateway ? 'PUT' : 'POST', headers: JSON_HEADERS, body: JSON.stringify(parsed.value satisfies AdminGatewayInput),
            }, { fallbackMessage: '保存网关失败' });
            showToast('success', gateway ? '网关已保存' : '网关已添加');
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : '保存网关失败');
        } finally {
            setSaving(false);
        }
    };
    const remove = async () => {
        if (!gateway) return;
        setSaving(true);
        try {
            await requestBrowserData(`/api/admin/ai-gateways/${gateway.id}`, { method: 'DELETE' }, { fallbackMessage: '删除网关失败' });
            showToast('success', '网关已删除');
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : '删除网关失败');
            setConfirm(null);
        } finally {
            setSaving(false);
        }
    };
    const test = async () => {
        setProbe({ busy: true });
        try {
            setProbe({ busy: false, result: await probeGateway({ gatewayId: gateway?.id, baseUrl: draft.baseUrl, apiKey: draft.apiKey.trim() || undefined }) });
        } catch (e) {
            setProbe({ busy: false, result: { ok: false, models: [], message: e instanceof Error ? e.message : '测试网关失败' } });
        }
    };
    const close = () => (dirty ? setConfirm('discard') : onClose());

    return <Dialog bare open onClose={close} busy={saving} labelledBy={titleId} initialFocusRef={firstField} className="ai-catalog-dialog">
        <header className="ai-catalog-dialog-head">
            <div style={{ flex: 1, minWidth: 0 }}>
                <h2 id={titleId}>{gateway ? gateway.displayName : '添加网关'}</h2>
                <p>OpenAI 兼容的网关（NewAPI、OneAPI、OpenRouter 或供应商官方接口）</p>
            </div>
            <IconButton label="关闭" size="sm" onClick={close}><X size={16} aria-hidden="true" /></IconButton>
        </header>
        <div className="ai-catalog-dialog-body">
            <section className="ai-catalog-section">
                <div className="ai-catalog-grid">
                    <label className="ai-catalog-field"><span>名称</span>
                        <Input ref={firstField}  value={draft.displayName} maxLength={60} placeholder="例如：主网关"
                            onChange={event => patch({ displayName: event.target.value })} />
                    </label>
                    <label className="ai-catalog-field"><span>标识</span>
                        <Input className="ai-catalog-mono"  value={draft.gatewayKey} maxLength={40} placeholder="main" disabled={!!gateway}
                            spellCheck={false} autoCapitalize="off" onChange={event => patch({ gatewayKey: event.target.value.toLowerCase() })} />
                    </label>
                </div>
                <label className="ai-catalog-field"><span>地址</span>
                    <Input className="ai-catalog-mono"  type="url" inputMode="url" value={draft.baseUrl} placeholder="https://api.example.com"
                        spellCheck={false} onChange={event => { patch({ baseUrl: event.target.value }); setProbe({ busy: false }); }} />
                    <span className="ai-catalog-hint">填根地址即可，对话、向量、重排的路径（/v1/chat/completions 等）会自动补上。</span>
                </label>
                <label className="ai-catalog-field"><span>密钥</span>
                    <span className="ai-catalog-key">
                        <Input className="ai-catalog-mono"  type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false}
                            value={draft.apiKey} placeholder={hasKey ? `已保存 ${gateway!.apiKeyHint}，留空保持不变` : 'sk-…'}
                            onChange={event => { patch({ apiKey: event.target.value, clearKey: false }); setProbe({ busy: false }); }} />
                        <IconButton label={showKey ? '隐藏密钥' : '显示密钥'} size="sm" onClick={() => setShowKey(value => !value)}>
                            {showKey ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                        </IconButton>
                        {hasKey && !draft.apiKey && <Button variant="ghost" size="xs" className="text-danger hover:text-danger" onClick={() => patch({ clearKey: true })}>清除</Button>}
                    </span>
                    <span className="ai-catalog-hint">{draft.clearKey ? '保存后清除已保存的密钥，经这个网关的模型将不可用。'
                        : '加密保存在数据库，只在发起请求时解开；页面不会再显示完整密钥。'}</span>
                </label>
                <div className="ai-catalog-limit">
                    <Button variant="secondary" size="sm" loading={probe.busy} disabled={!draft.baseUrl.trim()} onClick={() => void test()}>
                        {probe.busy ? null : <RefreshCw size={14} aria-hidden="true" />}测试连接
                    </Button>
                    {probe.result && <span className="ai-catalog-probe" data-ok={probe.result.ok} role="status">
                        {probe.result.ok && <Check size={14} aria-hidden="true" />}{probeSummary(probe.result)}
                    </span>}
                </div>
            </section>
            <section className="ai-catalog-section">
                <label className="ai-catalog-field"><span>备注</span>
                    <Input  value={draft.notes} maxLength={500} placeholder="可选" onChange={event => patch({ notes: event.target.value })} />
                </label>
                <div className="ai-catalog-toggle">
                    <span>启用<small>停用后，经这个网关的来源会被跳过</small></span>
                    <SettingsSwitch label="启用网关" checked={draft.isEnabled} onToggle={() => patch({ isEnabled: !draft.isEnabled })} />
                </div>
            </section>
        </div>
        <footer className="ai-catalog-dialog-foot">
            {gateway && <Button variant="ghost" className="text-danger hover:text-danger" disabled={saving || gateway.modelCount > 0}
                title={gateway.modelCount ? `还有 ${gateway.modelCount} 个模型在用` : undefined} onClick={() => setConfirm('delete')}>删除网关</Button>}
            {error ? <p className="ai-catalog-error" role="alert">{error}</p> : <span className="ai-catalog-spacer" />}
            <Button variant="secondary" disabled={saving} onClick={close}>取消</Button>
            <Button loading={saving} loadingText="正在保存…" disabled={saving || (!!gateway && !dirty)} onClick={() => void save()}>
                {gateway ? '保存' : '添加网关'}
            </Button>
        </footer>
        <ConfirmDialog isOpen={confirm !== null} onClose={() => setConfirm(null)} loading={saving}
            title={confirm === 'delete' ? '删除这个网关？' : '放弃未保存的修改？'}
            description={confirm === 'delete' ? '删除后无法恢复，保存的密钥一并清除。' : '关闭后，这次填写的内容不会保存。'}
            confirmText={confirm === 'delete' ? '删除' : '放弃修改'}
            onConfirm={() => (confirm === 'delete' ? remove() : onClose())} />
    </Dialog>;
}

export function AIGatewayPanel() {
    const [gateways, setGateways] = useState<AdminGateway[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ gateway: AdminGateway | null } | null>(null);
    const [probes, setProbes] = useState<Record<string, { busy: boolean; result?: GatewayProbeResult }>>({});
    const [updating, setUpdating] = useState<string | null>(null);
    const { showToast } = useToast();
    const listRef = useRef<HTMLDivElement>(null);
    const rows = useListMotion(listRef, gateways ?? [], gateway => gateway.id);

    const load = useCallback(async (signal?: AbortSignal) => {
        try {
            const data = await requestBrowserData<{ gateways: AdminGateway[] }>('/api/admin/ai-gateways', { method: 'GET', signal }, { fallbackMessage: '获取网关列表失败' });
            if (!signal?.aborted) { setGateways(data.gateways); setError(null); }
        } catch (e) {
            if (!signal?.aborted) setError(e instanceof Error ? e.message : '获取网关列表失败');
        }
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        // Deferred so the first state update happens outside the effect body.
        queueMicrotask(() => void load(controller.signal));
        return () => controller.abort();
    }, [load]);

    const test = async (gateway: AdminGateway) => {
        setProbes(current => ({ ...current, [gateway.id]: { busy: true } }));
        let result: GatewayProbeResult;
        try { result = await probeGateway({ gatewayId: gateway.id, baseUrl: gateway.baseUrl }); }
        catch (e) { result = { ok: false, models: [], message: e instanceof Error ? e.message : '测试网关失败' }; }
        setProbes(current => ({ ...current, [gateway.id]: { busy: false, result } }));
    };
    const toggle = async (gateway: AdminGateway) => {
        setUpdating(gateway.id);
        try {
            await requestBrowserData(`/api/admin/ai-gateways/${gateway.id}`, {
                method: 'PUT', headers: JSON_HEADERS,
                body: JSON.stringify({ gatewayKey: gateway.gatewayKey, displayName: gateway.displayName, baseUrl: gateway.baseUrl, notes: gateway.notes, isEnabled: !gateway.isEnabled }),
            }, { fallbackMessage: '更新网关失败' });
            setGateways(current => current?.map(item => item.id === gateway.id ? { ...item, isEnabled: !gateway.isEnabled } : item) ?? null);
        } catch (e) {
            showToast('error', e instanceof Error ? e.message : '更新网关失败');
        } finally {
            setUpdating(null);
        }
    };

    if (!gateways && !error) return <div className="flex min-h-[200px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
    return <div className="ai-catalog">
        <div className="ai-catalog-toolbar">
            <p>模型通过网关调用；一个模型可以排列多个网关做故障转移。</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />刷新</Button>
            <Button size="sm" onClick={() => setEditing({ gateway: null })}>
                <Plus size={14} aria-hidden="true" />添加网关
            </Button>
        </div>
        {error && <div className="settings-alert" role="alert"><span>{error}</span><Button variant="ghost" size="xs" onClick={() => void load()}>重试</Button></div>}
        {gateways && !gateways.length ? <div className="ai-catalog-list"><div className="ai-catalog-empty">
            <Server size={22} aria-hidden="true" /><strong>还没有网关</strong><span>添加一个网关并填写密钥，再到「模型管理」为模型选择来源。</span>
        </div></div> : <div className="ai-catalog-list" ref={listRef}>
            {rows.map(({ key, item: gateway }) => {
                const probe = probes[gateway.id];
                return <div key={key} data-motion-key={key} className="ai-catalog-row" data-disabled={!gateway.isEnabled || undefined}>
                    <Button unstyled type="button" className="ai-catalog-row-main" onClick={() => setEditing({ gateway })} aria-label={`编辑网关 ${gateway.displayName}`}>
                        <span className="ai-catalog-row-icon"><Server size={16} aria-hidden="true" /></span>
                        <span className="ai-catalog-row-text">
                            <span className="ai-catalog-row-title"><strong>{gateway.displayName}</strong><span className="ai-catalog-mono">{gateway.gatewayKey}</span></span>
                            <span className="ai-catalog-row-meta">
                                <span>{hostOf(gateway.baseUrl)}</span>
                                <span data-tone={gateway.apiKeyHint ? undefined : 'warning'}>{gateway.apiKeyHint ? `密钥 ${gateway.apiKeyHint}` : '未设置密钥'}</span>
                                <span>{gateway.modelCount} 个模型</span>
                                {probe?.result && <span data-tone={probe.result.ok ? undefined : 'warning'}>{probeSummary(probe.result)}</span>}
                            </span>
                        </span>
                    </Button>
                    <span className="ai-catalog-row-side">
                        <Button variant="ghost" size="xs" loading={probe?.busy} disabled={!gateway.apiKeyHint}
                            onClick={() => void test(gateway)}>测试</Button>
                        <SettingsSwitch label={`启用 ${gateway.displayName}`} checked={gateway.isEnabled} disabled={updating === gateway.id} onToggle={() => void toggle(gateway)} />
                    </span>
                </div>;
            })}
        </div>}
        {editing && <GatewayEditor key={editing.gateway?.id ?? 'new'} gateway={editing.gateway} onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); void load(); }} />}
    </div>;
}
