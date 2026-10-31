// Model editor dialog: every field of a catalog model, its thinking ladder and its ordered sources.
'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, RefreshCw, Trash2, X } from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import { Dialog } from '@/components/ui/Dialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FilterChip } from '@/components/ui/FilterChip';
import { Textarea } from '@/components/ui/Textarea';
import { IconButton } from '@/components/ui/IconButton';
import { Select } from '@/components/ui/Select';
import { SegmentedChoice } from '@/components/settings/SegmentedChoice';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { getVendorName, VENDOR_PRESETS } from '@/lib/ai/vendor-labels';
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import {
    CONTEXT_WINDOW_PRESETS, PRICE_FIELDS, THINKING_LEVEL_LABELS, USAGE_TYPES,
    formatTokenCount, parseModelInput, priceFieldsFor,
    type AdminGateway, type AdminModel, type AdminModelInput, type AdminModelSource, type PriceField,
} from '@/lib/admin/ai-catalog';
import { probeGateway, probeSummary } from './AIGatewayPanel';
import type { ModelsDevSuggestion } from '@/lib/admin/models-dev';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const CUSTOM_VENDOR = '__custom__';
const CUSTOM_WINDOW = '__custom__';

/** Form state: numbers and JSON stay text until saved, so a half-typed value is never lost. */
type Draft = Omit<AdminModelInput, 'contextWindow' | 'defaultMaxTokens' | 'customParameters' | 'sortOrder' | 'pricing'> & {
    sortOrder: string; contextWindow: string; defaultMaxTokens: string; customParameters: string;
    pricing: Record<PriceField, string>;
};

const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));

function draftOf(model: AdminModel | null, gateways: readonly AdminGateway[]): Draft {
    return {
        modelKey: model?.modelKey ?? '', displayName: model?.displayName ?? '', vendor: model?.vendor ?? 'openai',
        usageType: model?.usageType ?? 'chat', isEnabled: model?.isEnabled ?? true,
        pricing: Object.fromEntries(PRICE_FIELDS.map(field => [field.key, text(model?.pricing?.[field.key])])) as Record<PriceField, string>,
        sortOrder: text(model?.sortOrder ?? 0),
        supportsVision: model?.supportsVision ?? false,
        isReasoningDefault: model?.isReasoningDefault ?? false,
        thinkingLevels: model?.thinkingLevels ?? [],
        defaultReasoningEffort: model?.defaultReasoningEffort ?? null,
        // A new model starts at 1M; an existing one keeps whatever was saved.
        contextWindow: model ? text(model.contextWindow) : '1000000',
        defaultMaxTokens: text(model?.defaultMaxTokens),
        customParameters: model?.customParameters ? JSON.stringify(model.customParameters, null, 2) : '',
        // A new model starts on the first enabled gateway; it can be removed before saving.
        sources: model?.sources ?? gateways.filter(gateway => gateway.isEnabled).slice(0, 1)
            .map(gateway => ({ gatewayId: gateway.id, modelIdOverride: null, isEnabled: true })),
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

/** The context window: a preset ladder plus a free number, defaulting new models to 1M. */
function ContextWindowField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const customValue = value !== '' && !CONTEXT_WINDOW_PRESETS.some(preset => String(preset.tokens) === value);
    const [customMode, setCustomMode] = useState(customValue);
    const custom = customMode || customValue;
    return <div className="ai-catalog-field">
        <span>上下文窗口{value ? <span className="ai-catalog-hint"> · {formatTokenCount(Number(value))}</span> : null}</span>
        <div className="ai-catalog-limit" role="group" aria-label="上下文窗口">
            <Select ariaLabel="上下文窗口" value={custom ? CUSTOM_WINDOW : value} onChange={next => {
                setCustomMode(next === CUSTOM_WINDOW);
                if (next !== CUSTOM_WINDOW) onChange(next);
            }} options={[
                { value: '', label: '未设置' },
                ...CONTEXT_WINDOW_PRESETS.map(preset => ({ value: String(preset.tokens), label: preset.label })),
                { value: CUSTOM_WINDOW, label: '自定义…' },
            ]} className="w-36" />
            {custom && <Input type="number" inputMode="numeric" min={1024} aria-label="自定义上下文窗口" value={value}
                placeholder="例如 131072" onChange={event => onChange(event.target.value)} />}
        </div>
        <span className="ai-catalog-hint">Agent 按上下文窗口决定何时压缩对话；新建模型默认 1M。</span>
    </div>;
}

function SourceRow({ source, index, count, gateway, modelKey, onChange, onMove, onRemove }: {
    source: AdminModelSource; index: number; count: number; gateway: AdminGateway | undefined; modelKey: string;
    onChange: (change: Partial<AdminModelSource>) => void; onMove: (offset: number) => void; onRemove: () => void;
}) {
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
    const models = source.modelIdOverride && !probe.models.includes(source.modelIdOverride)
        ? [...probe.models, source.modelIdOverride]
        : probe.models;
    return <div className="ai-catalog-source" data-disabled={!source.isEnabled || undefined}>
        <div className="ai-catalog-source-head">
            <span className="ai-catalog-source-order" aria-hidden="true">{index + 1}</span>
            <strong>{gateway?.displayName ?? '未知网关'}</strong>
            {warning && <small data-tone="warning">{warning}</small>}
            <IconButton label="上移" size="xs" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={14} aria-hidden="true" /></IconButton>
            <IconButton label="下移" size="xs" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown size={14} aria-hidden="true" /></IconButton>
            <SettingsSwitch label={`启用来源 ${gateway?.displayName ?? ''}`} checked={source.isEnabled} onToggle={() => onChange({ isEnabled: !source.isEnabled })} />
            <IconButton label="移除来源" tone="danger" size="xs" onClick={onRemove}><Trash2 size={14} aria-hidden="true" /></IconButton>
        </div>
        <label className="ai-catalog-field"><span>上游模型 ID</span>
            <Input className="ai-catalog-mono" spellCheck={false} value={source.modelIdOverride ?? ''} placeholder={modelKey || '与模型 ID 相同'}
                onChange={event => onChange({ modelIdOverride: event.target.value || null })} />
        </label>
        {probe.models.length > 0 && <label className="ai-catalog-field"><span>从网关列表选择</span>
            <Select ariaLabel="从网关列表选择" value={source.modelIdOverride ?? ''}
                onChange={value => onChange({ modelIdOverride: value || null })}
                options={[
                    { value: '', label: `与模型 ID 相同${modelKey ? `（${modelKey}）` : ''}` },
                    ...models.map(model => ({ value: model, label: model })),
                ]} />
        </label>}
        {gateway?.apiKeyHint && <div className="ai-catalog-limit">
            <Button variant="ghost" size="sm" loading={probe.busy} loadingText={<><RefreshCw size={13} aria-hidden="true" />读取网关的模型列表</>} disabled={probe.busy} onClick={() => void load()}>
                {!probe.busy && <RefreshCw size={13} aria-hidden="true" />}读取网关的模型列表
            </Button>
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
    const chat = draft.usageType === 'chat';
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
            // 模型 ID 精确命中目录时，自动带出不可直填的默认值：输出上限与思考等级。
            const exact = result.models?.find(suggestion => suggestion.id.toLowerCase() === query.trim().toLowerCase());
            if (exact) {
                setDraft(current => {
                    let next = current;
                    if (!current.defaultMaxTokens && exact.maxTokens) {
                        next = { ...next, defaultMaxTokens: String(exact.maxTokens) };
                    }
                    if (!current.thinkingLevels.length && exact.thinkingLevels.length) {
                        next = {
                            ...next,
                            thinkingLevels: exact.thinkingLevels,
                            defaultReasoningEffort: exact.thinkingLevels.includes('medium') ? 'medium' : exact.thinkingLevels.at(-1) ?? null,
                        };
                    }
                    return next;
                });
            }
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
            thinkingLevels: levels,
            defaultReasoningEffort: levels.includes('medium') ? 'medium' : levels.at(-1) ?? null,
            isReasoningDefault: levels.length > 0 && draft.isReasoningDefault,
            supportsVision: suggestion.vision || draft.supportsVision,
        });
        showToast('success', `已填入 ${suggestion.name} 的目录值`);
    };

    const toggleLevel = (level: AIReasoningEffort) => {
        const levels = draft.thinkingLevels.includes(level) ? draft.thinkingLevels.filter(item => item !== level) : [...draft.thinkingLevels, level];
        const ordered = AI_REASONING_EFFORTS.filter(item => levels.includes(item));
        // The default stays one of the listed levels.
        const fallback = ordered.includes('medium') ? 'medium' : ordered.at(-1) ?? null;
        patch({
            thinkingLevels: ordered,
            defaultReasoningEffort: draft.defaultReasoningEffort && ordered.includes(draft.defaultReasoningEffort) ? draft.defaultReasoningEffort : ordered.length ? fallback : null,
            ...(ordered.length ? {} : { isReasoningDefault: false }),
        });
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

    return <Dialog bare open onClose={close} busy={saving} labelledBy={titleId} initialFocusRef={firstField} className="ai-catalog-dialog">
        <header className="ai-catalog-dialog-head">
            <div style={{ flex: 1, minWidth: 0 }}>
                <h2 id={titleId}>{model ? model.displayName : '添加模型'}</h2>
                {model && <p className="ai-catalog-mono">{model.modelKey}</p>}
            </div>
            <IconButton label="关闭" size="sm" onClick={close}><X size={16} aria-hidden="true" /></IconButton>
        </header>
        <div className="ai-catalog-dialog-body">
            <section className="ai-catalog-section" aria-labelledby={`${titleId}-basic`}>
                <header><h3 id={`${titleId}-basic`}>基本信息</h3></header>
                <div className="ai-catalog-grid">
                    <label className="ai-catalog-field"><span>显示名称</span>
                        <Input ref={firstField} value={draft.displayName} maxLength={80} placeholder="DeepSeek V4"
                            onChange={event => patch({ displayName: event.target.value })} />
                    </label>
                    <label className="ai-catalog-field"><span>模型 ID</span>
                        <Input className="ai-catalog-mono" value={draft.modelKey} maxLength={200} spellCheck={false} autoCapitalize="off" placeholder="deepseek-v4"
                            onChange={event => patch({ modelKey: event.target.value.trim() })} />
                    </label>
                    <label className="ai-catalog-field"><span>供应商</span>
                        <Select ariaLabel="供应商" value={vendorMode} onChange={value => {
                            setVendorMode(value);
                            if (value !== CUSTOM_VENDOR) patch({ vendor: value });
                        }} options={[
                            ...VENDOR_PRESETS.map(vendor => ({ value: vendor, label: getVendorName(vendor) })),
                            { value: CUSTOM_VENDOR, label: '其他…' },
                        ]} />
                    </label>
                </div>
                {vendorMode === CUSTOM_VENDOR && <label className="ai-catalog-field"><span>供应商标识</span>
                    <Input className="ai-catalog-mono" value={draft.vendor} maxLength={40} placeholder="mistral" onChange={event => patch({ vendor: event.target.value.trim() })} />
                </label>}
                <div className="ai-catalog-field"><span>用途</span>
                    <SegmentedChoice ariaLabel="模型用途" value={draft.usageType} options={USAGE_TYPES} maxWidth={320}
                        onChange={usageType => patch({ usageType })} />
                </div>
                {chat && <div className="ai-catalog-lookup">
                    <div className="ai-catalog-lookup-head">
                        <span>模型目录<small>models.dev 公开的上下文与思考能力，可一键填入</small></span>
                        <Button variant="ghost" size="sm" loading={lookup.busy} loadingText="查询中…"
                            disabled={draft.modelKey.trim().length < 2}
                            onClick={() => void lookupModelsDev(draft.modelKey.trim())}>
                            {!lookup.busy && <RefreshCw size={13} aria-hidden="true" />}查询 models.dev
                        </Button>
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
                            <Button variant="secondary" size="xs" onClick={() => applyCatalog(suggestion)}>填入</Button>
                        </li>)}
                    </ul>}
                    {!lookup.busy && !lookup.error && lookup.searched && lookup.models.length === 0 && <span className="ai-catalog-hint">models.dev 没有匹配；可以手填。</span>}
                </div>}
            </section>

            {image && <section className="ai-catalog-section" aria-labelledby={`${titleId}-image`}>
                <header><h3 id={`${titleId}-image`}>生图与价格</h3><p>输入框的「生图」按钮和 Agent 的 generate_image 工具使用这个模型；按张计费。</p></header>
                {priceFieldsFor(draft.usageType).map(field => <label key={field.key} className="ai-catalog-field"><span>{field.label}（{field.unit}）</span>
                    <Input inputMode="decimal" value={draft.pricing[field.key]}
                        onChange={event => patch({ pricing: { ...draft.pricing, [field.key]: event.target.value } })} />
                    <span className="ai-catalog-hint">留空表示未定价，平台不提供这个模型；填 0 为免费模型。</span>
                </label>)}
            </section>}

            {chat && <section className="ai-catalog-section" aria-labelledby={`${titleId}-pricing`}>
                <header><h3 id={`${titleId}-pricing`}>价格</h3><p>按实际用量计费，单位是美元/百万 token；推理 token 计入输出。</p></header>
                <div className="ai-catalog-grid">
                    {priceFieldsFor(draft.usageType).map(field => <label key={field.key} className="ai-catalog-field"><span>{field.label}（{field.unit}）</span>
                        <Input inputMode="decimal" value={draft.pricing[field.key]}
                            onChange={event => patch({ pricing: { ...draft.pricing, [field.key]: event.target.value } })} />
                    </label>)}
                </div>
                <span className="ai-catalog-hint">留空表示未定价，平台不提供这个模型；输入与输出都填 0 为免费模型。缓存单价留空时按输入价计。</span>
            </section>}

            {chat && <section className="ai-catalog-section" aria-labelledby={`${titleId}-limits`}>
                <header><h3 id={`${titleId}-limits`}>上下文与输出</h3><p>Agent 按上下文窗口决定何时压缩对话；输出上限取自模型目录，取不到时按模型默认。</p></header>
                <ContextWindowField value={draft.contextWindow} onChange={contextWindow => patch({ contextWindow })} />
                <div className="ai-catalog-field"><span>输出上限</span>
                    <span className="ai-catalog-hint">{draft.defaultMaxTokens
                        ? `当前上限 ${formatTokenCount(Number(draft.defaultMaxTokens))}`
                        : '未设 · 按模型默认'}</span>
                </div>
                <div className="ai-catalog-toggle">
                    <span>支持图片输入<small>Agent 会把图片附件随消息发给模型</small></span>
                    <SettingsSwitch label="支持图片输入" checked={draft.supportsVision} onToggle={() => patch({ supportsVision: !draft.supportsVision })} />
                </div>
            </section>}

            {chat && <section className="ai-catalog-section" aria-labelledby={`${titleId}-thinking`}>
                <header><h3 id={`${titleId}-thinking`}>思考</h3><p>勾选模型支持的等级即表示支持思考；不勾选时不会发送思考参数。</p></header>
                <div className="ai-catalog-field">
                    <span>可选等级</span>
                    <div className="ai-catalog-limit" role="group" aria-label="可选思考等级">
                        {AI_REASONING_EFFORTS.map(level => <FilterChip key={level} className="ai-catalog-chip"
                            pressed={draft.thinkingLevels.includes(level)} onClick={() => toggleLevel(level)}>{THINKING_LEVEL_LABELS[level]}</FilterChip>)}
                    </div>
                    <span className="ai-catalog-hint">输入框的「努力程度」只列出这里勾选的等级。</span>
                </div>
                {draft.thinkingLevels.length > 0 && <>
                    <div className="ai-catalog-grid">
                        <label className="ai-catalog-field"><span>默认等级</span>
                            <Select ariaLabel="默认等级" value={draft.defaultReasoningEffort ?? ''}
                                onChange={value => patch({ defaultReasoningEffort: (value || null) as AIReasoningEffort | null })}
                                options={draft.thinkingLevels.map(level => ({ value: level, label: THINKING_LEVEL_LABELS[level] }))} />
                        </label>
                    </div>
                    <div className="ai-catalog-toggle">
                        <span>默认开启思考</span>
                        <SettingsSwitch label="默认开启思考" checked={draft.isReasoningDefault} onToggle={() => patch({ isReasoningDefault: !draft.isReasoningDefault })} />
                    </div>
                </>}
            </section>}

            <section className="ai-catalog-section" aria-labelledby={`${titleId}-sources`}>
                <header><h3 id={`${titleId}-sources`}>来源与故障转移</h3><p>按顺序请求；前一个来源在回复出现前失败时，换下一个。每个来源只需选择网关和上游模型 ID。</p></header>
                {draft.sources.length ? <div className="ai-catalog-sources">
                    {draft.sources.map((source, index) => <SourceRow key={source.gatewayId} source={source} index={index} count={draft.sources.length}
                        gateway={gatewayById.get(source.gatewayId)} modelKey={draft.modelKey}
                        onChange={change => setSource(index, change)} onMove={offset => moveSource(index, offset)}
                        onRemove={() => patch({ sources: draft.sources.filter((_, position) => position !== index) })} />)}
                </div> : <p className="ai-catalog-hint">没有来源的模型不会出现在用户的模型菜单里。</p>}
                {unused.length > 0 && <Select
                    value={null}
                    placeholder="添加来源网关…"
                    ariaLabel="添加来源"
                    options={unused.map(gateway => ({ value: gateway.id, label: gateway.displayName }))}
                    onChange={gatewayId => patch({ sources: [...draft.sources, { gatewayId, modelIdOverride: null, isEnabled: true }] })}
                    className="w-auto min-w-40"
                />}
            </section>

            <section className="ai-catalog-section" aria-labelledby={`${titleId}-access`}>
                <header><h3 id={`${titleId}-access`}>可见范围</h3></header>
                <div className="ai-catalog-grid">
                    <label className="ai-catalog-field"><span>排序</span>
                        <Input type="number" value={draft.sortOrder} onChange={event => patch({ sortOrder: event.target.value })} />
                        <span className="ai-catalog-hint">数值越小越靠前，第一个可用的对话模型是默认模型。</span>
                    </label>
                </div>
            </section>

            <details className="ai-catalog-advanced">
                <summary><ChevronRight size={14} aria-hidden="true" />自定义请求参数</summary>
                <div>
                    <label className="ai-catalog-field"><span>自定义请求参数（JSON）</span>
                        <Textarea className="ai-catalog-mono" rows={4} spellCheck={false} value={draft.customParameters} placeholder={'{\n  "top_k": 40\n}'}
                            onChange={event => patch({ customParameters: event.target.value })} />
                        <span className="ai-catalog-hint">合并进请求体；消息、工具和思考参数由系统写入，这里不能覆盖。提示缓存亲和默认开启；网关不接受 prompt_cache_key 时，设为 <code>{'{"promptCacheKey": false}'}</code> 关闭。</span>
                    </label>
                </div>
            </details>
        </div>
        <footer className="ai-catalog-dialog-foot">
            {model && <Button variant="danger" size="sm" disabled={saving} onClick={() => setConfirm('delete')}>删除模型</Button>}
            {error ? <p className="ai-catalog-error" role="alert">{error}</p> : <span className="ai-catalog-spacer" />}
            <Button variant="ghost" size="lg" disabled={saving} onClick={close}>取消</Button>
            <Button size="lg" loading={saving} loadingText="正在保存…" disabled={saving || (!!model && !dirty)} onClick={() => void save()}>{model ? '保存' : '添加模型'}</Button>
        </footer>
        <ConfirmDialog isOpen={confirm !== null} onClose={() => setConfirm(null)} loading={saving}
            title={confirm === 'delete' ? `删除 ${model?.displayName ?? '模型'}？` : '放弃未保存的修改？'}
            description={confirm === 'delete' ? '用户的模型菜单里不再出现它；进行中的任务会失败。' : '关闭后，这次填写的内容不会保存。'}
            confirmText={confirm === 'delete' ? '删除' : '放弃修改'}
            onConfirm={() => (confirm === 'delete' ? remove() : onClose())} />
    </Dialog>;
}
