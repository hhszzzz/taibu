/**
 * 会话置顶（claude 侧栏 Pinned 组的 taibu 对应物）：localStorage 按用户存置顶会话 id 列表，
 * 最新的置顶排在最前。纯前端偏好，不进数据库。
 */

const keyFor = (userId: string) => `taibu:pinned-conversations:${userId}`;
const MAX_PINNED = 50;

export function loadPinnedConversations(userId: string | null | undefined): string[] {
    if (!userId) return [];
    try {
        const raw = JSON.parse(localStorage.getItem(keyFor(userId)) ?? 'null');
        if (!Array.isArray(raw)) return [];
        return raw.filter((id): id is string => typeof id === 'string').slice(0, MAX_PINNED);
    } catch {
        return [];
    }
}

function savePinnedConversations(userId: string, ids: string[]): string[] {
    try {
        localStorage.setItem(keyFor(userId), JSON.stringify(ids.slice(0, MAX_PINNED)));
    } catch {
        // 隐私模式写不进去时，置顶仅在本次会话内存中生效
    }
    return ids;
}

/** 切换置顶状态并返回新的置顶列表（置顶排到最前）。 */
export function togglePinnedConversation(userId: string, conversationId: string, current: string[]): string[] {
    const next = current.includes(conversationId)
        ? current.filter(id => id !== conversationId)
        : [conversationId, ...current].slice(0, MAX_PINNED);
    return savePinnedConversations(userId, next);
}
