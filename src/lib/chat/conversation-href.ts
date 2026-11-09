/** `/chat?id=…`，Agent 会话再加 `mode=agent`，可带要定位的消息。 */
export function conversationHref(conversation: { id: string; hasAgentRun?: boolean }, messageId?: string | null): string {
    const params = [`id=${encodeURIComponent(conversation.id)}`];
    if (conversation.hasAgentRun === true) params.push('mode=agent');
    if (messageId) params.push(`message=${encodeURIComponent(messageId)}`);
    return `/chat?${params.join('&')}`;
}
