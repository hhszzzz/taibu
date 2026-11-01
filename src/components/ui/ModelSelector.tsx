'use client';
// 'use client'：模型菜单需要弹层、键盘导航与浏览器内的自定义模型状态

import { useMemo, useEffect, useState, type ReactNode } from 'react';
import { BetaBadge } from '@/components/ui/BetaBadge';
import { ChevronDown, Cpu } from 'lucide-react';
import { KeyIcon } from '@/lib/navigation/nav-icons';
import { SoundWaveLoader } from './SoundWaveLoader';
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from './Menu';
import { ModelIcon } from './ModelIcon';
import { preloadLobeIcons } from './LobeIcon';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { useAvailableModels, type AvailableModel } from '@/lib/hooks/useAvailableModels';
import { CUSTOM_PROVIDER_CHANGED_EVENT, getCustomProvider, getCustomProviderDisplayName } from '@/lib/chat/custom-provider';
import type { AIVendor, AIReasoningEffort } from '@/types';
import { resolveThinkingLevel } from '@/lib/ai/thinking';
import { type ModelSettingsProps, type AgentCollaborator } from '@/lib/chat/model-settings';
import { useCollaborationPreset } from '@/lib/chat/collaboration-preset';
import { formatTokenPrices } from '@/lib/billing/format';

interface ClientModelConfig {
    id: string; name: string; vendor: AIVendor; icon?: string | null; supportsReasoning: boolean;
    thinkingLevels?: AIReasoningEffort[]; defaultThinkingLevel?: AIReasoningEffort | null;
    isReasoningDefault?: boolean; pricing?: AvailableModel['pricing'];
}
/** 多模型协作的成员上限：0–4 个，主模型不占名额。 */
const MAX_COLLABORATORS = 4;
interface ModelSelectorProps extends ModelSettingsProps {
    selectedModel?: string; onModelChange?: (modelId: string) => void;
    reasoningEnabled?: boolean; onReasoningChange?: (enabled: boolean) => void;
    userId?: string | null; disabled?: boolean;
    compact?: boolean; toolbarStyle?: boolean;
    /** Extra menu rows rendered after the root items, such as custom-provider shortcuts. */
    extra?: ReactNode;
    /** Offers the bring-your-own-model dialog from the menu. */
    onCustomProvider?: () => void;
}

/** 努力程度档位（claude 同构）；菜单只列出当前模型支持的档位，「推荐」标在模型的默认档上。 */
const EFFORT_OPTIONS: Array<{ value: AIReasoningEffort; label: string; badge?: string; tone?: 'warning' }> = [
    { value: 'minimal', label: '最低' },
    { value: 'low', label: '低' },
    { value: 'medium', label: '中等' },
    { value: 'high', label: '高' },
    { value: 'xhigh', label: '超高' },
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

export function ModelSelector({ selectedModel = DEFAULT_MODEL_ID, onModelChange, reasoningEnabled = false, onReasoningChange,
    reasoningEffort, onReasoningEffortChange, collaborators = [], onCollaboratorsChange, extra, onCustomProvider,
    userId, disabled = false, compact = false, toolbarStyle = false }: ModelSelectorProps) {
    const [open, setOpen] = useState(false);
    const query = useAvailableModels(userId ?? null, { enabled: !!onModelChange });
    const models = useMemo(() => (query.data ?? []) as ClientModelConfig[], [query.data]);
    useEffect(() => { preloadLobeIcons(models.map(model => model.icon)); }, [models]);
    const collaborationPreset = useCollaborationPreset(userId ?? null);
    const [custom, setCustom] = useState<ReturnType<typeof getCustomProvider>>(null);
    useEffect(() => {
        const sync = () => setCustom(getCustomProvider()); sync();
        window.addEventListener(CUSTOM_PROVIDER_CHANGED_EVENT, sync); window.addEventListener('storage', sync);
        return () => { window.removeEventListener(CUSTOM_PROVIDER_CHANGED_EVENT, sync); window.removeEventListener('storage', sync); };
    }, []);
    useEffect(() => {
        if (!models.length || !onModelChange) return;
        if (models.some(model => model.id === selectedModel)) return;
        if (models[0].id !== selectedModel) onModelChange(models[0].id);
    }, [models, onModelChange, selectedModel]);
    const current = models.find(model => model.id === selectedModel) ?? models[0];
    const reasoningAllowed = !!current?.supportsReasoning;
    useEffect(() => {
        if (!current || !onReasoningChange) return;
        if (!reasoningAllowed) {
            if (reasoningEnabled) onReasoningChange(false);
            if (reasoningEffort) onReasoningEffortChange?.(null);
        } else if (current.isReasoningDefault && !reasoningEnabled) onReasoningChange(true);
    }, [current, reasoningAllowed, reasoningEnabled, reasoningEffort, onReasoningChange, onReasoningEffortChange]);
    // 主模型只负责汇总，不作为协作成员：切换主模型时把旧主模型从成员里剔除。
    const subCollaborators = useMemo(() => collaborators.filter(member => member.model !== current?.id), [collaborators, current?.id]);
    useEffect(() => {
        if (!current || collaborators.length === subCollaborators.length) return;
        onCollaboratorsChange?.(subCollaborators);
    }, [current, collaborators, subCollaborators, onCollaboratorsChange]);
    if (!onModelChange && !onReasoningChange) return null;
    if (custom && !toolbarStyle) return <div className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm text-foreground-secondary"><Cpu size={16} /><span>{getCustomProviderDisplayName(custom) || custom.modelId}</span></div>;
    const locked = disabled || query.isLoading || !current;
    const summary = reasoningSummary(current, reasoningEnabled, reasoningEffort, !!onReasoningEffortChange);
    const label = `选择模型：${current?.name ?? '暂无可用模型'}${toolbarStyle && summary ? ` · ${summary}` : ''}`;
    const close = () => setOpen(false);
    const reasoningSupported = !!current?.supportsReasoning;
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
        // 个性化里为该模型配置过的名称、角色、努力程度与分工作为模板；勾选只影响当前对话，不改设置。
        const template = collaborationPreset.members.find(member => member.model === model.id);
        const next = existing
            ? collaborators.filter(member => member.model !== model.id)
            : [...collaborators, {
                id: crypto.randomUUID(),
                name: template?.name ?? model.name,
                model: model.id,
                focus: template?.focus ?? '',
                reasoning: template?.reasoning ?? !!model.isReasoningDefault,
                reasoningEffort: template?.reasoningEffort ?? null,
                ...(template?.profile ? { profile: template.profile } : {}),
            } satisfies AgentCollaborator];
        onCollaboratorsChange(next);
    };
    const effortChoice = !reasoningEnabled ? 'off' : effectiveEffort ?? 'default';
    const chooseEffort = (effort: AIReasoningEffort | null) => {
        onReasoningChange?.(true);
        onReasoningEffortChange?.(effort);
        close();
    };
    return <div className={`flex items-center ${toolbarStyle ? 'chat-model-selector' : ''}`}>
        <Menu open={open} onOpenChange={setOpen}>
            {toolbarStyle ? <MenuTrigger disabled={locked} className="chat-model-trigger" data-model-trigger
                aria-label={label}>
                {query.isLoading ? <SoundWaveLoader variant="inline" /> : current ? <ModelIcon icon={current.icon} vendor={current.vendor} size={16} /> : null}
                <span className="chat-model-name">{current?.name ?? (query.isLoading ? '正在加载模型' : '暂无可用模型')}</span>
                {summary && <span className="chat-model-hint">{summary}</span>}
                <ChevronDown size={14} aria-hidden="true" />
            </MenuTrigger> : <MenuTrigger disabled={locked} data-model-trigger
                className={`chat-model-picker flex items-center gap-1.5 rounded-xl px-2 transition-colors ${compact ? 'py-1 text-xs' : 'h-9 text-sm'} ${locked ? 'cursor-not-allowed opacity-50' : 'text-foreground-secondary hover:text-foreground'}`}
                aria-label={label}>
                {query.isLoading ? <SoundWaveLoader variant="inline" /> : current ? <ModelIcon icon={current.icon} vendor={current.vendor} /> : <Cpu size={16} />}
                <span className={`chat-model-name truncate ${compact ? 'max-w-[104px]' : 'max-w-[125px]'}`}>{current?.name ?? '暂无可用模型'}</span>
                <ChevronDown size={16} className={open ? 'rotate-180' : undefined} />
            </MenuTrigger>}
            <MenuContent side="top" align={toolbarStyle ? 'end' : 'start'} sideOffset={6} className="chat-model-menu" aria-label="模型与分析设置">
                <MenuRadioGroup className="chat-model-options" aria-label="选择模型" value={selectedModel ?? ''} onValueChange={value => onModelChange?.(value)}>
                    {models.map(model => {
                        const price = formatTokenPrices(model.pricing);
                        return <MenuRadioItem key={model.id} value={model.id} closeOnClick>
                            <ModelIcon icon={model.icon} vendor={model.vendor} size={16} />
                            <span className="chat-model-option-name">{model.name}</span>
                            {price && <span className="chat-model-option-price" title={price === '免费' ? undefined : '每百万 token：输入 / 输出（美元）'}>{price}</span>}
                        </MenuRadioItem>;
                    })}
                </MenuRadioGroup>
                {!models.length && !query.isLoading && <p className="chat-model-note">暂无可用模型。</p>}
                {reasoningSupported && <MenuSeparator className="chat-model-separator" />}
                {reasoningSupported && (effortSupported
                    ? <MenuSub>
                        <MenuSubTrigger className="chat-model-action chat-model-menu-row">
                            <span>努力程度</span><span className="chat-model-menu-value">{effortLabel(effectiveEffort, reasoningEnabled)}</span>
                        </MenuSubTrigger>
                        <MenuSubContent className="chat-model-menu chat-effort-menu" aria-label="努力程度">
                            <p className="chat-model-note chat-model-effort-note">投入程度越高，回复越详尽，但耗时越长，用量与费用也越高。</p>
                            <MenuRadioGroup value={effortChoice} onValueChange={value => {
                                if (value === 'off') { onReasoningChange?.(false); close(); return; }
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
                        onCheckedChange={() => onReasoningChange?.(!reasoningEnabled)}>
                        <span>推理</span>
                    </MenuCheckboxItem>)}
                {!reasoningSupported && onReasoningEffortChange && <MenuItem className="chat-model-action chat-model-menu-row" disabled>
                    <span>努力程度</span><span className="chat-model-menu-value">不支持</span>
                </MenuItem>}
                {onCollaboratorsChange && <MenuSub>
                    <MenuSubTrigger className="chat-model-action chat-model-menu-row" disabled={disabled || !models.length}>
                        <span>多模型协作<BetaBadge /></span>{collaborationEnabled && <span className="chat-model-menu-value">{subCollaborators.length}</span>}
                    </MenuSubTrigger>
                    <MenuSubContent className="chat-model-menu chat-collab-menu" aria-label="多模型协作">
                        <p className="chat-collab-note">子模型可在个性化设置努力程度</p>
                        {models.filter(model => model.id !== current?.id).map(model => {
                            const checked = collaborators.some(member => member.model === model.id);
                            // 右侧 = 个性化里为该模型注册的名称（如「专项分析」），未注册时不显示。
                            const registered = collaborationPreset.members.find(member => member.model === model.id)?.name ?? '';
                            const full = collaborationFull && !checked;
                            return <MenuCheckboxItem key={model.id} checked={checked} closeOnClick={false} disabled={full}
                                className="chat-model-action chat-collab-row" onCheckedChange={() => toggleCollaborator(model)}>
                                <span className="chat-collab-icon"><ModelIcon icon={model.icon} vendor={model.vendor} size={16} /></span>
                                <span className="chat-collab-name">{model.name}</span>
                                {registered && <span className="chat-collab-registered" aria-hidden="true">{registered}</span>}
                            </MenuCheckboxItem>;
                        })}
                        {subCollaborators.length > 0 && <p className="chat-collab-foot">已选 {subCollaborators.length} 个协作模型</p>}
                    </MenuSubContent>
                </MenuSub>}
                {extra}
                {onCustomProvider && <>
                    <MenuSeparator className="chat-model-separator" />
                    <MenuItem className="chat-model-action" onClick={() => { close(); onCustomProvider(); }}><KeyIcon size={16} />使用自己的模型 API</MenuItem>
                </>}
                {query.error && <p className="chat-model-note" role="alert">{query.error instanceof Error ? query.error.message : '模型列表加载失败'}</p>}
            </MenuContent>
        </Menu>
    </div>;
}
