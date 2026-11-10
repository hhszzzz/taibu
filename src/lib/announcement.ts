import { isPlainObject } from '@/lib/validation';

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

const ANNOUNCEMENT_TITLE_MAX = 30;
const HEADING_LINE = /^ {0,3}#{1,6} +(.+?)(?: +#+)? *$/u;

const FIRST_SENTENCE = /^(.{8,30}?)[，,。！？!?：:；;]/u;

/**
 * 公告没有标题字段：首个非空行是 Markdown 标题或不长于 30 字时作标题，正文是其后的内容；
 * 首行太长就在第 8 字后的第一个标点处断开（正文从断开处起），断不开才截断，正文保留全文。
 */
function splitAnnouncement(content: string): { title: string; body: string } {
    const lines = content.split('\n');
    const index = lines.findIndex(line => line.trim());
    if (index < 0) return { title: '', body: '' };
    const rest = lines.slice(index + 1).join('\n');
    const heading = lines[index].match(HEADING_LINE)?.[1];
    const line = getAnnouncementExcerpt(heading ?? lines[index]);
    if (heading || line.length <= ANNOUNCEMENT_TITLE_MAX) {
        return { title: line, body: rest.trim() };
    }
    const first = lines[index].trimStart();
    const sentence = line.match(FIRST_SENTENCE)?.[1];
    if (sentence && first.startsWith(sentence)) {
        const remainder = first.slice(sentence.length).replace(/^[，,。！？!?：:；;\s]+/u, '');
        return { title: sentence, body: `${remainder}\n${rest}`.trim() };
    }
    return { title: `${line.slice(0, ANNOUNCEMENT_TITLE_MAX - 6)}…`, body: content.trim() };
}

export function getAnnouncementTitle(content: string): string {
    return splitAnnouncement(content).title;
}

export function getAnnouncementBody(content: string): string {
    return splitAnnouncement(content).body;
}

export function parseAnnouncementInput(
    body: unknown,
    options: { partial?: boolean } = {},
): { value?: AnnouncementInput; error?: string } {
    const partial = options.partial ?? false;
    if (!isPlainObject(body)) {
        return { error: '请求体不是合法对象' };
    }

    const raw = body;
    const value: AnnouncementInput = {};

    if (!partial || hasOwn(raw, 'content')) {
        const parsed = normalizeRequiredText(raw.content, '公告内容');
        if (parsed.error) return { error: parsed.error };
        value.content = parsed.value;
    }

    return { value };
}

export function getAnnouncementCenterLocalState(raw: unknown): AnnouncementCenterLocalState {
    if (!isPlainObject(raw)) {
        return {};
    }

    const parsed = raw;
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
