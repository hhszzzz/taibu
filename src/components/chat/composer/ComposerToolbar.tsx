/**
 * Composer 底部工具栏：添加资料、联网、风格与发送
 * （引用命盘/知识库走打字 @ 触发（见 MentionPopover）；「对话方式」已上移到侧栏品牌行，见 components/chat/ModeSwitch.tsx）
 *
 * `+` 菜单按 claude 组织：上传或添加文件 / 记忆 / 搜索 / 知识库（可勾选）/ 分析风格（二级）/ 润色问题。
 *
 * 'use client' 标记说明：
 * - 菜单开关、文件选择与模型弹层需要交互状态
 */
'use client';

import { useRef, useState } from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { BookOpenText, Brain, Check, ChevronRight, Globe, ImagePlus, Paperclip, Plus, SlidersHorizontal, Square, Undo2, WandSparkles, X } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import type { MembershipType } from '@/lib/user/membership';
import type { ChatMode } from '@/lib/chat/use-chat-state';
import type { ModelSettingsProps } from '@/lib/chat/model-settings';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { DOCUMENT_ACCEPT } from '@/lib/ai/document-formats';
import { PRIVATE_ATTACHMENT_ACCEPT } from '@/lib/chat/composer-files';
import type { KnowledgeBaseSummary } from './useComposerState';

/** Agent web search toggle for the next task. */
export interface ComposerWebControl {
    enabled: boolean;
    disabled: boolean;
    label: string;
    title: string;
    onToggle: () => void;
}

/** Long-term memory switch (user setting; the agent reads/writes only when enabled). */
export interface ComposerMemoryControl {
    enabled: boolean;
    disabled: boolean;
    busy?: boolean;
    title?: string;
    onToggle: () => void;
}

/** Standalone image generation: the composer talks to /api/images/generate instead of the chat model. */
export interface ComposerImageGeneration {
    sizes: readonly string[];
    /** 每张图扣除的积分；0 表示免费。 */
    creditCost: number;
    maxCount: number;
    onGenerate: (options: { prompt: string; size: string; count: number }) => void;
}

/** The toolbar's 生图 toggle, shown only when an image model is available. */
export interface ComposerImageControl {
    active: boolean;
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
const STYLE_MENU_LABELS: Record<ChatMode, string> = { normal: '标准', mangpai: '盲派分析', dream: '周公解梦' };

interface ComposerToolbarProps extends ModelSettingsProps {
    agentMode: boolean;
    disabled: boolean;
    userId?: string | null;
    membershipType: MembershipType;
    webControl?: ComposerWebControl;
    memory?: ComposerMemoryControl;
    /** Absent when no image model serves the member; the button stays hidden. */
    image?: ComposerImageControl;
    /** Image mode relabels 润色问题 as 优化提示词. */
    imageMode?: boolean;
    // Attachments
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    hasFile: boolean;
    onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    // Plain chat search and knowledge
    plainWeb: { active: boolean; allowed: boolean; title: string; onToggle: () => void };
    knowledgeBase: { enabled: boolean; allowed: boolean; onOpen: () => void; selected: KnowledgeBaseSummary[]; onRemove: (id: string) => void };
    // Analysis style
    chatMode: ChatMode;
    onChatModeChange?: (mode: ChatMode) => void;
    styles: ChatMode[];
    /** `+` 菜单按钮的上层引用：自定义模型弹窗关闭后要把焦点还给它。 */
    addButtonRef?: React.RefObject<HTMLButtonElement | null>;
    polish: { available: boolean; busy: boolean; run: () => void; undo?: () => void };
    // Send
    send: ComposerSendState;
    onSend: () => void;
    onStop?: () => void;
    /** 会话内工具簇在框外 chin 行（无发送群）；hero 里与发送同排在壳内第二行。 */
    showSend?: boolean;
}

export function ComposerToolbar(props: ComposerToolbarProps) {
    const { agentMode, disabled, userId, webControl, memory, image, chatMode, onChatModeChange, styles, send, fileInputRef } = props;
    const internalAddRef = useRef<HTMLButtonElement>(null);
    const plusRef = props.addButtonRef ?? internalAddRef;
    const styleRef = useRef<HTMLButtonElement>(null);
    const [menu, setMenu] = useState<'plus' | null>(null);
    const [styleOpen, setStyleOpen] = useState(false);
    const addLabel = agentMode ? '添加图片或文本资料' : '添加附件';
    const closeMenu = () => { setMenu(null); setStyleOpen(false); };
    const openMenu = () => { setMenu(value => value === 'plus' ? null : 'plus'); setStyleOpen(false); };
    const searchToggle = webControl
        ? { active: webControl.enabled, disabled: webControl.disabled, title: webControl.title, onToggle: webControl.onToggle }
        : { active: props.plainWeb.active, disabled: !props.plainWeb.allowed, title: props.plainWeb.title, onToggle: props.plainWeb.onToggle };
    const knowledgeChecked = props.knowledgeBase.selected.length > 0;
    return (
        <div className="chat-composer-actions">
            <Tooltip label={addLabel}><button ref={plusRef} type="button" className="chat-tool-button is-bordered" aria-label={addLabel}
                aria-haspopup="menu" aria-expanded={menu === 'plus'} disabled={disabled} onClick={openMenu}>
                <Plus size={17} strokeWidth={1.9} aria-hidden="true" />
            </button></Tooltip>
            {image && <Tooltip label={image.title}><button type="button" className="chat-tool-button is-bordered" aria-label={image.title}
                aria-pressed={image.active} data-active={image.active || undefined} disabled={disabled} onClick={image.onToggle}>
                <ImagePlus size={17} strokeWidth={1.9} aria-hidden="true" />
            </button></Tooltip>}
            <FloatingPanel open={menu === 'plus'} anchorRef={plusRef} onClose={closeMenu} label={addLabel} side="top" className="chat-plus-menu" restoreFocus={false}>
                <button type="button" role="menuitem" disabled={chatMode === 'dream'} onClick={() => { closeMenu(); fileInputRef.current?.click(); }}>
                    <Paperclip size={16} aria-hidden="true" /><span className="chat-plus-label">上传或添加文件</span><kbd>⌘U</kbd>
                </button>
                <div className="chat-plus-divider" role="separator" />
                {memory && <button type="button" role="menuitemcheckbox" aria-checked={memory.enabled} disabled={memory.disabled || memory.busy} title={memory.title}
                    onClick={() => { memory.onToggle(); closeMenu(); }}>
                    <Brain size={16} aria-hidden="true" /><span className="chat-plus-label">记忆</span>{memory.enabled && <Check size={14} aria-hidden="true" />}
                </button>}
                <button type="button" role="menuitemcheckbox" aria-checked={searchToggle.active} disabled={searchToggle.disabled} title={searchToggle.title}
                    onClick={() => { searchToggle.onToggle(); closeMenu(); }}>
                    <Globe size={16} aria-hidden="true" /><span className="chat-plus-label">搜索</span>{searchToggle.active && <Check size={14} aria-hidden="true" />}
                </button>
                {!!userId && props.knowledgeBase.enabled && <button type="button" role="menuitemcheckbox" aria-checked={knowledgeChecked} disabled={!props.knowledgeBase.allowed}
                    onClick={() => { closeMenu(); props.knowledgeBase.onOpen(); }}>
                    <BookOpenText size={16} aria-hidden="true" /><span className="chat-plus-label">知识库</span>{knowledgeChecked ? <Check size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                </button>}
                {!!onChatModeChange && styles.length > 1 && <button ref={styleRef} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={styleOpen}
                    onClick={() => setStyleOpen(value => !value)}>
                    <SlidersHorizontal size={16} aria-hidden="true" /><span className="chat-plus-label">分析风格</span><span className="chat-plus-value">{STYLE_LABELS[chatMode]}</span><ChevronRight size={14} aria-hidden="true" />
                </button>}
                <div className="chat-plus-divider" role="separator" />
                <button type="button" role="menuitem" disabled={!props.polish.available || props.polish.busy} onClick={() => { closeMenu(); props.polish.run(); }}>
                    <WandSparkles size={16} aria-hidden="true" /><span className="chat-plus-label">{props.polish.busy ? '正在润色…' : props.imageMode ? '优化提示词' : '润色问题'}</span>
                </button>
            </FloatingPanel>
            {/* 二级菜单 = claude 侧边浮层：在「分析风格」行右侧另开一个弹窗，不替换 + 菜单内容。 */}
            {!!onChatModeChange && styles.length > 1 && <FloatingPanel open={styleOpen && menu === 'plus'} anchorRef={styleRef}
                onClose={() => setStyleOpen(false)} label="分析风格" side="right-start" className="chat-plus-menu chat-style-menu" restoreFocus={false}>
                <div>
                    {styles.map(style => <button key={style} type="button" role="menuitemradio" aria-checked={chatMode === style}
                        onClick={() => { onChatModeChange?.(style); closeMenu(); }}>
                        <span className="chat-plus-label">{STYLE_MENU_LABELS[style]}</span>{chatMode === style && <Check size={14} aria-hidden="true" />}
                    </button>)}
                </div>
            </FloatingPanel>}
            <input ref={fileInputRef} type="file" className="hidden" tabIndex={-1} aria-hidden="true"
                accept={agentMode ? PRIVATE_ATTACHMENT_ACCEPT : DOCUMENT_ACCEPT}
                multiple={agentMode} onChange={props.onFileChange} />

            {props.knowledgeBase.allowed && props.knowledgeBase.selected.map(base => <span key={base.id} className="chat-kb-chip" title={base.description || base.name}>
                <span>@ {base.name}</span>
                <button type="button" aria-label={`移除知识库引用：${base.name}`} disabled={disabled} onClick={() => props.knowledgeBase.onRemove(base.id)}><X size={12} aria-hidden="true" /></button>
            </span>)}

            {props.polish.undo && <button type="button" className="chat-tool-text is-muted" onClick={props.polish.undo}><Undo2 size={15} aria-hidden="true" />撤销润色</button>}

            {props.showSend !== false && <>
                <div className="chat-toolbar-spacer" />
                <ComposerSendCluster send={send} agentMode={agentMode} disabled={disabled} onSend={props.onSend} onStop={props.onStop} />
            </>}
        </div>
    );
}

/** 发送群（发送 / 停止 / 运行中拆分）：会话内单独渲染在白壳行右侧（claude /chat 实测），hero 与工具同排。 */
export function ComposerSendCluster({ send, agentMode, disabled, onSend, onStop }: { send: ComposerSendState; agentMode: boolean; disabled: boolean; onSend: () => void; onStop?: () => void }) {
    return (
        <div className="chat-composer-send-group">
            {send.kind === 'split' ? <>
                {send.onFollowUp && <button type="button" className="chat-run-secondary" disabled={send.disabled} onClick={send.onFollowUp}>结束后续问</button>}
                <button type="button" className="chat-run-primary" disabled={send.disabled} onClick={send.onSupplement}>补充到当前任务</button>
                {send.onStop && <button type="button" className="chat-stop-button is-small" aria-label="停止任务" title="停止任务" onClick={send.onStop}>
                    <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                </button>}
            </> : <SendButton send={send} agentMode={agentMode} disabled={disabled} onSend={onSend} onStop={onStop} />}
        </div>
    );
}

function SendButton({ send, agentMode, disabled, onSend, onStop }: { send: ComposerSendState; agentMode: boolean; disabled: boolean; onSend: () => void; onStop?: () => void }) {
    if (send.kind === 'sending') return <button type="button" className="chat-send-button" aria-label="正在发送" disabled><SoundWaveLoader variant="inline" /></button>;
    if (send.kind === 'stop') {
        const label = agentMode ? '停止任务' : '停止生成';
        return <button type="button" className="chat-stop-button" aria-label={label} title={label} disabled={!onStop} onClick={onStop}>
            <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
        </button>;
    }
    // claude 克隆站实测：发送键恒为幽灵态（透明底 + 黑箭头），禁用只是降透明度，从不填充。
    return <button type="button" className="chat-send-button" aria-label="发送" title="发送（Enter）" disabled={disabled || (send.kind === 'send' && send.disabled)} onClick={onSend}>
        {/* claude 实测：发送键字形 = 回车式折角箭头（横杆 + 左箭头 + 右端上折回），不是直上箭头；
            路径取 lucide corner-down-left（ISC）并补顶折回段。 */}
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-nav-icon="send">
            <path d="M14 4h6v7a4 4 0 0 1-4 4H4" />
            <path d="m9 10-5 5 5 5" />
        </svg>
    </button>;
}
