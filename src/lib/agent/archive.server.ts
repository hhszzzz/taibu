import 'server-only';
import { createHash } from 'node:crypto';
import type { ScopedDb } from '@/lib/db/context.server';
import { selectFromDynamic } from '@/lib/db/sql-helpers';
import { parseBaziCaseMasterReview } from '@/lib/bazi-case-profile';
import { RECORD_CATEGORIES } from '@/lib/records';
import {
    AGENT_ARCHIVE_CHART_LABELS,
    fillableMasterReviewItems,
    getAgentArchiveHref,
    parseAgentArchiveReference,
    type AgentArchiveChart,
    type AgentArchiveChartType,
    type AgentArchiveProposal,
    type AgentArchiveStatus,
} from './archive';

/**
 * The table of each saved item an entry may link to, as agent_archive_chart_owned names them. The routes and the
 * worker read them under the caller's scoped context.
 */
const CHART_TABLES = {
    bazi_chart: 'bazi_charts',
    ziwei_chart: 'ziwei_charts',
    tarot_reading: 'tarot_readings',
    liuyao_divination: 'liuyao_divinations',
    mbti_reading: 'mbti_readings',
    hepan_chart: 'hepan_charts',
    face_reading: 'face_readings',
    palm_reading: 'palm_readings',
    qimen_chart: 'qimen_charts',
    daliuren_divination: 'daliuren_divinations',
    meihua_divination: 'meihua_divinations',
    xiaoliuren_divination: 'xiaoliuren_divinations',
} as const satisfies Record<AgentArchiveChartType, string>;

/** Linked records read_user_data appends to a saved item, newest first. */
const LINKED_RECORD_LIMIT = 20;
const LINKED_RECORD_TEXT = 200;

export function isAgentArchiveChartType(type: string): type is AgentArchiveChartType {
    return Object.hasOwn(CHART_TABLES, type);
}

/** The entry a tool call writes, the database's agent_archive_entry_id: a replayed call or a second click finds it. */
export function agentArchiveEntryId(runId: string, callId: string): string {
    const hex = createHash('md5').update(`${runId}:${callId}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The user's saved item a reference names, as its card shows it; no reference links nothing. */
export async function resolveAgentArchiveChart(db: ScopedDb, userId: string, reference: string | undefined): Promise<AgentArchiveChart | null> {
    if (reference === undefined) return null;
    const { type, id } = parseAgentArchiveReference(reference);
    const named = type === 'bazi_chart' || type === 'ziwei_chart';
    const data = await db.tx((trx) => selectFromDynamic(trx, CHART_TABLES[type])
        .select(named ? ['id', 'name'] : ['id'])
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst());
    if (!data) throw new Error('关联的资料不存在或无权访问');
    const name = named ? String((data as { name?: string | null }).name ?? '').trim() : '';
    return { type, id, label: name ? `${AGENT_ARCHIVE_CHART_LABELS[type]}「${name}」` : AGENT_ARCHIVE_CHART_LABELS[type] };
}

type LinkedRecordRow = { title: string; content: string | null; category: string | null; event_date: string | null; source_run_id: string | null };

/** The 命理记录 the user linked to a saved item, as text after the item's own; null when there are none. */
export async function readLinkedRecords(db: ScopedDb, userId: string, type: AgentArchiveChartType, id: string): Promise<string | null> {
    // PostgreSQL sorts NULL first on DESC; the records page lists undated ones last.
    const rows = (await db.tx((trx) => trx
        .selectFrom('ming_records')
        .select(['title', 'content', 'category', 'event_date', 'source_run_id'])
        .where('user_id', '=', userId)
        .where('related_chart_type', '=', type)
        .where('related_chart_id', '=', id)
        .orderBy('event_date', 'desc')
        .orderBy('created_at', 'desc')
        .limit(LINKED_RECORD_LIMIT + 1)
        .execute()) as LinkedRecordRow[])
        .sort((a, b) => Number(a.event_date === null) - Number(b.event_date === null));
    if (!rows.length) return null;
    const lines = rows.slice(0, LINKED_RECORD_LIMIT).map(row => {
        const category = RECORD_CATEGORIES.find(item => item.value === row.category)?.label ?? row.category;
        const content = row.content?.trim() ? `：${row.content.trim().slice(0, LINKED_RECORD_TEXT)}${row.content.trim().length > LINKED_RECORD_TEXT ? '…' : ''}` : '';
        return `- ${[row.event_date ?? '未记日期', category, `${row.title}${content}`].filter(Boolean).join('｜')}${row.source_run_id ? '（Agent 记录）' : ''}`;
    });
    if (rows.length > LINKED_RECORD_LIMIT) lines.push(`- 另有更早的记录，可用 list_user_data 按关键词检索`);
    return ['【关联的命理记录】', ...lines].join('\n');
}

/** A bazi chart's master review as its case notes page reads it, through the caller's scoped context. */
export async function readMasterReview(db: ScopedDb, userId: string, chartId: string) {
    const data = await db.tx((trx) => trx
        .selectFrom('bazi_case_profiles')
        .select('master_review')
        .where('bazi_chart_id', '=', chartId)
        .where('user_id', '=', userId)
        .executeTakeFirst());
    return parseBaziCaseMasterReview(data?.master_review);
}

/**
 * A proposal card's state now, read under the owner's own context from what exists: an event or conclusion is saved
 * while its entry is there; a master review is saved once this task filled it and filled once nothing is left to fill.
 * Deleting the entry makes it savable again.
 */
export async function readAgentArchiveStatus(db: ScopedDb, userId: string, runId: string, callId: string, proposal: AgentArchiveProposal): Promise<AgentArchiveStatus> {
    const chart = proposal.chart;
    const id = agentArchiveEntryId(runId, callId);
    const target = proposal.kind === 'master_review' ? 'master_review' : proposal.kind === 'event' && chart?.type === 'bazi_chart' ? 'case_event' : 'record';
    const found = await db.tx(async trx => {
        const linked = chart ? await trx.selectFrom(CHART_TABLES[chart.type]).select('id').where('id', '=', chart.id).where('user_id', '=', userId).executeTakeFirst() : true;
        if (!linked) return null;
        if (target === 'master_review') return {
            profile: await trx.selectFrom('bazi_case_profiles').select(['master_review', 'source_run_id'])
                .where('bazi_chart_id', '=', chart!.id).where('user_id', '=', userId).executeTakeFirst(),
        };
        return { entry: await trx.selectFrom(target === 'case_event' ? 'bazi_case_events' : 'ming_records').select('id').where('id', '=', id).where('user_id', '=', userId).executeTakeFirst() };
    }, { timeoutMs: 5_000 });
    if (!found) return { state: 'unavailable', message: `${chart!.label}已删除，无法保存` };
    if (proposal.kind === 'master_review') {
        const href = getAgentArchiveHref('master_review', proposal.chart.id, proposal.chart);
        if (fillableMasterReviewItems(parseBaziCaseMasterReview(found.profile?.master_review), proposal.review).length) return { state: 'pending' };
        return found.profile?.source_run_id === runId ? { state: 'saved', target: 'master_review', id: proposal.chart.id, href } : { state: 'filled', href };
    }
    if (target === 'master_review' || !found.entry) return { state: 'pending' };
    return { state: 'saved', target, id, href: getAgentArchiveHref(target, id, chart) };
}
