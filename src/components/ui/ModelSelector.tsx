'use client';
// 'use client'：模型菜单需要弹层、键盘导航与本机保存的自定义模型 Key

import { useMemo, useEffect, useState, type ReactNode } from 'react';
import { BetaBadge } from '@/components/ui/BetaBadge';
import { Check, ChevronDown, Cpu, Info } from 'lucide-react';
import { KeyIcon } from '@/lib/navigation/nav-icons';
import { SoundWaveLoader } from './SoundWaveLoader';
import { Menu, MenuCheckboxItem, MenuContent, MenuGroup, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from './Menu';
import { ModelIcon } from './ModelIcon';
import { preloadLobeIcons } from './LobeIcon';
import { useToast } from './Toast';
import { ByokKeyDialog } from '@/components/byok/ByokKeyDialog';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { useAvailableModels, type AvailableModel } from '@/lib/hooks/useAvailableModels';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { ownModelChoice, useOwnModels, type OwnModel } from '@/lib/byok/client';
import { byokComposerEffort, isByokRef } from '@/lib/byok/config';
import { BYOK_KEY_REQUEST_EVENT } from '@/lib/byok/key-request';
import { openSettingsCenter } from '@/lib/settings-center';
import type { AIVendor, AIReasoningEffort } from '@/types';
import { resolveThinkingLevel } from '@/lib/ai/thinking';
import { type ModelSettingsProps, type AgentCollaborator } from '@/lib/chat/model-settings';
import { useCollaborationPreset } from '@/lib/chat/collaboration-preset';
import { formatPrice } from '@/lib/billing/money';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

interface ClientModelConfig {
    id: string; name: string; description?: string | null; vendor: AIVendor; icon?: string | null; supportsReasoning: boolean;
    thinkingLevels?: AIReasoningEffort[]; defaultThinkingLevel?: AIReasoningEffort | null;
    isReasoningDefault?: boolean; pricing?: AvailableModel['pricing'];
    contextWindow?: number | null; maxTokens?: number | null; supportsVision?: boolean;
    /** The member's own model behind this row. */
    own?: OwnModel;
}
/** 多模型协作的成员上限：0–4 个，主模型不占名额。 */
const MAX_COLLABORATORS = 4;
interface ModelSelectorProps extends ModelSettingsProps {
    selectedModel?: string; onModelChange?: (modelId: string) => void;
    reasoningEnabled?: boolean; onReasoningChange?: (enabled: boolean) => void;
    userId?: string | null; disabled?: boolean;
    compact?: boolean; toolbarStyle?: boolean;
    /** Extra menu rows rendered after the root items. */
    extra?: ReactNode;
    /** Offers 「使用自己的模型 API」, which opens the own-model settings. */
    ownModelsEntry?: boolean;
    /** True when the lists settled with nothing selectable and the own-model API is available. */
    onEmptyChange?: (empty: boolean) => void;
    /** A guest picking the own-model entry: ask them to sign in first. */
    onLoginRequired?: () => void;
}

/** `1M` / `128K` / `8,000`: how a capacity reads in the model details. */
function formatCapacity(value: number | null | undefined): string {
    if (!value) return '未设置';
    if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
    if (value >= 1_000) return `${Math.round(value / 1000)}K`;
    return String(value);
}

/** The card behind a model row's info icon: context, limits, prices and abilities. */
function ModelDetails({ model }: { model: ClientModelConfig }) {
    const pricing = model.pricing;
    const priceRows = pricing ? [
        { label: '输入', value: pricing.input },
        { label: '输出', value: pricing.output },
        { label: '缓存读', value: pricing.cacheRead },
        { label: '缓存写', value: pricing.cacheWrite },
    ].filter(row => row.value !== null && row.value !== undefined) : [];
    const free = !!pricing && priceRows.every(row => !row.value);
    return (
        <div className="chat-model-details">
            <div className="chat-model-details-head">
                <ModelIcon icon={model.icon} vendor={model.vendor} size={18} />
                <div className="min-w-0">
                    <p className="chat-model-details-name">{model.name}</p>
                    <p className="chat-model-details-id">{model.own ? `${model.own.connection.name} · ${model.own.modelId}` : model.id}</p>
                </div>
            </div>
            {model.description ? <p className="chat-model-details-desc">{model.description}</p> : null}
            <dl className="chat-model-details-grid">
                <div><dt>上下文</dt><dd>{formatCapacity(model.contextWindow)}</dd></div>
                <div><dt>输出上限</dt><dd>{formatCapacity(model.maxTokens)}</dd></div>
                <div><dt>图片输入</dt><dd>{model.supportsVision ? '支持' : '不支持'}</dd></div>
                <div><dt>思考等级</dt><dd>{model.thinkingLevels?.length ? model.thinkingLevels.map(level => level === 'minimal' ? '最低' : level === 'low' ? '低' : level === 'medium' ? '中等' : level === 'high' ? '高' : level === 'xhigh' ? '极高' : '最高').join(' / ') : '不支持'}</dd></div>
            </dl>
            <div className="chat-model-details-prices">
                {model.own ? <p className="chat-model-details-desc">使用自己的 API Key。</p> : <>
                    <p className="chat-model-details-label">每百万 token 的美元单价</p>
                    {priceRows.length ? (
                        <dl className="chat-model-details-grid">
                            {priceRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{free ? '免费' : formatPrice(row.value as number)}</dd></div>)}
                        </dl>
                    ) : <p className="chat-model-details-desc">未定价</p>}
                </>}
            </div>
        </div>
    );
}

/** 思考强度档位（claude 同构）；菜单只列出当前模型支持的档位，「推荐」标在模型的默认档上。 */
const EFFORT_OPTIONS: Array<{ value: AIReasoningEffort; label: string; badge?: string; tone?: 'warning' }> = [
    { value: 'minimal', label: '最低' },
    { value: 'low', label: '低' },
    { value: 'medium', label: '中等' },
    { value: 'high', label: '高' },
    { value: 'xhigh', label: '极高' },
    { value: 'max', label: '最高', badge: '3.5× 或更多用量', tone: 'warning' },
];

function effortLabel(effort: AIReasoningEffort | null | undefined, enabled: boolean): string {
    if (!enabled) return '关';
    if (!effort) return '默认';
    return EFFORT_OPTIONS.find(option => option.value === effort)?.label ?? '默认';
}

/** The level a chosen effort runs at on this model (the server moves an unlisted one to the nearest listed level). */
function modelEffort(model: ClientModelConfig | undefined, effort: AIReasoningEffort | null | undefined): AIReasoningEffort | null {
    if (!effort || !model?.thinkingLevels?.length) return null;
    return resolveThinkingLevel({ thinkingLevels: model.thinkingLevels, defaultReasoningEffort: model.defaultThinkingLevel ?? undefined }, effort);
}

/** What the reasoning setting reads as next to the model name, e.g. 高（claude 实测只显示档位，不加「推理」前缀）. */
function reasoningSummary(model: ClientModelConfig | undefined, enabled: boolean, effort: AIReasoningEffort | null | undefined, levels: boolean): string | null {
    if (!model?.supportsReasoning) return null;
    if (!enabled) return '关';
    if (!levels || !model.thinkingLevels?.length) return '开';
    return effortLabel(modelEffort(model, effort), enabled);
}

/** Own models by connection, in the order the settings page lists them. */
function groupByConnection(models: ClientModelConfig[]) {
    const groups = new Map<string, { name: string; models: ClientModelConfig[] }>();
    for (const model of models) {
        if (!model.own) continue;
        const group = groups.get(model.own.connection.id) ?? { name: model.own.connection.name, models: [] };
        group.models.push(model);
        groups.set(model.own.connection.id, group);
    }
    return [...groups.entries()].map(([id, group]) => ({ id, ...group }));
}

export function ModelSelector({ selectedModel = DEFAULT_MODEL_ID, onModelChange, reasoningEnabled = false, onReasoningChange,
    reasoningEffort, onReasoningEffortChange, reasoningFromModel = false, onReasoningFromModelChange, collaborators = [], onCollaboratorsChange, extra, ownModelsEntry = false,
    onEmptyChange, onLoginRequired, userId, disabled = false, compact = false, toolbarStyle = false }: ModelSelectorProps) {
    const [open, setOpen] = useState(false);
    const { showToast } = useToast();
    const query = useAvailableModels(userId ?? null, { enabled: !!onModelChange });
    const own = useOwnModels(onModelChange ? userId : null);
    const features = useFeatureToggles();
    const platformModels = useMemo(() => (query.data ?? []) as ClientModelConfig[], [query.data]);
    // 平台模型在上，自己的对话模型按连接分组排在后面。
    const ownChoices = useMemo<ClientModelConfig[]>(() => own.models.filter(model => model.usage === 'chat').map(ownModelChoice), [own.models]);
    const models = useMemo(() => [...platformModels, ...ownChoices], [platformModels, ownChoices]);
    const ownGroups = useMemo(() => groupByConnection(ownChoices), [ownChoices]);
    useEffect(() => { preloadLobeIcons(models.map(model => model.icon)); }, [models]);
    const collaborationPreset = useCollaborationPreset(userId ?? null);
    const [keyModel, setKeyModel] = useState<OwnModel | null>(null);
    // A missing own model may only still be loading, or its list failed to load: it is replaced once its absence is known.
    const listsSettled = !query.isLoading && !own.loading && !own.failed;
    // Nothing to pick and the member can bring their own key: the trigger itself becomes the BYOK entry.
    // Guests see the same entry when the feature is on; it asks them to sign in first.
    const byokEntry = own.enabled || (!userId && features.isFeatureEnabled('byok'));
    const byokEntryPending = !userId && features.isLoading;
    const emptyForOwnApi = listsSettled && !byokEntryPending && !query.error && byokEntry && models.length === 0;
    // While nothing is selectable, both lists decide the empty state; a settled platform model never waits for BYOK.
    const emptyLoading = query.isLoading || (!models.length && (own.loading || byokEntryPending));
    useEffect(() => { onEmptyChange?.(emptyForOwnApi); }, [emptyForOwnApi, onEmptyChange]);
    useEffect(() => {
        if (!models.length || !onModelChange || !listsSettled) return;
        if (models.some(model => model.id === selectedModel)) return;
        const fallback = platformModels[0] ?? models[0];
        if (fallback.id === selectedModel) return;
        if (isByokRef(selectedModel)) showToast('info', `所选的自定义模型已不可用，已改用「${fallback.name}」`);
        onModelChange(fallback.id);
    }, [listsSettled, models, onModelChange, platformModels, selectedModel, showToast]);
    const current = models.find(model => model.id === selectedModel) ?? models[0];
    const reasoningSupported = !!current?.supportsReasoning;
    useEffect(() => {
        if (!current || !onReasoningChange) return;
        if (!reasoningSupported) {
            if (reasoningEnabled) onReasoningChange(false);
            if (reasoningEffort) onReasoningEffortChange?.(null);
        } else if (current.isReasoningDefault && !reasoningEnabled) onReasoningChange(true);
    }, [current, reasoningSupported, reasoningEnabled, reasoningEffort, onReasoningChange, onReasoningEffortChange]);
    // 主模型只负责汇总，不作为协作成员：切换主模型时把旧主模型从成员里剔除；已删除的自定义模型也一并去掉。
    const subCollaborators = useMemo(() => collaborators.filter(member => member.model !== current?.id
        && (!listsSettled || !isByokRef(member.model) || ownChoices.some(model => model.id === member.model))), [collaborators, current?.id, listsSettled, ownChoices]);
    useEffect(() => {
        if (!current || collaborators.length === subCollaborators.length) return;
        onCollaboratorsChange?.(subCollaborators);
    }, [current, collaborators, subCollaborators, onCollaboratorsChange]);
    // 发送时发现缺 Key：由提示条里的「填写 Key」打开这里的对话框。
    useEffect(() => {
        if (!onModelChange) return;
        const request = (event: Event) => {
            const model = own.models.find(item => item.ref === (event as CustomEvent<string>).detail);
            if (model) setKeyModel(model);
        };
        window.addEventListener(BYOK_KEY_REQUEST_EVENT, request);
        return () => window.removeEventListener(BYOK_KEY_REQUEST_EVENT, request);
    }, [onModelChange, own.models]);
    useEffect(() => {
        const ownModel = current?.own;
        if (!reasoningFromModel || !ownModel || !onReasoningChange) return;
        const effort = byokComposerEffort(ownModel.defaultEffort);
        if (reasoningEnabled === effort.reasoning && (reasoningEffort ?? null) === effort.reasoningEffort) return;
        onReasoningChange(effort.reasoning);
        onReasoningEffortChange?.(effort.reasoningEffort);
    }, [current, reasoningEnabled, reasoningEffort, reasoningFromModel, onReasoningChange, onReasoningEffortChange]);
    if (!onModelChange && !onReasoningChange) return null;
    // 没有平台模型时仍然可以打开菜单：自己的模型不依赖平台模型目录。
    const locked = disabled || emptyLoading;
    const summary = reasoningSummary(current, reasoningEnabled, reasoningEffort, !!onReasoningEffortChange);
    const emptyLabel = emptyLoading ? '正在加载模型' : emptyForOwnApi ? '使用自己的模型 API' : '暂无可用模型';
    const label = `选择模型：${current?.name ?? emptyLabel}${toolbarStyle && summary ? ` · ${summary}` : ''}`;
    const close = () => setOpen(false);
    const openOwnModelSettings = () => {
        if (!userId) { onLoginRequired?.(); return; }
        openSettingsCenter('byok');
    };
    /** Own models start at their own default effort; one without a key on this device asks for it first. */
    const applyModel = (model: ClientModelConfig) => {
        onModelChange?.(model.id);
        if (!model.own) { onReasoningFromModelChange?.(false); return; }
        const effort = byokComposerEffort(model.own.defaultEffort);
        onReasoningChange?.(effort.reasoning);
        onReasoningEffortChange?.(effort.reasoningEffort);
        onReasoningFromModelChange?.(true);
    };
    const chooseModel = (id: string) => {
        const model = models.find(item => item.id === id);
        if (!model) return;
        if (model.own && !model.own.ready) { setKeyModel(model.own); return; }
        applyModel(model);
    };
    const effortSupported = reasoningSupported && !!current.thinkingLevels?.length && !!onReasoningEffortChange;
    const effectiveEffort = modelEffort(current, reasoningEffort);
    const effortOptions = EFFORT_OPTIONS.filter(option => current?.thinkingLevels?.includes(option.value));
    const recommendedEffort = current?.defaultThinkingLevel ?? (current?.thinkingLevels?.includes('medium') ? 'medium' : null);
    const collaborationEnabled = subCollaborators.length > 0;
    // 协作成员 0–4 个：满员后未选中的模型不可再加入（主模型不占名额）。
    const collaborationFull = subCollaborators.length >= MAX_COLLABORATORS;
    const toggleCollaborator = (model: ClientModelConfig) => {
        if (!onCollaboratorsChange) return;
        const existing = collaborators.find(member => member.model === model.id);
        if (!existing && collaborationFull) return;
        // 个性化里为该模型配置过的名称、角色、思考强度与分工作为模板；勾选只影响当前对话，不改设置。
        const template = collaborationPreset.members.find(member => member.model === model.id);
        const ownEffort = model.own ? byokComposerEffort(model.own.defaultEffort) : null;
        const next = existing
            ? collaborators.filter(member => member.model !== model.id)
            : [...collaborators, {
                id: crypto.randomUUID(),
                name: template?.name ?? model.name,
                model: model.id,
                focus: template?.focus ?? '',
                reasoning: template?.reasoning ?? ownEffort?.reasoning ?? !!model.isReasoningDefault,
                reasoningEffort: template?.reasoningEffort ?? ownEffort?.reasoningEffort ?? null,
                ...(template?.profile ? { profile: template.profile } : {}),
            } satisfies AgentCollaborator];
        onCollaboratorsChange(next);
    };
    const effortChoice = !reasoningEnabled ? 'off' : effectiveEffort ?? 'default';
    const chooseEffort = (effort: AIReasoningEffort | null) => {
        onReasoningFromModelChange?.(false);
        onReasoningChange?.(true);
        onReasoningEffortChange?.(effort);
        close();
    };
    const modelRow = (model: ClientModelConfig) => {
        let infoButton: HTMLButtonElement | null = null;
        return <MenuRadioItem key={model.id} value={model.id} closeOnClick hideIndicator className="chat-model-option-row">
        <ModelIcon icon={model.icon} vendor={model.vendor} size={16} />
        <span className="chat-model-option-text" title={model.description || undefined}>
            <span className="chat-model-option-name">{model.name}{model.own && !model.own.ready && <span className="chat-model-badge" data-tone="warning">需填 Key</span>}</span>
            {model.description ? <span className="chat-model-option-desc">{model.description}</span> : null}
        </span>
        {model.id === selectedModel && <Check className="chat-model-selected-check" size={14} aria-hidden="true" />}
        {/* 详情弹层：点图标只开卡片，不选中这一行；卡片贴主菜单左侧展开，不盖住模型列表。 */}
        <Popover>
            <PopoverTrigger ref={node => { infoButton = node; }} className="chat-model-info" aria-label={`「${model.name}」的详情`}
                onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
                <Info size={13} aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent side="left" align="start" sideOffset={8} className="chat-model-details-popover"
                anchor={() => infoButton?.closest<HTMLElement>('.chat-model-menu') ?? null}>
                <ModelDetails model={model} />
            </PopoverContent>
        </Popover>
    </MenuRadioItem>;
    };
    return <div className={`flex items-center ${toolbarStyle ? 'chat-model-selector' : ''}`}>
        <Menu open={open} onOpenChange={next => {
            // No models at all: the trigger is a shortcut to the own-model settings instead of an empty menu.
            if (next && emptyForOwnApi) { openOwnModelSettings(); return; }
            setOpen(next);
        }}>
            {toolbarStyle ? <MenuTrigger disabled={locked} className="chat-model-trigger" data-model-trigger
                aria-label={label}>
                {emptyLoading ? <SoundWaveLoader variant="inline" /> : current ? <ModelIcon icon={current.icon} vendor={current.vendor} size={16} />
                    : emptyForOwnApi ? <KeyIcon size={16} /> : null}
                <span className="chat-model-name">{current?.name ?? emptyLabel}</span>
                {summary && <span className="chat-model-hint">{summary}</span>}
                <ChevronDown size={14} aria-hidden="true" />
            </MenuTrigger> : <MenuTrigger disabled={locked} data-model-trigger
                className={`chat-model-picker flex items-center gap-1.5 rounded-xl px-2 transition-colors ${compact ? 'py-1 text-xs' : 'h-9 text-sm'} ${locked ? 'cursor-not-allowed opacity-50' : 'text-foreground-secondary hover:text-foreground'}`}
                aria-label={label}>
                {emptyLoading ? <SoundWaveLoader variant="inline" /> : current ? <ModelIcon icon={current.icon} vendor={current.vendor} />
                    : emptyForOwnApi ? <KeyIcon size={16} /> : <Cpu size={16} />}
                <span className={`chat-model-name truncate ${compact ? 'max-w-[104px]' : 'max-w-[125px]'}`}>{current?.name ?? emptyLabel}</span>
                <ChevronDown size={16} className={open ? 'rotate-180' : undefined} />
            </MenuTrigger>}
            <MenuContent side="top" align={toolbarStyle ? 'end' : 'start'} sideOffset={6} className="chat-model-menu" aria-label="模型与分析设置">
                <MenuRadioGroup className="chat-model-options" aria-label="选择模型" value={selectedModel ?? ''} onValueChange={value => chooseModel(String(value))}>
                    {platformModels.map(modelRow)}
                    {ownGroups.map(group => <MenuGroup key={group.id} label={group.name}>{group.models.map(modelRow)}</MenuGroup>)}
                </MenuRadioGroup>
                {!models.length && !emptyLoading && <p className="chat-model-note">{emptyForOwnApi ? '没有可用的平台模型，可使用自己的模型 API。' : '暂无可用模型。'}</p>}
                {reasoningSupported && <MenuSeparator className="chat-model-separator" />}
                {reasoningSupported && (effortSupported
                    ? <MenuSub>
                        <MenuSubTrigger className="chat-model-action chat-model-menu-row">
                            <span>思考强度</span><span className="chat-model-menu-value">{effortLabel(effectiveEffort, reasoningEnabled)}</span>
                        </MenuSubTrigger>
                        <MenuSubContent side="left" sideOffset={8} className="chat-model-menu chat-effort-menu" aria-label="思考强度">
                            <p className="chat-model-note chat-model-effort-note">投入程度越高，回复越详尽，但耗时越长，用量与费用也越高。</p>
                            <MenuRadioGroup value={effortChoice} onValueChange={value => {
                                if (value === 'off') { onReasoningFromModelChange?.(false); onReasoningChange?.(false); close(); return; }
                                chooseEffort(value === 'default' ? null : value as AIReasoningEffort);
                            }}>
                                {effortOptions.map(option => {
                                    const badge = option.value === recommendedEffort ? '推荐' : option.badge;
                                    return <MenuRadioItem key={option.value} value={option.value} className="chat-model-action chat-model-menu-row" closeOnClick>
                                        <span>{option.label}{badge && <span className="chat-model-badge" data-tone={badge === option.badge ? option.tone : undefined} aria-hidden="true">{badge}</span>}</span>
                                    </MenuRadioItem>;
                                })}
                                <MenuRadioItem value="default" className="chat-model-action chat-model-menu-row" closeOnClick><span>模型默认</span></MenuRadioItem>
                                {!current?.isReasoningDefault && <MenuRadioItem value="off" className="chat-model-action chat-model-menu-row" closeOnClick><span>关闭推理</span></MenuRadioItem>}
                            </MenuRadioGroup>
                        </MenuSubContent>
                    </MenuSub>
                    : <MenuCheckboxItem checked={reasoningEnabled} className="chat-model-action chat-model-menu-row"
                        onCheckedChange={() => { onReasoningFromModelChange?.(false); onReasoningChange?.(!reasoningEnabled); }}>
                        <span>推理</span>
                    </MenuCheckboxItem>)}
                {!reasoningSupported && onReasoningEffortChange && <MenuItem className="chat-model-action chat-model-menu-row" disabled>
                    <span>思考强度</span><span className="chat-model-menu-value">不支持</span>
                </MenuItem>}
                {onCollaboratorsChange && <MenuSub>
                    <MenuSubTrigger className="chat-model-action chat-model-menu-row" disabled={disabled || !models.length}>
                        <span>多模型协作<BetaBadge /></span>{collaborationEnabled && <span className="chat-model-menu-value">{subCollaborators.length}</span>}
                    </MenuSubTrigger>
                    <MenuSubContent side="left" sideOffset={8} className="chat-model-menu chat-collab-menu" aria-label="多模型协作">
                        <p className="chat-collab-note">子模型可在个性化设置思考强度</p>
                        {models.filter(model => model.id !== current?.id).map(model => {
                            const checked = collaborators.some(member => member.model === model.id);
                            // 右侧 = 个性化里为该模型注册的名称（如「专项分析」），未注册时不显示。
                            const registered = collaborationPreset.members.find(member => member.model === model.id)?.name ?? '';
                            const needsKey = !!model.own && !model.own.ready;
                            const full = collaborationFull && !checked;
                            return <MenuCheckboxItem key={model.id} checked={checked} closeOnClick={false} disabled={full || (needsKey && !checked)}
                                className="chat-model-action chat-collab-row" onCheckedChange={() => toggleCollaborator(model)}>
                                <span className="chat-collab-icon"><ModelIcon icon={model.icon} vendor={model.vendor} size={16} /></span>
                                <span className="chat-collab-name">{model.name}</span>
                                {needsKey ? <span className="chat-collab-registered" aria-hidden="true">需填 Key</span>
                                    : registered && <span className="chat-collab-registered" aria-hidden="true">{registered}</span>}
                            </MenuCheckboxItem>;
                        })}
                        {subCollaborators.length > 0 && <p className="chat-collab-foot">已选 {subCollaborators.length} 个协作模型</p>}
                    </MenuSubContent>
                </MenuSub>}
                {extra}
                {ownModelsEntry && own.enabled && <>
                    <MenuSeparator className="chat-model-separator" />
                    <MenuItem className="chat-model-action" onClick={() => { close(); openOwnModelSettings(); }}><KeyIcon size={16} />使用自己的模型 API</MenuItem>
                </>}
                {query.error && <p className="chat-model-note" role="alert">{query.error instanceof Error ? query.error.message : '模型列表加载失败'}</p>}
            </MenuContent>
        </Menu>
        {userId && <ByokKeyDialog model={keyModel} userId={userId} onClose={() => setKeyModel(null)} onSaved={model => {
            setKeyModel(null);
            const choice = ownChoices.find(item => item.id === model.ref);
            if (choice && choice.id !== selectedModel) applyModel(choice);
        }} />}
    </div>;
}
