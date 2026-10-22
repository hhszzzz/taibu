import { requestBrowserJson } from '@/lib/browser-api';
import {
    createEmptyBaziCaseProfile,
    parseBaziCaseEvents,
    parseBaziCaseMasterReview,
    parseBaziCaseOwnerFeedback,
    type BaziCaseEvent,
    type BaziCaseMasterReview,
    type BaziCaseOwnerFeedback,
    type BaziCaseProfile,
    type BaziCaseSource,
} from '@/lib/bazi-case-profile';

function sourceOf(value: unknown): BaziCaseSource | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;
    return typeof source.runId === 'string'
        ? { runId: source.runId, conversationId: typeof source.conversationId === 'string' ? source.conversationId : null }
        : null;
}

function normalizeProfile(value: unknown): BaziCaseProfile | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    const events = parseBaziCaseEvents(row.events);
    return {
        ...createEmptyBaziCaseProfile(),
        id: typeof row.id === 'string' ? row.id : undefined,
        chartId: typeof row.chartId === 'string' ? row.chartId : undefined,
        userId: typeof row.userId === 'string' ? row.userId : undefined,
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
        masterReview: parseBaziCaseMasterReview(row.masterReview),
        ownerFeedback: parseBaziCaseOwnerFeedback(row.ownerFeedback),
        // Who wrote an entry is for display only; the save reads its ID and ignores the rest.
        events: events.map((event, index) => ({ ...event, source: sourceOf((row.events as Array<Record<string, unknown>>)[index]?.source) })),
        masterReviewSource: sourceOf(row.masterReviewSource),
    };
}

export async function loadBaziCaseProfile(chartId: string): Promise<BaziCaseProfile | null> {
    const result = await requestBrowserJson<{ profile?: unknown | null }>(`/api/bazi/case-profile?chartId=${encodeURIComponent(chartId)}`, {
        method: 'GET',
    });

    if (result.error) {
        throw new Error(result.error.message || '加载断事笔记失败');
    }

    return normalizeProfile(result.data?.profile ?? null);
}

export async function saveBaziCaseProfile(input: {
    chartId: string;
    masterReview: BaziCaseMasterReview;
    ownerFeedback: BaziCaseOwnerFeedback;
    events: BaziCaseEvent[];
}): Promise<BaziCaseProfile> {
    const result = await requestBrowserJson<{ profile?: unknown | null }>('/api/bazi/case-profile', {
        method: 'PUT',
        body: JSON.stringify(input),
    });

    if (result.error) {
        throw new Error(result.error.message || '保存断事笔记失败');
    }

    const profile = normalizeProfile(result.data?.profile ?? null);
    if (!profile) {
        throw new Error('断事笔记返回数据无效');
    }

    return profile;
}
