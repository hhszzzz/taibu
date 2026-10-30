/**
 * 对话分组组件（按类型分组的一个区块）
 *
 * 行样式与对话页侧栏共用 `ConversationNavItem`（.chat-nav-row），
 * 站点侧栏与 /chat 侧栏的对话记录保持同一外观。
 *
 * 'use client' 标记说明：
 * - 需要处理用户交互事件（折叠/展开）
 */
'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ConversationListItem, ConversationSourceType } from '@/types';
import { ConversationMarker, ConversationNavItem } from '@/components/chat/sidebar/ConversationNavItem';
import type { ConversationAgentMarker } from '@/lib/agent/activity';
import type { MenuHandle } from '@/components/ui/Menu';
import { Button } from '@/components/ui/Button';

interface ConversationGroupProps {
    type: ConversationSourceType;
    label: string;
    items: ConversationListItem[];
    showLabel?: boolean;
    isGroupCollapsed: boolean;
    onToggleGroup: (type: ConversationSourceType) => void;
    activeId?: string;
    menu: MenuHandle<ConversationListItem>;
    editingId?: string | null;
    editTitle?: string;
    onEditTitleChange?: (value: string) => void;
    onSaveRename?: () => void;
    onCancelRename?: () => void;
    pendingTitle?: string | null;
    showPendingInGroup: boolean;
    markers?: ReadonlyMap<string, ConversationAgentMarker>;
    /** 紧凑模式 — 内嵌侧边栏时使用更小间距 */
    compact?: boolean;
}

export function ConversationGroup({
    type,
    label,
    items,
    showLabel = true,
    isGroupCollapsed,
    onToggleGroup,
    activeId,
    menu,
    editingId,
    editTitle,
    onEditTitleChange,
    onSaveRename,
    onCancelRename,
    pendingTitle,
    showPendingInGroup,
    markers,
    compact = false,
}: ConversationGroupProps) {
    const displayCount = items.length + (showPendingInGroup ? 1 : 0);
    const shouldShowContent = showLabel ? !isGroupCollapsed : true;

    return (
        <div className={compact ? 'mb-1' : 'mb-2'}>
            {/* 分组标题 */}
            {showLabel && (
                <Button unstyled
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleGroup(type);
                    }}
                    className={`flex items-center w-full text-foreground-secondary hover:text-foreground transition-colors duration-150 ${compact ? 'px-3 py-1 text-[10px] gap-1' : 'px-3 py-1.5 text-xs gap-2'}`}
                >
                    {isGroupCollapsed ? (
                        <ChevronRight className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                    ) : (
                        <ChevronDown className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                    )}
                    <span className="font-bold uppercase tracking-wider">{label}</span>
                    <span className="ml-auto font-mono opacity-50">
                        {displayCount}
                    </span>
                </Button>
            )}

            {/* 分组内容 */}
            {shouldShowContent && (
                <div className="space-y-0.5">
                    {showPendingInGroup && (
                        <div data-conversation-row="true" className="chat-nav-row" data-pending="true">
                            <span className="chat-nav-row-link">
                                <span className="chat-nav-row-title">{pendingTitle}</span>
                                <ConversationMarker marker="running" />
                            </span>
                        </div>
                    )}
                    {items.map(conv => (
                        <ConversationNavItem
                            key={conv.id}
                            conv={conv}
                            isActive={activeId === conv.id}
                            marker={markers?.get(conv.id)}
                            menu={menu}
                            isEditing={editingId === conv.id}
                            editTitle={editingId === conv.id ? editTitle : ''}
                            onEditTitleChange={editingId === conv.id ? onEditTitleChange : undefined}
                            onSaveRename={editingId === conv.id ? onSaveRename : undefined}
                            onCancelRename={editingId === conv.id ? onCancelRename : undefined}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
