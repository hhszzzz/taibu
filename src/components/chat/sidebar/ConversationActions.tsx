'use client';

import { useState } from 'react';
import type { ConversationListItem } from '@/types';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuShortcut, type MenuHandle } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { formatConversationMenuTitle } from '@/lib/chat/conversation-title-display';
import { conversationHref } from '@/lib/chat/conversation-href';

/** Desktop sidebar and mobile drawer share the same row menu; each row opens it with its conversation payload. */
export function ConversationMenu({ menu, onRename, onDelete, onPin, pinned, knowledgeBaseEnabled = false }: {
    menu: MenuHandle<ConversationListItem>;
    onRename: (conversation: ConversationListItem) => void;
    onDelete: (conversation: ConversationListItem) => void;
    onPin: (conversation: ConversationListItem) => void;
    pinned: (conversation: ConversationListItem) => boolean;
    knowledgeBaseEnabled?: boolean;
}) {
    const { showToast } = useToast();
    const [kbTarget, setKbTarget] = useState<ConversationListItem | null>(null);
    const copyLink = async (conversation: ConversationListItem) => {
        const url = `${window.location.origin}${conversationHref(conversation)}`;
        try {
            await navigator.clipboard.writeText(url);
            showToast('success', '已复制链接');
        } catch {
            showToast('error', '复制失败，请手动复制地址栏链接');
        }
    };
    return <>
        <Menu handle={menu}>
            {({ payload }) => payload ? (
                <MenuContent letterShortcuts className="conversation-menu" aria-label="会话操作">
                    <MenuItem className="conversation-menu-item" onClick={() => onPin(payload)}>
                        {pinned(payload) ? '取消置顶' : '置顶'}<MenuShortcut>P</MenuShortcut>
                    </MenuItem>
                    {payload.sourceType === 'chat' && (
                        <MenuItem className="conversation-menu-item" onClick={() => onRename(payload)}>
                            重命名<MenuShortcut>R</MenuShortcut>
                        </MenuItem>
                    )}
                    <MenuItem className="conversation-menu-item" onClick={() => { void copyLink(payload); }}>
                        复制链接<MenuShortcut>C</MenuShortcut>
                    </MenuItem>
                    {knowledgeBaseEnabled && (
                        <MenuItem className="conversation-menu-item" onClick={() => setKbTarget(payload)}>
                            加入知识库<MenuShortcut>A</MenuShortcut>
                        </MenuItem>
                    )}
                    <MenuSeparator />
                    <MenuItem tone="danger" className="conversation-menu-item" onClick={() => onDelete(payload)}>
                        删除<MenuShortcut>D</MenuShortcut>
                    </MenuItem>
                </MenuContent>
            ) : null}
        </Menu>
        {kbTarget && <AddToKnowledgeBaseModal open onClose={() => setKbTarget(null)}
            sourceTitle={formatConversationMenuTitle(kbTarget).slice(0, 40) || '对话'} sourceType="conversation"
            sourceId={kbTarget.id} sourceMeta={{ conversationId: kbTarget.id }} />}
    </>;
}
