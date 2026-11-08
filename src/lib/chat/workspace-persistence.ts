/**
 * 新对话的草稿和它发出的第一条消息是同一段对话：右侧工作区的打开标记与选中页
 * 存在草稿的 key 下，拿到正式会话 ID 后要把它们带过去，否则面板会在发送后消失。
 */
const WORKSPACE_KEYS = ['taibu.workspace-open:', 'taibu.workspace:'] as const;

export function carryDraftWorkspace(
    storage: Pick<Storage, 'getItem' | 'setItem'>,
    userId: string,
    conversationId: string,
): void {
    for (const prefix of WORKSPACE_KEYS) {
        const from = `${prefix}${userId}:new`;
        const to = `${prefix}${userId}:${conversationId}`;
        try {
            if (storage.getItem(to) !== null) continue;
            const value = storage.getItem(from);
            if (value !== null) storage.setItem(to, value);
        } catch { /* Storage may be unavailable. */ }
    }
}
