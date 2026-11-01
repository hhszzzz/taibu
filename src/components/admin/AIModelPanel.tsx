/**
 * AI 模型目录：按用途分组的紧凑列表，一行看清上下文、输出上限、思考等级、来源与会员；点开在弹层里编辑。
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Eye, Plus, Search, Sparkles } from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Dialog';
import { ModelIcon } from '@/components/ui/ModelIcon';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { useListMotion } from '@/lib/motion/list';
import { THINKING_LEVEL_LABELS, USAGE_TYPES, formatTokenCount, priceFieldsFor, type AdminGateway, type AdminModel } from '@/lib/admin/ai-catalog';
import { formatPrice } from '@/lib/billing/money';
import { isFreeTextModel, isImagePriced, isTextPriced } from '@/lib/billing/pricing';
import { AIModelEditor } from './AIModelEditor';
import './ai-catalog.css';
import { Input } from '@/components/ui/Input';

/** The row's price tag: unpriced models are not offered, free ones need no balance. */
function priceTagOf(model: AdminModel): { label: string; tone?: 'free' | 'unpriced' } | null {
    if (!priceFieldsFor(model.usageType).length) return null;
    if (model.usageType === 'image') {
        if (!isImagePriced(model.pricing)) return { label: '未定价', tone: 'unpriced' };
        return model.pricing.image ? { label: `${formatPrice(model.pricing.image)} / 张` } : { label: '免费', tone: 'free' };
    }
    if (!isTextPriced(model.pricing)) return { label: '未定价', tone: 'unpriced' };
    if (isFreeTextModel(model.pricing)) return { label: '免费', tone: 'free' };
    return { label: `${formatPrice(model.pricing.input as number)} / ${formatPrice(model.pricing.output as number)}` };
}

function PriceTag({ model }: { model: AdminModel }) {
    const tag = priceTagOf(model);
    const title = !tag?.tone && model.usageType !== 'image' ? '输入 / 输出，美元每百万 token' : undefined;
    return tag ? <span className="ai-catalog-price" data-tone={tag.tone} title={title}>{tag.label}</span> : null;
}

function ModelMeta({ model, gateways }: { model: AdminModel; gateways: ReadonlyMap<string, AdminGateway> }) {
    const callable = model.sources.filter(source => source.isEnabled && gateways.get(source.gatewayId)?.isEnabled && gateways.get(source.gatewayId)?.apiKeyHint);
    const names = model.sources.map(source => gateways.get(source.gatewayId)?.displayName).filter(Boolean);
    const usage = USAGE_TYPES.find(item => item.value === model.usageType)?.label;
    return <span className="ai-catalog-row-meta">
        {model.usageType !== 'chat' && <span>{usage}</span>}
        {(model.usageType === 'chat') && <span>
            {model.contextWindow ? `${formatTokenCount(model.contextWindow)} 上下文` : '未设上下文'} · {model.defaultMaxTokens ? `${formatTokenCount(model.defaultMaxTokens)} 输出` : '不限输出'}
        </span>}
        {model.thinkingLevels.length > 0 && <span>思考 {model.thinkingLevels.map(level => THINKING_LEVEL_LABELS[level]).join('/')}</span>}
        {model.supportsVision && <span><Eye size={12} aria-label="支持图片" style={{ display: 'inline', verticalAlign: '-1px' }} /></span>}
        <span data-tone={callable.length ? undefined : 'warning'}>{names.length ? names.join(' → ') : '没有来源'}{names.length && !callable.length ? '（不可用）' : ''}</span>
    </span>;
}

type AutofillResult = {
    updated: Array<{ name: string; changes: string[]; source: string }>;
    unchanged: number;
    unmatched: string[];
    failed: Array<{ name: string; error: string }>;
};

/** What one-click fill changed, and which models it could not match or save. */
function AutofillReport({ result, onClose }: { result: AutofillResult; onClose: () => void }) {
    const failed = result.failed.length ? `，${result.failed.length} 个保存失败` : '';
    return <Dialog open onClose={onClose} className="max-w-lg" title="models.dev 补全结果"
        description={`补全 ${result.updated.length} 个，${result.unchanged} 个没有空缺，${result.unmatched.length} 个未匹配${failed}。`}
        footer={<Button size="md" onClick={onClose}>知道了</Button>}>
        <div className="ai-catalog-report">
            {result.updated.length > 0 && <section><h3>已补全</h3><ul>
                {result.updated.map((item, index) => <li key={`${item.name}-${index}`}><strong>{item.name}</strong><span>{item.changes.join('、')}</span><small>{item.source}</small></li>)}
            </ul></section>}
            {result.failed.length > 0 && <section><h3>保存失败</h3><ul>
                {result.failed.map((item, index) => <li key={`${item.name}-${index}`} data-tone="danger"><strong>{item.name}</strong><span>{item.error}</span></li>)}
            </ul></section>}
            {result.unmatched.length > 0 && <section><h3>models.dev 里没找到</h3><p>按模型 ID、上游模型 ID 与显示名精确匹配；可以在编辑器里查询相近的条目后填入。</p><ul>
                {result.unmatched.map((name, index) => <li key={`${name}-${index}`}><strong>{name}</strong></li>)}
            </ul></section>}
        </div>
    </Dialog>;
}

export function AIModelPanel() {
    const [models, setModels] = useState<AdminModel[] | null>(null);
    const [gateways, setGateways] = useState<AdminGateway[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [editing, setEditing] = useState<{ model: AdminModel | null } | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);
    const [autofill, setAutofill] = useState<'confirm' | 'running' | null>(null);
    const [report, setReport] = useState<AutofillResult | null>(null);
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

    const runAutofill = async () => {
        setAutofill('running');
        try {
            const result = await requestBrowserData<AutofillResult>('/api/admin/ai-models/autofill', { method: 'POST' }, { fallbackMessage: '从 models.dev 补全失败' });
            showToast('success', result.updated.length ? `已补全 ${result.updated.length} 个模型` : '没有可从 models.dev 补全的空缺');
            if (result.updated.length || result.unmatched.length || result.failed.length) setReport(result);
            void load();
        } catch (e) {
            showToast('error', e instanceof Error ? e.message : '从 models.dev 补全失败');
        } finally {
            setAutofill(null);
        }
    };

    if (!models && !error) return <div className="flex min-h-[200px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
    return <div className="ai-catalog">
        <div className="ai-catalog-toolbar">
            <Input className="ai-catalog-search"  type="search" aria-label="搜索模型" value={query}
                placeholder={`搜索 ${models?.length ?? 0} 个模型`} onChange={event => setQuery(event.target.value)} />
            <span style={{ flex: 1 }} />
            <Button variant="secondary" size="sm" disabled={!models?.length || autofill === 'running'} onClick={() => setAutofill('confirm')}>
                <Sparkles size={14} aria-hidden="true" />从 models.dev 补全
            </Button>
            <Button size="sm" onClick={() => setEditing({ model: null })}>
                <Plus size={14} aria-hidden="true" />添加模型
            </Button>
        </div>
        {error && <div className="settings-alert" role="alert"><span>{error}</span><Button variant="ghost" size="xs" onClick={() => void load()}>重试</Button></div>}
        {models && !visible.length ? <div className="ai-catalog-list"><div className="ai-catalog-empty">
            {query ? <><Search size={20} aria-hidden="true" /><strong>没有匹配「{query}」的模型</strong></>
                : <><Boxes size={22} aria-hidden="true" /><strong>还没有模型</strong><span>先在「网关管理」添加网关，再添加模型并选择来源。</span></>}
        </div></div> : <div className="ai-catalog-list" ref={listRef}>
            {rows.map(({ key, item: model }) => <div key={key} data-motion-key={key} className="ai-catalog-row" data-disabled={!model.isEnabled || undefined}>
                <Button unstyled type="button" className="ai-catalog-row-main" onClick={() => setEditing({ model })} aria-label={`编辑 ${model.displayName}`}>
                    <span className="ai-catalog-row-icon"><ModelIcon icon={model.icon} vendor={model.vendor} size={16} /></span>
                    <span className="ai-catalog-row-text">
                        <span className="ai-catalog-row-title"><strong>{model.displayName}</strong><span className="ai-catalog-mono">{model.modelKey}</span></span>
                        <ModelMeta model={model} gateways={gatewayById} />
                    </span>
                </Button>
                <span className="ai-catalog-row-side">
                    <PriceTag model={model} />
                    <SettingsSwitch label={`启用 ${model.displayName}`} checked={model.isEnabled} disabled={updating === model.id} onToggle={() => void toggle(model)} />
                </span>
            </div>)}
        </div>}
        {editing && <AIModelEditor key={editing.model?.id ?? 'new'} model={editing.model} gateways={gateways}
            onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
        <ConfirmDialog isOpen={autofill !== null} onClose={() => setAutofill(null)} loading={autofill === 'running'} variant="default"
            title="从 models.dev 补全模型信息？"
            description="逐个对话模型按 ID 精确匹配 models.dev，只填空着的上下文、输出上限、思考等级、图片输入与单价，已填的值不变；目录价格全为 0 的不补单价。"
            confirmText="开始补全" onConfirm={() => void runAutofill()} />
        {report && <AutofillReport result={report} onClose={() => setReport(null)} />}
    </div>;
}
