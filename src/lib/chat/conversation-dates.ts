/**
 * Groups conversations by their last activity for the chat sidebar
 * (今天 / 昨天 / 7 天内 / 30 天内 / 更早). Days are local calendar days, so a
 * conversation from 23:50 yesterday is 昨天 even ten minutes later.
 */

export type ConversationDateGroupKey = 'today' | 'yesterday' | 'week' | 'month' | 'earlier';
export interface ConversationDateGroup<T> { key: ConversationDateGroupKey; label: string; items: T[] }

const GROUP_ORDER: readonly ConversationDateGroupKey[] = ['today', 'yesterday', 'week', 'month', 'earlier'];
export const CONVERSATION_DATE_GROUP_LABELS: Record<ConversationDateGroupKey, string> = {
    today: '今天', yesterday: '昨天', week: '7 天内', month: '30 天内', earlier: '更早',
};
const DAY_MS = 86_400_000;

function localDay(time: number) {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** A missing or unreadable time sorts into 更早; a time ahead of the clock counts as today. */
export function getConversationDateGroup(timestamp: string | null | undefined, now: Date): ConversationDateGroupKey {
    const time = timestamp ? Date.parse(timestamp) : NaN;
    if (!Number.isFinite(time)) return 'earlier';
    // Rounding absorbs the 23- and 25-hour days around daylight-saving changes.
    const days = Math.round((localDay(now.getTime()) - localDay(time)) / DAY_MS);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return 'week';
    if (days < 30) return 'month';
    return 'earlier';
}

/** Keeps the list's own order inside each group and omits empty groups. */
export function groupConversationsByDate<T extends { updatedAt?: string | null }>(items: readonly T[], now: Date): ConversationDateGroup<T>[] {
    const groups = new Map<ConversationDateGroupKey, T[]>();
    for (const item of items) {
        const key = getConversationDateGroup(item.updatedAt, now);
        const group = groups.get(key);
        if (group) group.push(item); else groups.set(key, [item]);
    }
    return GROUP_ORDER.flatMap(key => {
        const group = groups.get(key);
        return group ? [{ key, label: CONVERSATION_DATE_GROUP_LABELS[key], items: group }] : [];
    });
}
