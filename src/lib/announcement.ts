export interface Announcement {
    id: string;
    content: string;
    publishedAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface AnnouncementRow {
    id: string;
    content: string;
    published_at: string;
    created_at: string;
    updated_at: string;
}

export interface AnnouncementInput {
    content?: string;
}

export interface AnnouncementCenterLocalState {
    latestAnnouncementKey?: string;
    latestPublishedAt?: string;
    dismissedUntil?: string;
}

export const ANNOUNCEMENT_CENTER_STORAGE_KEY = 'taibu:announcement:center';
export const LEGACY_ANNOUNCEMENT_CENTER_STORAGE_KEY = 'mingai:announcement:center';

const hasOwn = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function normalizeRequiredText(value: unknown, fieldLabel: string): { value?: string; error?: string } {
    if (typeof value !== 'string') {
        return { error: `${fieldLabel}格式无效` };
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return { error: `${fieldLabel}不能为空` };
    }

    return { value: trimmed };
}

export function serializeAnnouncement(row: AnnouncementRow): Announcement {
    return {
        id: row.id,
        content: row.content,
        publishedAt: row.published_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * 管理列表里的公告摘要：去掉基础 Markdown 标记（标题、强调、链接、图片、代码、列表、引用、
 * 分隔线），合并成一段纯文本，避免整段渲染 Markdown 后在截断处露出半行标题。
 */
export function getAnnouncementExcerpt(content: string): string {
    return content
        .replace(/```[^\n]*\n?([\s\S]*?)```/gu, '$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
        .replace(/^ {0,3}(?:[-*_] *){3,}$/gmu, '')
        .replace(/^ {0,3}(?:#{1,6} +|> ?|[-*+] +|\d+[.)] +)+/gmu, '')
        .replace(/\*\*|__|~~|`/gu, '')
        .replace(/\*(\S(?:[^*\n]*\S)?)\*/gu, '$1')
        .replace(/\s+/gu, ' ')
        .trim();
}

export function parseAnnouncementInput(
    body: unknown,
    options: { partial?: boolean } = {},
): { value?: AnnouncementInput; error?: string } {
    const partial = options.partial ?? false;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: '请求体不是合法对象' };
    }

    const raw = body as Record<string, unknown>;
    const value: AnnouncementInput = {};

    if (!partial || hasOwn(raw, 'content')) {
        const parsed = normalizeRequiredText(raw.content, '公告内容');
        if (parsed.error) return { error: parsed.error };
        value.content = parsed.value;
    }

    return { value };
}

export function getAnnouncementCenterLocalState(raw: unknown): AnnouncementCenterLocalState {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }

    const parsed = raw as Record<string, unknown>;
    const state: AnnouncementCenterLocalState = {};

    if (typeof parsed.latestAnnouncementKey === 'string' && parsed.latestAnnouncementKey.trim()) {
        state.latestAnnouncementKey = parsed.latestAnnouncementKey;
    }
    if (typeof parsed.latestPublishedAt === 'string' && parsed.latestPublishedAt.trim()) {
        state.latestPublishedAt = parsed.latestPublishedAt;
    }
    if (typeof parsed.dismissedUntil === 'string' && parsed.dismissedUntil.trim()) {
        state.dismissedUntil = parsed.dismissedUntil;
    }

    return state;
}

export function getEndOfLocalDayIso(now: Date) {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
}

export function getAnnouncementPromptIdentity(announcement: Pick<Announcement, 'id' | 'publishedAt' | 'updatedAt'> | null | undefined) {
    if (!announcement?.publishedAt) {
        return null;
    }
    return `${announcement.id}:${announcement.updatedAt || announcement.publishedAt}`;
}

export function shouldPromptLatestAnnouncement(input: {
    announcementKey: string | null | undefined;
    state: AnnouncementCenterLocalState | null | undefined;
    nowIso?: string;
}) {
    const announcementKey = input.announcementKey ?? null;
    if (!announcementKey) {
        return false;
    }

    const state = input.state ?? {};
    const previousAnnouncementKey = state.latestAnnouncementKey ?? state.latestPublishedAt ?? null;
    if (previousAnnouncementKey !== announcementKey) {
        return true;
    }

    if (!state.dismissedUntil) {
        return true;
    }

    const dismissedUntil = Date.parse(state.dismissedUntil);
    const now = Date.parse(input.nowIso ?? new Date().toISOString());

    if (Number.isNaN(dismissedUntil) || Number.isNaN(now)) {
        return true;
    }

    return dismissedUntil <= now;
}
