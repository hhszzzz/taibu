import type { ChatMessage } from '@/types';
import { isAgentRunTerminal, type AgentMessageData, type AgentPart, type AgentRunStatus, type AgentRuntimeInfo } from '@/lib/agent/types';
import { getAgentToolFamily, type AgentToolFamily, AGENT_CHART_NAMES, isAgentChartTool } from '@/lib/agent/tool-catalog';
import { getAgentAttachmentRead, getAgentChart, getAgentDataResults, getAgentMethod, getAgentSearchResults, getAgentToolArtifactId, getAgentToolQuestions, type AgentChart } from '@/lib/agent/tool-presentation';
import { getChartFocus, getChartTargets } from '@/lib/agent/chart-interaction';
import type { AgentWorkspaceModel } from '@/lib/agent/workspace';
import { parallelAnalysisResults, type ParallelAnalysisResult } from '@/lib/agent/parallel-results';
import { countAgentEvidence, getAgentCitationLabels, getAgentEvidence } from '@/lib/agent/evidence';
import { getCitedParagraphs } from '@/lib/chat/markdown-citations';

export type AgentArtifact = Extract<AgentPart, { type: 'artifact' }>;
export type AgentTool = Extract<AgentPart, { type: 'tool' }>;
export type AgentProcessPart = Extract<AgentPart, { type: 'tool' | 'reasoning' | 'question' }>;

/** Preserve transcript order: narration separates consecutive process groups. */
export function groupAgentParts(parts: AgentPart[]) {
    const groups: Array<{ type: 'activity'; id: string; parts: AgentProcessPart[] } | { type: 'content'; id: string; part: Exclude<AgentPart, AgentProcessPart> }> = [];
    for (const part of parts) {
        if (part.type === 'tool' || part.type === 'reasoning' || part.type === 'question') {
            const last = groups.at(-1);
            if (last?.type === 'activity') last.parts.push(part);
            else groups.push({ type: 'activity', id: part.id, parts: [part] });
        } else groups.push({ type: 'content', id: part.id, part });
    }
    return groups;
}

export function getAgentActivityLabel(data: AgentMessageData) {
    if (data.status === 'queued') return '等待后台开始任务';
    if (data.status === 'awaiting_input') return '等待你回答问题';
    if (data.status === 'cancelling') return '正在停止任务';
    const activity = data.runtime?.activity;
    switch (activity?.phase) {
        case 'compacting': return '正在压缩上下文';
        case 'tools': return activity.toolTitle ? `正在${activity.toolTitle}` : '正在执行工具';
        case 'thinking': return '正在思考';
        case 'responding': return '正在整理回答';
        case 'settling': return '正在整理任务结果';
        case 'retrying': return `准备重试${activity.attempt ? ` · 第 ${activity.attempt} 次` : ''}`;
        case 'preparing': return '正在准备下一步';
        default: return '等待模型响应';
    }
}

/**
 * The live line under a running answer: the phase, and while a tool runs what it works on,
 * e.g. 正在定位分析位置 · 月干丁火. A collaboration names the members still analysing instead.
 */
export function getAgentLiveLine(data: AgentMessageData): string {
    const label = getAgentActivityLabel(data);
    const phase = data.runtime?.activity?.phase;
    // A step left marked running must not describe a thinking or answering phase.
    if (data.status !== 'running' || (phase && phase !== 'tools')) return label;
    const tool = data.parts.findLast((part): part is AgentTool => part.type === 'tool' && part.status === 'running');
    if (!tool) return label;
    if (tool.name === 'parallel_analysis') {
        const names = parallelAnalysisResults(tool.output).filter(member => member.status === 'running').map(member => member.name ?? member.system);
        if (names.length) return `等待协作成员 · ${names.join('、')} 正在分析`;
    }
    const head = phase ? label : `正在${tool.title}`;
    const summary = tool.name === 'parallel_analysis' ? null : summarizeAgentTool(tool);
    return summary ? `${head} · ${summary}` : head;
}

/** A readable step title when the model left the raw tool name as its title. */
const RAW_TOOL_TITLES: Record<string, string> = {
    parallel_analysis: '协作分析',
    select_final_artifacts: '确定最终成果',
    inspect_chart: '查看命盘',
    focus_chart: '定位分析位置',
    web_search: '联网搜索',
    search_knowledge: '知识库检索',
    list_user_data: '检索资料',
    read_user_data: '读取资料',
    read_attachment: '读取附件',
    list_analysis_methods: '列出分析方法',
    load_analysis_method: '加载分析方法',
    todo_write: '更新计划',
    ask_user: '向你确认信息',
    read_user_memory: '读取长期记忆',
    remember_user_fact: '记住偏好',
    bazi_dayun: '八字大运',
    bazi_pillars_resolve: '核对八字四柱',
    ziwei_horoscope: '紫微运限',
    ziwei_flying_star: '紫微飞星',
};

export function getAgentToolTitle(tool: AgentTool): string {
    if (tool.title && tool.title !== tool.name) return tool.title;
    if (isAgentChartTool(tool.name)) return AGENT_CHART_NAMES[tool.name];
    return RAW_TOOL_TITLES[tool.name] ?? tool.title ?? tool.name;
}

const DRILLDOWN_SCOPES: Record<string, string> = {
    natal: '本命', decadal: '大限', yearly: '流年', monthly: '流月', daily: '流日', hourly: '流时',
};

const DRILLDOWN_PLANETS: Record<string, string> = {
    sun: '太阳', moon: '月亮', mercury: '水星', venus: '金星', mars: '火星', jupiter: '木星', saturn: '土星',
    uranus: '天王星', neptune: '海王星', pluto: '冥王星', northnode: '北交点', southnode: '南交点',
    lilith: '莉莉丝', ascendant: '上升点', midheaven: '天顶',
};

/** 详查参数的读法；其余参数按值原样列出，reference 只是命盘引用，不展示。 */
const DRILLDOWN_SELECTION_LABELS: Record<string, (value: unknown) => string> = {
    year: value => `${value} 年`,
    month: value => `${value} 月（节气月）`,
    dayun: value => `第 ${value} 步大运`,
    yunSect: () => '',
    palace: value => typeof value === 'number' ? `第 ${value} 宫` : value === '命宫' ? '命宫' : `${value}宫`,
    scope: value => DRILLDOWN_SCOPES[String(value)] ?? String(value),
    targetDate: value => String(value),
    targetTimeIndex: value => `时辰 ${value}`,
    fromYear: value => `${value} 年起`,
    toYear: value => `至 ${value} 年`,
    focus: value => `只看 ${value}`,
    leiShen: value => `类神 ${value}`,
    planet: value => DRILLDOWN_PLANETS[String(value)] ?? String(value),
    house: value => `第 ${value} 宫`,
    line: value => `第 ${value} 爻`,
    locate: value => {
        const locate = value as { type?: unknown; value?: unknown };
        if (typeof locate?.type !== 'string') return '';
        const target = typeof locate.value === 'string' && locate.value ? ` ${locate.value}` : '';
        return `按${locate.type}${target}定位`;
    },
};

/** 「2027 年 · 5 月（节气月）」：详查步骤的副标题；只有命盘本身时为「原局」。 */
export function describeDrilldownSelection(args: Record<string, unknown>): string {
    const parts = Object.entries(args).flatMap(([key, value]) => {
        if (key === 'reference' || value === undefined || value === null || value === '') return [];
        const label = DRILLDOWN_SELECTION_LABELS[key];
        const text = label ? label(value) : typeof value === 'object' ? '' : String(value);
        return text ? [text] : [];
    });
    return parts.join(' · ') || '原局';
}

/** One line under a process step, read from its arguments and stored result only. */
export function summarizeAgentTool(tool: AgentTool): string | null {
    const args = tool.input && typeof tool.input === 'object' && !Array.isArray(tool.input) ? tool.input as Record<string, unknown> : {};
    if (getAgentToolFamily(tool.name) === 'drilldown') return describeDrilldownSelection(args);
    if (typeof args.birthYear === 'number' && (tool.name.startsWith('bazi') || tool.name.startsWith('ziwei'))) {
        const date = [args.birthYear, args.birthMonth, args.birthDay].filter(value => typeof value === 'number').join(' / ');
        return [typeof args.name === 'string' ? args.name : '', date, typeof args.birthHour === 'number' ? `${args.birthHour} 时` : ''].filter(Boolean).join(' · ') || null;
    }
    if (tool.name === 'select_final_artifacts' && Array.isArray(args.artifactIds)) return `选定 ${args.artifactIds.length} 份成果`;
    if (tool.name === 'web_search' || tool.name === 'search_knowledge') {
        const query = typeof args.query === 'string' ? `「${args.query.slice(0, 60)}」` : '';
        const results = getAgentSearchResults(tool);
        const web = tool.name === 'web_search';
        if (!results) return query || null;
        const found = results.length ? web ? `找到 ${results.length} 个公开来源` : `命中 ${results.length} 段` : web ? '没有可引用的公开来源' : '没有匹配的段落';
        return query ? `${query} · ${found}` : found;
    }
    if (tool.name === 'list_user_data') {
        const data = getAgentDataResults(tool);
        return data ? `找到 ${data.items.length} 份资料${data.errors.length ? ` · ${data.errors.length} 项暂不可读` : ''}` : null;
    }
    if (tool.name === 'load_analysis_method') return getAgentMethod(tool)?.title ?? (typeof args.id === 'string' ? args.id : null);
    if (tool.name === 'parallel_analysis') {
        const members = parallelAnalysisResults(tool.output);
        return members.length ? `${members.length} 名成员 · ${members.filter(member => member.status === 'completed').length} 名已完成` : null;
    }
    if (tool.name === 'ask_user') {
        const count = getAgentToolQuestions(tool).length;
        return count ? `${count} 个问题` : null;
    }
    // A running focus call has only its arguments; the stored focus replaces them once it completes.
    if (tool.name === 'focus_chart') return getChartFocus(tool)?.caption ?? (typeof args.caption === 'string' && args.caption.trim() ? args.caption.slice(0, 160) : null);
    if (tool.name === 'todo_write' && Array.isArray(args.items)) return `${args.items.length} 项`;
    if (tool.name === 'read_attachment') {
        const read = getAgentAttachmentRead(tool);
        return read ? `${read.name}${read.readUntil !== null && read.total !== null ? ` · 读到 ${read.readUntil} / ${read.total} 字` : ''}` : null;
    }
    if (tool.name === 'remember_user_fact' && typeof args.title === 'string') return args.title;
    for (const key of ['query', 'name', 'type']) if (typeof args[key] === 'string') return (args[key] as string).slice(0, 120);
    return null;
}

export const agentStatusLabels: Record<AgentRunStatus, string> = {
    queued: '任务已排队',
    running: '正在执行',
    awaiting_input: '等待补充信息',
    cancelling: '正在停止',
    completed: '任务完成',
    cancelled: '任务已停止',
    failed: '任务未完成',
};

export function getAgentArtifactHref(artifact: AgentArtifact): string | null {
    if (artifact.recordId) return `/records?id=${encodeURIComponent(artifact.recordId)}`;
    if (!artifact.chartId) return null;
    if (artifact.chartType === 'bazi' || artifact.chartType === 'ziwei') {
        return `/${artifact.chartType}/result?chart=${encodeURIComponent(artifact.chartId)}`;
    }
    return null;
}

/** Only visible messages contribute results; edited-away branches stay hidden. */
export function collectAgentArtifacts(messages: ChatMessage[]): AgentArtifact[] {
    const artifacts = new Map<string, AgentArtifact>();
    for (const message of messages) {
        for (const part of message.agent?.parts ?? []) {
            if (part.type !== 'artifact') continue;
            const href = getAgentArtifactHref(part);
            if (href) artifacts.set(href, part);
        }
    }
    return [...artifacts.values()];
}

/** Collapsed process line: step titles in first-use order with repeats counted, e.g. 八字排盘、定位分析位置 3 次. */
export function summarizeAgentProcess(tools: readonly AgentTool[], limit = 4): string {
    const counts = new Map<string, number>();
    // Plan updates are bookkeeping, not steps the reader looks for.
    for (const tool of tools) if (tool.name !== 'todo_write') counts.set(tool.title, (counts.get(tool.title) ?? 0) + 1);
    const items = [...counts].map(([title, count]) => count > 1 ? `${title} ${count} 次` : title);
    return items.length > limit ? `${items.slice(0, limit).join('、')}等` : items.join('、');
}

/**
 * claude 状态行词表：按工具家族归并成「已查看 N 张命盘，已读取 N 份资料，开启 N 个智能体」。
 * 协作成员数来自本次调用实际派出的成员，而不是调用次数。
 */
const FAMILY_PHRASES: Partial<Record<AgentToolFamily, (count: number) => string>> = {
    chart: count => `已查看 ${count} 张命盘`,
    calculation: count => `已计算 ${count} 次`,
    drilldown: count => `已详查 ${count} 处`,
    search: count => `已搜索 ${count} 次`,
    data: count => `已读取 ${count} 份资料`,
    method: count => `已加载 ${count} 套分析方法`,
    memory: count => `已记忆 ${count} 条`,
    artifacts: count => `已选定 ${count} 份成果`,
    external: count => `已调用 ${count} 个外部工具`,
    other: count => `已运行 ${count} 个工具`,
};

function collaborationMembers(tool: AgentTool): number {
    const members = parallelAnalysisResults(tool.output).length;
    if (members) return members;
    const input = tool.input && typeof tool.input === 'object' && !Array.isArray(tool.input) ? tool.input as Record<string, unknown> : {};
    return Array.isArray(input.collaborators) ? input.collaborators.length : 0;
}

export function summarizeAgentActivity(tools: readonly AgentTool[], questionCount: number, failed: number): string {
    const counts = new Map<AgentToolFamily, number>();
    let members = 0;
    for (const tool of tools) {
        const family = getAgentToolFamily(tool.name);
        if (family === 'collaboration') { members += collaborationMembers(tool); continue; }
        if (family === 'plan') continue;
        counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    const phrases = (Object.keys(FAMILY_PHRASES) as AgentToolFamily[])
        .flatMap(family => counts.has(family) ? [FAMILY_PHRASES[family]!(counts.get(family)!)] : []);
    if (questionCount) phrases.push(`已确认 ${questionCount} 项信息`);
    if (members) phrases.push(`开启 ${members} 个智能体`);
    const text = phrases.join('，');
    return `${text || '任务过程'}${failed ? `，${failed} 处失败` : ''}`;
}

/** Process steps of a task: every call except plan updates, which show as the task list instead. */
export function getAgentSteps(parts: readonly AgentPart[]): AgentTool[] {
    return parts.filter((part): part is AgentTool => part.type === 'tool' && getAgentToolFamily(part.name) !== 'plan');
}

/** 第 N 步: one numbering across the whole task, shared by the chat process card and the workspace. */
export function getAgentStepNumbers(parts: readonly AgentPart[]): ReadonlyMap<string, number> {
    return new Map(getAgentSteps(parts).map((tool, index) => [tool.id, index + 1]));
}

/** Note under a call's details: whether a replay reuses the stored result（用时只落库，不展示 — 用户裁定 2026-10-17）。 */
export function describeAgentCallNote(tool: AgentTool): string | null {
    // A calculation's output names the artifact it was cached as under this task and call ID.
    const stored = tool.status === 'completed' && getAgentToolArtifactId(tool) !== null ? '结果已按任务与调用 ID 暂存，重放不会重新计算或扣费。' : null;
    return stored;
}

/** A process step's state, the summary line and a note for states other than a plain completion. */
export function describeAgentStep(tool: AgentTool, runStatus: AgentRunStatus) {
    const state = getAgentToolState(tool, runStatus);
    const summary = summarizeAgentTool(tool);
    const note = state.status === 'failed' ? '失败'
        : state.status === 'interrupted' ? '已结束（任务停止时未完成）'
        : state.status === 'awaiting_input' ? '等待你回答'
        : state.status === 'pending' ? '待执行'
        : state.status === 'running' && !summary ? '执行中' : null;
    return { ...state, summary, note };
}

export function getAgentToolState(tool: AgentTool, runStatus: AgentRunStatus) {
    if (['running', 'pending', 'awaiting_input'].includes(tool.status) && ['completed', 'cancelled', 'failed'].includes(runStatus)) {
        return { status: 'interrupted', label: '已结束' } as const;
    }
    return {
        status: tool.status,
        label: tool.status === 'pending' ? '待执行' : tool.status === 'awaiting_input' ? '等待回答' : tool.status === 'running' ? '执行中' : tool.status === 'failed' ? '失败' : '完成',
    };
}

/** A collaboration member within its call: one still marked running after the call or the task ended did not finish. */
export function getParallelMemberState(member: Pick<ParallelAnalysisResult, 'status'>, call: ReturnType<typeof getAgentToolState>['status']) {
    if (member.status === 'completed') return { state: 'completed', label: '已完成' } as const;
    if (member.status === 'running' && (call === 'running' || call === 'pending')) return { state: 'running', label: '分析中' } as const;
    return { state: 'failed', label: '未完成' } as const;
}

/** Tool execution time measured by the durable runtime for the completed attempt. */
export function formatAgentToolDuration(ms: number): string {
    if (ms < 1) return '不足 1 毫秒';
    if (ms < 1000) return `${Math.round(ms)} 毫秒`;
    if (ms < 10_000) return `${Math.round(ms / 100) / 10} 秒`;
    return `${Math.round(ms / 1000)} 秒`;
}

export function getAgentResponseTiming(responses: AgentRuntimeInfo['responses']) {
    const measured = new Map((responses ?? []).filter(response => typeof response.durationMs === 'number' && Number.isFinite(response.durationMs) && response.durationMs >= 0).map(response => [response.id, response.durationMs!]));
    return measured.size ? { count: measured.size, durationMs: [...measured.values()].reduce((total, ms) => total + ms, 0) } : null;
}

/** Wall-clock task spans include human waits and recovery; they are not execute() measurements. */
export function getAgentTaskSpan(timing: { startedAt?: number; endedAt?: number }) {
    return typeof timing.startedAt === 'number' && typeof timing.endedAt === 'number' &&
        Number.isFinite(timing.startedAt) && Number.isFinite(timing.endedAt) && timing.startedAt >= 0 && timing.endedAt >= timing.startedAt
        ? timing.endedAt - timing.startedAt : null;
}

/**
 * How long an ended task took: from its creation to the last measured end of a
 * model response or call, so queueing and waits for the user's answer count.
 * Null without a valid creation time or any measured end.
 */
export function getAgentTaskDuration(createdAt: string | undefined, data: Pick<AgentMessageData, 'parts' | 'runtime'> | undefined): number | null {
    const started = createdAt ? Date.parse(createdAt) : NaN;
    if (!Number.isFinite(started) || !data) return null;
    const ends = [...data.runtime?.responses ?? [], ...data.parts.flatMap(part => part.type === 'tool' ? [part] : [])]
        .flatMap(timing => typeof timing.endedAt === 'number' && Number.isFinite(timing.endedAt) && timing.endedAt >= started ? [timing.endedAt] : []);
    return ends.length ? Math.max(...ends) - started : null;
}

/** An ended earlier Agent round as its fold bar shows it: 上一轮 · 问题 · 7 个步骤 · 1 分 46 秒. */
export interface AgentRoundSummary {
    /** The run of the reply that ends the round. */
    id: string;
    /** 上一轮 just before the latest round, 第 N 轮 further back. */
    label: string;
    /** The question that started the round on one line, or empty. */
    question: string;
    status: AgentRunStatus;
    steps: number;
    durationMs: number | null;
    /** Results the Agent selected before answering, as 本任务成果 lists them. */
    results: number;
}
export interface AgentRoundFold { round: AgentRoundSummary; /** The round's first row, which carries the bar. */ first: boolean }

const ROUND_QUESTION_LENGTH = 120;

/**
 * Earlier Agent rounds fold to one bar so the latest round reads on its own.
 * A round runs from the message after the previous reply through the reply
 * that ends it. Only rounds an ended Agent reply closes, with a message after
 * them, fold; plain chat rounds still count toward 第 N 轮. Keyed by message id.
 */
export function getAgentRoundFolds(messages: readonly ChatMessage[]): ReadonlyMap<string, AgentRoundFold> {
    const rounds: ChatMessage[][] = [];
    let current: ChatMessage[] = [];
    for (const message of messages) {
        current.push(message);
        if (message.role === 'assistant') { rounds.push(current); current = []; }
    }
    if (current.length) rounds.push(current);
    const folds = new Map<string, AgentRoundFold>();
    rounds.forEach((round, index) => {
        const reply = round[round.length - 1];
        const data = reply.role === 'assistant' ? reply.agent : undefined;
        // Rows are found by id, so a round with an unsaved row stays open.
        if (!data || index === rounds.length - 1 || !isAgentRunTerminal(data.status) || round.some(message => !message.id)) return;
        const question = round.find(message => message.role === 'user')?.content.replace(/\s+/gu, ' ').trim() ?? '';
        const summary: AgentRoundSummary = {
            id: data.runId,
            label: index === rounds.length - 2 ? '上一轮' : `第 ${index + 1} 轮`,
            question: [...question].slice(0, ROUND_QUESTION_LENGTH).join(''),
            status: data.status,
            steps: getAgentSteps(data.parts).length,
            durationMs: getAgentTaskDuration(reply.createdAt, data),
            results: data.parts.filter(part => part.type === 'artifact' && getAgentArtifactHref(part) !== null).length,
        };
        round.forEach((message, position) => folds.set(message.id, { round: summary, first: position === 0 }));
    });
    return folds;
}

export function formatAgentValue(value: unknown): string {
    if (value === undefined) return '暂无数据';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2) ?? '暂无数据';
}

/** Short tags shown on process steps, one per tool family. */
export const AGENT_TOOL_FAMILY_LABELS: Record<AgentToolFamily, string> = {
    chart: '命盘', calculation: '推演', drilldown: '详查', search: '依据', data: '资料', method: '指引', plan: '计划',
    question: '问题', collaboration: '协作', memory: '记忆', artifacts: '成果', external: '外部', other: '工具',
};

/**
 * 依据 chip of one task: what its searches returned plus the chart positions it
 * located. A task that never searched has no chip; its positions live in the chart.
 */
export function getAgentEvidenceSummary(parts: AgentPart[]) {
    if (!parts.some(part => part.type === 'tool' && getAgentToolFamily(part.name) === 'search')) return null;
    const counts = countAgentEvidence(getAgentEvidence(parts));
    return counts.total ? counts : null;
}

/**
 * The paragraph, counted from 1, of the latest answer citing `cite`. Answers
 * cite only what their own task returned; one answer is parsed, on demand.
 */
export function getAgentCitedParagraph(messages: readonly Pick<ChatMessage, 'agent' | 'content'>[], cite: number): number | null {
    for (let index = messages.length - 1; index >= 0; index--) {
        const { agent, content } = messages[index];
        if (!agent || !content.includes(String(cite))) continue;
        const labels = getAgentCitationLabels(agent.parts);
        if (!labels.has(cite)) continue;
        const paragraph = getCitedParagraphs(content, value => labels.has(value)).get(cite);
        if (paragraph !== undefined) return paragraph;
    }
    return null;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');
const toolArgs = (tool: AgentTool) => tool.input && typeof tool.input === 'object' && !Array.isArray(tool.input) ? tool.input as Record<string, unknown> : {};

/**
 * 男 · 公历 1990-01-15 09:00 · Asia/Shanghai · 日主 庚: whom a bazi reading is
 * about, from the call's arguments and the rules Core returned. A saved chart
 * read back has no birth arguments; other kinds keep their summary.
 */
export function describeAgentChartSubject(tool: AgentTool, value: AgentChart): string {
    if (value.kind !== 'bazi') return value.summary;
    const args = toolArgs(tool);
    const integer = (key: string) => typeof args[key] === 'number' && Number.isInteger(args[key]) ? args[key] as number : null;
    const [year, month, day, hour, minute] = ['birthYear', 'birthMonth', 'birthDay', 'birthHour', 'birthMinute'].map(integer);
    const lunar = args.calendarType === 'lunar';
    const date = year !== null && month !== null && day !== null
        ? `${lunar ? '农历' : '公历'} ${pad(year, 4)}-${lunar && args.isLeapMonth === true ? '闰' : ''}${pad(month)}-${pad(day)}${hour !== null ? ` ${pad(hour)}:${pad(minute ?? 0)}` : ''}`
        : null;
    const rules = value.chart.计算规则;
    const zone = typeof rules?.timezone === 'string' ? rules.timezone : typeof args.timezone === 'string' ? args.timezone : null;
    return [value.chart.基本信息.性别, date, zone, `日主 ${value.chart.基本信息.日主}`].filter(Boolean).join(' · ');
}

const RULE_ORDER = ['dayBoundary', 'timezone', 'solarTermBasis', 'ruleVersion'] as const;
const RULE_LABELS: Partial<Record<typeof RULE_ORDER[number], string>> = { dayBoundary: '子时换日', solarTermBasis: '节气' };

/** 子时换日 midnight · Asia/Shanghai · 节气 instant · bazi-2026.10: the rules Core calculated with, as returned. */
export function describeAgentChartRules(value: AgentChart): string | null {
    const rules = (value.chart as { 计算规则?: unknown }).计算规则;
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return null;
    const items = RULE_ORDER.flatMap(key => {
        const rule = (rules as Record<string, unknown>)[key];
        return typeof rule === 'string' && rule.trim() ? [RULE_LABELS[key] ? `${RULE_LABELS[key]} ${rule.trim()}` : rule.trim()] : [];
    });
    return items.length ? items.join(' · ') : null;
}

/** Whether a reading is a saved record read back, a task result the final selection saved, or a cached one. */
export function getAgentReadingState(reading: AgentTool, saved: ReadonlySet<string>): '已存资料' | '已保存' | '暂存成果' {
    if (reading.name === 'inspect_chart') return '已存资料';
    const artifactId = getAgentToolArtifactId(reading);
    return artifactId !== null && saved.has(artifactId) ? '已保存' : '暂存成果';
}

/**
 * 第 2 步计算 · 第 5 步定位 · 暂存成果: the latest task's steps behind a chart
 * tab and what became of its reading. Calls from earlier tasks carry no number.
 */
export function describeAgentChartSteps({ reading, focus, numbers, state }: {
    reading: AgentTool | undefined; focus: AgentTool | undefined; numbers: ReadonlyMap<string, number>; state: string | null;
}): string {
    const readingStep = reading && numbers.get(reading.id);
    const focusStep = focus && numbers.get(focus.id);
    return [
        readingStep && `第 ${readingStep} 步${reading.name === 'inspect_chart' ? '读取' : '计算'}`,
        focusStep && `第 ${focusStep} 步定位`,
        state,
    ].filter(Boolean).join(' · ');
}

/**
 * 模型定位: the focus calls of the conversation and the chart positions they
 * marked, by the labels of the chart they name, in first-located order.
 */
export function getAgentLocatedPositions(model: AgentWorkspaceModel): { toolIds: string[]; labels: string[] } {
    const toolIds: string[] = [];
    const labels = new Set<string>();
    for (const item of model.evidence) {
        if (item.kind !== 'chart') continue;
        toolIds.push(item.toolId);
        const resource = model.resources.find(entry => entry.id === model.chartResources.get(item.focus.reference));
        const reading = resource?.toolIds.flatMap(id => model.toolsById.get(id) ?? []).findLast(tool => getAgentChart(tool));
        const value = reading && getAgentChart(reading);
        if (value) for (const target of getChartTargets(value)) if (item.focus.targetIds.includes(target.id)) labels.add(target.label);
    }
    return { toolIds, labels: [...labels] };
}

/** A Markdown document without its leading `# Title` when that title is already shown above it. */
export function stripLeadingTitle(markdown: string, title: string): string {
    const match = /^\s*#[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/.exec(markdown);
    return match && match[1].trim() === title.trim() ? markdown.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, '') : markdown;
}

/** Three luck periods around `year`: the one it falls in with its neighbours, or the first three before the first starts. */
export function getDayunWindow(periods: readonly { 干支: string; 起运年份: number }[], year: number) {
    const current = periods.findIndex((period, index) => year >= period.起运年份 && (index === periods.length - 1 || year < periods[index + 1].起运年份));
    const start = current < 0 ? 0 : Math.max(0, Math.min(current - 1, periods.length - 3));
    return periods.slice(start, start + 3).map((period, index) => ({ ...period, current: start + index === current }));
}
