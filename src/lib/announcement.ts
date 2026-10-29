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
    /** 最近一次真正展示给用户的最新公告身份；同一个身份不再弹第二次。 */
    seenAnnouncementKey?: string;
}

export const ANNOUNCEMENT_CENTER_STORAGE_KEY = 'taibu:announcement:center';

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

    if (typeof parsed.seenAnnouncementKey === 'string' && parsed.seenAnnouncementKey.trim()) {
        state.seenAnnouncementKey = parsed.seenAnnouncementKey;
    }

    return state;
}

/** 公告身份只看发布，不看编辑时间：修改旧公告不会让所有人重新收到弹窗。 */
export function getAnnouncementPromptIdentity(announcement: Pick<Announcement, 'id' | 'publishedAt'> | null | undefined) {
    if (!announcement?.publishedAt) {
        return null;
    }
    return `${announcement.id}:${announcement.publishedAt}`;
}

/** 只有存在一条尚未展示过的最新公告时才弹；展示过就永久记为已看。 */
export function shouldPromptLatestAnnouncement(input: {
    announcementKey: string | null | undefined;
    state: AnnouncementCenterLocalState | null | undefined;
}) {
    const announcementKey = input.announcementKey ?? null;
    if (!announcementKey) {
        return false;
    }
    return (input.state ?? {}).seenAnnouncementKey !== announcementKey;
}
