/**
 * 虚拟化聊天消息列表
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useRef, useEffect, useCallback)
 * - 使用 @tanstack/react-virtual 进行虚拟滚动
 */
'use client';

import { useEffect, type MutableRefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ChatMessage, Mention } from '@/types';
import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
import { AgentRoundRow, isFoldedAway, type AgentRoundFolding } from '@/components/chat/agent/AgentRoundFold';

interface VirtualizedChatMessageListProps {
    scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
    messages: ChatMessage[];
    isLoading: boolean;
    onEditMessage?: (messageId: string, newContent: string, mentions?: Mention[]) => void;
    onRegenerateResponse?: (messageId: string) => void;
    onSwitchVersion?: (messageId: string, versionIndex: number) => void;
    onArchiveMessage?: (message: ChatMessage) => void;
    disabled?: boolean;
    /** Earlier Agent rounds fold to one bar each; their other rows stay as empty, hidden rows. */
    rounds?: AgentRoundFolding;
}

// 估算消息高度（用于虚拟化初始计算）
function estimateMessageHeight(message: ChatMessage): number {
    const baseHeight = 80; // 基础高度（padding + 操作按钮）
    const contentLength = message.content.length;
    const reasoningLength = message.reasoning?.length || 0;

    // 根据内容长度估算行数（假设每行约 60 个字符）
    const contentLines = Math.ceil(contentLength / 60);
    const reasoningLines = Math.ceil(reasoningLength / 60);

    // 每行约 24px
    const contentHeight = contentLines * 24;
    const reasoningHeight = reasoningLines * 20;

    // 附件额外高度
    const attachmentHeight = message.attachments?.fileName ? 60 : 0;

    return baseHeight + contentHeight + reasoningHeight + attachmentHeight;
}

// A folded round shows its 44px bar in a padded row and nothing else; unfolded, the bar keeps 20px from the message.
function estimateRowHeight(message: ChatMessage, rounds: AgentRoundFolding | undefined): number {
    const fold = rounds?.folds.get(message.id);
    if (!fold) return estimateMessageHeight(message);
    const open = rounds?.unfolded.has(fold.round.id) ?? false;
    if (!fold.first) return open ? estimateMessageHeight(message) : 0;
    return open ? 64 + estimateMessageHeight(message) : 68;
}

export function VirtualizedChatMessageList({
    scrollContainerRef: parentRef,
    messages,
    isLoading,
    onEditMessage,
    onRegenerateResponse,
    onSwitchVersion,
    onArchiveMessage,
    disabled = false,
    rounds,
}: VirtualizedChatMessageListProps) {

    // 找到最后一条正在流式输出的AI消息
    const lastMessage = messages[messages.length - 1];
    const isStreamingAI = isLoading && lastMessage?.role === 'assistant';

    // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual 库特性，不影响功能
    const virtualizer = useVirtualizer({
        count: messages.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (index) => estimateRowHeight(messages[index], rounds),
        overscan: 5, // 预渲染上下各 5 条消息
        getItemKey: (index) => messages[index]?.id || `msg-${index}`,
    });

    const virtualItems = virtualizer.getVirtualItems();
    useEffect(() => {
        const element = parentRef.current;
        const locate = (event: Event) => {
            const id = (event as CustomEvent<string>).detail;
            const index = messages.findIndex(message => message.id === id);
            if (index < 0) return;
            virtualizer.scrollToIndex(index, { align: 'start' });
            // Remeasure after the target mounts; no guessed scroll offsets.
            requestAnimationFrame(() => virtualizer.scrollToIndex(index, { align: 'start' }));
        };
        element?.addEventListener('taibu:locate-message', locate);
        return () => element?.removeEventListener('taibu:locate-message', locate);
    }, [messages, parentRef, virtualizer]);

    return (
        <div
            ref={parentRef}
            className="chat-virtual-scroller h-full overflow-auto"
            aria-label="聊天记录"
            tabIndex={0}
            style={{ contain: 'strict' }}
        >
            <div
                className="chat-transcript-list max-w-3xl mx-auto relative"
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                }}
            >
                <div
                    className="absolute top-0 left-0 w-full"
                    style={{
                        transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
                    }}
                >
                    {virtualItems.map((virtualRow) => {
                        const message = messages[virtualRow.index];
                        if (!message) return null;
                        // Indexes stay one per message, so jumps to a message keep working while its round is folded.
                        const hidden = isFoldedAway(rounds, message.id);

                        return (
                            <div
                                key={virtualRow.key}
                                data-index={virtualRow.index}
                                ref={virtualizer.measureElement}
                                className="chat-transcript-row"
                                hidden={hidden}
                            >
                                {hidden ? null : <AgentRoundRow rounds={rounds} messageId={message.id}>
                                    <ChatMessageItem
                                        message={message}
                                        isStreamingAI={isStreamingAI}
                                        isLastMessage={virtualRow.index === messages.length - 1}
                                        disabled={disabled}
                                        onEditMessage={onEditMessage}
                                        onRegenerateResponse={onRegenerateResponse}
                                        onSwitchVersion={onSwitchVersion}
                                        onArchiveMessage={onArchiveMessage}
                                    />
                                </AgentRoundRow>}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
