/**
 * Chat 页面头部：会话标题菜单、工作区入口、后台任务、分享与查看选项
 *
 * 'use client' 标记说明：
 * - 菜单开关、重命名输入、分享/后台任务与删除确认需要交互状态
 */
'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Clock3, Ellipsis, Share2 } from 'lucide-react';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { useConversationExport } from '@/components/chat/ConversationExportDialog';
import { ShareConversationMenu } from '@/components/chat/ShareConversationMenu';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useAgentActivity } from '@/lib/agent/use-agent-activity';
import { AGENT_MARKER_LABELS } from '@/lib/agent/activity';
import { CHAT_RECORD_VIEW_LABELS, CHAT_RECORD_VIEWS, useChatRecordView, useChatRecordViewDefault, writeChatRecordView, writeChatRecordViewDefault } from '@/lib/chat/chat-record-view';
import type { ReactNode } from 'react';

interface ChatHeaderProps {
    /** Opens the navigation drawer where the page has no sidebar (phones and tablets). */
    navigation?: ReactNode;
    /** A new conversation shows no header beside the sidebar; phones keep it for the drawer. */
    empty?: boolean;
    title: string;
    /** Saved conversation; new conversations have no rename, delete or export. */
    conversationId: string | null;
    /** Workspace toggle, rendered before the overflow menu. */
    workspaceButton?: ReactNode;
    membershipType: string;
    knowledgeBaseEnabled: boolean;
    userId?: string | null;
}

export function ChatHeader({
    navigation,
    empty = false,
    title,
    conversationId,
    workspaceButton,
    membershipType,
    knowledgeBaseEnabled,
    userId = null,
}: ChatHeaderProps) {
    const { conversations, handleRenameConversation, handleDeleteConversation } = useConversationList();
    const router = useRouter();
    const { showToast } = useToast();
    const titleRef = useRef<HTMLButtonElement>(null);
    const moreRef = useRef<HTMLButtonElement>(null);
    const shareRef = useRef<HTMLButtonElement>(null);
    const tasksRef = useRef<HTMLButtonElement>(null);
    const recordRef = useRef<HTMLButtonElement>(null);
    const exportRef = useRef<HTMLButtonElement>(null);
    const renameInput = useRef<HTMLInputElement>(null);
    const [titleMenu, setTitleMenu] = useState(false);
    const [recordOpen, setRecordOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [moreMenu, setMoreMenu] = useState(false);
    const [shareMenu, setShareMenu] = useState(false);
    const [tasksOpen, setTasksOpen] = useState(false);
    const [kbOpen, setKbOpen] = useState(false);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [renameBusy, setRenameBusy] = useState(false);
    const recordView = useChatRecordView(userId, conversationId);
    const defaultRecordView = useChatRecordViewDefault(userId);
    // 导出 = 标题菜单的二级浮层（Markdown / 可打印 HTML），不再弹独立对话框。
    const { tools: exportTools, setTools: setExportTools, busy: exportBusy, download: downloadExport } = useConversationExport(conversationId ?? '');
    const markers = useAgentActivity(userId, conversationId, !!userId);
    // 后台任务：直接取活动标记（不依赖会话列表是否已分页加载到该会话）。
    const backgroundTasks = useMemo(() => [...markers.entries()]
        .filter(([, marker]) => marker === 'running' || marker === 'awaiting')
        .map(([id, marker]) => ({ id, marker, title: conversations.find(conv => conv.id === id)?.title ?? '任务对话' })), [conversations, markers]);

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

    /** claude 会话标题菜单的「复制链接 C」：拼出当前会话 URL 进剪贴板（纯前端）。 */
    const copyConversationLink = async () => {
        if (!conversationId) return;
        const url = `${window.location.origin}/chat?id=${encodeURIComponent(conversationId)}`;
        try {
            await navigator.clipboard.writeText(url);
            showToast('success', '已复制链接');
        } catch {
            showToast('error', '复制失败，请手动复制地址栏链接');
        }
    };

    const canUseKnowledgeBase = membershipType !== 'free' && knowledgeBaseEnabled;

    return (
        <header className={`chat-session-header${empty ? ' is-empty' : ''}`}>
            {navigation}
            <h1 className="chat-session-title">
                {conversationId ? renaming !== null ? (
                    /* 内联重命名 = 克隆站 TopBar：输入框直接替换标题（h-7 / r7 / 5% 底），Enter 保存、Esc 取消、失焦提交。 */
                    <input ref={renameInput} className="chat-rename-inline" aria-label="重命名" autoFocus
                        value={renaming} maxLength={120} disabled={renameBusy}
                        onChange={event => setRenaming(event.target.value)}
                        onBlur={() => { if (!renaming?.trim()) setRenaming(null); else void saveRename(); }}
                        onKeyDown={event => {
                            if (event.key === 'Enter') { event.preventDefault(); void saveRename(); }
                            else if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); }
                        }} />
                ) : <button ref={titleRef} type="button" className="chat-title-button" aria-haspopup="menu" aria-expanded={titleMenu}
                    onClick={() => setTitleMenu(open => !open)} title={title}>
                    <span>{title}</span><ChevronDown size={16} aria-hidden="true" />
                </button> : <span className="chat-title-text" title={title}>{title}</span>}
            </h1>
            <div className="chat-session-actions">
                {workspaceButton}
                <button ref={tasksRef} type="button" className="chat-header-icon" aria-label="后台任务" title="后台任务"
                    aria-haspopup="dialog" aria-expanded={tasksOpen} onClick={() => setTasksOpen(open => !open)}>
                    <Clock3 size={17} aria-hidden="true" />
                    {backgroundTasks.length > 0 && <span className="chat-header-count" aria-hidden="true">{backgroundTasks.length}</span>}
                </button>
                <button ref={shareRef} type="button" className="chat-header-share" aria-label="分享" aria-haspopup="menu" aria-expanded={shareMenu}
                    onClick={() => setShareMenu(open => !open)}>
                    <Share2 size={15} aria-hidden="true" /><span>分享</span>
                </button>
                <button ref={moreRef} type="button" className="chat-header-icon" aria-label="查看选项" title="查看选项"
                    aria-haspopup="dialog" aria-expanded={moreMenu} onClick={() => setMoreMenu(open => !open)}>
                    <Ellipsis size={18} aria-hidden="true" />
                </button>
            </div>

            {/* 会话标题菜单 = claude 词表：重命名 R / 复制链接 C / 加入知识库 A / 对话记录视图 ▸ / 删除对话 D（字母键由 FloatingPanel 接线）；导出在「查看选项」里 */}
            <FloatingPanel open={titleMenu} anchorRef={titleRef} onClose={() => { setTitleMenu(false); setRecordOpen(false); setExportOpen(false); }} label="对话操作" className="chat-header-menu">
                <button type="button" role="menuitem" onClick={() => { setTitleMenu(false); setRenaming(title); }}>重命名<kbd>R</kbd></button>
                <button type="button" role="menuitem" onClick={() => { setTitleMenu(false); void copyConversationLink(); }}>复制链接<kbd>C</kbd></button>
                {conversationId && canUseKnowledgeBase && <button type="button" role="menuitem" onClick={() => { setTitleMenu(false); setKbOpen(true); }}>加入知识库<kbd>A</kbd></button>}
                <div className="chat-header-menu-divider" role="separator" />
                {/* claude 标题菜单的「对话记录视图 ▸」：二级浮层选普通 / 详细。 */}
                <button ref={recordRef} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={recordOpen}
                    onClick={() => { setRecordOpen(value => !value); setExportOpen(false); }}>
                    对话记录视图<span className="chat-header-menu-chevron"><ChevronRight size={14} aria-hidden="true" /></span>
                </button>
                <div className="chat-header-menu-divider" role="separator" />
                <button type="button" role="menuitem" className="is-danger" onClick={() => { setTitleMenu(false); setDeleting(true); }}>删除对话<kbd>D</kbd></button>
            </FloatingPanel>

            {/* 对话记录视图 = 标题菜单右侧二级浮层（claude 子菜单同构）。 */}
            <FloatingPanel open={(titleMenu || moreMenu) && recordOpen} anchorRef={recordRef} onClose={() => setRecordOpen(false)} label="对话记录视图" side="right-start" className="chat-header-menu chat-header-submenu">
                {CHAT_RECORD_VIEWS.map(view => <button key={view} type="button" role="menuitemradio" aria-checked={recordView === view}
                    onClick={() => { writeChatRecordView(userId, view, conversationId); setRecordOpen(false); setTitleMenu(false); setMoreMenu(false); }}>
                    {CHAT_RECORD_VIEW_LABELS[view]}{recordView === view && <span className="chat-header-menu-check" aria-hidden="true">✓</span>}
                </button>)}
                {/* claude：当前视图偏离默认时才出现「将 X 设为默认」。 */}
                {recordView !== defaultRecordView && <>
                    <div className="chat-header-menu-divider" role="separator" />
                    <button type="button" role="menuitem"
                        onClick={() => { writeChatRecordViewDefault(userId, recordView); setRecordOpen(false); setTitleMenu(false); setMoreMenu(false); }}>
                        将 {CHAT_RECORD_VIEW_LABELS[recordView]} 设为默认
                    </button>
                </>}
            </FloatingPanel>

            {/* 导出对话 = 标题菜单右侧二级浮层：格式 + 是否包含工具参数。 */}
            {conversationId && <FloatingPanel open={(titleMenu || moreMenu) && exportOpen} anchorRef={exportRef} onClose={() => setExportOpen(false)} label="导出对话" side="right-start" className="chat-header-menu chat-header-submenu">
                <button type="button" role="menuitem" disabled={exportBusy !== null} onClick={() => { void downloadExport('md'); }}>{exportBusy === 'md' ? '正在导出…' : 'Markdown'}</button>
                <button type="button" role="menuitem" disabled={exportBusy !== null} onClick={() => { void downloadExport('html'); }}>{exportBusy === 'html' ? '正在导出…' : 'HTML'}</button>
                <label className="chat-header-menu-check-row"><input type="checkbox" checked={exportTools} disabled={exportBusy !== null} onChange={event => setExportTools(event.target.checked)} />包含工具调用参数与原始结果</label>
            </FloatingPanel>}

            <FloatingPanel open={shareMenu} anchorRef={shareRef} onClose={() => setShareMenu(false)} label="分享" className="chat-header-menu" align="end">
                <ShareConversationMenu conversationId={conversationId} taskActive={backgroundTasks.some(task => task.id === conversationId)}
                    exportBusy={exportBusy} onExport={format => { void downloadExport(format); }} onClose={() => setShareMenu(false)} />
            </FloatingPanel>

            <FloatingPanel open={tasksOpen} anchorRef={tasksRef} onClose={() => setTasksOpen(false)} label="后台任务" role="dialog" className="chat-header-menu chat-tasks-menu" align="end">
                {backgroundTasks.length ? <>
                    <p className="chat-tasks-title">进行中的任务 <span>{backgroundTasks.length}</span></p>
                    {backgroundTasks.slice(0, 6).map(task => <button key={task.id} type="button" className="chat-task-row" onClick={() => { setTasksOpen(false); router.push(`/chat?id=${encodeURIComponent(task.id)}`); }}>
                        <span className="chat-task-title">{task.title}</span>
                        <span className="chat-task-state">{AGENT_MARKER_LABELS[task.marker]}</span>
                    </button>)}
                </> : <p className="chat-header-menu-note">没有进行中的后台任务。</p>}
            </FloatingPanel>

            <FloatingPanel open={moreMenu} anchorRef={moreRef} onClose={() => setMoreMenu(false)} label="查看选项" role="dialog" align="end" className="chat-header-menu chat-header-more">
                <button ref={recordRef} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={recordOpen}
                    onClick={() => { setRecordOpen(value => !value); setExportOpen(false); }}>
                    对话记录视图<span className="chat-header-menu-chevron"><ChevronRight size={14} aria-hidden="true" /></span>
                </button>
                {conversationId && <button ref={exportRef} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={exportOpen}
                    onClick={() => { setExportOpen(value => !value); setRecordOpen(false); }}>
                    导出选项<span className="chat-header-menu-chevron"><ChevronRight size={14} aria-hidden="true" /></span>
                </button>}
            </FloatingPanel>

            {conversationId && canUseKnowledgeBase && <AddToKnowledgeBaseModal
                open={kbOpen}
                onClose={() => setKbOpen(false)}
                sourceTitle={title.slice(0, 40) || '对话'}
                sourceType="conversation"
                sourceId={conversationId}
                sourceMeta={{ conversationId }}
            />}

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
