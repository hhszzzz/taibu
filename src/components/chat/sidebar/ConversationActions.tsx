'use client';

import { Pin, PinOff, SquarePen, Trash2 } from 'lucide-react';
import type { ConversationListItem } from '@/types';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuShortcut, type MenuHandle } from '@/components/ui/Menu';

/** Desktop sidebar and mobile drawer share the same row menu; each row opens it with its conversation payload. */
export function ConversationMenu({ menu, onRename, onDelete, onPin, pinned }: {
    menu: MenuHandle<ConversationListItem>;
    onRename: (conversation: ConversationListItem) => void;
    onDelete: (conversation: ConversationListItem) => void;
    onPin: (conversation: ConversationListItem) => void;
    pinned: (conversation: ConversationListItem) => boolean;
}) {
    return (
        <Menu handle={menu}>
            {({ payload }) => payload ? (
                <MenuContent letterShortcuts className="conversation-menu" aria-label="会话操作">
                    <MenuItem className="conversation-menu-item" onClick={() => onPin(payload)}>
                        {pinned(payload) ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
                        {pinned(payload) ? '取消置顶' : '置顶'}<MenuShortcut>P</MenuShortcut>
                    </MenuItem>
                    {payload.sourceType === 'chat' && (
                        <MenuItem className="conversation-menu-item" onClick={() => onRename(payload)}>
                            <SquarePen size={15} aria-hidden="true" />重命名<MenuShortcut>R</MenuShortcut>
                        </MenuItem>
                    )}
                    <MenuSeparator />
                    <MenuItem tone="danger" className="conversation-menu-item" onClick={() => onDelete(payload)}>
                        <Trash2 size={15} aria-hidden="true" />删除<MenuShortcut>D</MenuShortcut>
                    </MenuItem>
                </MenuContent>
            ) : null}
        </Menu>
    );
}
