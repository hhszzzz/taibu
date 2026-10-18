'use client';

import type { RefObject } from 'react';
import { Pin, PinOff, SquarePen, Trash2 } from 'lucide-react';
import type { ConversationListItem } from '@/types';
import { formatConversationMenuTitle } from '@/lib/chat/conversation-title-display';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/** Desktop sidebar and mobile drawer share the same action/confirmation surface. */
export function ConversationActions({ conversation, anchorRef, view, onViewChange, onClose, onRename, onDelete, deleting, withinModal = false, pinned = false, onPin }: {
    conversation: ConversationListItem | null;
    anchorRef: RefObject<HTMLElement | null>;
    view: 'menu' | 'rename' | 'delete';
    onViewChange: (view: 'menu' | 'rename' | 'delete') => void;
    onClose: () => void;
    onRename: () => void;
    onDelete: () => Promise<unknown>;
    deleting: boolean;
    withinModal?: boolean;
    /** claude 行菜单的 Pin：纯前端置顶（localStorage），置顶项排进「已置顶」组 */
    pinned?: boolean;
    onPin?: () => void;
}) {
    return <>
        <FloatingPanel open={Boolean(conversation) && view === 'menu'} anchorRef={anchorRef} onClose={onClose} label="会话操作" className="conversation-menu" portaled={!withinModal}>
            {conversation && <>
                {onPin && <button type="button" role="menuitem" onClick={onPin} className="conversation-menu-item">{pinned ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}{pinned ? '取消置顶' : '置顶'}<kbd>P</kbd></button>}
                {conversation.sourceType === 'chat' && <button type="button" role="menuitem" onClick={onRename} className="conversation-menu-item"><SquarePen size={15} aria-hidden="true" />重命名<kbd>R</kbd></button>}
                <div className="conversation-menu-divider" role="separator" />
                <button type="button" role="menuitem" onClick={() => onViewChange('delete')} className="conversation-menu-item is-danger"><Trash2 size={15} aria-hidden="true" />删除<kbd>D</kbd></button>
            </>}
        </FloatingPanel>
        <ConfirmDialog isOpen={Boolean(conversation) && view === 'delete'} onClose={onClose} onConfirm={async () => { await onDelete(); }} loading={deleting} title="删除此聊天" description={`删除“${conversation ? formatConversationMenuTitle(conversation) : ''}”后无法恢复。`} confirmText="确认删除" />
    </>;
}
