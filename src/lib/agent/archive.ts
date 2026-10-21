/**
 * Agent 档案（迁移 20261021_120000_agent_user_archive）：长期记忆开启时，用户亲口讲述的经历由 record_user_event
 * 直接记入档案；Agent 的判断与结论只由 propose_archive_entry 生成保存卡片，用户点「保存」后才写入。
 * 关联八字命盘的事件进该盘断事笔记的关键事件，旺衰、格局、五行喜忌只补填命理师判断中尚未填写的项，其余进命理记录。
 * 浏览器与服务端共用这里的参数校验、卡片读取与链接；数据库按同样的规则再校验一次。
 */
import {
    BAZI_CASE_ADVANCED_GOD_OPTIONS,
    BAZI_CASE_BASIC_ELEMENTS,
    BAZI_CASE_EVENT_CATEGORY_OPTIONS,
    BAZI_CASE_STRENGTH_LEVELS,
    type BaziCaseAdvancedGod,
    type BaziCaseBasicElement,
    type BaziCaseEventCategory,
    type BaziCaseGodSelection,
    type BaziCaseStrengthLevel,
} from '@/lib/bazi-case-profile';
import type { DataSourceType } from '@/lib/data-sources/types';
import { isValidUUID } from '@/lib/validation';
import { getSavedChartHref } from './chart-save';
import { AGENT_ARCHIVE_TOOLS } from './tool-catalog';

export const AGENT_RECORD_EVENT_TOOL = AGENT_ARCHIVE_TOOLS.record;
export const AGENT_PROPOSE_ARCHIVE_TOOL = AGENT_ARCHIVE_TOOLS.propose;

/** Saved items an entry may link to: the data sources with a table of their own (agent_archive_chart_owned). */
export const AGENT_ARCHIVE_CHART_LABELS = {
    bazi_chart: '八字命盘',
    ziwei_chart: '紫微命盘',
    tarot_reading: '塔罗占卜',
    liuyao_divination: '六爻占卜',
    mbti_reading: 'MBTI测评',
    hepan_chart: '合盘',
    face_reading: '面相分析',
    palm_reading: '手相分析',
    qimen_chart: '奇门遁甲',
    daliuren_divination: '大六壬',
    meihua_divination: '梅花易数',
    xiaoliuren_divination: '小六壬',
} as const satisfies Partial<Record<DataSourceType, string>>;

export type AgentArchiveChartType = keyof typeof AGENT_ARCHIVE_CHART_LABELS;

/** A linked saved item and the name its card shows, e.g. 八字命盘「张三」. */
export interface AgentArchiveChart { type: AgentArchiveChartType; id: string; label: string }

export const AGENT_GOD_ROLES = ['yongShen', 'xiShen', 'jiShen', 'xianShen'] as const;
export type AgentGodRole = typeof AGENT_GOD_ROLES[number];
export const AGENT_GOD_ROLE_LABELS: Record<AgentGodRole, string> = { yongShen: '用神', xiShen: '喜神', jiShen: '忌神', xianShen: '闲神' };

export const AGENT_CONCLUSION_CATEGORIES = ['general', 'prediction'] as const;
export type AgentConclusionCategory = typeof AGENT_CONCLUSION_CATEGORIES[number];

/** What a master review proposal fills; the four roles go together, so one analysis never mixes with another. */
export interface AgentMasterReviewFill {
    strengthLevel?: BaziCaseStrengthLevel;
    patterns?: string[];
    gods?: Record<AgentGodRole, BaziCaseGodSelection>;
}

export type AgentArchiveProposal =
    | { kind: 'event'; date: string; category: BaziCaseEventCategory; title: string; detail: string; chart: AgentArchiveChart | null }
    | { kind: 'conclusion'; category: AgentConclusionCategory; title: string; content: string; date: string | null; tags: string[]; chart: AgentArchiveChart | null }
    | { kind: 'master_review'; chart: AgentArchiveChart; review: AgentMasterReviewFill };
export type AgentArchiveKind = AgentArchiveProposal['kind'];

export const AGENT_ARCHIVE_KIND_LABELS: Record<AgentArchiveKind, string> = {
    event: '记录事件',
    conclusion: '保存结论',
    master_review: '补填命理师判断',
};

/** Where an entry was written: a 命理记录, a key event of a chart's case notes, or the master review of those notes. */
export type AgentArchiveTarget = 'record' | 'case_event' | 'master_review';

/** A proposal card's state, derived from what exists now: saving again after the user deleted the entry restores it. */
export type AgentArchiveStatus =
    | { state: 'pending' }
    | { state: 'saved'; target: AgentArchiveTarget; id: string; href: string | null; filled?: string[] }
    | { state: 'filled'; href: string | null }
    | { state: 'unavailable'; message: string };

/** The parameters the model gives propose_archive_entry; the kind decides which of them apply. */
export interface AgentArchiveProposalArgs {
    kind: AgentArchiveKind;
    title?: string;
    content?: string;
    category?: string;
    date?: string;
    tags?: string[];
    strengthLevel?: string;
    patterns?: string[];
    gods?: Partial<Record<AgentGodRole, { basic?: string[]; advanced?: string[] }>>;
}

const pad = (value: number) => String(value).padStart(2, '0');
const isOneOf = <T extends readonly string[]>(value: unknown, options: T): value is T[number] =>
    typeof value === 'string' && (options as readonly string[]).includes(value);

/** A saved item's reference as read_user_data and list_user_data give it: `type:ID`. */
export function parseAgentArchiveReference(value: string): { type: AgentArchiveChartType; id: string } {
    const trimmed = value.trim();
    if (trimmed.startsWith('artifact:')) throw new Error('这张盘还没有保存：请用户先在盘面上保存命盘，或不关联命盘');
    const separator = trimmed.indexOf(':');
    const type = trimmed.slice(0, separator), id = trimmed.slice(separator + 1).toLowerCase();
    if (separator < 0 || !Object.hasOwn(AGENT_ARCHIVE_CHART_LABELS, type) || !isValidUUID(id))
        throw new Error('reference 须为已存资料的引用，如 bazi_chart:ID');
    return { type: type as AgentArchiveChartType, id };
}

/** China Standard Time's date today, the day an event may not come after. */
export function agentArchiveToday(now = Date.now()): string {
    return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * A date as precise as the user gave it: a year, a month or a day, stored as the period's first day.
 * `notAfter` keeps events in the past; a prediction's date may lie ahead.
 */
export function parseAgentArchiveDate(value: string, notAfter?: string): string {
    const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/u.exec(value.trim());
    if (!match) throw new Error('date 须为 YYYY、YYYY-MM 或 YYYY-MM-DD');
    const year = Number(match[1]), month = Number(match[2] ?? 1), day = Number(match[3] ?? 1);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || year > 2100 || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error('date 不是有效日期');
    const date = `${match[1]}-${pad(month)}-${pad(day)}`;
    if (notAfter && date > notAfter) throw new Error('事件日期不能晚于今天；尚未发生的事请作为预测结论提出');
    return date;
}

/** Lengths count as the case notes page trims (UTF-16 units), so a saved entry reads back unchanged. */
export function agentArchiveText(value: string | undefined, field: string, max: number, required: boolean): string {
    const trimmed = value?.trim() ?? '';
    if (required && !trimmed) throw new Error(`${field} 不能为空`);
    if (trimmed.length > max) throw new Error(`${field} 不能超过 ${max} 字`);
    return trimmed;
}
const text = agentArchiveText;

function labels(values: string[] | undefined, field: string, maxItems: number, maxLength = 24): string[] {
    const unique = [...new Set((values ?? []).map(item => item.trim()).filter(Boolean))];
    if (unique.length > maxItems) throw new Error(`${field} 最多 ${maxItems} 项`);
    if (unique.some(item => item.length > maxLength)) throw new Error(`${field} 每项不能超过 ${maxLength} 字`);
    return unique;
}

function choices<T extends readonly string[]>(values: string[] | undefined, options: T, field: string): T[number][] {
    const unique = [...new Set(values ?? [])];
    const unknown = unique.find(value => !isOneOf(value, options));
    if (unknown !== undefined) throw new Error(`${field} 包含未收录的值：${unknown}`);
    return unique as T[number][];
}

function masterReview(args: AgentArchiveProposalArgs): AgentMasterReviewFill {
    const review: AgentMasterReviewFill = {};
    if (args.strengthLevel !== undefined) {
        if (!isOneOf(args.strengthLevel, BAZI_CASE_STRENGTH_LEVELS)) throw new Error(`strengthLevel 只能是 ${BAZI_CASE_STRENGTH_LEVELS.join('、')}`);
        review.strengthLevel = args.strengthLevel;
    }
    if (args.patterns !== undefined) {
        const patterns = labels(args.patterns, 'patterns', 6);
        if (patterns.length) review.patterns = patterns;
    }
    if (args.gods !== undefined) {
        const gods = Object.fromEntries(AGENT_GOD_ROLES.map(role => [role, {
            basic: choices<typeof BAZI_CASE_BASIC_ELEMENTS>(args.gods?.[role]?.basic, BAZI_CASE_BASIC_ELEMENTS, `gods.${role}.basic`) as BaziCaseBasicElement[],
            advanced: choices<typeof BAZI_CASE_ADVANCED_GOD_OPTIONS>(args.gods?.[role]?.advanced, BAZI_CASE_ADVANCED_GOD_OPTIONS, `gods.${role}.advanced`) as BaziCaseAdvancedGod[],
        }])) as Record<AgentGodRole, BaziCaseGodSelection>;
        const elements = AGENT_GOD_ROLES.flatMap(role => gods[role].basic);
        if (new Set(elements).size !== elements.length) throw new Error('同一五行不能同时属于两种喜忌');
        if (elements.length || AGENT_GOD_ROLES.some(role => gods[role].advanced.length)) review.gods = gods;
    }
    if (!review.strengthLevel && !review.patterns && !review.gods) throw new Error('kind=master_review 至少给出 strengthLevel、patterns 或 gods 之一');
    return review;
}

function rejectFields(args: AgentArchiveProposalArgs, fields: Array<keyof AgentArchiveProposalArgs>) {
    const given = fields.filter(field => args[field] !== undefined);
    if (given.length) throw new Error(`kind=${args.kind} 不接受 ${given.join('、')}`);
}

/**
 * The proposal a card shows and the save writes, checked as the database checks it. `chart` is the saved item the
 * server resolved from the model's reference and found the user's own.
 */
export function normalizeAgentArchiveProposal(args: AgentArchiveProposalArgs, chart: AgentArchiveChart | null, today = agentArchiveToday()): AgentArchiveProposal {
    switch (args.kind) {
        case 'event': {
            rejectFields(args, ['tags', 'strengthLevel', 'patterns', 'gods']);
            if (!isOneOf(args.category, BAZI_CASE_EVENT_CATEGORY_OPTIONS)) throw new Error(`category 只能是 ${BAZI_CASE_EVENT_CATEGORY_OPTIONS.join('、')}`);
            if (!args.date) throw new Error('kind=event 需要 date');
            return { kind: 'event', date: parseAgentArchiveDate(args.date, today), category: args.category, title: text(args.title, 'title', 80, true), detail: text(args.content, 'content', 500, false), chart };
        }
        case 'conclusion': {
            rejectFields(args, ['strengthLevel', 'patterns', 'gods']);
            const category = args.category ?? 'general';
            if (!isOneOf(category, AGENT_CONCLUSION_CATEGORIES)) throw new Error('kind=conclusion 的 category 只能是 general 或 prediction');
            return {
                kind: 'conclusion', category, title: text(args.title, 'title', 80, true), content: text(args.content, 'content', 4000, true),
                date: args.date ? parseAgentArchiveDate(args.date) : null, tags: labels(args.tags, 'tags', 8), chart,
            };
        }
        case 'master_review':
            rejectFields(args, ['title', 'content', 'category', 'date', 'tags']);
            if (chart?.type !== 'bazi_chart') throw new Error('kind=master_review 需要已存八字命盘的 reference（bazi_chart:ID）');
            return { kind: 'master_review', chart, review: masterReview(args) };
    }
}

/** What a master review proposal fills, one line per item, e.g. 用神：水、木（进阶：壬水）. */
export function describeMasterReviewFill(review: AgentMasterReviewFill): string[] {
    const lines: string[] = [];
    if (review.strengthLevel) lines.push(`旺衰：${review.strengthLevel}`);
    if (review.patterns?.length) lines.push(`格局：${review.patterns.join('、')}`);
    for (const role of AGENT_GOD_ROLES) {
        const selection = review.gods?.[role];
        if (!selection || (!selection.basic.length && !selection.advanced.length)) continue;
        const advanced = selection.advanced.length ? `${selection.basic.length ? '（进阶：' : '进阶：'}${selection.advanced.join('、')}${selection.basic.length ? '）' : ''}` : '';
        lines.push(`${AGENT_GOD_ROLE_LABELS[role]}：${selection.basic.join('、')}${advanced}`);
    }
    return lines;
}

/** The items of a master review a proposal can still fill: an empty 旺衰, empty 格局, or all four roles empty. */
export function fillableMasterReviewItems(current: { strengthLevel: unknown; patterns: unknown[] } & Record<AgentGodRole, BaziCaseGodSelection>, review: AgentMasterReviewFill): string[] {
    const items: string[] = [];
    if (review.strengthLevel && !current.strengthLevel) items.push('strengthLevel');
    if (review.patterns?.length && !current.patterns.length) items.push('patterns');
    if (review.gods && AGENT_GOD_ROLES.every(role => !current[role].basic.length && !current[role].advanced.length)) items.push('gods');
    return items;
}

/** The part of a proposal that fills the given items. */
export function pickMasterReviewFill(review: AgentMasterReviewFill, items: readonly string[]): AgentMasterReviewFill {
    return {
        ...(items.includes('strengthLevel') && review.strengthLevel ? { strengthLevel: review.strengthLevel } : {}),
        ...(items.includes('patterns') && review.patterns ? { patterns: review.patterns } : {}),
        ...(items.includes('gods') && review.gods ? { gods: review.gods } : {}),
    };
}

/** Where a saved entry opens: the record, or the case notes tab of its bazi chart. */
export function getAgentArchiveHref(target: AgentArchiveTarget, id: string, chart: Pick<AgentArchiveChart, 'type' | 'id'> | null): string | null {
    if (target === 'record') return `/records?id=${encodeURIComponent(id)}`;
    return chart?.type === 'bazi_chart' ? `${getSavedChartHref('bazi', chart.id)}&tab=notes` : null;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function chartOf(value: unknown): AgentArchiveChart | null {
    const chart = record(value);
    return typeof chart.type === 'string' && Object.hasOwn(AGENT_ARCHIVE_CHART_LABELS, chart.type) && typeof chart.id === 'string' && typeof chart.label === 'string'
        ? { type: chart.type as AgentArchiveChartType, id: chart.id, label: chart.label } : null;
}

/** A proposal card: the task and call its result is cached under, and what it proposes. */
export interface AgentArchiveCard { runId: string; callId: string; proposal: AgentArchiveProposal }

function proposalOf(value: unknown): AgentArchiveProposal | null {
    const proposal = record(value), chart = chartOf(proposal.chart);
    if (proposal.kind === 'master_review') return chart ? { kind: 'master_review', chart, review: record(proposal.review) as AgentMasterReviewFill } : null;
    if (typeof proposal.title !== 'string') return null;
    if (proposal.kind === 'event' && typeof proposal.date === 'string' && isOneOf(proposal.category, BAZI_CASE_EVENT_CATEGORY_OPTIONS))
        return { kind: 'event', date: proposal.date, category: proposal.category, title: proposal.title, detail: typeof proposal.detail === 'string' ? proposal.detail : '', chart };
    if (proposal.kind === 'conclusion' && isOneOf(proposal.category, AGENT_CONCLUSION_CATEGORIES) && typeof proposal.content === 'string')
        return { kind: 'conclusion', category: proposal.category, title: proposal.title, content: proposal.content,
            date: typeof proposal.date === 'string' ? proposal.date : null, tags: Array.isArray(proposal.tags) ? proposal.tags.filter((tag): tag is string => typeof tag === 'string') : [], chart };
    return null;
}

/** A completed proposal call's card; the server reads the same shape from the task's cached result. */
export function getAgentArchiveProposal(tool: { name: string; status: string; output?: unknown }): AgentArchiveCard | null {
    if (tool.name !== AGENT_PROPOSE_ARCHIVE_TOOL || tool.status !== 'completed') return null;
    const output = record(tool.output), proposal = proposalOf(output.proposal);
    if (typeof output.runId !== 'string' || typeof output.callId !== 'string' || !output.callId || !proposal) return null;
    return { runId: output.runId, callId: output.callId, proposal };
}

/** An event record_user_event wrote: where it went and what it says. */
export interface AgentArchiveRecord {
    target: Extract<AgentArchiveTarget, 'record' | 'case_event'>;
    id: string;
    date: string;
    category: BaziCaseEventCategory;
    title: string;
    detail: string;
    chart: AgentArchiveChart | null;
}

export function getAgentArchiveRecord(tool: { name: string; status: string; output?: unknown }): AgentArchiveRecord | null {
    if (tool.name !== AGENT_RECORD_EVENT_TOOL || tool.status !== 'completed') return null;
    const output = record(tool.output), event = record(output.event);
    if ((output.target !== 'record' && output.target !== 'case_event') || typeof output.id !== 'string') return null;
    if (typeof event.date !== 'string' || !isOneOf(event.category, BAZI_CASE_EVENT_CATEGORY_OPTIONS) || typeof event.title !== 'string') return null;
    return { target: output.target, id: output.id, date: event.date, category: event.category, title: event.title,
        detail: typeof event.detail === 'string' ? event.detail : '', chart: chartOf(event.chart) };
}
