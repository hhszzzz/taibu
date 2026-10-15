/** Conversation export downloads shared by the export dialog and the workspace overview. */
export type ConversationExportFormat = 'md' | 'html';

export const CONVERSATION_EXPORT_EVENT = 'taibu:export';

export function conversationExportUrl(conversationId: string, format: ConversationExportFormat, includeTools: boolean): string {
    return `/api/conversations/${encodeURIComponent(conversationId)}/export?format=${format}&tools=${includeTools ? '1' : '0'}`;
}

/** Downloads the current branch; throws a user-facing message when the server refuses. */
export async function downloadConversationExport(conversationId: string, format: ConversationExportFormat, includeTools: boolean): Promise<void> {
    const response = await fetch(conversationExportUrl(conversationId, format, includeTools));
    if (!response.ok) throw new Error('导出失败，请重试');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `太卜-对话.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function requestConversationExport() {
    window.dispatchEvent(new Event(CONVERSATION_EXPORT_EVENT));
}
