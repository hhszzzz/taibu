/**
 * 聊天消息列表组件
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useMemo)
 * - 需要传递 ref 给子组件
 */
'use client';

import { useMemo } from 'react';
import type { ChatMessage, Mention } from '@/types';
import { ChatMessageItem } from '@/components/chat/ChatMessageItem';

interface ChatMessageListProps {
    messages: ChatMessage[];
    isLoading: boolean;
    messagesEndRef: React.RefObject<HTMLDivElement | null>;
    onEditMessage?: (messageId: string, newContent: string, mentions?: Mention[]) => void;
    onRegenerateResponse?: (messageId: string) => void;
    onSwitchVersion?: (messageId: string, versionIndex: number) => void;
    onArchiveMessage?: (message: ChatMessage) => void;
    disabled?: boolean;
}

export function ChatMessageList({
    messages,
    isLoading,
    messagesEndRef,
    onEditMessage,
    onRegenerateResponse,
    onSwitchVersion,
    onArchiveMessage,
    disabled = false,
}: ChatMessageListProps) {
    // 找到最后一条正在流式输出的AI消息
    const lastMessage = messages[messages.length - 1];
    const isStreamingAI = useMemo(
        () => isLoading && lastMessage?.role === 'assistant',
        [isLoading, lastMessage?.role]
    );

    return (
        <div className="chat-transcript-list mx-auto">
            {messages.map((message, index) => (
                <div
                    key={message.id || `msg-${index}`}
                    className="chat-transcript-row"
                    data-role={message.role}
                    data-motion-key={index}
                >
                    <ChatMessageItem
                        message={message}
                        isStreamingAI={isStreamingAI}
                        isLastMessage={index === messages.length - 1}
                        disabled={disabled}
                        onEditMessage={onEditMessage}
                        onRetryMessage={message.role === 'user' && messages[index + 1]?.role === 'assistant' && onRegenerateResponse ? () => onRegenerateResponse(messages[index + 1].id) : undefined}
                        onRegenerateResponse={onRegenerateResponse}
                        onSwitchVersion={onSwitchVersion}
                        onArchiveMessage={onArchiveMessage}
                    />
                </div>
            ))}

            <div ref={messagesEndRef} />
        </div>
    );
}
