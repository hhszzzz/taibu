/**
 * 对话列表排序偏好（claude 分组头「分组和排序」的 taibu 对应物）：localStorage 按用户存，
 * 作用于日期分组内与置顶组内的排序。纯前端偏好，不进数据库。
 */

const keyFor = (userId: string) => `taibu:conversation-sort:${userId}`;

export type ConversationSortMode = 'recent' | 'title';
export const CONVERSATION_SORT_LABELS: Record<ConversationSortMode, string> = { recent: '最近活动', title: '标题 A→Z' };
export const CONVERSATION_SORT_MODES = Object.keys(CONVERSATION_SORT_LABELS) as ConversationSortMode[];

export function loadConversationSort(userId: string | null | undefined): ConversationSortMode {
    if (!userId) return 'recent';
    try {
        const raw = localStorage.getItem(keyFor(userId));
        return raw === 'title' ? 'title' : 'recent';
    } catch {
        return 'recent';
    }
}

export function saveConversationSort(userId: string, mode: ConversationSortMode): void {
    try {
        localStorage.setItem(keyFor(userId), mode);
    } catch {
        // 隐私模式写不进去时，排序仅在本次会话内存中生效
    }
}
