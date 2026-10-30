/**
 * 单个对话行组件
 *
 * 'use client' 标记说明：
 * - 需要处理用户交互事件
 */
'use client';

import { memo, useRef } from 'react';
import { Archive, Check, Ellipsis, X } from 'lucide-react';
import { MenuTrigger, type MenuHandle } from '@/components/ui/Menu';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getConversationDisplayParts } from '@/lib/chat/conversation-title-display';
import type { ConversationListItem } from '@/types';

interface ConversationItemProps {
    conv: ConversationListItem;
    isActive: boolean;
    isSidebarCollapsed: boolean;
    onSelect: (id: string) => void;
    /** Row menus are detached triggers of one root in the list. */
    menu: MenuHandle<ConversationListItem>;
    isEditing?: boolean;
    editTitle?: string;
    onEditTitleChange?: (value: string) => void;
    onSaveRename?: () => void;
    onCancelRename?: () => void;
    /** 紧凑模式 — 内嵌侧边栏时使用更小间距 */
    compact?: boolean;
}

export const ConversationItem = memo(function ConversationItem({
    conv,
    isActive,
    isSidebarCollapsed,
    onSelect,
    menu,
    isEditing = false,
    editTitle = '',
    onEditTitleChange,
    onSaveRename,
    onCancelRename,
    compact = false,
}: ConversationItemProps) {
    const { mainTitle, subTitle, changedTitle } = getConversationDisplayParts(conv);

    // Enter / Esc 已经结束编辑时，随后卸载触发的失焦不再重复提交。
    const settledRef = useRef(false);
    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            settledRef.current = true;
            onSaveRename?.();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            settledRef.current = true;
            onCancelRename?.();
        }
    };
    // 与标题栏一致：失焦即保存；清空或未改动则视为取消。
    const handleBlur = () => {
        if (settledRef.current) return;
        const next = editTitle.trim();
        if (next && next !== conv.title) onSaveRename?.();
        else onCancelRename?.();
    };

    // Compact: 用于内嵌侧边栏
    if (compact) {
        if (isEditing) {
            return (
                <div
                    data-conversation-row="true"
                    className="flex items-center gap-1.5 px-0.5 py-0.5 rounded-md bg-background-secondary border border-border"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Input
                        type="text"
                        value={editTitle}
                        onChange={(e) => onEditTitleChange?.(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onFocus={() => { settledRef.current = false; }}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        className="min-w-0 flex-1 rounded-md bg-background border border-border px-2 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-accent/10 focus:border-accent"
                    />
                    <Button unstyled
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                            e.stopPropagation();
                            onCancelRename?.();
                        }}
                        className="rounded-md text-foreground-secondary hover:bg-background hover:text-foreground transition-colors"
                        aria-label="取消重命名"
                    >
                        <X className="w-4.5 h-4.5" />
                    </Button>
                    <Button unstyled
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                            e.stopPropagation();
                            onSaveRename?.();
                        }}
                        disabled={!editTitle.trim()}
                        className="rounded-md text-accent hover:bg-accent/10 disabled:opacity-50 transition-colors"
                        aria-label="确认重命名"
                    >
                        <Check className="w-4.5 h-4.5" />
                    </Button>
                </div>
            );
        }

        return (
            <div
                data-conversation-row="true"
                className={`
                    group flex items-center gap-2 px-3 py-1 rounded-md cursor-pointer
                    transition-colors duration-150 text-[14px]
                    ${isActive ? 'bg-background-secondary text-foreground' : 'text-foreground hover:bg-background-secondary has-[[data-popup-open]]:bg-background-secondary'}
                `}
            >
                <Button unstyled type="button" onClick={() => onSelect(conv.id)} aria-current={isActive ? 'page' : undefined} className="flex-1 min-w-0 text-left flex flex-col focus-visible:outline-2 focus-visible:outline-accent rounded">
                    <span className="truncate font-medium flex items-center gap-1">
                        <span className="truncate">{mainTitle}</span>
                        {changedTitle && (
                            <>
                                <span className="text-[10px] text-foreground-secondary shrink-0">变</span>
                                <span className="truncate">{changedTitle}</span>
                            </>
                        )}
                    </span>
                    {subTitle && (
                        <span className="text-[11px] text-foreground-secondary truncate -mt-0.5">
                            {subTitle}
                        </span>
                    )}
                </Button>
                {conv.isArchived && (
                    <Archive className="w-3.5 h-3.5 text-foreground-secondary flex-shrink-0" />
                )}
                <div className="flex-shrink-0 transition-opacity opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 has-[[data-popup-open]]:opacity-100">
                    <MenuTrigger
                        handle={menu}
                        payload={conv}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded p-1 text-foreground-secondary hover:bg-background-tertiary hover:text-foreground data-popup-open:bg-background-tertiary data-popup-open:text-foreground"
                        aria-label="更多操作"
                    >
                        <Ellipsis className="w-4 h-4" />
                    </MenuTrigger>
                </div>
            </div>
        );
    }

    if (isEditing) {
        return (
            <div
                data-conversation-row="true"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background-secondary border border-border"
                onClick={(e) => e.stopPropagation()}
            >
                <Input
                    type="text"
                    value={editTitle}
                    onChange={(e) => onEditTitleChange?.(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => { settledRef.current = false; }}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    className="min-w-0 flex-1 rounded-md bg-background border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/10 focus:border-accent"
                />
                <Button unstyled
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                        e.stopPropagation();
                        onCancelRename?.();
                    }}
                    className="p-1.5 rounded-md text-foreground-secondary hover:bg-background hover:text-foreground transition-colors"
                    aria-label="取消重命名"
                >
                    <X className="w-4 h-4" />
                </Button>
                <Button unstyled
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSaveRename?.();
                    }}
                    disabled={!editTitle.trim()}
                    className="p-1.5 rounded-md text-accent hover:bg-accent/10 disabled:opacity-50 transition-colors"
                    aria-label="确认重命名"
                >
                    <Check className="w-4 h-4" />
                </Button>
            </div>
        );
    }

    return (
        <div
            data-conversation-row="true"
            className={`
                group flex ${subTitle ? 'items-start' : 'items-center'} gap-3 px-4 py-2 rounded-lg cursor-pointer
                transition-colors text-sm
                ${isActive ? 'bg-background-secondary' : 'hover:bg-background-secondary has-[[data-popup-open]]:bg-background-secondary'}
            `}
        >
            <Button unstyled type="button" onClick={() => onSelect(conv.id)} aria-current={isActive ? 'page' : undefined} className="flex-1 min-w-0 text-left focus-visible:outline-2 focus-visible:outline-accent rounded">
                <span className="text-sm truncate flex items-center gap-1">
                    <span className="truncate">{mainTitle}</span>
                    {changedTitle && (
                        <>
                            <span className="text-[10px] text-foreground-secondary shrink-0">变</span>
                            <span className="truncate">{changedTitle}</span>
                        </>
                    )}
                </span>
                {subTitle && (
                    <p className="text-[11px] text-foreground-secondary truncate mt-0.5">
                        {subTitle}
                    </p>
                )}
            </Button>
            {conv.isArchived && (
                <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border bg-background-tertiary text-[10px] text-foreground-secondary flex-shrink-0 ${subTitle ? 'mt-0.5' : ''}`}
                    title={
                        Array.isArray(conv.archivedKbIds) && conv.archivedKbIds.length
                            ? `已归档到 ${conv.archivedKbIds.length} 个知识库`
                            : '已归档到知识库'
                    }
                >
                    <Archive className="w-3 h-3" />
                    {!isSidebarCollapsed && <span>归档</span>}
                </span>
            )}
            <div className={`flex items-center flex-shrink-0 transition-opacity has-[[data-popup-open]]:opacity-100 ${subTitle ? 'mt-0.5' : ''} opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100`}>
                <MenuTrigger
                    handle={menu}
                    payload={conv}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded p-1.5 text-foreground-secondary hover:bg-background-tertiary hover:text-foreground data-popup-open:bg-background-tertiary data-popup-open:text-foreground"
                    aria-label="更多操作"
                >
                    <Ellipsis className="w-4 h-4" />
                </MenuTrigger>
            </div>
        </div>
    );
});
