/**
 * Composer 底部工具栏：添加资料、引用、对话方式、联网、风格、上下文、模型与发送
 *
 * 'use client' 标记说明：
 * - 菜单开关、文件选择与模型弹层需要交互状态
 */
'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ArrowUp, AtSign, BookOpenText, ChevronDown, FileText, Globe, KeyRound, Mic, Paperclip, Plus, Square, Undo2, WandSparkles, X } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import type { MembershipType } from '@/lib/user/membership';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { CustomProviderPanel } from '@/components/chat/CustomProviderPanel';
import type { ChatMode } from '@/lib/chat/use-chat-state';
import type { ModelSettingsProps } from '@/lib/chat/model-settings';
import type { AgentPromptTemplate } from '@/lib/agent/prompt-templates';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { Modal } from '@/components/ui/Modal';
import { PromptTemplateMenu } from './ComposerDomainControls';
import type { KnowledgeBaseSummary } from './useComposerState';

/** Agent / plain conversation switch, shown on the empty state and in plain chat. */
export interface ComposerModeControl {
    mode: 'agent' | 'plain';
    onChange: (mode: 'agent' | 'plain') => void;
    agentDisabled: boolean;
    plainDisabled: boolean;
}

/** Agent web search toggle for the next task. */
export interface ComposerWebControl {
    enabled: boolean;
    disabled: boolean;
    label: string;
    title: string;
    onToggle: () => void;
}

/** Ways to finish a draft: send, stop the run, or split into supplement / follow-up while it runs. */
export type ComposerSendState =
    | { kind: 'send'; disabled: boolean }
    | { kind: 'sending' }
    | { kind: 'stop' }
    | { kind: 'split'; disabled: boolean; onSupplement: () => void; onFollowUp?: () => void; onStop?: () => void };

const STYLE_LABELS: Record<ChatMode, string> = { normal: '标准', mangpai: '盲派', dream: '解梦' };

interface ComposerToolbarProps extends ModelSettingsProps {
    agentMode: boolean;
    hero: boolean;
    disabled: boolean;
    userId?: string | null;
    membershipType: MembershipType;
    modeControl?: ComposerModeControl;
    webControl?: ComposerWebControl;
    // Attachments
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    hasFile: boolean;
    onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    // Plain chat search and knowledge
    plainWeb: { active: boolean; allowed: boolean; onToggle: () => void };
    knowledgeBase: { enabled: boolean; allowed: boolean; onOpen: () => void; selected: KnowledgeBaseSummary[]; onRemove: (id: string) => void };
    onMention?: () => void;
    // Analysis style
    chatMode: ChatMode;
    onChatModeChange?: (mode: ChatMode) => void;
    styles: ChatMode[];
    // Drafting helpers
    onPickTemplate: (template: AgentPromptTemplate) => void;
    speech: { recording: boolean; toggle: () => void };
    polish: { available: boolean; busy: boolean; run: () => void; undo?: () => void };
    // Context and model
    contextMeter?: ReactNode;
    promptStatistics?: ReactNode;
    selectedModel: string;
    onModelChange?: (modelId: string) => void;
    reasoningEnabled: boolean;
    onReasoningChange?: (enabled: boolean) => void;
    customProviderActive: boolean;
    customProviderLabel: string | null;
    // Send
    send: ComposerSendState;
    onSend: () => void;
    onStop?: () => void;
}

export function ComposerToolbar(props: ComposerToolbarProps) {
    const { agentMode, hero, disabled, userId, modeControl, webControl, chatMode, onChatModeChange, styles, send, fileInputRef } = props;
    const plusRef = useRef<HTMLButtonElement>(null);
    const styleRef = useRef<HTMLButtonElement>(null);
    const providerReturnRef = useRef<HTMLButtonElement>(null);
    const [menu, setMenu] = useState<'plus' | 'templates' | 'style' | null>(null);
    const [providerOpen, setProviderOpen] = useState(false);
    const addLabel = agentMode ? '添加图片或文本资料' : '添加附件';
    const closeMenu = () => setMenu(null);
    // Plain chat always shows its style; Agent keeps it in the model menu and only flags a non-standard choice.
    const showStyleButton = !!onChatModeChange && styles.length > 1 && (!agentMode || chatMode !== 'normal');
    // The empty state and plain chat show the mode inline; Agent conversations keep it in the model menu.
    const inlineMode = modeControl && (hero || !agentMode || props.customProviderActive) ? modeControl : undefined;
    const menuMode = modeControl && !inlineMode ? <>
        <div className="chat-model-separator" aria-hidden="true" />
        <div className="chat-model-label">对话方式</div>
        <ModeSwitch control={modeControl} className="chat-model-segments is-pair" />
    </> : null;
    const styleSegments = agentMode && onChatModeChange && styles.length > 1 ? <>
        <div className="chat-model-separator" aria-hidden="true" />
        <div className="chat-model-label">分析风格</div>
        <div role="radiogroup" aria-label="分析风格" className="chat-model-segments" style={{ gridTemplateColumns: `repeat(${styles.length}, minmax(0, 1fr))` }}>
            {styles.map(style => <button key={style} type="button" role="radio" aria-checked={chatMode === style} disabled={disabled} onClick={() => onChatModeChange(style)}>{STYLE_LABELS[style]}</button>)}
        </div>
    </> : null;

    return (
        <div className="chat-composer-toolbar">
            <button ref={plusRef} type="button" className="chat-tool-button is-bordered" aria-label={addLabel} title={addLabel}
                aria-haspopup="menu" aria-expanded={menu === 'plus'} disabled={disabled} onClick={() => setMenu(value => value === 'plus' ? null : 'plus')}>
                <Plus size={17} strokeWidth={1.9} aria-hidden="true" />
            </button>
            <FloatingPanel open={menu === 'plus'} anchorRef={plusRef} onClose={closeMenu} label={addLabel} side="top" className="chat-plus-menu" restoreFocus={false}>
                <button type="button" role="menuitem" disabled={chatMode === 'dream'} onClick={() => { closeMenu(); fileInputRef.current?.click(); }}>
                    <Paperclip size={16} aria-hidden="true" />{agentMode ? '上传图片或文本资料' : props.hasFile ? '更换附件' : '上传附件'}
                </button>
                {!agentMode && <button type="button" role="menuitemcheckbox" aria-checked={props.plainWeb.active} disabled={chatMode === 'dream'} onClick={() => { closeMenu(); props.plainWeb.onToggle(); }}>
                    <Globe size={16} aria-hidden="true" />联网搜索{!props.plainWeb.allowed && <small>Plus</small>}
                </button>}
                {/* Phones move the Agent web switch here from the toolbar. */}
                {webControl && <button type="button" role="menuitemcheckbox" className="chat-plus-web" aria-checked={webControl.enabled} disabled={webControl.disabled} title={webControl.title}
                    onClick={() => { closeMenu(); webControl.onToggle(); }}>
                    <Globe size={16} aria-hidden="true" />{webControl.label}
                </button>}
                {!!userId && props.knowledgeBase.enabled && <button type="button" role="menuitem" onClick={() => { closeMenu(); props.knowledgeBase.onOpen(); }}>
                    <BookOpenText size={16} aria-hidden="true" />知识库{!props.knowledgeBase.allowed && <small>Plus</small>}
                </button>}
                {!!userId && <button type="button" role="menuitem" onClick={() => setMenu('templates')}><FileText size={16} aria-hidden="true" />问法模板</button>}
                <button type="button" role="menuitemcheckbox" aria-checked={props.speech.recording} onClick={() => { closeMenu(); props.speech.toggle(); }}>
                    <Mic size={16} aria-hidden="true" />{props.speech.recording ? '停止录音' : '语音输入'}
                </button>
                <button type="button" role="menuitem" disabled={!props.polish.available || props.polish.busy} onClick={() => { closeMenu(); props.polish.run(); }}>
                    <WandSparkles size={16} aria-hidden="true" />{props.polish.busy ? '正在润色…' : '润色问题'}
                </button>
            </FloatingPanel>
            <PromptTemplateMenu open={menu === 'templates'} anchorRef={plusRef} onClose={closeMenu} userId={userId} onPick={props.onPickTemplate} />
            <input ref={fileInputRef} type="file" className="hidden" tabIndex={-1} aria-hidden="true"
                accept={agentMode ? '.jpg,.jpeg,.png,.webp,.pdf,.txt,.md,.doc,.docx,.xlsx,.xls,.csv' : '.pdf,.txt,.md,.doc,.docx,.xlsx,.xls,.csv'}
                multiple={agentMode} onChange={props.onFileChange} />

            {props.onMention && !hero && <button type="button" className="chat-tool-button is-mention" aria-label="引用命盘或知识库" title="引用命盘或知识库" disabled={disabled} onClick={props.onMention}>
                <AtSign size={17} strokeWidth={1.9} aria-hidden="true" />
            </button>}

            {inlineMode && <ModeSwitch control={inlineMode} className="chat-mode-switch" />}

            {props.knowledgeBase.allowed && props.knowledgeBase.selected.map(base => <span key={base.id} className="chat-kb-chip" title={base.description || base.name}>
                <span>@ {base.name}</span>
                <button type="button" aria-label={`移除知识库引用：${base.name}`} disabled={disabled} onClick={() => props.knowledgeBase.onRemove(base.id)}><X size={12} aria-hidden="true" /></button>
            </span>)}

            {webControl && <button type="button" className="chat-tool-text is-web" aria-pressed={webControl.enabled} disabled={webControl.disabled} title={webControl.title} onClick={webControl.onToggle}>
                <Globe size={16} strokeWidth={1.8} aria-hidden="true" />{webControl.label}
            </button>}
            {!agentMode && props.plainWeb.active && <button type="button" className="chat-tool-text" aria-pressed="true" title="关闭联网搜索" onClick={props.plainWeb.onToggle}>
                <Globe size={16} aria-hidden="true" />联网搜索
            </button>}

            {showStyleButton && <>
                <button ref={styleRef} type="button" className="chat-tool-text is-muted" aria-haspopup="menu" aria-expanded={menu === 'style'} disabled={disabled}
                    onClick={() => setMenu(value => value === 'style' ? null : 'style')}>
                    风格 · {STYLE_LABELS[chatMode]}<ChevronDown size={13} aria-hidden="true" />
                </button>
                <FloatingPanel open={menu === 'style'} anchorRef={styleRef} onClose={closeMenu} label="回答风格" side="top" className="chat-plus-menu">
                    {styles.map(style => <button key={style} type="button" role="menuitemradio" aria-checked={chatMode === style} onClick={() => { closeMenu(); onChatModeChange?.(style); }}>
                        {style === 'normal' ? '标准' : style === 'mangpai' ? '盲派分析' : '周公解梦'}
                    </button>)}
                </FloatingPanel>
            </>}

            {props.speech.recording && <button type="button" className="chat-tool-text is-recording" aria-pressed="true" onClick={props.speech.toggle}>
                <Mic size={16} aria-hidden="true" />正在录音 · 停止
            </button>}
            {props.polish.undo && <button type="button" className="chat-tool-text is-muted" onClick={props.polish.undo}><Undo2 size={15} aria-hidden="true" />撤销润色</button>}

            <div className="chat-toolbar-spacer" />

            {send.kind === 'split' ? <>
                {send.onFollowUp && <button type="button" className="chat-run-secondary" disabled={send.disabled} onClick={send.onFollowUp}>结束后续问</button>}
                <button type="button" className="chat-run-primary" disabled={send.disabled} onClick={send.onSupplement}>补充到当前任务</button>
                {send.onStop && <button type="button" className="chat-stop-button is-small" aria-label="停止任务" title="停止任务" onClick={send.onStop}>
                    <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                </button>}
            </> : <>
                {props.contextMeter}
                {props.customProviderActive ? <button ref={providerReturnRef} type="button" className="chat-model-trigger" aria-label={`自定义模型：${props.customProviderLabel || '未命名'}`}
                    aria-haspopup="dialog" aria-expanded={providerOpen} onClick={() => setProviderOpen(true)}>
                    <KeyRound size={15} aria-hidden="true" /><span className="chat-model-name">{props.customProviderLabel || '自定义模型'}</span><span className="chat-model-hint">自定义</span><ChevronDown size={14} aria-hidden="true" />
                </button> : <ModelSelector selectedModel={props.selectedModel} onModelChange={props.onModelChange}
                    reasoningEnabled={props.reasoningEnabled} onReasoningChange={props.onReasoningChange}
                    reasoningEffort={props.reasoningEffort} onReasoningEffortChange={props.onReasoningEffortChange}
                    collaborators={agentMode ? props.collaborators : undefined} onCollaboratorsChange={agentMode ? props.onCollaboratorsChange : undefined}
                    extra={<>{styleSegments}{menuMode}{props.promptStatistics}</>} onCustomProvider={() => setProviderOpen(true)}
                    userId={userId} membershipType={props.membershipType} disabled={disabled} toolbarStyle />}
                <SendButton send={send} agentMode={agentMode} disabled={disabled} onSend={props.onSend} onStop={props.onStop} />
            </>}

            <Modal open={providerOpen} onClose={() => setProviderOpen(false)} returnFocusRef={props.customProviderActive ? providerReturnRef : plusRef} labelledBy="custom-provider-panel-title" className="chat-provider-dialog">
                <button type="button" onClick={() => setProviderOpen(false)} aria-label="关闭自定义模型" className="agent-icon-button absolute right-3 top-3 z-10"><X size={17} /></button>
                <CustomProviderPanel onClose={() => setProviderOpen(false)} />
            </Modal>
        </div>
    );
}

/** Agent / plain radio pair; arrow keys switch like a native radio group. */
function ModeSwitch({ control, className }: { control: ComposerModeControl; className: string }) {
    return <div role="radiogroup" aria-label="对话方式" className={className}
        onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const group = event.currentTarget;
            const next = control.mode === 'agent' ? 'plain' : 'agent';
            if (next === 'agent' ? control.agentDisabled : control.plainDisabled) return;
            control.onChange(next);
            requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
        }}>
        <button type="button" role="radio" aria-checked={control.mode === 'agent'} tabIndex={control.mode === 'agent' ? 0 : -1}
            disabled={control.agentDisabled && control.mode !== 'agent'} title="Agent 会排盘、检索并在工作区展示" onClick={() => control.onChange('agent')}>Agent</button>
        <button type="button" role="radio" aria-checked={control.mode === 'plain'} tabIndex={control.mode === 'plain' ? 0 : -1}
            disabled={control.plainDisabled && control.mode !== 'plain'} onClick={() => control.onChange('plain')}>对话</button>
    </div>;
}

function SendButton({ send, agentMode, disabled, onSend, onStop }: { send: ComposerSendState; agentMode: boolean; disabled: boolean; onSend: () => void; onStop?: () => void }) {
    if (send.kind === 'sending') return <button type="button" className="chat-send-button" aria-label="正在发送" disabled><SoundWaveLoader variant="inline" /></button>;
    if (send.kind === 'stop') {
        const label = agentMode ? '停止任务' : '停止生成';
        return <button type="button" className="chat-stop-button" aria-label={label} title={label} disabled={!onStop} onClick={onStop}>
            <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
        </button>;
    }
    return <button type="button" className="chat-send-button" aria-label="发送" title="发送（Enter）" disabled={disabled || (send.kind === 'send' && send.disabled)} onClick={onSend}>
        <ArrowUp size={17} strokeWidth={2.25} aria-hidden="true" />
    </button>;
}
