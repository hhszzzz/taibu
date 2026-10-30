/**
 * Chat 页面头部：会话标题菜单、工作区入口、后台任务、分享与查看选项
 *
 * 'use client' 标记说明：
 * - 菜单开关、重命名输入、分享/后台任务与删除确认需要交互状态
 */
'use client';

import { useState } from 'react';
import { ChevronDown, Ellipsis, Share2 } from 'lucide-react';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { useConversationExport } from '@/components/chat/ConversationExportDialog';
import { ShareConversationMenu } from '@/components/chat/ShareConversationMenu';
import {
    Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem,
    MenuSeparator, MenuShortcut, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger,
} from '@/components/ui/Menu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useAgentActivity } from '@/lib/agent/use-agent-activity';
import { CHAT_RECORD_VIEW_LABELS, CHAT_RECORD_VIEWS, useChatRecordView, useChatRecordViewDefault, writeChatRecordView, writeChatRecordViewDefault } from '@/lib/chat/chat-record-view';
import type { ReactNode } from 'react';
import type { ChatRecordView } from '@/lib/chat/chat-record-view';

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

/** 「对话记录视图 ▸」：标题菜单与查看选项共用同一组普通/详细与本机默认。 */
function RecordViewSubmenu({ recordView, defaultRecordView, onSelect, onSetDefault }: {
    recordView: ChatRecordView;
    defaultRecordView: ChatRecordView;
    onSelect: (view: ChatRecordView) => void;
    onSetDefault: () => void;
}) {
    return (
        <MenuSub>
            <MenuSubTrigger>对话记录视图</MenuSubTrigger>
            <MenuSubContent className="chat-header-submenu">
                <MenuRadioGroup value={recordView} onValueChange={view => onSelect(view as ChatRecordView)}>
                    {CHAT_RECORD_VIEWS.map(view => (
                        <MenuRadioItem key={view} value={view} closeOnClick>{CHAT_RECORD_VIEW_LABELS[view]}</MenuRadioItem>
                    ))}
                </MenuRadioGroup>
                {recordView !== defaultRecordView ? <>
                    <MenuSeparator />
                    <MenuItem onClick={onSetDefault}>将 {CHAT_RECORD_VIEW_LABELS[recordView]} 设为默认</MenuItem>
                </> : null}
            </MenuSubContent>
        </MenuSub>
    );
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
    const { handleRenameConversation, handleDeleteConversation } = useConversationList();
    const { showToast } = useToast();
    const [titleMenu, setTitleMenu] = useState(false);
    const [moreMenu, setMoreMenu] = useState(false);
    const [shareMenu, setShareMenu] = useState(false);
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
    const selectRecordView = (view: ChatRecordView) => writeChatRecordView(userId, view, conversationId);
    const makeRecordViewDefault = () => writeChatRecordViewDefault(userId, recordView);

    return (
        <header className={`chat-session-header${empty ? ' is-empty' : ''}`}>
            {navigation}
            <h1 className="chat-session-title">
                {conversationId ? renaming !== null ? (
                    /* 内联重命名 = 克隆站 TopBar：输入框直接替换标题（h-7 / r7 / 5% 底），Enter 保存、Esc 取消、失焦提交。 */
                    <Input className="chat-rename-inline" aria-label="重命名" autoFocus
                        value={renaming} maxLength={120} disabled={renameBusy}
                        onChange={event => setRenaming(event.target.value)}
                        onBlur={() => { if (!renaming?.trim()) setRenaming(null); else void saveRename(); }}
                        onKeyDown={event => {
                            if (event.key === 'Enter') { event.preventDefault(); void saveRename(); }
                            else if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); }
                        }} />
                ) : (
                    <Menu open={titleMenu} onOpenChange={setTitleMenu}>
                        <MenuTrigger className="chat-title-button" title={title}>
                            <span>{title}</span><ChevronDown size={16} aria-hidden="true" />
                        </MenuTrigger>
                        {/* 会话标题菜单 = claude 词表：重命名 R / 复制链接 C / 加入知识库 A / 对话记录视图 ▸ / 删除对话 D */}
                        <MenuContent letterShortcuts className="chat-header-menu">
                            <MenuItem className="chat-header-menu-item" onClick={() => setRenaming(title)}>重命名<MenuShortcut>R</MenuShortcut></MenuItem>
                            <MenuItem className="chat-header-menu-item" onClick={() => { void copyConversationLink(); }}>复制链接<MenuShortcut>C</MenuShortcut></MenuItem>
                            {canUseKnowledgeBase && <MenuItem className="chat-header-menu-item" onClick={() => setKbOpen(true)}>加入知识库<MenuShortcut>A</MenuShortcut></MenuItem>}
                            <MenuSeparator />
                            <RecordViewSubmenu recordView={recordView} defaultRecordView={defaultRecordView}
                                onSelect={selectRecordView} onSetDefault={makeRecordViewDefault} />
                            <MenuSeparator />
                            <MenuItem tone="danger" className="chat-header-menu-item" onClick={() => setDeleting(true)}>删除对话<MenuShortcut>D</MenuShortcut></MenuItem>
                        </MenuContent>
                    </Menu>
                ) : <span className="chat-title-text" title={title}>{title}</span>}
            </h1>
            <div className="chat-session-actions">
                {workspaceButton}
                {conversationId ? (
                    <Menu open={shareMenu} onOpenChange={setShareMenu}>
                        <MenuTrigger className="chat-header-share">
                            <Share2 size={15} aria-hidden="true" /><span>分享</span>
                        </MenuTrigger>
                        <MenuContent sideOffset={6} align="end" className="chat-header-menu w-[min(20rem,calc(100vw-2rem))]" aria-label="分享">
                            <ShareConversationMenu conversationId={conversationId} taskActive={markers.get(conversationId) === 'running' || markers.get(conversationId) === 'awaiting'}
                                exportBusy={exportBusy} onExport={format => { void downloadExport(format); }} onClose={() => setShareMenu(false)} />
                        </MenuContent>
                    </Menu>
                ) : (
                    <Button variant="ghost" className="chat-header-share" disabled>
                        <Share2 size={15} aria-hidden="true" /><span>分享</span>
                    </Button>
                )}
                <Menu open={moreMenu} onOpenChange={setMoreMenu}>
                    <MenuTrigger className="chat-header-icon" aria-label="查看选项" title="查看选项">
                        <Ellipsis size={18} aria-hidden="true" />
                    </MenuTrigger>
                    <MenuContent sideOffset={6} align="end" className="chat-header-menu chat-header-more">
                        <RecordViewSubmenu recordView={recordView} defaultRecordView={defaultRecordView}
                            onSelect={selectRecordView} onSetDefault={makeRecordViewDefault} />
                        {conversationId ? (
                            <MenuSub>
                                <MenuSubTrigger>导出选项</MenuSubTrigger>
                                <MenuSubContent className="chat-header-submenu">
                                    <MenuItem disabled={exportBusy !== null} onClick={() => { void downloadExport('md'); }}>{exportBusy === 'md' ? '正在导出…' : 'Markdown'}</MenuItem>
                                    <MenuItem disabled={exportBusy !== null} onClick={() => { void downloadExport('html'); }}>{exportBusy === 'html' ? '正在导出…' : 'HTML'}</MenuItem>
                                    <MenuSeparator />
                                    <MenuCheckboxItem checked={exportTools} closeOnClick={false}
                                        disabled={exportBusy !== null} onCheckedChange={setExportTools}>
                                        包含工具调用参数与原始结果
                                    </MenuCheckboxItem>
                                </MenuSubContent>
                            </MenuSub>
                        ) : null}
                    </MenuContent>
                </Menu>
            </div>

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
