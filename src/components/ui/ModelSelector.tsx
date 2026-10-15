'use client';
// 'use client'：模型菜单需要弹层、键盘导航与浏览器内的自定义模型状态

import { useMemo, useEffect, useRef, useState, useId, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Cpu, KeyRound, Plus, Trash2, Users } from 'lucide-react';
import { SoundWaveLoader } from './SoundWaveLoader';
import { FloatingPanel } from './FloatingPanel';
import { getVendorIcon } from '@/lib/ai/vendor-config';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { useAvailableModels } from '@/lib/hooks/useAvailableModels';
import { CUSTOM_PROVIDER_CHANGED_EVENT, getCustomProvider, getCustomProviderDisplayName } from '@/lib/chat/custom-provider';
import { AI_REASONING_EFFORTS, type AIVendor, type AIReasoningEffort } from '@/types';
import { REASONING_EFFORT_LABELS, type ModelSettingsProps, type AgentCollaborator } from '@/lib/chat/model-settings';
import type { MembershipType } from '@/lib/user/membership';

interface ClientModelConfig {
    id: string; name: string; vendor: AIVendor; supportsReasoning: boolean;
    reasoningEffortFormat?: 'reasoning_object' | 'reasoning_effort' | null;
    isReasoningDefault?: boolean; allowed?: boolean; tier?: 'free' | 'plus' | 'pro' | null; blockedReason?: string | null; reasoningAllowed?: boolean;
}
interface ModelSelectorProps extends ModelSettingsProps {
    selectedModel?: string; onModelChange?: (modelId: string) => void;
    reasoningEnabled?: boolean; onReasoningChange?: (enabled: boolean) => void;
    userId?: string | null; membershipType?: MembershipType; disabled?: boolean;
    compact?: boolean; toolbarStyle?: boolean;
    /** Extra sections rendered after reasoning, such as the analysis style or prompt statistics. */
    extra?: ReactNode;
    /** Offers the bring-your-own-model dialog from the menu. */
    onCustomProvider?: () => void;
}

type ReasoningChoice = 'off' | 'on' | AIReasoningEffort;
const TIER_LABELS = { free: '免费', plus: 'Plus', pro: 'Pro' } as const;

function tierLabel(model: ClientModelConfig): string {
    if (model.allowed === false) return `${model.blockedReason ?? '会员'} 会员可用`;
    return model.tier ? TIER_LABELS[model.tier] : '';
}

/** What the reasoning setting reads as next to the model name, e.g. 推理 高. */
function reasoningSummary(model: ClientModelConfig | undefined, enabled: boolean, effort: AIReasoningEffort | null | undefined, levels: boolean): string | null {
    if (!model?.supportsReasoning || model.reasoningAllowed === false) return null;
    if (!enabled) return '推理 关';
    if (!levels || !model.reasoningEffortFormat) return '推理 开';
    return effort ? `推理 ${REASONING_EFFORT_LABELS[effort]}` : '推理 默认';
}

/** Moves focus between enabled buttons of a composite widget with the arrow, Home and End keys. */
function moveFocus(event: KeyboardEvent<HTMLElement>, keys: string[], select = false) {
    if (![...keys, 'Home', 'End'].includes(event.key) || !(event.target instanceof HTMLButtonElement)) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = items.indexOf(event.target);
    const forward = event.key === keys[0] || event.key === keys[2];
    const next = items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (forward ? 1 : -1) + items.length) % items.length];
    next?.focus();
    if (select) next?.click();
}

/** Segmented reasoning control: off, then the model's effort levels or a plain on switch. */
function ReasoningSegments({ model, reasoning, effort, levels, disabled, onChange }: {
    model: ClientModelConfig; reasoning: boolean; effort?: AIReasoningEffort | null; levels: boolean; disabled?: boolean;
    onChange: (enabled: boolean, effort: AIReasoningEffort | null) => void;
}) {
    if (!model.supportsReasoning) return <p className="chat-model-note">此模型不支持推理。</p>;
    if (model.reasoningAllowed === false) return <p className="chat-model-note">当前会员不可使用推理。</p>;
    const effortSupported = levels && !!model.reasoningEffortFormat;
    const options: Array<{ value: ReasoningChoice; label: string }> = [
        ...(model.isReasoningDefault ? [] : [{ value: 'off' as const, label: '关闭' }]),
        ...(effortSupported ? AI_REASONING_EFFORTS.map(level => ({ value: level, label: REASONING_EFFORT_LABELS[level] })) : [{ value: 'on' as const, label: '开启' }]),
    ];
    if (options.length < 2) return <p className="chat-model-note">此模型始终开启推理。</p>;
    const current: ReasoningChoice | null = !reasoning ? 'off' : effortSupported ? effort ?? null : 'on';
    const focusable = options.some(option => option.value === current) ? current : options[0].value;
    return <div role="radiogroup" aria-label="推理档位" className="chat-model-segments" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        onKeyDown={event => moveFocus(event, ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'], true)}>
        {options.map(option => <button key={option.value} type="button" role="radio" aria-checked={current === option.value} disabled={disabled}
            tabIndex={option.value === focusable ? 0 : -1}
            onClick={() => onChange(option.value !== 'off', option.value === 'off' || option.value === 'on' ? null : option.value)}>{option.label}</button>)}
    </div>;
}

/** Compact select for collaborator reasoning, where a full segment row would not fit. */
function ReasoningSelect({ model, reasoning, effort, onChange, label, disabled }: {
    model: ClientModelConfig; reasoning: boolean; effort?: AIReasoningEffort | null;
    onChange: (enabled: boolean, effort: AIReasoningEffort | null) => void; label: string; disabled?: boolean;
}) {
    const allowed = model.supportsReasoning && (model.reasoningAllowed ?? true);
    const effortSupported = !!model.reasoningEffortFormat;
    return <label className="chat-model-setting"><span>推理档位</span>
        <select aria-label={label} disabled={disabled || !allowed} value={allowed && reasoning ? (effortSupported ? effort : null) ?? 'default' : 'off'}
            onChange={event => onChange(event.target.value !== 'off', event.target.value === 'off' || event.target.value === 'default' ? null : event.target.value as AIReasoningEffort)}>
            {!model.isReasoningDefault && <option value="off">关闭</option>}
            {!allowed && model.isReasoningDefault && <option value="off">不可用</option>}
            <option value="default">{effortSupported ? '模型默认' : '开启'}</option>
            {effortSupported && AI_REASONING_EFFORTS.map(level => <option key={level} value={level}>{REASONING_EFFORT_LABELS[level]}</option>)}
        </select>
    </label>;
}

export function ModelSelector({ selectedModel = DEFAULT_MODEL_ID, onModelChange, reasoningEnabled = false, onReasoningChange,
    reasoningEffort, onReasoningEffortChange, collaborators = [], onCollaboratorsChange, extra, onCustomProvider,
    userId, membershipType = 'free', disabled = false, compact = false, toolbarStyle = false }: ModelSelectorProps) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const anchorRef = useRef<HTMLButtonElement>(null);
    const menuId = useId();
    const query = useAvailableModels(userId ?? null, { enabled: !!onModelChange, membershipType });
    const models = useMemo(() => (query.data ?? []) as ClientModelConfig[], [query.data]);
    const [custom, setCustom] = useState<ReturnType<typeof getCustomProvider>>(null);
    useEffect(() => {
        const sync = () => setCustom(getCustomProvider()); sync();
        window.addEventListener(CUSTOM_PROVIDER_CHANGED_EVENT, sync); window.addEventListener('storage', sync);
        return () => { window.removeEventListener(CUSTOM_PROVIDER_CHANGED_EVENT, sync); window.removeEventListener('storage', sync); };
    }, []);
    useEffect(() => {
        if (!models.length || !onModelChange) return;
        if (models.some(model => model.id === selectedModel && model.allowed !== false)) return;
        const next = models.find(model => model.allowed !== false);
        if (next && next.id !== selectedModel) onModelChange(next.id);
    }, [models, onModelChange, selectedModel]);
    const current = models.find(model => model.id === selectedModel) ?? models[0];
    const reasoningAllowed = current?.supportsReasoning && (current.reasoningAllowed ?? true);
    useEffect(() => {
        if (!current || !onReasoningChange) return;
        if (!reasoningAllowed) {
            if (reasoningEnabled) onReasoningChange(false);
            if (reasoningEffort) onReasoningEffortChange?.(null);
        } else if (current.isReasoningDefault && !reasoningEnabled) onReasoningChange(true);
    }, [current, reasoningAllowed, reasoningEnabled, reasoningEffort, onReasoningChange, onReasoningEffortChange]);
    if (!onModelChange && !onReasoningChange) return null;
    if (custom && !toolbarStyle) return <div className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm text-foreground-secondary"><Cpu size={16} /><span>{getCustomProviderDisplayName(custom) || custom.modelId}</span></div>;
    const locked = disabled || query.isLoading || !current;
    const available = models.filter(model => model.allowed !== false);
    const modelName = (id: string) => models.find(model => model.id === id)?.name ?? '模型已不可用';
    const update = (index: number, change: Partial<AgentCollaborator>) => onCollaboratorsChange?.(collaborators.map((member, position) => position === index ? { ...member, ...change } : member));
    const member = (index: number): AgentCollaborator => ({ id: crypto.randomUUID(), name: index === 0 ? '专项分析' : index === 1 ? '独立复核' : `协作 ${index + 1}`,
        model: available[index % available.length]?.id ?? selectedModel, focus: index === 1 ? '独立核对依据、分歧和不确定性' : '',
        reasoning: !!available[index % available.length]?.isReasoningDefault && available[index % available.length]?.reasoningAllowed !== false, reasoningEffort: null });
    const summary = reasoningSummary(current, reasoningEnabled, reasoningEffort, !!onReasoningEffortChange);
    const hint = collaborators.length ? `+ 协作 ${collaborators.length} 人` : summary;
    const editingIndex = collaborators.findIndex(item => item.id === editing);
    const editingMember = editingIndex >= 0 ? collaborators[editingIndex] : undefined;
    const editingModel = editingMember && models.find(model => model.id === editingMember.model);
    const label = `选择模型：${current?.name ?? '暂无可用模型'}${toolbarStyle && hint ? ` · ${hint}` : ''}`;
    return <div className={`flex items-center ${toolbarStyle ? 'chat-model-selector' : ''}`}>
        {toolbarStyle ? <button ref={anchorRef} type="button" onClick={() => setOpen(value => !value)} disabled={locked} className="chat-model-trigger"
            aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? menuId : undefined}>
            {query.isLoading ? <SoundWaveLoader variant="inline" /> : collaborators.length ? <Users size={16} aria-hidden="true" /> : null}
            <span className="chat-model-name">{current?.name ?? (query.isLoading ? '正在加载模型' : '暂无可用模型')}</span>
            {hint && <span className="chat-model-hint">{hint}</span>}
            <ChevronDown size={14} aria-hidden="true" />
        </button> : <button ref={anchorRef} type="button" onClick={() => setOpen(value => !value)} disabled={locked}
            className={`chat-model-picker flex items-center gap-1.5 rounded-xl px-2 transition-colors ${compact ? 'py-1 text-xs' : 'h-9 text-sm'} ${locked ? 'cursor-not-allowed opacity-50' : 'text-foreground-secondary hover:bg-background-secondary hover:text-foreground'}`}
            aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? menuId : undefined}>
            {query.isLoading ? <SoundWaveLoader variant="inline" /> : current ? getVendorIcon(current.vendor) : <Cpu size={16} />}
            <span className={`chat-model-name truncate ${compact ? 'max-w-[104px]' : 'max-w-[125px]'}`}>{current?.name ?? '暂无可用模型'}</span>
            {!!collaborators.length && <Users size={14} aria-label={`${collaborators.length} 个协作 Agent`} />}
            <ChevronDown size={16} className={open ? 'rotate-180' : undefined} />
        </button>}
        <FloatingPanel open={open && !locked} anchorRef={anchorRef} onClose={() => setOpen(false)} id={menuId}
            role="dialog" label="模型与分析设置" side="top" align={toolbarStyle ? 'end' : 'start'} className="chat-model-menu">
            <div className="chat-model-options" role="menu" aria-label="选择模型" onKeyDown={event => moveFocus(event, ['ArrowDown', 'ArrowUp'])}>
                {models.map(model => <button key={model.id} type="button" role="menuitemradio" aria-checked={selectedModel === model.id}
                    disabled={model.allowed === false} onClick={() => { onModelChange?.(model.id); anchorRef.current?.focus(); setOpen(false); }}>
                    <span className="chat-model-option-name">{model.name}</span>
                    <span className="chat-model-option-tier">{tierLabel(model)}</span>
                    {selectedModel === model.id && <Check size={14} aria-hidden="true" />}
                </button>)}
                {!models.length && !query.isLoading && <p className="chat-model-note">暂无可用模型。</p>}
            </div>
            {current && onReasoningChange && <>
                <div className="chat-model-separator" aria-hidden="true" />
                <div className="chat-model-label">推理档位</div>
                <ReasoningSegments model={current} reasoning={reasoningEnabled} effort={reasoningEffort} levels={!!onReasoningEffortChange} disabled={disabled}
                    onChange={(enabled, effort) => { onReasoningChange(enabled); onReasoningEffortChange?.(effort); }} />
            </>}
            {extra}
            {onCollaboratorsChange && <>
                <div className="chat-model-separator" aria-hidden="true" />
                <label className="chat-model-switch">
                    <span>多模型协作<small>2–4 名成员，各用独立模型与分工</small></span>
                    <input type="checkbox" aria-label="启用多模型协作" checked={!!collaborators.length} disabled={disabled || !available.length}
                        onChange={event => {
                            const members = event.target.checked ? [member(0), member(1)] : [];
                            setEditing(members[0]?.id ?? null);
                            onCollaboratorsChange(members);
                        }} />
                </label>
                {!!collaborators.length && <div className="chat-model-members" role="group" aria-label="协作成员">
                    {collaborators.map(item => <button key={item.id} type="button" aria-pressed={editing === item.id} onClick={() => setEditing(value => value === item.id ? null : item.id)}>
                        {item.name || '未命名成员'} · {modelName(item.model)}
                    </button>)}
                    <button type="button" disabled={disabled || collaborators.length >= 4} onClick={() => {
                        const next = member(collaborators.length);
                        setEditing(next.id);
                        onCollaboratorsChange([...collaborators, next]);
                    }}><Plus size={12} aria-hidden="true" />添加成员</button>
                </div>}
                {editingMember && <fieldset className="chat-collaborator">
                    <legend>Agent {editingIndex + 1}</legend>
                    <div className="chat-collaborator-heading"><input aria-label={`Agent ${editingIndex + 1} 名称`} maxLength={60} value={editingMember.name} disabled={disabled} onChange={event => update(editingIndex, { name: event.target.value })} />
                        <button type="button" aria-label={`移除 Agent ${editingIndex + 1}`} disabled={disabled} onClick={() => {
                            setEditing(null);
                            onCollaboratorsChange(collaborators.length === 2 ? [] : collaborators.filter((_, position) => position !== editingIndex));
                        }}><Trash2 size={14} /></button></div>
                    <label className="chat-model-setting"><span>模型</span><select aria-label={`Agent ${editingIndex + 1} 模型`} value={editingMember.model} disabled={disabled} onChange={event => {
                        const next = models.find(model => model.id === event.target.value);
                        update(editingIndex, { model: event.target.value, reasoning: !!next?.isReasoningDefault && next.reasoningAllowed !== false, reasoningEffort: null });
                    }}>{!editingModel && <option value={editingMember.model}>模型已不可用</option>}{models.map(model => <option key={model.id} value={model.id} disabled={model.allowed === false}>{model.name}{model.allowed === false ? '（会员限制）' : ''}</option>)}</select></label>
                    {editingModel && <ReasoningSelect model={editingModel} reasoning={editingMember.reasoning} effort={editingMember.reasoningEffort} disabled={disabled} label={`Agent ${editingIndex + 1} 推理档位`} onChange={(reasoning, reasoningEffort) => update(editingIndex, { reasoning, reasoningEffort })} />}
                    <textarea aria-label={`Agent ${editingIndex + 1} 分工`} placeholder="分析角度或复核重点" rows={2} maxLength={1200} disabled={disabled} value={editingMember.focus} onChange={event => update(editingIndex, { focus: event.target.value })} />
                </fieldset>}
                {!!collaborators.length && <p className="chat-model-note">主模型汇总各成员的分析，整项任务计一次费用。设置用于下一项任务。</p>}
            </>}
            {onCustomProvider && <>
                <div className="chat-model-separator" aria-hidden="true" />
                <button type="button" className="chat-model-action" onClick={() => { setOpen(false); onCustomProvider(); }}><KeyRound size={15} aria-hidden="true" />使用自己的模型 API</button>
            </>}
            {query.error && <p className="chat-model-note" role="alert">{query.error instanceof Error ? query.error.message : '模型列表加载失败'}</p>}
        </FloatingPanel>
    </div>;
}
