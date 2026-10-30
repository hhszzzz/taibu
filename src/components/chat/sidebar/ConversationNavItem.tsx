/**
 * 对话侧栏中的一行：单行标题 + 任务标记（执行中 / 待回答）。
 * 完成/失败只走右下角 Toast，不再在侧栏重复未读圆点。
 *
 * 'use client' 标记说明：
 * - 需要处理更多操作与重命名的交互事件
 */
'use client';

import { memo } from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { MenuTrigger, type MenuHandle } from '@/components/ui/Menu';
import Link from 'next/link';
import { Archive, Clock, Cloud, Ellipsis, LoaderCircle } from 'lucide-react';
// The shared conversation lists render this row outside the chat page too.
import './chat-sidebar.css';
import { formatConversationMenuTitle } from '@/lib/chat/conversation-title-display';
import { AGENT_MARKER_LABELS, type ConversationAgentMarker } from '@/lib/agent/activity';
import type { ConversationListItem } from '@/types';
import { ConversationItem } from './ConversationItem';

interface ConversationNavItemProps {
    conv: ConversationListItem;
    isActive: boolean;
    marker?: ConversationAgentMarker;
    menu: MenuHandle<ConversationListItem>;
    isEditing?: boolean;
    editTitle?: string;
    onEditTitleChange?: (value: string) => void;
    onSaveRename?: () => void;
    onCancelRename?: () => void;
}

const ignoreSelect = () => {};

export function ConversationMarker({ marker }: { marker: ConversationAgentMarker }) {
    if (marker === 'running') return <LoaderCircle size={13} strokeWidth={2.4} className="chat-nav-marker is-running" role="img" aria-label={AGENT_MARKER_LABELS.running} />;
    return <span className="chat-nav-marker is-awaiting">{AGENT_MARKER_LABELS.awaiting}</span>;
}

export const ConversationNavItem = memo(function ConversationNavItem({
    conv,
    isActive,
    marker,
    menu,
    isEditing = false,
    editTitle = '',
    onEditTitleChange,
    onSaveRename,
    onCancelRename,
}: ConversationNavItemProps) {
    if (isEditing) {
        return (
            <ConversationItem conv={conv} compact isEditing isActive={isActive} isSidebarCollapsed={false}
                onSelect={ignoreSelect} menu={menu} editTitle={editTitle} onEditTitleChange={onEditTitleChange}
                onSaveRename={onSaveRename} onCancelRename={onCancelRename} />
        );
    }
    const title = formatConversationMenuTitle(conv);
    return (
        <div data-conversation-row="true" className="chat-nav-row" data-active={isActive || undefined}>
            <Link href={`/chat?id=${encodeURIComponent(conv.id)}`} aria-current={isActive ? 'page' : undefined} className="chat-nav-row-link" title={title}>
                <span className="chat-nav-row-title">{title}</span>
                <span className="chat-nav-row-badges">
                    {marker ? <ConversationMarker marker={marker} /> : null}
                    {conv.isScheduled ? <span className="chat-nav-row-cloud" role="img" aria-label="定时任务"><Clock size={13} /></span> : null}
                    {conv.hasAgentRun ? <span className="chat-nav-row-cloud" role="img" aria-label="云端任务"><Cloud size={13} /></span> : null}
                    {conv.isArchived ? <Archive size={13} className="chat-nav-row-archived" role="img" aria-label="已归档到知识库" /> : null}
                </span>
            </Link>
            <Tooltip label="更多">
                <MenuTrigger
                    handle={menu}
                    payload={conv}
                    onClick={(e) => e.stopPropagation()}
                    className="chat-nav-row-more"
                    aria-label="更多操作"
                >
                    <Ellipsis size={16} aria-hidden="true" />
                </MenuTrigger>
            </Tooltip>
        </div>
    );
});
