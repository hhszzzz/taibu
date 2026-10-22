import 'server-only';

import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { isValidUUID } from '@/lib/validation';
import {
    createEmptyBaziCaseProfile,
    parseBaziCaseEvents,
    parseBaziCaseMasterReview,
    parseBaziCaseOwnerFeedback,
    type BaziCaseEvent,
    type BaziCaseProfile,
    type BaziCaseMasterReview,
    type BaziCaseOwnerFeedback,
    type BaziCaseSource,
} from '@/lib/bazi-case-profile';

type ProfileRow = {
    id: string;
    user_id: string;
    bazi_chart_id: string;
    master_review: unknown;
    owner_feedback: unknown;
    source_run_id: string | null;
    created_at: string;
    updated_at: string;
};

type EventRow = {
    id: string;
    profile_id: string;
    user_id: string;
    bazi_chart_id: string;
    event_date: string;
    category: string;
    title: string;
    detail: string | null;
    source_run_id: string | null;
    created_at: string;
    updated_at: string;
};

export async function ensureUserOwnsBaziChart(
    db: ScopedDb,
    chartId: string,
    userId: string,
): Promise<boolean> {
    const data = await db.tx((trx) => trx
        .selectFrom('bazi_charts')
        .select('id')
        .where('id', '=', chartId)
        .where('user_id', '=', userId)
        .executeTakeFirst());
    return !!data?.id;
}

function mapProfileRow(row: ProfileRow, events: EventRow[], sources: ReadonlyMap<string, BaziCaseSource>): BaziCaseProfile {
    const parsedEvents = parseBaziCaseEvents(events.map((event) => ({
        id: event.id,
        eventDate: event.event_date,
        category: event.category,
        title: event.title,
        detail: event.detail || '',
    })));
    const source = (runId: string | null) => runId ? sources.get(runId) ?? { runId, conversationId: null } : null;

    return {
        id: row.id,
        userId: row.user_id,
        chartId: row.bazi_chart_id,
        masterReview: parseBaziCaseMasterReview(row.master_review),
        ownerFeedback: parseBaziCaseOwnerFeedback(row.owner_feedback),
        events: parsedEvents.map((event, index) => ({
            ...event,
            createdAt: events[index]?.created_at,
            updatedAt: events[index]?.updated_at,
            source: source(events[index]?.source_run_id ?? null),
        })),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        masterReviewSource: source(row.source_run_id),
    };
}

/** The conversations of the Agent tasks that wrote entries; a task the reader cannot see keeps only its ID. */
async function readSources(db: ScopedDb, userId: string, runIds: string[]): Promise<Map<string, BaziCaseSource>> {
    const unique = [...new Set(runIds)];
    if (!unique.length) return new Map();
    const rows = await db.tx((trx) => trx
        .selectFrom('agent_runs')
        .select(['id', 'conversation_id'])
        .where('id', 'in', unique)
        .where('user_id', '=', userId)
        .execute());
    return new Map(rows.map(run => [run.id, { runId: run.id, conversationId: run.conversation_id }]));
}

export async function getBaziCaseProfileByChartId(
    db: ScopedDb,
    chartId: string,
    userId: string,
): Promise<BaziCaseProfile | null> {
    const data = await db.tx((trx) => trx
        .selectFrom('bazi_case_profiles')
        .select(['id', 'user_id', 'bazi_chart_id', 'master_review', 'owner_feedback', 'source_run_id', 'created_at', 'updated_at'])
        .where('bazi_chart_id', '=', chartId)
        .where('user_id', '=', userId)
        .executeTakeFirst());

    if (!data) {
        return null;
    }

    const eventRows = await db.tx((trx) => trx
        .selectFrom('bazi_case_events')
        .select(['id', 'profile_id', 'user_id', 'bazi_chart_id', 'event_date', 'category', 'title', 'detail', 'source_run_id', 'created_at', 'updated_at'])
        .where('profile_id', '=', data.id)
        .orderBy('event_date', 'desc')
        .execute());

    const profile = data as ProfileRow, events = eventRows as EventRow[];
    const sources = await readSources(db, userId, [profile.source_run_id, ...events.map(event => event.source_run_id)].filter((id): id is string => !!id));
    return mapProfileRow(profile, events, sources);
}

/**
 * The whole profile replaces the stored one. An event keeps its ID, so the save keeps its creation time and the Agent
 * task that recorded it; an ID given twice stays with the first event and the rest are saved as new ones.
 */
export async function saveBaziCaseProfile(args: {
    db: ScopedDb;
    userId: string;
    chartId: string;
    masterReview: BaziCaseMasterReview;
    ownerFeedback: BaziCaseOwnerFeedback;
    events: BaziCaseEvent[];
}): Promise<BaziCaseProfile> {
    const { db, userId, chartId, masterReview, ownerFeedback, events } = args;
    const kept = new Set<string>();
    let data: unknown;
    try {
        data = await systemDb().rpc('save_bazi_case_profile_as_service', {
            p_user_id: userId,
            p_chart_id: chartId,
            p_master_review: masterReview,
            p_owner_feedback: ownerFeedback,
            p_events: events.map((event) => {
                const id = event.id && isValidUUID(event.id) && !kept.has(event.id.toLowerCase()) ? event.id.toLowerCase() : null;
                if (id) kept.add(id);
                return {
                    ...(id ? { id } : {}),
                    event_date: event.eventDate,
                    category: event.category,
                    title: event.title,
                    detail: event.detail || null,
                };
            }),
        });
    } catch (error) {
        throw new Error(error instanceof Error ? error.message : '保存断事笔记失败');
    }

    const result = (data || {}) as { status?: string; profile_id?: string };
    if (result.status !== 'ok' || !result.profile_id) {
        throw new Error('保存断事笔记失败');
    }

    return (await getBaziCaseProfileByChartId(db, chartId, userId))
        || {
            ...createEmptyBaziCaseProfile(),
            id: result.profile_id,
            userId,
            chartId,
            masterReview,
            ownerFeedback,
            events,
        };
}
