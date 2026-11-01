// Model editor dialog: icon, identity, prices, capabilities and ordered sources of a catalog model, laid out compactly.
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
import { formatPrice } from '@/lib/billing/money';
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import {
    CONTEXT_WINDOW_PRESETS, PRICE_FIELDS, THINKING_LEVEL_LABELS, USAGE_TYPES,
    formatTokenCount, parseModelInput, priceFieldsFor,
    type AdminGateway, type AdminModel, type AdminModelInput, type AdminModelSource, type PriceField,
} from '@/lib/admin/ai-catalog';
import { defaultThinkingLevel, type ModelsDevPricing, type ModelsDevSuggestion } from '@/lib/admin/models-dev';
import { probeGateway, probeSummary } from './AIGatewayPanel';
import { ModelIconPicker } from './ModelIconPicker';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const CUSTOM_VENDOR = '__custom__';
const CUSTOM_WINDOW = '__custom__';
const NEW_MODEL_WINDOW = '1000000';
const SELECT_SM = 'h-8 rounded-lg';
const CATALOG_PRICES = [
    { key: 'input', label: '输入价' }, { key: 'output', label: '输出价' },
    { key: 'cacheRead', label: '缓存读价' }, { key: 'cacheWrite', label: '缓存写价' },
] as const;

/** Form state: numbers and JSON stay text until saved, so a half-typed value is never lost. */
type Draft = Omit<AdminModelInput, 'contextWindow' | 'defaultMaxTokens' | 'customParameters' | 'sortOrder' | 'pricing'> & {
    sortOrder: string; contextWindow: string; defaultMaxTokens: string; customParameters: string;
    pricing: Record<PriceField, string>;
};

const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));

function draftOf(model: AdminModel | null, gateways: readonly AdminGateway[]): Draft {
    return {
        modelKey: model?.modelKey ?? '', displayName: model?.displayName ?? '', description: model?.description ?? '',
        vendor: model?.vendor ?? 'openai',
        icon: model?.icon ?? null,
        usageType: model?.usageType ?? 'chat', isEnabled: model?.isEnabled ?? true,
        pricing: Object.fromEntries(PRICE_FIELDS.map(field => [field.key, text(model?.pricing?.[field.key])])) as Record<PriceField, string>,
        sortOrder: text(model?.sortOrder ?? 0),
        supportsVision: model?.supportsVision ?? false,
        isReasoningDefault: model?.isReasoningDefault ?? false,
        thinkingLevels: model?.thinkingLevels ?? [],
        defaultReasoningEffort: model?.defaultReasoningEffort ?? null,
        // A new model starts at 1M; an existing one keeps whatever was saved.
        contextWindow: model ? text(model.contextWindow) : NEW_MODEL_WINDOW,
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

/** The output limit must stay under the context window and within what the catalog accepts. */
const fitsOutput = (maxTokens: number, contextWindow: string) => maxTokens <= 1_000_000 && (!contextWindow || maxTokens < Number(contextWindow));

/** `$3 / $15 · 缓存 $0.3 / $3.75`; 免费 when every price is 0. */
function catalogPriceLabel(pricing: ModelsDevPricing): string {
    if (!pricing.input && !pricing.output && !pricing.cacheRead && !pricing.cacheWrite) return '免费';
    const cache = pricing.cacheRead === undefined && pricing.cacheWrite === undefined ? ''
        : ` · 缓存 ${pricing.cacheRead === undefined ? '—' : formatPrice(pricing.cacheRead)} / ${pricing.cacheWrite === undefined ? '—' : formatPrice(pricing.cacheWrite)}`;
    return `${formatPrice(pricing.input)} / ${formatPrice(pricing.output)}${cache}`;
}

/** 精确命中目录时只补空着的字段，新模型还停在初始 1M 的上下文也换成目录值；目录价格全为 0 时不补，图片输入不动。 */
function fillBlanks(draft: Draft, suggestion: ModelsDevSuggestion, creating: boolean): { draft: Draft; changes: string[] } {
    const next: Draft = { ...draft, pricing: { ...draft.pricing } };
    const changes: string[] = [];
    if (suggestion.contextWindow && String(suggestion.contextWindow) !== draft.contextWindow
        && (!draft.contextWindow || (creating && draft.contextWindow === NEW_MODEL_WINDOW))) {
        next.contextWindow = String(suggestion.contextWindow);
        changes.push('上下文');
    }
    if (!draft.defaultMaxTokens && suggestion.maxTokens && fitsOutput(suggestion.maxTokens, next.contextWindow)) {
        next.defaultMaxTokens = String(suggestion.maxTokens);
        changes.push('输出上限');
    }
    if (!draft.thinkingLevels.length && suggestion.reasoning && suggestion.thinkingLevels.length) {
        next.thinkingLevels = suggestion.thinkingLevels;
        next.defaultReasoningEffort = defaultThinkingLevel(suggestion.thinkingLevels);
        changes.push('思考等级');
    }
    const pricing = suggestion.pricing;
    if (pricing && (pricing.input > 0 || pricing.output > 0)) {
        for (const { key, label } of CATALOG_PRICES) {
            const value = pricing[key];
            if (value === undefined || draft.pricing[key].trim()) continue;
            next.pricing[key] = String(value);
            changes.push(label);
        }
    }
    return { draft: next, changes };
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
            ]} className={`${SELECT_SM} w-28`} />
            {custom && <Input size="sm" type="number" inputMode="numeric" min={1024} aria-label="自定义上下文窗口" value={value}
                placeholder="例如 131072" onChange={event => onChange(event.target.value)} />}
        </div>
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
        <div className="ai-catalog-grid">
            <label className="ai-catalog-field"><span>上游模型 ID</span>
                <Input size="sm" className="ai-catalog-mono" spellCheck={false} value={source.modelIdOverride ?? ''} placeholder={modelKey || '与模型 ID 相同'}
                    onChange={event => onChange({ modelIdOverride: event.target.value || null })} />
            </label>
            {probe.models.length > 0 && <label className="ai-catalog-field"><span>从网关列表选择</span>
                <Select ariaLabel="从网关列表选择" value={source.modelIdOverride ?? ''} className={SELECT_SM}
                    onChange={value => onChange({ modelIdOverride: value || null })}
                    options={[
                        { value: '', label: `与模型 ID 相同${modelKey ? `（${modelKey}）` : ''}` },
                        ...models.map(model => ({ value: model, label: model })),
                    ]} />
            </label>}
        </div>
        {gateway?.apiKeyHint && <div className="ai-catalog-limit">
            <Button variant="ghost" size="xs" loading={probe.busy} loadingText={<><RefreshCw size={12} aria-hidden="true" />读取网关的模型列表</>} disabled={probe.busy} onClick={() => void load()}>
                {!probe.busy && <RefreshCw size={12} aria-hidden="true" />}读取网关的模型列表
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
    const [lookup, setLookup] = useState<{ busy: boolean; error: string | null; searched: boolean; models: ModelsDevSuggestion[]; filled: string[] }>(
        { busy: false, error: null, searched: false, models: [], filled: [] });
    const lookupSeq = useRef(0);
    const latestDraft = useRef(draft);
    const firstField = useRef<HTMLInputElement>(null);
    const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
    useUnsavedSettingsGuard(dirty);
    useEffect(() => { latestDraft.current = draft; }, [draft]);
    const patch = (change: Partial<Draft>) => { setDraft(current => ({ ...current, ...change })); setError(null); };
    const gatewayById = useMemo(() => new Map(gateways.map(gateway => [gateway.id, gateway])), [gateways]);
    const unused = gateways.filter(gateway => !draft.sources.some(source => source.gatewayId === gateway.id));
    const creating = !model;
    const savedKey = baseline.modelKey;
    const chat = draft.usageType === 'chat';
    const image = draft.usageType === 'image';

    const lookupModelsDev = useCallback(async (query: string) => {
        const seq = ++lookupSeq.current;
        if (query.length < 2) {
            setLookup({ busy: false, error: null, searched: false, models: [], filled: [] });
            return;
        }
        setLookup(current => ({ ...current, busy: true, error: null }));
        try {
            const result = await requestBrowserData<{ models: ModelsDevSuggestion[] }>(
                `/api/admin/models-dev?q=${encodeURIComponent(query)}`, undefined, { fallbackMessage: '查询 models.dev 失败' });
            if (seq !== lookupSeq.current) return;
            // 只在新建或改了模型 ID 时自动补：打开已有模型不改表单，已保存的选择（如关掉的图片输入）不会被翻回去。
            const exact = query !== savedKey ? result.models?.find(suggestion => suggestion.id.toLowerCase() === query.trim().toLowerCase()) : undefined;
            const fill = exact ? fillBlanks(latestDraft.current, exact, creating) : null;
            if (fill?.changes.length) setDraft(fill.draft);
            setLookup({ busy: false, error: null, searched: true, models: result.models ?? [], filled: fill?.changes ?? [] });
        } catch (e) {
            if (seq !== lookupSeq.current) return;
            setLookup({ busy: false, error: e instanceof Error ? e.message : '查询 models.dev 失败', searched: true, models: [], filled: [] });
        }
    }, [creating, savedKey]);

    // 模型 ID 停下 600ms 后查一次 models.dev；按钮可以立刻重查。新填的 ID 精确命中时只补空缺，其余结果点「填入」才写进表单。
    useEffect(() => {
        if (!chat) return;
        const timer = setTimeout(() => { void lookupModelsDev(draft.modelKey.trim()); }, 600);
        return () => clearTimeout(timer);
    }, [chat, draft.modelKey, lookupModelsDev]);

    // 「填入」是显式操作：目录里有的字段（含单价）都覆盖表单。
    const applyCatalog = (suggestion: ModelsDevSuggestion) => {
        const levels = suggestion.reasoning ? suggestion.thinkingLevels : [];
        const contextWindow = suggestion.contextWindow ? String(suggestion.contextWindow) : draft.contextWindow;
        const pricing = { ...draft.pricing };
        for (const { key } of CATALOG_PRICES) {
            const value = suggestion.pricing?.[key];
            if (value !== undefined) pricing[key] = String(value);
        }
        patch({
            contextWindow,
            ...(suggestion.maxTokens && fitsOutput(suggestion.maxTokens, contextWindow) ? { defaultMaxTokens: String(suggestion.maxTokens) } : {}),
            ...(draft.displayName ? {} : { displayName: suggestion.name }),
            thinkingLevels: levels,
            defaultReasoningEffort: defaultThinkingLevel(levels),
            isReasoningDefault: levels.length > 0 && draft.isReasoningDefault,
            supportsVision: suggestion.vision || draft.supportsVision,
            pricing,
        });
        setLookup(current => ({ ...current, filled: [] }));
        showToast('success', `已填入 ${suggestion.name} 的目录值`);
    };

    const toggleLevel = (level: AIReasoningEffort) => {
        const levels = draft.thinkingLevels.includes(level) ? draft.thinkingLevels.filter(item => item !== level) : [...draft.thinkingLevels, level];
        const ordered = AI_REASONING_EFFORTS.filter(item => levels.includes(item));
        // The default stays one of the listed levels.
        patch({
            thinkingLevels: ordered,
            defaultReasoningEffort: draft.defaultReasoningEffort && ordered.includes(draft.defaultReasoningEffort) ? draft.defaultReasoningEffort : defaultThinkingLevel(ordered),
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
    const setPrice = (key: PriceField, value: string) => patch({ pricing: { ...draft.pricing, [key]: value } });

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

    return <Dialog bare open onClose={close} busy={saving} labelledBy={titleId} initialFocusRef={firstField} className="ai-catalog-dialog ai-catalog-dialog-wide">
        <header className="ai-catalog-dialog-head">
            <div style={{ flex: 1, minWidth: 0 }}>
                <h2 id={titleId}>{model ? model.displayName : '添加模型'}</h2>
                {model && <p className="ai-catalog-mono">{model.modelKey}</p>}
            </div>
            <IconButton label="关闭" size="sm" onClick={close}><X size={16} aria-hidden="true" /></IconButton>
        </header>
        <div className="ai-catalog-dialog-body">
            <section className="ai-catalog-section" aria-labelledby={`${titleId}-basic`}>
                <header><h3 id={`${titleId}-basic`}>基本信息</h3><p>排序数值越小越靠前，第一个可用的对话模型是默认模型。</p></header>
                <div className="ai-catalog-identity">
                    <div className="ai-catalog-field"><span>图标</span>
                        <ModelIconPicker value={draft.icon} vendor={draft.vendor} onChange={icon => patch({ icon })} />
                    </div>
                    <label className="ai-catalog-field"><span>显示名称</span>
                        <Input size="sm" ref={firstField} value={draft.displayName} maxLength={80} placeholder="DeepSeek V4"
                            onChange={event => patch({ displayName: event.target.value })} />
                    </label>
                    <label className="ai-catalog-field"><span>模型 ID</span>
                        <Input size="sm" className="ai-catalog-mono" value={draft.modelKey} maxLength={200} spellCheck={false} autoCapitalize="off" placeholder="deepseek-v4"
                            onChange={event => patch({ modelKey: event.target.value.trim() })} />
                    </label>
                </div>
                <label className="ai-catalog-field">
                    <span>简介</span>
                    <Input size="sm" value={draft.description} maxLength={200} placeholder="一句话说明它擅长什么，显示在模型选择里"
                        onChange={event => patch({ description: event.target.value })} />
                </label>
                <div className="ai-catalog-meta-row">
                    <label className="ai-catalog-field"><span>供应商</span>
                        <Select ariaLabel="供应商" value={vendorMode} className={SELECT_SM} onChange={value => {
                            setVendorMode(value);
                            if (value !== CUSTOM_VENDOR) patch({ vendor: value });
                        }} options={[
                            ...VENDOR_PRESETS.map(vendor => ({ value: vendor, label: getVendorName(vendor) })),
                            { value: CUSTOM_VENDOR, label: '其他…' },
                        ]} />
                    </label>
                    {vendorMode === CUSTOM_VENDOR && <label className="ai-catalog-field"><span>供应商标识</span>
                        <Input size="sm" className="ai-catalog-mono" value={draft.vendor} maxLength={40} placeholder="mistral" onChange={event => patch({ vendor: event.target.value.trim() })} />
                    </label>}
                    <div className="ai-catalog-field ai-catalog-usage"><span>用途</span>
                        <SegmentedChoice ariaLabel="模型用途" value={draft.usageType} options={USAGE_TYPES} maxWidth={260}
                            onChange={usageType => patch({ usageType })} />
                    </div>
                    <label className="ai-catalog-field ai-catalog-sort"><span>排序</span>
                        <Input size="sm" type="number" value={draft.sortOrder} onChange={event => patch({ sortOrder: event.target.value })} />
                    </label>
                </div>
                {chat && <div className="ai-catalog-lookup">
                    <div className="ai-catalog-lookup-head">
                        <span>models.dev<small>按模型 ID 查上下文、输出上限、思考等级与单价；新填的 ID 精确命中时自动补空着的字段，点「填入」用目录值覆盖。</small></span>
                        <Button variant="ghost" size="xs" loading={lookup.busy} loadingText="查询中…"
                            disabled={draft.modelKey.trim().length < 2}
                            onClick={() => void lookupModelsDev(draft.modelKey.trim())}>
                            {!lookup.busy && <RefreshCw size={12} aria-hidden="true" />}查询
                        </Button>
                    </div>
                    {lookup.error && <span className="ai-catalog-hint">{lookup.error}</span>}
                    {lookup.filled.length > 0 && <span className="ai-catalog-hint" data-tone="accent">已补全空着的{lookup.filled.join('、')}，保存后生效。</span>}
                    {!lookup.busy && !lookup.error && lookup.models.length > 0 && <ul className="ai-catalog-lookup-list" aria-label="models.dev 匹配结果">
                        {lookup.models.slice(0, 6).map(suggestion => <li key={`${suggestion.provider}:${suggestion.id}`}>
                            <span className="ai-catalog-lookup-name"><strong>{suggestion.name}</strong><small>{suggestion.providerName} · {suggestion.id}</small></span>
                            <span className="ai-catalog-lookup-meta">
                                {suggestion.contextWindow ? `${formatTokenCount(suggestion.contextWindow)} 上下文` : '上下文未知'}
                                {suggestion.maxTokens ? ` · ${formatTokenCount(suggestion.maxTokens)} 输出` : ''}
                                {suggestion.reasoning ? ' · 思考' : ''}
                                {suggestion.vision ? ' · 图片' : ''}
                                {suggestion.pricing && <span className="ai-catalog-lookup-price" title="美元/百万 token：输入 / 输出">{catalogPriceLabel(suggestion.pricing)}</span>}
                            </span>
                            <Button variant="secondary" size="xs" onClick={() => applyCatalog(suggestion)}>填入</Button>
                        </li>)}
                    </ul>}
                    {!lookup.busy && !lookup.error && lookup.searched && lookup.models.length === 0 && <span className="ai-catalog-hint">models.dev 没有匹配；可以手填。</span>}
                </div>}
            </section>

            {image && <section className="ai-catalog-section" aria-labelledby={`${titleId}-image`}>
                <header><h3 id={`${titleId}-image`}>价格</h3><p>输入框的「生图」和 Agent 的 generate_image 用这个模型，按张计费；留空即未定价，填 0 为免费。</p></header>
                <div className="ai-catalog-grid" data-columns="4">
                    {priceFieldsFor(draft.usageType).map(field => <label key={field.key} className="ai-catalog-field"><span>{field.label}（{field.unit}）</span>
                        <Input size="sm" inputMode="decimal" value={draft.pricing[field.key]} placeholder="未定价" onChange={event => setPrice(field.key, event.target.value)} />
                    </label>)}
                </div>
            </section>}

            {chat && <section className="ai-catalog-section" aria-labelledby={`${titleId}-pricing`}>
                <header><h3 id={`${titleId}-pricing`}>价格</h3><p>美元/百万 token，推理计入输出；留空即未定价，输入输出都填 0 为免费，缓存价留空按输入价。</p></header>
                <div className="ai-catalog-grid" data-columns="4">
                    {priceFieldsFor(draft.usageType).map(field => <label key={field.key} className="ai-catalog-field"><span>{field.label}</span>
                        <Input size="sm" inputMode="decimal" value={draft.pricing[field.key]} placeholder={field.key.startsWith('cache') ? '按输入价' : '未定价'}
                            onChange={event => setPrice(field.key, event.target.value)} />
                    </label>)}
                </div>
            </section>}

            {chat && <section className="ai-catalog-section" aria-labelledby={`${titleId}-capability`}>
                <header><h3 id={`${titleId}-capability`}>能力</h3><p>Agent 按上下文窗口决定何时压缩对话；输入框的「努力程度」只列出勾选的思考等级，不勾选时不发送思考参数。</p></header>
                <div className="ai-catalog-grid">
                    <ContextWindowField value={draft.contextWindow} onChange={contextWindow => patch({ contextWindow })} />
                    <label className="ai-catalog-field"><span>输出上限{draft.defaultMaxTokens ? <span className="ai-catalog-hint"> · {formatTokenCount(Number(draft.defaultMaxTokens))}</span> : null}</span>
                        <Input size="sm" type="number" inputMode="numeric" min={1} aria-label="输出上限" value={draft.defaultMaxTokens}
                            placeholder="按模型默认" onChange={event => patch({ defaultMaxTokens: event.target.value })} />
                    </label>
                </div>
                <div className="ai-catalog-field">
                    <span>思考等级</span>
                    <div className="ai-catalog-limit" role="group" aria-label="可选思考等级">
                        {AI_REASONING_EFFORTS.map(level => <FilterChip key={level} className="ai-catalog-chip"
                            pressed={draft.thinkingLevels.includes(level)} onClick={() => toggleLevel(level)}>{THINKING_LEVEL_LABELS[level]}</FilterChip>)}
                    </div>
                </div>
                <div className="ai-catalog-grid">
                    {draft.thinkingLevels.length > 0 ? <label className="ai-catalog-field"><span>默认等级</span>
                        <Select ariaLabel="默认等级" value={draft.defaultReasoningEffort ?? ''} className={SELECT_SM}
                            onChange={value => patch({ defaultReasoningEffort: (value || null) as AIReasoningEffort | null })}
                            options={draft.thinkingLevels.map(level => ({ value: level, label: THINKING_LEVEL_LABELS[level] }))} />
                    </label> : <span aria-hidden="true" />}
                    <div className="ai-catalog-toggles">
                        <div className="ai-catalog-toggle">
                            <span>支持图片输入</span>
                            <SettingsSwitch label="支持图片输入" checked={draft.supportsVision} onToggle={() => patch({ supportsVision: !draft.supportsVision })} />
                        </div>
                        {draft.thinkingLevels.length > 0 && <div className="ai-catalog-toggle">
                            <span>默认开启思考</span>
                            <SettingsSwitch label="默认开启思考" checked={draft.isReasoningDefault} onToggle={() => patch({ isReasoningDefault: !draft.isReasoningDefault })} />
                        </div>}
                    </div>
                </div>
            </section>}

            <section className="ai-catalog-section" aria-labelledby={`${titleId}-sources`}>
                <header><h3 id={`${titleId}-sources`}>来源与故障转移</h3><p>按顺序请求；前一个来源在回复出现前失败时，换下一个。</p></header>
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
                    className={`${SELECT_SM} w-auto min-w-40 self-start`}
                />}
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
            <Button variant="ghost" size="md" disabled={saving} onClick={close}>取消</Button>
            <Button size="md" loading={saving} loadingText="正在保存…" disabled={saving || (!!model && !dirty)} onClick={() => void save()}>{model ? '保存' : '添加模型'}</Button>
        </footer>
        <ConfirmDialog isOpen={confirm !== null} onClose={() => setConfirm(null)} loading={saving}
            title={confirm === 'delete' ? `删除 ${model?.displayName ?? '模型'}？` : '放弃未保存的修改？'}
            description={confirm === 'delete' ? '用户的模型菜单里不再出现它；进行中的任务会失败。' : '关闭后，这次填写的内容不会保存。'}
            confirmText={confirm === 'delete' ? '删除' : '放弃修改'}
            onConfirm={() => (confirm === 'delete' ? remove() : onClose())} />
    </Dialog>;
}
