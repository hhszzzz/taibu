/**
 * Chat 页面头部：会话标题菜单、模式标记、任务状态、工作区入口与更多操作
 *
 * 'use client' 标记说明：
 * - 菜单开关、重命名输入与删除确认需要交互状态
 */
'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { BookOpenText, ChevronDown, Download, Ellipsis, PenLine, SquarePen, Trash2, X } from 'lucide-react';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { requestConversationExport } from '@/lib/chat/conversation-export';
import { SettingsCenterLink } from '@/components/settings/SettingsCenterLink';
import { SETTINGS_CENTER_TAB_ICONS } from '@/components/settings/settings-center-icons';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

interface ChatHeaderProps {
    /** Opens the navigation drawer where the page has no sidebar (phones and tablets). */
    navigation?: ReactNode;
    /** A new conversation shows no header beside the sidebar; phones keep it for the drawer. */
    empty?: boolean;
    title: string;
    /** Saved conversation; new conversations have no rename, delete or export. */
    conversationId: string | null;
    /** Conversation mode shown next to the title, e.g. Agent. */
    badge?: string;
    /** Live task status shown before the actions. */
    status?: ReactNode;
    /** Workspace toggle, rendered before the overflow menu. */
    workspaceButton?: ReactNode;
    /** Plain conversations show export as a visible action. */
    showExport?: boolean;
    readingWidth: number;
    onReadingWidthChange: (width: number) => void;
    membershipType: string;
    knowledgeBaseEnabled: boolean;
    aiPersonalizationEnabled: boolean;
}

const PersonalizationIcon = SETTINGS_CENTER_TAB_ICONS.personalization;

export function ChatHeader({
    navigation,
    empty = false,
    title,
    conversationId,
    badge,
    status,
    workspaceButton,
    showExport = false,
    readingWidth,
    onReadingWidthChange,
    membershipType,
    knowledgeBaseEnabled,
    aiPersonalizationEnabled,
}: ChatHeaderProps) {
    const { handleNewChat, handleRenameConversation, handleDeleteConversation } = useConversationList();
    const { showToast } = useToast();
    const titleRef = useRef<HTMLButtonElement>(null);
    const moreRef = useRef<HTMLButtonElement>(null);
    const renameInput = useRef<HTMLInputElement>(null);
    const renameId = useId();
    const [titleMenu, setTitleMenu] = useState(false);
    const [moreMenu, setMoreMenu] = useState(false);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [renameBusy, setRenameBusy] = useState(false);

    const saveRename = async () => {
        const next = renaming?.trim();
        if (!conversationId || !next || renameBusy) return;
        setRenameBusy(true);
        try {
            if (await handleRenameConversation(conversationId, next)) setRenaming(null);
            else showToast('error', '重命名失败，请重试');
        } finally {
            setRenameBusy(false);
        }
    };

    return (
        <header className={`chat-session-header${empty ? ' is-empty' : ''}`}>
            {navigation}
            <h1 className="chat-session-title">
                {conversationId ? <button ref={titleRef} type="button" className="chat-title-button" aria-haspopup="menu" aria-expanded={titleMenu}
                    onClick={() => setTitleMenu(open => !open)} title={title}>
                    <span>{title}</span><ChevronDown size={15} aria-hidden="true" />
                </button> : <span className="chat-title-text" title={title}>{title}</span>}
            </h1>
            {badge && <span className="chat-mode-badge">{badge}</span>}
            <div className="chat-session-actions">
                {status && <div className="chat-session-status">{status}</div>}
                {showExport && conversationId && <button type="button" className="chat-header-button" onClick={requestConversationExport}>
                    <Download size={15} aria-hidden="true" /><span>导出</span>
                </button>}
                {workspaceButton}
                <button ref={moreRef} type="button" className="chat-header-icon" aria-label="更多对话操作" title="更多对话操作"
                    aria-haspopup="dialog" aria-expanded={moreMenu} onClick={() => setMoreMenu(open => !open)}>
                    <Ellipsis size={18} aria-hidden="true" />
                </button>
            </div>

            <FloatingPanel open={titleMenu} anchorRef={titleRef} onClose={() => setTitleMenu(false)} label="对话操作" className="chat-header-menu">
                <button type="button" role="menuitem" onClick={() => { setTitleMenu(false); setRenaming(title); }}><PenLine size={15} aria-hidden="true" />重命名</button>
                <button type="button" role="menuitem" onClick={() => { setTitleMenu(false); requestConversationExport(); }}><Download size={15} aria-hidden="true" />导出对话</button>
                <button type="button" role="menuitem" className="is-danger" onClick={() => { setTitleMenu(false); setDeleting(true); }}><Trash2 size={15} aria-hidden="true" />删除对话</button>
            </FloatingPanel>

            <FloatingPanel open={moreMenu} anchorRef={moreRef} onClose={() => setMoreMenu(false)} label="更多对话操作" role="dialog" align="end" className="chat-header-menu chat-header-more">
                <button type="button" onClick={() => { setMoreMenu(false); void handleNewChat(); }}><SquarePen size={15} aria-hidden="true" />新建对话</button>
                {conversationId && <button type="button" onClick={() => { setMoreMenu(false); requestConversationExport(); }}><Download size={15} aria-hidden="true" />导出对话</button>}
                {aiPersonalizationEnabled && <SettingsCenterLink tab="personalization" className="chat-header-menu-link" onClick={() => setMoreMenu(false)}>
                    <PersonalizationIcon size={15} aria-hidden="true" />个性化
                </SettingsCenterLink>}
                {membershipType !== 'free' && knowledgeBaseEnabled && <SettingsCenterLink tab="knowledge-base" className="chat-header-menu-link" onClick={() => setMoreMenu(false)}>
                    <BookOpenText size={15} aria-hidden="true" />知识库
                </SettingsCenterLink>}
                <label className="chat-reading-width">
                    <span>阅读列宽 <output>{readingWidth}px</output></span>
                    <input type="range" aria-label="阅读列宽" min="560" max="1200" step="20" value={readingWidth} onChange={event => onReadingWidthChange(Number(event.target.value))} />
                </label>
            </FloatingPanel>

            <Modal open={renaming !== null} onClose={() => { if (!renameBusy) setRenaming(null); }} busy={renameBusy} initialFocusRef={renameInput} labelledBy={renameId} className="chat-rename-dialog">
                <form onSubmit={event => { event.preventDefault(); void saveRename(); }}>
                    <div className="chat-rename-heading"><h2 id={renameId}>重命名对话</h2>
                        <button type="button" className="chat-header-icon" aria-label="取消重命名" disabled={renameBusy} onClick={() => setRenaming(null)}><X size={17} /></button></div>
                    <input ref={renameInput} aria-label="对话标题" value={renaming ?? ''} maxLength={120} onChange={event => setRenaming(event.target.value)} disabled={renameBusy} />
                    <div className="chat-rename-actions">
                        <button type="button" className="chat-header-button" disabled={renameBusy} onClick={() => setRenaming(null)}>取消</button>
                        <button type="submit" className="chat-primary-button" disabled={renameBusy || !renaming?.trim()}>{renameBusy ? '正在保存' : '保存'}</button>
                    </div>
                </form>
            </Modal>
            <ConfirmDialog isOpen={deleting} onClose={() => { if (!deleteBusy) setDeleting(false); }} loading={deleteBusy}
                onConfirm={async () => {
                    if (!conversationId) return;
                    setDeleteBusy(true);
                    try {
                        if (!await handleDeleteConversation(conversationId)) showToast('error', '删除失败，请重试');
                        else setDeleting(false);
                    } finally {
                        setDeleteBusy(false);
                    }
                }}
                title="删除此对话" description={`删除“${title}”后无法恢复。`} confirmText="确认删除" />
        </header>
    );
}
