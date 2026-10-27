/**
 * AI 模型目录：按用途分组的紧凑列表，一行看清上下文、输出上限、思考等级、来源与会员；点开在弹层里编辑。
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Eye, Plus, RefreshCw, Search } from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { getVendorIcon } from '@/lib/ai/vendor-config';
import { useListMotion } from '@/lib/motion/list';
import { THINKING_LEVEL_LABELS, USAGE_TYPES, formatTokenCount, type AdminGateway, type AdminModel } from '@/lib/admin/ai-catalog';
import { AIModelEditor } from './AIModelEditor';
import './ai-catalog.css';

function ModelMeta({ model, gateways }: { model: AdminModel; gateways: ReadonlyMap<string, AdminGateway> }) {
    const callable = model.sources.filter(source => source.isEnabled && gateways.get(source.gatewayId)?.isEnabled && gateways.get(source.gatewayId)?.apiKeyHint);
    const names = model.sources.map(source => gateways.get(source.gatewayId)?.displayName).filter(Boolean);
    const usage = USAGE_TYPES.find(item => item.value === model.usageType)?.label;
    return <span className="ai-catalog-row-meta">
        {model.usageType !== 'chat' && <span>{usage}</span>}
        {(model.usageType === 'chat' || model.usageType === 'vision') && <span>
            {model.contextWindow ? `${formatTokenCount(model.contextWindow)} 上下文` : '未设上下文'} · {model.defaultMaxTokens ? `${formatTokenCount(model.defaultMaxTokens)} 输出` : '默认输出'}
        </span>}
        {model.supportsReasoning && <span>思考 {model.thinkingLevels.length ? model.thinkingLevels.map(level => THINKING_LEVEL_LABELS[level]).join('/') : '开关'}</span>}
        {model.supportsVision && <span><Eye size={12} aria-label="支持图片" style={{ display: 'inline', verticalAlign: '-1px' }} /></span>}
        <span data-tone={callable.length ? undefined : 'warning'}>{names.length ? names.join(' → ') : '没有来源'}{names.length && !callable.length ? '（不可用）' : ''}</span>
    </span>;
}

export function AIModelPanel() {
    const [models, setModels] = useState<AdminModel[] | null>(null);
    const [gateways, setGateways] = useState<AdminGateway[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [editing, setEditing] = useState<{ model: AdminModel | null } | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);
    const { showToast } = useToast();
    const listRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async (signal?: AbortSignal) => {
        try {
            const [modelData, gatewayData] = await Promise.all([
                requestBrowserData<{ models: AdminModel[] }>('/api/admin/ai-models', { method: 'GET', signal }, { fallbackMessage: '获取模型列表失败' }),
                requestBrowserData<{ gateways: AdminGateway[] }>('/api/admin/ai-gateways', { method: 'GET', signal }, { fallbackMessage: '获取网关列表失败' }),
            ]);
            if (signal?.aborted) return;
            setModels(modelData.models);
            setGateways(gatewayData.gateways);
            setError(null);
        } catch (e) {
            if (!signal?.aborted) setError(e instanceof Error ? e.message : '获取模型列表失败');
        }
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        queueMicrotask(() => void load(controller.signal));
        return () => controller.abort();
    }, [load]);

    const gatewayById = useMemo(() => new Map(gateways.map(gateway => [gateway.id, gateway])), [gateways]);
    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return (models ?? []).filter(model => !needle || [model.displayName, model.modelKey, model.vendor].some(value => value.toLowerCase().includes(needle)));
    }, [models, query]);
    const rows = useListMotion(listRef, visible, model => model.id);

    const toggle = async (model: AdminModel) => {
        setUpdating(model.id);
        setModels(current => current?.map(item => item.id === model.id ? { ...item, isEnabled: !model.isEnabled } : item) ?? null);
        try {
            await requestBrowserData(`/api/admin/ai-models/${model.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isEnabled: !model.isEnabled }),
            }, { fallbackMessage: '更新模型失败' });
        } catch (e) {
            setModels(current => current?.map(item => item.id === model.id ? { ...item, isEnabled: model.isEnabled } : item) ?? null);
            showToast('error', e instanceof Error ? e.message : '更新模型失败');
        } finally {
            setUpdating(null);
        }
    };
    const clearCache = async () => {
        try {
            await requestBrowserData('/api/admin/ai-models/cache', { method: 'POST' }, { fallbackMessage: '清除缓存失败' });
            showToast('success', '模型缓存已清除，修改会立即生效');
        } catch (e) {
            showToast('error', e instanceof Error ? e.message : '清除缓存失败');
        }
    };

    if (!models && !error) return <div className="flex min-h-[200px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
    return <div className="ai-catalog">
        <div className="ai-catalog-toolbar">
            <input className="settings-input ai-catalog-search" type="search" aria-label="搜索模型" value={query}
                placeholder={`搜索 ${models?.length ?? 0} 个模型`} onChange={event => setQuery(event.target.value)} />
            <span style={{ flex: 1 }} />
            <button type="button" className="settings-button settings-button-compact" onClick={() => void clearCache()} title="保存会自动生效；外部改了数据库时用这个">
                <RefreshCw size={14} aria-hidden="true" />清除缓存
            </button>
            <button type="button" className="settings-button settings-button-compact settings-button-primary" onClick={() => setEditing({ model: null })}>
                <Plus size={14} aria-hidden="true" />添加模型
            </button>
        </div>
        {error && <div className="settings-alert" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>重试</button></div>}
        {models && !visible.length ? <div className="ai-catalog-list"><div className="ai-catalog-empty">
            {query ? <><Search size={20} aria-hidden="true" /><strong>没有匹配「{query}」的模型</strong></>
                : <><Boxes size={22} aria-hidden="true" /><strong>还没有模型</strong><span>先在「网关管理」添加网关，再添加模型并选择来源。</span></>}
        </div></div> : <div className="ai-catalog-list" ref={listRef}>
            {rows.map(({ key, item: model }) => <div key={key} data-motion-key={key} className="ai-catalog-row" data-disabled={!model.isEnabled || undefined}>
                <button type="button" className="ai-catalog-row-main" onClick={() => setEditing({ model })} aria-label={`编辑 ${model.displayName}`}>
                    <span className="ai-catalog-row-icon">{getVendorIcon(model.vendor, 16)}</span>
                    <span className="ai-catalog-row-text">
                        <span className="ai-catalog-row-title"><strong>{model.displayName}</strong><span className="ai-catalog-mono">{model.modelKey}</span></span>
                        <ModelMeta model={model} gateways={gatewayById} />
                    </span>
                </button>
                <span className="ai-catalog-row-side">
                    <span className="ai-catalog-tier" data-tier={model.requiredTier}>{model.requiredTier === 'free' ? 'Free' : model.requiredTier === 'plus' ? 'Plus' : 'Pro'}</span>
                    <SettingsSwitch label={`启用 ${model.displayName}`} checked={model.isEnabled} disabled={updating === model.id} onToggle={() => void toggle(model)} />
                </span>
            </div>)}
        </div>}
        {editing && <AIModelEditor key={editing.model?.id ?? 'new'} model={editing.model} gateways={gateways}
            onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </div>;
}
