/**
 * Composer 底部工具栏：添加资料、联网、风格与发送
 * （引用命盘/知识库走打字 @ 触发（见 MentionPopover）；「对话方式」已上移到侧栏品牌行，见 components/chat/ModeSwitch.tsx）
 *
 * `+` 菜单从上到下：上传或添加文件 / 技能 / 连接器 / 知识库 / 分析风格 / 记忆 / 搜索 / 润色问题。
 *
 * 'use client' 标记说明：
 * - 菜单开关、文件选择与模型弹层需要交互状态
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Tooltip } from '@/components/ui/Tooltip';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Check, ImagePlus, Paperclip, Plus, Settings2, SlidersHorizontal, Square, Undo2, WandSparkles, X } from 'lucide-react';
import { ConnectorsIcon, KnowledgeIcon, MemoryIcon, SearchIcon, SkillIcon } from '@/lib/navigation/nav-icons';
import { BetaBadge } from '@/components/ui/BetaBadge';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import type { MembershipType } from '@/lib/user/membership';
import type { ChatMode } from '@/lib/chat/use-chat-state';
import type { ModelSettingsProps } from '@/lib/chat/model-settings';
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '@/components/ui/Menu';
import { DOCUMENT_ACCEPT } from '@/lib/ai/document-formats';
import { PRIVATE_ATTACHMENT_ACCEPT } from '@/lib/chat/composer-files';
import type { KnowledgeBaseSummary } from './useComposerState';
import { fetchSkillCommands } from '@/lib/agent/skills/client';
import type { SkillCommand } from '@/lib/agent/skills/config';
import { fetchAgentConnectors, type AgentConnector } from '@/lib/agent/mcp/client';

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
    knowledgeBase: {
        enabled: boolean; allowed: boolean; selected: KnowledgeBaseSummary[];
        items: KnowledgeBaseSummary[]; savingId: string | null; loading: boolean;
        onLoad: () => void; onToggle: (id: string) => void; onRemove: (id: string) => void;
    };
    // Analysis style
    chatMode: ChatMode;
    onChatModeChange?: (mode: ChatMode) => void;
    styles: ChatMode[];
    /** `+` 菜单按钮的上层引用：自定义模型弹窗关闭后要把焦点还给它。 */
    addButtonRef?: React.RefObject<HTMLButtonElement | null>;
    /** Agent 技能：从 + 菜单选中后填入 `/skill:名称 `。 */
    onSkillSelect?: (name: string) => void;
    /** 普通对话里选技能时切到 Agent 对话。 */
    onEnableAgent?: () => void;
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
    const router = useRouter();
    const [menu, setMenu] = useState<'plus' | null>(null);
    const [extensions, setExtensions] = useState<{ skills: SkillCommand[]; connectors: AgentConnector[]; loaded: boolean }>(
        { skills: [], connectors: [], loaded: false });
    const addLabel = agentMode ? '添加图片或文本资料' : '添加附件';
    // 每次打开 + 菜单重读技能与连接器：设置里刚添加的条目马上可见。
    useEffect(() => {
        if (menu !== 'plus' || !userId) return;
        const controller = new AbortController();
        Promise.all([
            fetchSkillCommands(controller.signal).catch(() => [] as SkillCommand[]),
            fetchAgentConnectors(controller.signal).catch(() => [] as AgentConnector[]),
        ]).then(([skills, connectors]) => {
            if (!controller.signal.aborted) setExtensions({ skills, connectors, loaded: true });
        });
        return () => controller.abort();
    }, [menu, userId]);
    const searchToggle = webControl
        ? { active: webControl.enabled, disabled: webControl.disabled, title: webControl.title, onToggle: webControl.onToggle }
        : { active: props.plainWeb.active, disabled: !props.plainWeb.allowed, title: props.plainWeb.title, onToggle: props.plainWeb.onToggle };
    const knowledgeChecked = props.knowledgeBase.selected.length > 0;
    return (
        <div className="chat-composer-actions">
            <Menu open={menu === 'plus'} onOpenChange={open => setMenu(open ? 'plus' : null)}>
                <Tooltip label={addLabel}>
                    <MenuTrigger ref={plusRef} className="chat-tool-button is-bordered chat-plus-trigger" aria-label={addLabel} disabled={disabled}>
                        <Plus size={17} strokeWidth={1.9} aria-hidden="true" />
                    </MenuTrigger>
                </Tooltip>
                <MenuContent side="top" sideOffset={6} className="chat-plus-menu" aria-label={addLabel}>
                    <MenuItem disabled={chatMode === 'dream'} onClick={() => fileInputRef.current?.click()}>
                        <Paperclip size={16} aria-hidden="true" /><span className="chat-plus-label">上传或添加文件</span><kbd>⌘U</kbd>
                    </MenuItem>
                    <MenuSeparator className="chat-plus-divider" />
                    {!!userId && <MenuSub>
                        <MenuSubTrigger><SkillIcon size={18} /><span className="chat-plus-label">技能</span><BetaBadge /></MenuSubTrigger>
                        <MenuSubContent className="chat-plus-menu chat-extension-menu" aria-label="技能">
                            {extensions.skills.length > 0 ? extensions.skills.map(skill => (
                                <MenuItem key={skill.name} title={skill.description}
                                    onClick={() => { if (!agentMode) props.onEnableAgent?.(); props.onSkillSelect?.(skill.name); }}>
                                    <SkillIcon size={18} /><span className="chat-plus-label">{skill.name}</span>
                                    <small>{skill.scope === 'platform' ? '平台' : '我的'}</small>
                                </MenuItem>
                            )) : <p className="chat-plus-empty">{extensions.loaded ? '还没有可用技能' : '正在读取…'}</p>}
                            <MenuSeparator className="chat-plus-divider" />
                            <MenuItem onClick={() => router.push('/settings/skills')}>
                                <Settings2 size={16} aria-hidden="true" /><span className="chat-plus-label">管理技能</span>
                            </MenuItem>
                        </MenuSubContent>
                    </MenuSub>}
                    {!!userId && <MenuSub>
                        <MenuSubTrigger><ConnectorsIcon size={18} /><span className="chat-plus-label">连接器</span><BetaBadge /></MenuSubTrigger>
                        <MenuSubContent className="chat-plus-menu chat-extension-menu" aria-label="连接器">
                            {extensions.connectors.length > 0
                                ? <ul className="chat-plus-connector-list" aria-label="可用连接器">
                                    {extensions.connectors.map(connector => <li key={connector.id}>
                                        <ConnectorsIcon size={16} /><span>{connector.name}</span>
                                        <small>{connector.scope === 'platform' ? '平台' : '我的'}</small><Check size={14} aria-hidden="true" />
                                    </li>)}
                                </ul>
                                : <p className="chat-plus-empty">{extensions.loaded ? '还没有可用连接器' : '正在读取…'}</p>}
                            <MenuSeparator className="chat-plus-divider" />
                            <MenuItem onClick={() => router.push('/settings/connectors')}>
                                <Settings2 size={16} aria-hidden="true" /><span className="chat-plus-label">管理连接器</span>
                            </MenuItem>
                        </MenuSubContent>
                    </MenuSub>}
                    {!!userId && props.knowledgeBase.enabled && <MenuSub onOpenChange={open => { if (open) props.knowledgeBase.onLoad(); }}>
                        <MenuSubTrigger disabled={!props.knowledgeBase.allowed}>
                            <KnowledgeIcon size={18} /><span className="chat-plus-label">知识库</span>
                            {knowledgeChecked && <Check size={14} className="chat-plus-check" aria-hidden="true" />}
                        </MenuSubTrigger>
                        <MenuSubContent className="chat-plus-menu chat-extension-menu" aria-label="知识库">
                            {props.knowledgeBase.items.length > 0 ? props.knowledgeBase.items.map(base => {
                                const enabled = props.knowledgeBase.selected.some(item => item.id === base.id);
                                const saving = props.knowledgeBase.savingId === base.id;
                                return <MenuCheckboxItem key={base.id} checked={enabled} closeOnClick={false} disabled={saving}
                                    title={base.description || base.name} onCheckedChange={() => props.knowledgeBase.onToggle(base.id)}>
                                    <KnowledgeIcon size={18} /><span className="chat-plus-label">{base.name}</span>
                                    {saving ? <SoundWaveLoader variant="inline" /> : enabled && <Check size={14} aria-hidden="true" />}
                                </MenuCheckboxItem>;
                            }) : <p className="chat-plus-empty">{props.knowledgeBase.loading ? '正在读取…' : '还没有知识库'}</p>}
                            <MenuSeparator className="chat-plus-divider" />
                            <MenuItem onClick={() => router.push('/settings/knowledge-base')}>
                                <Settings2 size={16} aria-hidden="true" /><span className="chat-plus-label">管理知识库</span>
                            </MenuItem>
                        </MenuSubContent>
                    </MenuSub>}
                    {!!onChatModeChange && styles.length > 1 && <MenuSub>
                        <MenuSubTrigger>
                            <SlidersHorizontal size={16} aria-hidden="true" /><span className="chat-plus-label">分析风格</span>
                            <span className="chat-plus-value">{STYLE_LABELS[chatMode]}</span>
                        </MenuSubTrigger>
                        <MenuSubContent className="chat-plus-menu chat-style-menu" aria-label="分析风格">
                            <MenuRadioGroup value={chatMode} onValueChange={value => onChatModeChange?.(value as ChatMode)}>
                                {styles.map(style => <MenuRadioItem key={style} value={style} closeOnClick>
                                    <span className="chat-plus-label">{STYLE_MENU_LABELS[style]}</span>
                                </MenuRadioItem>)}
                            </MenuRadioGroup>
                        </MenuSubContent>
                    </MenuSub>}
                    <MenuSeparator className="chat-plus-divider" />
                    {memory && <MenuCheckboxItem checked={memory.enabled} closeOnClick disabled={memory.disabled || memory.busy} title={memory.title}
                        onCheckedChange={() => memory.onToggle()}>
                        <MemoryIcon size={18} /><span className="chat-plus-label">记忆</span><BetaBadge />
                    </MenuCheckboxItem>}
                    <MenuCheckboxItem checked={searchToggle.active} closeOnClick disabled={searchToggle.disabled} title={searchToggle.title}
                        onCheckedChange={() => searchToggle.onToggle()}>
                        <SearchIcon size={18} /><span className="chat-plus-label">搜索</span>
                    </MenuCheckboxItem>
                    <MenuSeparator className="chat-plus-divider" />
                    <MenuItem disabled={!props.polish.available || props.polish.busy} onClick={() => props.polish.run()}>
                        <WandSparkles size={16} aria-hidden="true" /><span className="chat-plus-label">{props.polish.busy ? '正在润色…' : props.imageMode ? '优化提示词' : '润色问题'}</span>
                    </MenuItem>
                </MenuContent>
            </Menu>
            {image && <Tooltip label={image.title}><IconButton label={image.title} className="chat-tool-button is-bordered" expand="none"
                aria-pressed={image.active} data-active={image.active || undefined} disabled={disabled} onClick={image.onToggle}>
                <ImagePlus size={17} strokeWidth={1.9} aria-hidden="true" />
            </IconButton></Tooltip>}
            <input ref={fileInputRef} type="file" className="hidden" tabIndex={-1} aria-hidden="true"
                accept={agentMode ? PRIVATE_ATTACHMENT_ACCEPT : DOCUMENT_ACCEPT}
                multiple={agentMode} onChange={props.onFileChange} />

            {props.knowledgeBase.allowed && props.knowledgeBase.selected.map(base => <span key={base.id} className="chat-kb-chip" title={base.description || base.name}>
                <span>@ {base.name}</span>
                <Button unstyled type="button" aria-label={`移除知识库引用：${base.name}`} disabled={disabled} onClick={() => props.knowledgeBase.onRemove(base.id)}><X size={12} aria-hidden="true" /></Button>
            </span>)}

            {props.polish.undo && <Button unstyled type="button" className="chat-tool-text is-muted" onClick={props.polish.undo}><Undo2 size={15} aria-hidden="true" />撤销润色</Button>}

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
                {send.onFollowUp && <Button unstyled type="button" className="chat-run-secondary" disabled={send.disabled} onClick={send.onFollowUp}>结束后续问</Button>}
                <Button unstyled type="button" className="chat-run-primary" disabled={send.disabled} onClick={send.onSupplement}>补充到当前任务</Button>
                {send.onStop && <Button unstyled type="button" className="chat-stop-button is-small" aria-label="停止任务" title="停止任务" onClick={send.onStop}>
                    <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                </Button>}
            </> : <SendButton send={send} agentMode={agentMode} disabled={disabled} onSend={onSend} onStop={onStop} />}
        </div>
    );
}

function SendButton({ send, agentMode, disabled, onSend, onStop }: { send: ComposerSendState; agentMode: boolean; disabled: boolean; onSend: () => void; onStop?: () => void }) {
    if (send.kind === 'sending') return <Button unstyled type="button" className="chat-send-button" aria-label="正在发送" disabled><SoundWaveLoader variant="inline" /></Button>;
    if (send.kind === 'stop') {
        const label = agentMode ? '停止任务' : '停止生成';
        return <Button unstyled type="button" className="chat-stop-button" aria-label={label} title={label} disabled={!onStop} onClick={onStop}>
            <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
        </Button>;
    }
    // claude 克隆站实测：发送键恒为幽灵态（透明底 + 黑箭头），禁用只是降透明度，从不填充。
    return <Button unstyled type="button" className="chat-send-button" aria-label="发送" title="发送（Enter）" disabled={disabled || (send.kind === 'send' && send.disabled)} onClick={onSend}>
        {/* claude 实测：发送键字形 = 回车式折角箭头（横杆 + 左箭头 + 右端上折回），不是直上箭头；
            路径取 lucide corner-down-left（ISC）并补顶折回段。 */}
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-nav-icon="send">
            <path d="M14 4h6v7a4 4 0 0 1-4 4H4" />
            <path d="m9 10-5 5 5 5" />
        </svg>
    </Button>;
}
