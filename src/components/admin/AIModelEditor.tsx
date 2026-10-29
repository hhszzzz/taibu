// Model editor dialog: every field of a catalog model, its thinking ladder and its ordered sources.
'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, RefreshCw, Trash2, X } from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { SegmentedChoice } from '@/components/settings/SegmentedChoice';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { getVendorName, VENDOR_PRESETS } from '@/lib/ai/vendor-labels';
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import {
    CONTEXT_WINDOW_PRESETS, MAX_OUTPUT_PRESETS, THINKING_FORMAT_OPTIONS, THINKING_LEVEL_LABELS, TIERS, USAGE_TYPES,
    formatTokenCount, parseModelInput,
    type AdminGateway, type AdminModel, type AdminModelInput, type AdminModelSource, type LimitPreset,
} from '@/lib/admin/ai-catalog';
import { probeGateway, probeSummary } from './AIGatewayPanel';
import type { ModelsDevSuggestion } from '@/lib/admin/models-dev';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const CUSTOM_VENDOR = '__custom__';

/** Form state: numbers and JSON stay text until saved, so a half-typed value is never lost. */
type Draft = Omit<AdminModelInput, 'contextWindow' | 'defaultMaxTokens' | 'customParameters' | 'sortOrder' | 'description'> & {
    description: string; sortOrder: string; contextWindow: string; defaultMaxTokens: string; customParameters: string;
};

const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));

function draftOf(model: AdminModel | null, gateways: readonly AdminGateway[]): Draft {
    return {
        modelKey: model?.modelKey ?? '', displayName: model?.displayName ?? '', vendor: model?.vendor ?? 'openai',
        description: model?.description ?? '', usageType: model?.usageType ?? 'chat', creditCost: model?.creditCost ?? 1, isEnabled: model?.isEnabled ?? true,
        sortOrder: text(model?.sortOrder ?? 0), requiredTier: model?.requiredTier ?? 'free',
        supportsVision: model?.supportsVision ?? false, supportsReasoning: model?.supportsReasoning ?? false,
        isReasoningDefault: model?.isReasoningDefault ?? false, reasoningRequiredTier: model?.reasoningRequiredTier ?? 'free',
        thinkingFormat: model?.thinkingFormat ?? 'openai', thinkingLevels: model?.thinkingLevels ?? [],
        defaultReasoningEffort: model?.defaultReasoningEffort ?? null,
        contextWindow: text(model?.contextWindow), defaultMaxTokens: text(model?.defaultMaxTokens),
        customParameters: model?.customParameters ? JSON.stringify(model.customParameters, null, 2) : '',
        // A new model starts on the first enabled gateway; it can be removed before saving.
        sources: model?.sources ?? gateways.filter(gateway => gateway.isEnabled).slice(0, 1)
            .map(gateway => ({ gatewayId: gateway.id, modelIdOverride: null, reasoningModelId: null, isEnabled: true })),
    };
}

function payloadOf(draft: Draft): Record<string, unknown> | { error: string } {
    let customParameters: unknown = null;
    if (draft.customParameters.trim()) {
        try { customParameters = JSON.parse(draft.customParameters); }
        catch { return { error: '自定义参数不是有效的 JSON' }; }
    }
    return { ...draft, customParameters, sortOrder: draft.sortOrder.trim() || 0 };
}

/** A token limit: a preset ladder that writes the number, and the number itself. */
function LimitField({ label, hint, value, presets, placeholder, onChange }: {
    label: string; hint: string; value: string; presets: readonly LimitPreset[]; placeholder?: string; onChange: (value: string) => void;
}) {
    const id = useId();
    return <div className="ai-catalog-field">
        <label htmlFor={id}>{label}{value ? <span className="ai-catalog-hint"> · {formatTokenCount(Number(value))}</span> : null}</label>
        <div className="ai-catalog-limit" role="group" aria-label={label}>
            {presets.map(preset => <button key={preset.label} type="button" className="ai-catalog-chip" aria-pressed={Number(value) === preset.tokens}
                onClick={() => onChange(String(preset.tokens))}>{preset.label}</button>)}
            <input id={id} className="settings-input" type="number" inputMode="numeric" min={1} value={value} placeholder={placeholder}
                onChange={event => onChange(event.target.value)} />
        </div>
        <span className="ai-catalog-hint">{hint}</span>
    </div>;
}

function SourceRow({ source, index, count, gateway, modelKey, supportsReasoning, onChange, onMove, onRemove }: {
    source: AdminModelSource; index: number; count: number; gateway: AdminGateway | undefined; modelKey: string; supportsReasoning: boolean;
    onChange: (change: Partial<AdminModelSource>) => void; onMove: (offset: number) => void; onRemove: () => void;
}) {
    const listId = useId();
    const [probe, setProbe] = useState<{ busy: boolean; models: string[]; message?: string }>({ busy: false, models: [] });
    const load = async () => {
        if (!gateway) return;
        setProbe(current => ({ ...current, busy: true }));
        try {
            const result = await probeGateway({ gatewayId: gateway.id, baseUrl: gateway.baseUrl });
            setProbe({ busy: false, models: result.models, message: probeSummary(result) });
        } catch (e) {
            setProbe({ busy: false, models: [], message: e instanceof Error ? e.message : '获取模型列表失败' });
        }
    };
    const warning = !gateway ? '网关已删除' : !gateway.apiKeyHint ? '网关未设置密钥' : !gateway.isEnabled ? '网关已停用' : null;
    return <div className="ai-catalog-source" data-disabled={!source.isEnabled || undefined}>
        <div className="ai-catalog-source-head">
            <span className="ai-catalog-source-order" aria-hidden="true">{index + 1}</span>
            <strong>{gateway?.displayName ?? '未知网关'}</strong>
            {warning && <small data-tone="warning">{warning}</small>}
            <button type="button" className="ai-catalog-icon-button" aria-label="上移" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
            <button type="button" className="ai-catalog-icon-button" aria-label="下移" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown size={14} /></button>
            <SettingsSwitch label={`启用来源 ${gateway?.displayName ?? ''}`} checked={source.isEnabled} onToggle={() => onChange({ isEnabled: !source.isEnabled })} />
            <button type="button" className="ai-catalog-icon-button" data-danger aria-label="移除来源" onClick={onRemove}><Trash2 size={14} /></button>
        </div>
        <div className="ai-catalog-grid">
            <label className="ai-catalog-field"><span>上游模型 ID</span>
                <input className="settings-input ai-catalog-mono" list={listId} spellCheck={false} value={source.modelIdOverride ?? ''} placeholder={modelKey || '与模型 ID 相同'}
                    onChange={event => onChange({ modelIdOverride: event.target.value || null })} />
            </label>
            {supportsReasoning && <label className="ai-catalog-field"><span>思考时改用（可选）</span>
                <input className="settings-input ai-catalog-mono" list={listId} spellCheck={false} value={source.reasoningModelId ?? ''} placeholder="同上游模型"
                    onChange={event => onChange({ reasoningModelId: event.target.value || null })} />
            </label>}
        </div>
        <datalist id={listId}>{probe.models.map(model => <option key={model} value={model} />)}</datalist>
        {gateway?.apiKeyHint && <div className="ai-catalog-limit">
            <button type="button" className="settings-button settings-button-compact settings-button-ghost" disabled={probe.busy} onClick={() => void load()}>
                {probe.busy ? <SoundWaveLoader variant="inline" /> : <RefreshCw size={13} aria-hidden="true" />}读取网关的模型列表
            </button>
            {probe.message && <span className="ai-catalog-probe">{probe.message}</span>}
        </div>}
    </div>;
}

export function AIModelEditor({ model, gateways, onClose, onSaved }: {
    model: AdminModel | null; gateways: readonly AdminGateway[]; onClose: () => void; onSaved: () => void;
}) {
    const titleId = useId();
    const { showToast } = useToast();
    const [draft, setDraft] = useState(() => draftOf(model, gateways));
    const [baseline] = useState(draft);
    const [vendorMode, setVendorMode] = useState(() => (VENDOR_PRESETS.includes(draft.vendor) ? draft.vendor : CUSTOM_VENDOR));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);
    const [lookup, setLookup] = useState<{ busy: boolean; error: string | null; searched: boolean; models: ModelsDevSuggestion[] }>(
        { busy: false, error: null, searched: false, models: [] });
    const lookupSeq = useRef(0);
    const firstField = useRef<HTMLInputElement>(null);
    const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
    useUnsavedSettingsGuard(dirty);
    const patch = (change: Partial<Draft>) => { setDraft(current => ({ ...current, ...change })); setError(null); };
    const gatewayById = useMemo(() => new Map(gateways.map(gateway => [gateway.id, gateway])), [gateways]);
    const unused = gateways.filter(gateway => !draft.sources.some(source => source.gatewayId === gateway.id));
    const format = THINKING_FORMAT_OPTIONS.find(option => option.value === draft.thinkingFormat);
    const chat = draft.usageType === 'chat' || draft.usageType === 'vision';
    const image = draft.usageType === 'image';

    const lookupModelsDev = useCallback(async (query: string) => {
        const seq = ++lookupSeq.current;
        if (query.length < 2) {
            setLookup({ busy: false, error: null, searched: false, models: [] });
            return;
        }
        setLookup(current => ({ ...current, busy: true, error: null }));
        try {
            const result = await requestBrowserData<{ models: ModelsDevSuggestion[] }>(
                `/api/admin/models-dev?q=${encodeURIComponent(query)}`, undefined, { fallbackMessage: '查询 models.dev 失败' });
            if (seq !== lookupSeq.current) return;
            setLookup({ busy: false, error: null, searched: true, models: result.models ?? [] });
        } catch (e) {
            if (seq !== lookupSeq.current) return;
            setLookup({ busy: false, error: e instanceof Error ? e.message : '查询 models.dev 失败', searched: true, models: [] });
        }
    }, []);

    // 模型 ID 停下 600ms 后查一次 models.dev；按钮可以立刻重查。查询结果只用于一键填入。
    useEffect(() => {
        if (!chat) return;
        const timer = setTimeout(() => { void lookupModelsDev(draft.modelKey.trim()); }, 600);
        return () => clearTimeout(timer);
    }, [chat, draft.modelKey, lookupModelsDev]);

    const applyCatalog = (suggestion: ModelsDevSuggestion) => {
        const levels = suggestion.reasoning ? suggestion.thinkingLevels : [];
        patch({
            ...(suggestion.contextWindow ? { contextWindow: String(suggestion.contextWindow) } : {}),
            ...(suggestion.maxTokens ? { defaultMaxTokens: String(suggestion.maxTokens) } : {}),
            ...(draft.displayName ? {} : { displayName: suggestion.name }),
            supportsReasoning: suggestion.reasoning,
            thinkingLevels: levels,
            defaultReasoningEffort: levels.includes('medium') ? 'medium' : levels.at(-1) ?? null,
            supportsVision: suggestion.vision || draft.usageType === 'vision',
        });
        showToast('success', `已填入 ${suggestion.name} 的目录值`);
    };

    const toggleLevel = (level: AIReasoningEffort) => {
        const levels = draft.thinkingLevels.includes(level) ? draft.thinkingLevels.filter(item => item !== level) : [...draft.thinkingLevels, level];
        const ordered = AI_REASONING_EFFORTS.filter(item => levels.includes(item));
        // The default stays one of the listed levels.
        const fallback = ordered.includes('medium') ? 'medium' : ordered.at(-1) ?? null;
        patch({ thinkingLevels: ordered, defaultReasoningEffort: draft.defaultReasoningEffort && ordered.includes(draft.defaultReasoningEffort) ? draft.defaultReasoningEffort : ordered.length ? fallback : null });
    };
    const setSource = (index: number, change: Partial<AdminModelSource>) =>
        patch({ sources: draft.sources.map((source, position) => (position === index ? { ...source, ...change } : source)) });
    const moveSource = (index: number, offset: number) => {
        const sources = [...draft.sources];
        const [moved] = sources.splice(index, 1);
        sources.splice(index + offset, 0, moved);
        patch({ sources });
    };

    const save = async () => {
        const payload = payloadOf(draft);
        if ('error' in payload) { setError(payload.error as string); return; }
        const parsed = parseModelInput(payload);
        if ('error' in parsed) { setError(parsed.error); return; }
        setSaving(true);
        try {
            await requestBrowserData(model ? `/api/admin/ai-models/${model.id}` : '/api/admin/ai-models', {
                method: model ? 'PUT' : 'POST', headers: JSON_HEADERS, body: JSON.stringify(parsed.value),
            }, { fallbackMessage: '保存模型失败' });
            showToast('success', model ? '模型已保存' : '模型已添加');
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : '保存模型失败');
        } finally {
            setSaving(false);
        }
    };
    const remove = async () => {
        if (!model) return;
        setSaving(true);
        try {
            await requestBrowserData(`/api/admin/ai-models/${model.id}`, { method: 'DELETE' }, { fallbackMessage: '删除模型失败' });
            showToast('success', '模型已删除');
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : '删除模型失败');
            setConfirm(null);
        } finally {
            setSaving(false);
        }
    };
    const close = () => (dirty ? setConfirm('discard') : onClose());

    return <Modal open onClose={close} busy={saving} labelledBy={titleId} initialFocusRef={firstField} className="ai-catalog-dialog">
        <header className="ai-catalog-dialog-head">
            <div style={{ flex: 1, minWidth: 0 }}>
                <h2 id={titleId}>{model ? model.displayName : '添加模型'}</h2>
                {model && <p className="ai-catalog-mono">{model.modelKey}</p>}
            </div>
            <button type="button" className="ai-catalog-icon-button" aria-label="关闭" onClick={close}><X size={16} /></button>
        </header>
        <div className="ai-catalog-dialog-body">
            <section className="ai-catalog-section" aria-labelledby={`${titleId}-basic`}>
                <header><h3 id={`${titleId}-basic`}>基本信息</h3></header>
                <div className="ai-catalog-grid">
                    <label className="ai-catalog-field"><span>显示名称</span>
                        <input ref={firstField} className="settings-input" value={draft.displayName} maxLength={80} placeholder="DeepSeek V4"
                            onChange={event => patch({ displayName: event.target.value })} />
                    </label>
                    <label className="ai-catalog-field"><span>模型 ID</span>
                        <input className="settings-input ai-catalog-mono" value={draft.modelKey} maxLength={200} spellCheck={false} autoCapitalize="off" placeholder="deepseek-v4"
                            onChange={event => patch({ modelKey: event.target.value.trim() })} />
                    </label>
                    <label className="ai-catalog-field"><span>供应商</span>
                        <select className="settings-select" value={vendorMode} onChange={event => {
                            setVendorMode(event.target.value);
                            if (event.target.value !== CUSTOM_VENDOR) patch({ vendor: event.target.value });
                        }}>
                            {VENDOR_PRESETS.map(vendor => <option key={vendor} value={vendor}>{getVendorName(vendor)}</option>)}
                            <option value={CUSTOM_VENDOR}>其他…</option>
                        </select>
                    </label>
                    {vendorMode === CUSTOM_VENDOR ? <label className="ai-catalog-field"><span>供应商标识</span>
                        <input className="settings-input ai-catalog-mono" value={draft.vendor} maxLength={40} placeholder="mistral" onChange={event => patch({ vendor: event.target.value.trim() })} />
                    </label> : <div className="ai-catalog-field"><span>用途</span>
                        <SegmentedChoice ariaLabel="模型用途" value={draft.usageType} options={USAGE_TYPES} maxWidth={320}
                            onChange={usageType => patch({ usageType, supportsVision: usageType === 'vision' || draft.supportsVision })} />
                    </div>}
                </div>
                {vendorMode === CUSTOM_VENDOR && <div className="ai-catalog-field"><span>用途</span>
                    <SegmentedChoice ariaLabel="模型用途" value={draft.usageType} options={USAGE_TYPES} maxWidth={320}
                        onChange={usageType => patch({ usageType, supportsVision: usageType === 'vision' || draft.supportsVision })} />
                </div>}
                <label className="ai-catalog-field"><span>描述（可选）</span>
                    <input className="settings-input" value={draft.description} maxLength={500} onChange={event => patch({ description: event.target.value })} />
                </label>
                {chat && <div className="ai-catalog-lookup">
                    <div className="ai-catalog-lookup-head">
                        <span>模型目录<small>models.dev 公开的上下文与输出上限，可一键填入</small></span>
                        <button type="button" className="settings-button settings-button-compact settings-button-ghost"
                            disabled={lookup.busy || draft.modelKey.trim().length < 2}
                            onClick={() => void lookupModelsDev(draft.modelKey.trim())}>
                            {lookup.busy ? <SoundWaveLoader variant="inline" /> : <RefreshCw size={13} aria-hidden="true" />}
                            {lookup.busy ? '查询中…' : '查询 models.dev'}
                        </button>
                    </div>
                    {lookup.error && <span className="ai-catalog-hint">{lookup.error}</span>}
                    {!lookup.busy && !lookup.error && lookup.models.length > 0 && <ul className="ai-catalog-lookup-list" aria-label="models.dev 匹配结果">
                        {lookup.models.slice(0, 5).map(suggestion => <li key={`${suggestion.provider}:${suggestion.id}`}>
                            <span className="ai-catalog-lookup-name"><strong>{suggestion.name}</strong><small>{suggestion.providerName} · {suggestion.id}</small></span>
                            <span className="ai-catalog-lookup-meta">
                                {suggestion.contextWindow ? `${formatTokenCount(suggestion.contextWindow)} 上下文` : '上下文未知'}
                                {suggestion.maxTokens ? ` · ${formatTokenCount(suggestion.maxTokens)} 输出` : ''}
                                {suggestion.reasoning ? ' · 思考' : ''}
                                {suggestion.vision ? ' · 图片' : ''}
                            </span>
                            <button type="button" className="settings-button settings-button-compact" onClick={() => applyCatalog(suggestion)}>填入</button>
                        </li>)}
                    </ul>}
                    {!lookup.busy && !lookup.error && lookup.searched && lookup.models.length === 0 && <span className="ai-catalog-hint">models.dev 没有匹配；可以手填。</span>}
                </div>}
            </section>

            {image && <section className="ai-catalog-section" aria-labelledby={`${titleId}-image`}>
                <header><h3 id={`${titleId}-image`}>生图</h3><p>输入框的「生图」按钮和 Agent 的 generate_image 工具使用这个模型；按张扣积分。</p></header>
                <label className="ai-catalog-field"><span>每张图积分</span>
                    <input className="settings-input" type="number" inputMode="numeric" min={0} max={1000} value={draft.creditCost}
                        onChange={event => patch({ creditCost: Number(event.target.value) })} />
                    <span className="ai-catalog-hint">0 表示不扣积分；每次最多生成 4 张。</span>
                </label>
            </section>}

            {chat && <section className="ai-catalog-section" aria-labelledby={`${titleId}-limits`}>
                <header><h3 id={`${titleId}-limits`}>上下文与输出</h3><p>Agent 按上下文窗口决定何时压缩对话；最大输出是单次回复（含思考）的上限。</p></header>
                <LimitField label="上下文窗口" value={draft.contextWindow} presets={CONTEXT_WINDOW_PRESETS} placeholder="未知"
                    hint="留空时按已知模型的应用上限；都不知道时 Agent 不按阈值压缩。" onChange={contextWindow => patch({ contextWindow })} />
                <LimitField label="最大输出" value={draft.defaultMaxTokens} presets={MAX_OUTPUT_PRESETS} placeholder="不限"
                    hint="留空表示不限：请求不带 max_tokens，由上游按模型默认处理。思考也计入输出，思考等级越高越需要留足。" onChange={defaultMaxTokens => patch({ defaultMaxTokens })} />
                <div className="ai-catalog-toggle">
                    <span>支持图片输入<small>Agent 会把图片附件随消息发给模型</small></span>
                    <SettingsSwitch label="支持图片输入" checked={draft.supportsVision} onToggle={() => patch({ supportsVision: !draft.supportsVision })} />
                </div>
            </section>}

            {chat && <section className="ai-catalog-section" aria-labelledby={`${titleId}-thinking`}>
                <header><h3 id={`${titleId}-thinking`}>思考</h3></header>
                <div className="ai-catalog-toggle">
                    <span>支持思考<small>模型会先推理再回答；推理内容在工具调用之间延续</small></span>
                    <SettingsSwitch label="支持思考" checked={draft.supportsReasoning}
                        onToggle={() => patch({ supportsReasoning: !draft.supportsReasoning, ...(draft.supportsReasoning ? { isReasoningDefault: false } : {}) })} />
                </div>
                <div className="ai-catalog-reveal" data-open={draft.supportsReasoning} inert={!draft.supportsReasoning || undefined}>
                    <div>
                        <div className="ai-catalog-field">
                            <span>可选等级</span>
                            <div className="ai-catalog-limit" role="group" aria-label="可选思考等级">
                                {AI_REASONING_EFFORTS.map(level => <button key={level} type="button" className="ai-catalog-chip"
                                    aria-pressed={draft.thinkingLevels.includes(level)} onClick={() => toggleLevel(level)}>{THINKING_LEVEL_LABELS[level]}</button>)}
                            </div>
                            <span className="ai-catalog-hint">输入框的「努力程度」只列出这里勾选的等级；都不勾选时只能开关思考。</span>
                        </div>
                        <div className="ai-catalog-grid">
                            <label className="ai-catalog-field"><span>参数格式</span>
                                <select className="settings-select" value={draft.thinkingFormat} onChange={event => patch({ thinkingFormat: event.target.value as Draft['thinkingFormat'] })}>
                                    {THINKING_FORMAT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                                {format && <span className="ai-catalog-hint ai-catalog-mono">{format.fields}</span>}
                            </label>
                            <label className="ai-catalog-field"><span>默认等级</span>
                                <select className="settings-select" value={draft.defaultReasoningEffort ?? ''} disabled={!draft.thinkingLevels.length}
                                    onChange={event => patch({ defaultReasoningEffort: (event.target.value || null) as AIReasoningEffort | null })}>
                                    {!draft.thinkingLevels.length && <option value="">—</option>}
                                    {draft.thinkingLevels.map(level => <option key={level} value={level}>{THINKING_LEVEL_LABELS[level]}</option>)}
                                </select>
                            </label>
                        </div>
                        <div className="ai-catalog-toggle">
                            <span>默认开启思考</span>
                            <SettingsSwitch label="默认开启思考" checked={draft.isReasoningDefault} onToggle={() => patch({ isReasoningDefault: !draft.isReasoningDefault })} />
                        </div>
                        <div className="ai-catalog-field"><span>思考所需会员</span>
                            <SegmentedChoice ariaLabel="思考所需会员" value={draft.reasoningRequiredTier} options={TIERS} onChange={reasoningRequiredTier => patch({ reasoningRequiredTier })} />
                        </div>
                    </div>
                </div>
            </section>}

            <section className="ai-catalog-section" aria-labelledby={`${titleId}-sources`}>
                <header><h3 id={`${titleId}-sources`}>来源与故障转移</h3><p>按顺序请求；前一个来源在回复出现前失败时，换下一个。</p></header>
                {draft.sources.length ? <div className="ai-catalog-sources">
                    {draft.sources.map((source, index) => <SourceRow key={source.gatewayId} source={source} index={index} count={draft.sources.length}
                        gateway={gatewayById.get(source.gatewayId)} modelKey={draft.modelKey} supportsReasoning={draft.supportsReasoning}
                        onChange={change => setSource(index, change)} onMove={offset => moveSource(index, offset)}
                        onRemove={() => patch({ sources: draft.sources.filter((_, position) => position !== index) })} />)}
                </div> : <p className="ai-catalog-hint">没有来源的模型不会出现在用户的模型菜单里。</p>}
                {unused.length > 0 && <select className="settings-select" value="" aria-label="添加来源"
                    onChange={event => event.target.value && patch({ sources: [...draft.sources, { gatewayId: event.target.value, modelIdOverride: null, reasoningModelId: null, isEnabled: true }] })}>
                    <option value="">添加来源网关…</option>
                    {unused.map(gateway => <option key={gateway.id} value={gateway.id}>{gateway.displayName}</option>)}
                </select>}
            </section>

            <section className="ai-catalog-section" aria-labelledby={`${titleId}-access`}>
                <header><h3 id={`${titleId}-access`}>可见范围</h3></header>
                <div className="ai-catalog-grid">
                    <div className="ai-catalog-field"><span>所需会员</span>
                        <SegmentedChoice ariaLabel="所需会员" value={draft.requiredTier} options={TIERS} onChange={requiredTier => patch({ requiredTier })} />
                    </div>
                    <label className="ai-catalog-field"><span>排序</span>
                        <input className="settings-input" type="number" value={draft.sortOrder} onChange={event => patch({ sortOrder: event.target.value })} />
                        <span className="ai-catalog-hint">数值越小越靠前，第一个可用的对话模型是默认模型。</span>
                    </label>
                </div>
            </section>

            <details className="ai-catalog-advanced">
                <summary><ChevronRight size={14} aria-hidden="true" />自定义请求参数</summary>
                <div>
                    <label className="ai-catalog-field"><span>自定义请求参数（JSON）</span>
                        <textarea className="settings-textarea ai-catalog-mono" rows={4} spellCheck={false} value={draft.customParameters} placeholder={'{\n  "top_k": 40\n}'}
                            onChange={event => patch({ customParameters: event.target.value })} />
                        <span className="ai-catalog-hint">合并进请求体；消息、工具、输出上限和思考参数由系统写入，这里不能覆盖。提示缓存亲和默认开启；网关不接受 prompt_cache_key 时，设为 <code>{'{"promptCacheKey": false}'}</code> 关闭。</span>
                    </label>
                </div>
            </details>
        </div>
        <footer className="ai-catalog-dialog-foot">
            {model && <button type="button" className="settings-text-button-danger" disabled={saving} onClick={() => setConfirm('delete')}>删除模型</button>}
            {error ? <p className="ai-catalog-error" role="alert">{error}</p> : <span className="ai-catalog-spacer" />}
            <button type="button" className="settings-button" disabled={saving} onClick={close}>取消</button>
            <button type="button" className="settings-button settings-button-primary" disabled={saving || (!!model && !dirty)} onClick={() => void save()}>
                {saving ? '正在保存…' : model ? '保存' : '添加模型'}
            </button>
        </footer>
        <ConfirmDialog isOpen={confirm !== null} onClose={() => setConfirm(null)} loading={saving}
            title={confirm === 'delete' ? `删除 ${model?.displayName ?? '模型'}？` : '放弃未保存的修改？'}
            description={confirm === 'delete' ? '用户的模型菜单里不再出现它；进行中的任务会失败。' : '关闭后，这次填写的内容不会保存。'}
            confirmText={confirm === 'delete' ? '删除' : '放弃修改'}
            onConfirm={() => (confirm === 'delete' ? remove() : onClose())} />
    </Modal>;
}
