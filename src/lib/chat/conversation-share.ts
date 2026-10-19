/**
 * Public read-only conversation shares: snapshot construction and parsing.
 *
 * A share is a frozen copy of the visible branch, reduced to presentation fields.
 * Version trees, Agent runtime state, ids, chart names and private attachment
 * references never leave the owner's account; chart basis is opt-in.
 */
import { randomBytes } from 'node:crypto';
import type { ChatMessage, MentionType } from '@/types';
import { DATA_SOURCE_TYPES } from '@/lib/data-sources/types';
import { redactExportValue } from './conversation-transfer';

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const SHARE_SNAPSHOT_MAX_BYTES = 1_048_576;
export const SHARE_TITLE_MAX_LENGTH = 200;

export type SharedSource = { title: string; url: string };
export type SharedBasis = { title: string; text: string };
export type SharedMessage = {
    role: 'user' | 'assistant';
    content: string;
    createdAt?: string;
    modelName?: string;
    /** Attachment file names only; the private objects stay with the owner. */
    attachments?: string[];
    /** Referenced data kinds (八字命盘…); never the chart names or ids. */
    mentionTypes?: MentionType[];
    /** Number of injected references (knowledge base / charts) behind the answer. */
    references?: number;
    sources?: SharedSource[];
    /** Chart and tool basis text, present only when the owner opted in. */
    basis?: SharedBasis[];
};

/** Owner-facing state of a conversation's public link. */
export type ConversationShareState = {
    token: string;
    path: string;
    includeCharts: boolean;
    createdAt: string;
    updatedAt: string;
};

/** Owner list entry for the settings center. */
export type ConversationShareSummary = ConversationShareState & {
    conversationId: string;
    title: string;
};

/** conversation_shares columns readable by the owner. */
export type ConversationShareRow = {
    token: string;
    conversation_id: string;
    title: string;
    include_charts: boolean;
    created_at: string;
    updated_at: string;
};

export function shareStateFromRow(row: Pick<ConversationShareRow, 'token' | 'include_charts' | 'created_at' | 'updated_at'>): ConversationShareState {
    return { token: row.token, path: sharePath(row.token), includeCharts: row.include_charts, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function shareSummaryFromRow(row: ConversationShareRow): ConversationShareSummary {
    return { ...shareStateFromRow(row), conversationId: row.conversation_id, title: row.title };
}

export class ShareSnapshotTooLargeError extends Error {
    constructor() { super('分享内容超过 1MB 上限'); this.name = 'ShareSnapshotTooLargeError'; }
}

const MENTION_TYPES: ReadonlySet<string> = new Set<string>(['knowledge_base', ...DATA_SOURCE_TYPES]);
const HTTP_URL = /^https?:\/\//iu;

/** 256-bit unguessable link token: 32 random bytes as 43 base64url characters. */
export function createShareToken(): string {
    return randomBytes(32).toString('base64url');
}

export function isShareToken(value: unknown): value is string {
    return typeof value === 'string' && SHARE_TOKEN_PATTERN.test(value);
}

/** Site-relative public path; clients prefix their own origin when copying. */
export function sharePath(token: string): string {
    return `/share/${encodeURIComponent(token)}`;
}

export function normalizeShareTitle(title: unknown): string {
    const text = typeof title === 'string' ? title.replace(/\s+/gu, ' ').trim() : '';
    return (text || '对话').slice(0, SHARE_TITLE_MAX_LENGTH);
}

function validDate(value: unknown): string | undefined {
    return typeof value === 'string' && value && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function shareMessage(message: ChatMessage, includeCharts: boolean): SharedMessage | null {
    if (message.role !== 'user' && message.role !== 'assistant') return null;
    const shared: SharedMessage = { role: message.role, content: typeof message.content === 'string' ? message.content : '' };
    const createdAt = validDate(message.createdAt);
    if (createdAt) shared.createdAt = createdAt;
    if (message.role === 'assistant' && typeof message.modelName === 'string' && message.modelName) shared.modelName = message.modelName.slice(0, 80);
    const fileName = message.attachments?.fileName?.trim();
    if (fileName) shared.attachments = [fileName.slice(0, 200)];
    const mentionTypes = [...new Set((message.mentions ?? []).map(mention => mention.type).filter(type => MENTION_TYPES.has(type)))];
    if (mentionTypes.length) shared.mentionTypes = mentionTypes;
    const injected = (message.metadata as { sources?: unknown } | undefined)?.sources;
    if (message.role === 'assistant' && Array.isArray(injected) && injected.length) shared.references = injected.length;
    const sources: SharedSource[] = [];
    const basis: SharedBasis[] = [];
    for (const part of message.agent?.parts ?? []) {
        if (part.type === 'source' && HTTP_URL.test(part.url) && !sources.some(source => source.url === part.url)) {
            sources.push({ title: (part.title || part.url).slice(0, 300), url: part.url });
        }
        if (includeCharts && part.type === 'tool' && part.status === 'completed') {
            const output = part.output as { canonicalText?: unknown } | null | undefined;
            const text = part.canonicalText ?? (typeof output?.canonicalText === 'string' ? output.canonicalText : undefined);
            if (text) basis.push({ title: part.title || '命盘依据', text });
        }
    }
    if (sources.length) shared.sources = sources;
    if (basis.length) shared.basis = basis;
    if (!shared.content.trim() && !shared.attachments && !shared.sources && !shared.basis) return null;
    return shared;
}

/**
 * Snapshot of the visible branch for public display. Throws ShareSnapshotTooLargeError
 * when the serialized result exceeds the 1 MB cap enforced again by the database.
 */
export function buildShareSnapshot(messages: readonly ChatMessage[], options: { includeCharts: boolean }): SharedMessage[] {
    const snapshot = messages.flatMap(message => {
        const shared = shareMessage(message, options.includeCharts);
        return shared ? [shared] : [];
    });
    const redacted = redactExportValue(snapshot) as SharedMessage[];
    if (Buffer.byteLength(JSON.stringify(redacted), 'utf8') > SHARE_SNAPSHOT_MAX_BYTES) throw new ShareSnapshotTooLargeError();
    return redacted;
}

function stringField(value: unknown, max: number): string | undefined {
    return typeof value === 'string' && value ? value.slice(0, max) : undefined;
}

/** Defensive parse of a stored snapshot before rendering; malformed entries are dropped. */
export function parseSharedSnapshot(value: unknown): SharedMessage[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): SharedMessage[] => {
        if (!item || typeof item !== 'object') return [];
        const raw = item as Record<string, unknown>;
        if ((raw.role !== 'user' && raw.role !== 'assistant') || typeof raw.content !== 'string') return [];
        const message: SharedMessage = { role: raw.role, content: raw.content };
        const createdAt = validDate(raw.createdAt);
        if (createdAt) message.createdAt = createdAt;
        const modelName = stringField(raw.modelName, 80);
        if (modelName) message.modelName = modelName;
        if (Array.isArray(raw.attachments)) {
            const names = raw.attachments.filter((name): name is string => typeof name === 'string' && !!name).map(name => name.slice(0, 200));
            if (names.length) message.attachments = names;
        }
        if (Array.isArray(raw.mentionTypes)) {
            const types = raw.mentionTypes.filter((type): type is MentionType => typeof type === 'string' && MENTION_TYPES.has(type));
            if (types.length) message.mentionTypes = types;
        }
        if (typeof raw.references === 'number' && Number.isInteger(raw.references) && raw.references > 0) message.references = raw.references;
        if (Array.isArray(raw.sources)) {
            const sources = raw.sources.flatMap((source): SharedSource[] => {
                const entry = source as Record<string, unknown> | null;
                const url = stringField(entry?.url, 2000);
                return url && HTTP_URL.test(url) ? [{ title: stringField(entry?.title, 300) ?? url, url }] : [];
            });
            if (sources.length) message.sources = sources;
        }
        if (Array.isArray(raw.basis)) {
            const basis = raw.basis.flatMap((entry): SharedBasis[] => {
                const record = entry as Record<string, unknown> | null;
                const text = stringField(record?.text, SHARE_SNAPSHOT_MAX_BYTES);
                return text ? [{ title: stringField(record?.title, 200) ?? '命盘依据', text }] : [];
            });
            if (basis.length) message.basis = basis;
        }
        return [message];
    });
}
