/**
 * 对话侧栏中的一行：单行标题 + 任务标记（执行中 / 待回答 / 有新回答）。
 * 标题是指向对话的链接；重命名时沿用 ConversationItem 的紧凑编辑框。
 *
 * 'use client' 标记说明：
 * - 需要处理更多操作与重命名的交互事件
 */
'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Archive, Ellipsis, LoaderCircle } from 'lucide-react';
import { formatConversationMenuTitle } from '@/lib/chat/conversation-title-display';
import { AGENT_MARKER_LABELS, type ConversationAgentMarker } from '@/lib/agent/activity';
import type { ConversationListItem } from '@/types';
import { ConversationItem } from './ConversationItem';

interface ConversationNavItemProps {
    conv: ConversationListItem;
    isActive: boolean;
    isActionActive: boolean;
    marker?: ConversationAgentMarker;
    onOpenAction: (conv: ConversationListItem, e: React.MouseEvent) => void;
    isEditing?: boolean;
    editTitle?: string;
    onEditTitleChange?: (value: string) => void;
    onSaveRename?: () => void;
    onCancelRename?: () => void;
}

const ignoreSelect = () => {};

export function ConversationMarker({ marker }: { marker: ConversationAgentMarker }) {
    if (marker === 'running') return <LoaderCircle size={13} strokeWidth={2.4} className="chat-nav-marker is-running" role="img" aria-label={AGENT_MARKER_LABELS.running} />;
    if (marker === 'awaiting') return <span className="chat-nav-marker is-awaiting">{AGENT_MARKER_LABELS.awaiting}</span>;
    return <span className="chat-nav-marker is-answered" role="img" aria-label={AGENT_MARKER_LABELS.answered} />;
}

export const ConversationNavItem = memo(function ConversationNavItem({
    conv,
    isActive,
    isActionActive,
    marker,
    onOpenAction,
    isEditing = false,
    editTitle = '',
    onEditTitleChange,
    onSaveRename,
    onCancelRename,
}: ConversationNavItemProps) {
    if (isEditing) {
        return (
            <ConversationItem conv={conv} compact isEditing isActive={isActive} isActionActive={isActionActive} isSidebarCollapsed={false}
                onSelect={ignoreSelect} onOpenAction={onOpenAction} editTitle={editTitle} onEditTitleChange={onEditTitleChange}
                onSaveRename={onSaveRename} onCancelRename={onCancelRename} />
        );
    }
    const title = formatConversationMenuTitle(conv);
    return (
        <div data-conversation-row="true" className="chat-nav-row" data-active={isActive || undefined} data-menu-open={isActionActive || undefined}>
            <Link href={`/chat?id=${encodeURIComponent(conv.id)}`} aria-current={isActive ? 'page' : undefined} className="chat-nav-row-link" title={title}>
                <span className="chat-nav-row-title">{title}</span>
                {conv.isArchived ? <Archive size={13} className="chat-nav-row-archived" role="img" aria-label="已归档到知识库" /> : null}
                {marker ? <ConversationMarker marker={marker} /> : null}
            </Link>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onOpenAction(conv, e);
                }}
                className="chat-nav-row-more"
                aria-label={`${title} 的更多操作`}
                aria-haspopup="menu"
                aria-expanded={isActionActive}
            >
                <Ellipsis size={16} aria-hidden="true" />
            </button>
        </div>
    );
});
