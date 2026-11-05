import type { ChatMessage } from '@/types';
import { type AgentMessageData, type AgentPart, type AgentRunStatus, type AgentRuntimeInfo } from '@/lib/agent/types';
import { getAgentToolFamily, type AgentToolFamily, AGENT_ARCHIVE_TOOLS, AGENT_BACKGROUND_TOOL, AGENT_CHART_NAMES, AGENT_CODEMODE_TOOL, AGENT_SKILL_TOOLS, AGENT_SUBMIT_PLAN_TOOL, AGENT_TOOL_SEARCH_TOOL, isAgentChartTool, isAgentMemberTool } from '@/lib/agent/tool-catalog';
import { getAgentAttachmentRead, getAgentCalculation, getAgentChart, getAgentConversationHits, getAgentDataResults, getAgentGeneratedImages, getAgentMethod, getAgentNotes, getAgentScript, getAgentSearchResults, getAgentSkillLoad, getAgentToolArtifactId, getAgentToolQuestions, type AgentChart } from '@/lib/agent/tool-presentation';
import { AGENT_ARCHIVE_KIND_LABELS, getAgentArchiveProposal, getAgentArchiveRecord } from '@/lib/agent/archive';
import { getChartFocus, getChartTargets } from '@/lib/agent/chart-interaction';
import { getSavedChartHref } from '@/lib/agent/chart-save';
import type { AgentWorkspaceModel } from '@/lib/agent/workspace';
import { parallelAnalysisResults, parallelMemberName, type ParallelAnalysisResult } from '@/lib/agent/parallel-results';
import { countAgentEvidence, getAgentCitationLabels, getAgentEvidence } from '@/lib/agent/evidence';
import { getCitedParagraphs } from '@/lib/chat/markdown-citations';
import { mentionTypeLabels } from '@/components/chat/mentionStyles';

/** 资料类别的中文名（八字命盘、六爻占卜…），不把 bazi_chart 之类的内部类型名露给用户。 */
export const getAgentDataTypeLabel = (type: unknown) => typeof type === 'string' && Object.hasOwn(mentionTypeLabels, type)
    ? mentionTypeLabels[type as keyof typeof mentionTypeLabels] : mentionTypeLabels.default;

export type AgentArtifact = Extract<AgentPart, { type: 'artifact' }>;
export type AgentTool = Extract<AgentPart, { type: 'tool' }>;
export type AgentProcessPart = Extract<AgentPart, { type: 'tool' | 'reasoning' | 'question' }>;

/**
 * 按发生顺序分块：连续的过程步骤（思考、工具、提问）合成一块，中间说的话原样留在块与块之间，
 * 所以读起来是「说一句 → 调工具 → 再说一句 → 再调工具」。
 */
export function groupAgentParts(parts: AgentPart[]) {
    const groups: Array<{ type: 'activity'; id: string; parts: AgentProcessPart[] } | { type: 'content'; id: string; part: Exclude<AgentPart, AgentProcessPart> }> = [];
    let pending: AgentProcessPart[] = [];
    const flush = () => {
        if (pending.length) groups.push({ type: 'activity', id: pending[0].id, parts: pending });
        pending = [];
    };
    for (const part of parts) {
        if (part.type === 'tool' || part.type === 'reasoning' || part.type === 'question') pending.push(part);
        else {
            flush();
            groups.push({ type: 'content', id: part.id, part });
        }
    }
    flush();
    return groups;
}

export function getAgentActivityLabel(data: AgentMessageData) {
    if (data.status === 'queued') return '等待后台开始任务';
    if (data.status === 'awaiting_input') return '等待你回答问题';
    if (data.status === 'cancelling') return '正在停止任务';
    const activity = data.runtime?.activity;
    switch (activity?.phase) {
        case 'compacting': return '正在压缩上下文';
        case 'background': return '等待后台子分析回报';
        case 'tools': return activity.toolTitle ? `正在${activity.toolTitle}` : '正在执行工具';
        case 'thinking': return '正在思考';
        case 'responding': return '正在整理回答';
        case 'settling': return '正在整理任务结果';
        case 'retrying': return `准备重试${activity.attempt ? ` · 第 ${activity.attempt} 次` : ''}`;
        case 'preparing': return '正在准备下一步';
        default: return '等待模型响应';
    }
}

/** Members still analysing on member cards, by name, each once. */
function analysingMembers(tools: readonly AgentTool[]): string[] {
    return [...new Set(tools.flatMap(tool => parallelAnalysisResults(tool.output).filter(member => member.status === 'running').map(parallelMemberName)))];
}

/**
 * The live line under a running answer: the phase, and while a tool runs what it works on,
 * e.g. 正在定位分析位置 · 月干丁火. A collaboration names the members still analysing instead,
 * and so does a task that only waits for its background subagents.
 */
export function getAgentLiveLine(data: AgentMessageData): string {
    const label = getAgentActivityLabel(data);
    const phase = data.runtime?.activity?.phase;
    if (data.status === 'running' && phase === 'background') {
        const names = analysingMembers(data.parts.filter((part): part is AgentTool => part.type === 'tool' && part.name === AGENT_BACKGROUND_TOOL && part.status === 'running'));
        return names.length ? `${label} · ${names.join('、')} 正在分析` : label;
    }
    // A step left marked running must not describe a thinking or answering phase.
    if (data.status !== 'running' || (phase && phase !== 'tools')) return label;
    const tool = data.parts.findLast((part): part is AgentTool => part.type === 'tool' && part.status === 'running');
    if (!tool) return label;
    if (isAgentMemberTool(tool.name)) {
        const names = analysingMembers([tool]);
        if (names.length) return `${tool.name === 'parallel_analysis' ? '等待协作成员' : '后台子分析'} · ${names.join('、')} 正在分析`;
    }
    const head = phase ? label : `正在${tool.title}`;
    const summary = isAgentMemberTool(tool.name) ? null : summarizeAgentTool(tool);
    return summary ? `${head} · ${summary}` : head;
}

/** A readable step title when the model left the raw tool name as its title. */
const RAW_TOOL_TITLES: Record<string, string> = {
    parallel_analysis: '协作分析',
    [AGENT_BACKGROUND_TOOL]: '后台子分析',
    inspect_chart: '查看命盘',
    focus_chart: '定位分析位置',
    web_search: '联网搜索',
    web_fetch: '读取网页',
    search_knowledge: '知识库检索',
    list_user_data: '检索资料',
    read_user_data: '读取资料',
    read_user_notes: '读取每日笔记',
    search_conversations: '检索以往对话',
    generate_image: '生成图片',
    [AGENT_ARCHIVE_TOOLS.record]: '记入档案',
    [AGENT_ARCHIVE_TOOLS.propose]: '生成保存卡片',
    read_attachment: '读取附件',
    [AGENT_SKILL_TOOLS.load]: '加载方法或技能',
    [AGENT_SKILL_TOOLS.read]: '读取技能文件',
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

/** 筛选参数是字符串数组：「涉及 日柱、流年」「只看 六冲」 */
const listLabel = (prefix: string) => (value: unknown) => Array.isArray(value) && value.length && value.every(item => typeof item === 'string')
    ? `${prefix} ${value.join('、')}` : '';

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
    focus: value => value === '全部' ? '' : `只看 ${value}`,
    pillars: listLabel('涉及'),
    types: listLabel('只看'),
    sections: listLabel('只看'),
    detailLevel: value => value === 'full' ? '完整' : value === 'more' ? '更多' : '',
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

/** A page address as a reader recognises it: host and path without the scheme, cut to 60 characters. */
function shortAddress(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.host.replace(/^www\./u, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`.slice(0, 60);
    } catch {
        return url.slice(0, 60);
    }
}

/** 「工作」 · 2026-01-01 至 2026-03-31: the conditions a listing was narrowed by. */
function describeListConditions(args: Record<string, unknown>): string {
    const keyword = typeof args.keyword === 'string' && args.keyword.trim() ? `「${args.keyword.trim().slice(0, 40)}」` : '';
    const since = typeof args.since === 'string' ? args.since : '', until = typeof args.until === 'string' ? args.until : '';
    const range = since && until ? `${since} 至 ${until}` : since ? `${since} 起` : until ? `至 ${until}` : '';
    return [keyword, range].filter(Boolean).join(' · ');
}

/** 「小王 · 1990 / 1 / 15 · 9 时」: whose birth data a chart step took; a pairing side may name a chart instead. */
function describeBirth(args: Record<string, unknown>): string {
    const date = [args.birthYear, args.birthMonth, args.birthDay].filter(value => typeof value === 'number').join(' / ');
    return [typeof args.name === 'string' ? args.name : '', date, typeof args.birthHour === 'number' ? `${args.birthHour} 时` : '',
        typeof args.reference === 'string' ? '已有命盘' : ''].filter(Boolean).join(' · ');
}

/** One line under a process step, read from its arguments and stored result only. */
export function summarizeAgentTool(tool: AgentTool): string | null {
    const args = tool.input && typeof tool.input === 'object' && !Array.isArray(tool.input) ? tool.input as Record<string, unknown> : {};
    if (getAgentToolFamily(tool.name) === 'drilldown') return describeDrilldownSelection(args);
    // 推算时辰：出生日期、记得的时段与前事年份，算完再给候选个数
    if (tool.name === 'bazi_hour_candidates') {
        const window = typeof args.fromHour === 'number' || typeof args.toHour === 'number' ? `${args.fromHour ?? 0}–${args.toHour ?? 24} 时` : '';
        const events = Array.isArray(args.eventYears) && args.eventYears.length ? `前事 ${args.eventYears.join('、')}` : '';
        const result = getAgentCalculation(tool);
        const count = result?.kind === 'bazi_hour_candidates' ? `${result.data.候选数量} 个候选时辰` : '';
        return [describeBirth(args), window, events, count].filter(Boolean).join(' · ') || null;
    }
    if (typeof args.birthYear === 'number' && (tool.name.startsWith('bazi') || tool.name.startsWith('ziwei'))) return describeBirth(args) || null;
    // 合盘的两人按 Core 的默认称呼（甲方、乙方）补名。
    if (tool.name === 'bazi_hepan') return (['a', 'b'] as const).map((key, index) => describeBirth({
        name: index ? '乙方' : '甲方', ...(args[key] && typeof args[key] === 'object' ? args[key] as Record<string, unknown> : {}),
    })).join(' × ');
    if (tool.name === 'web_fetch') {
        const address = typeof args.url === 'string' ? `「${shortAddress(args.url)}」` : '';
        const page = getAgentSearchResults(tool)?.[0];
        return [address, page && `读取了「${page.title.slice(0, 40)}」`].filter(Boolean).join(' · ') || null;
    }
    if (tool.name === 'web_search' || tool.name === 'search_knowledge') {
        const query = typeof args.query === 'string' ? `「${args.query.slice(0, 60)}」` : '';
        const results = getAgentSearchResults(tool);
        const web = tool.name === 'web_search';
        if (!results) return query || null;
        const found = results.length ? web ? `找到 ${results.length} 个公开来源` : `命中 ${results.length} 段` : web ? '没有可引用的公开来源' : '没有匹配的段落';
        return query ? `${query} · ${found}` : found;
    }
    if (tool.name === 'generate_image') {
        const generated = getAgentGeneratedImages(tool);
        if (generated) return `生成 ${generated.images.length} 张图片`;
        return typeof args.prompt === 'string' && args.prompt.trim() ? `「${args.prompt.trim().slice(0, 40)}」` : null;
    }
    if (tool.name === 'list_user_data') {
        const data = getAgentDataResults(tool);
        const found = data && `找到 ${data.items.length} 份资料${data.errors.length ? ` · ${data.errors.length} 项暂不可读` : ''}`;
        return [describeListConditions(args), found].filter(Boolean).join(' · ') || null;
    }
    if (tool.name === 'read_user_notes') {
        const notes = getAgentNotes(tool);
        return [describeListConditions(args), notes && `${notes.notes.length}${notes.more ? '+' : ''} 条笔记`].filter(Boolean).join(' · ') || null;
    }
    if (tool.name === 'search_conversations') {
        const query = typeof args.query === 'string' ? `「${args.query.slice(0, 60)}」` : '';
        const hits = getAgentConversationHits(tool);
        return [query, hits && (hits.length ? `命中 ${hits.length} 处` : '没有找到')].filter(Boolean).join(' · ') || null;
    }
    if (tool.name === AGENT_ARCHIVE_TOOLS.record) {
        const event = getAgentArchiveRecord(tool);
        if (event) return `${event.date} · ${event.title}`;
        return typeof args.title === 'string' ? args.title.slice(0, 80) : null;
    }
    if (tool.name === AGENT_ARCHIVE_TOOLS.propose) {
        const card = getAgentArchiveProposal(tool);
        if (!card) return typeof args.title === 'string' ? args.title.slice(0, 80) : null;
        const subject = card.proposal.kind === 'master_review' ? card.proposal.chart.label : card.proposal.title;
        return `${AGENT_ARCHIVE_KIND_LABELS[card.proposal.kind]} · ${subject}`;
    }
    if (tool.name === AGENT_SKILL_TOOLS.load) {
        const method = getAgentMethod(tool);
        if (method) return `${method.title} · v${method.version}`;
        const skill = getAgentSkillLoad(tool);
        if (skill) return `${skill.name} · v${skill.version}${skill.files.length ? ` · ${skill.files.length} 个附属文件` : ''}`;
        return typeof args.name === 'string' ? args.name : null;
    }
    if (tool.name === AGENT_SKILL_TOOLS.read) return typeof args.name === 'string' && typeof args.path === 'string' ? `${args.name}/${args.path}` : null;
    if (tool.name === 'read_user_data') return getAgentDataTypeLabel(args.type);
    if (tool.name === 'parallel_analysis') {
        const members = parallelAnalysisResults(tool.output);
        const names = members.length ? members.map(parallelMemberName)
            : Array.isArray(args.tasks) ? args.tasks.flatMap(task => task && typeof task === 'object' && typeof (task as { name?: unknown }).name === 'string' ? [(task as { name: string }).name] : []) : [];
        return names.length ? formatMemberNames(names) : null;
    }
    if (tool.name === AGENT_BACKGROUND_TOOL) {
        const action = typeof args.action === 'string' ? BACKGROUND_ACTION_LABELS[args.action] : undefined;
        if (args.action === 'status') return action ?? null;
        const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : null;
        return [name, action].filter(Boolean).join(' · ') || null;
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
    if (tool.name === AGENT_TOOL_SEARCH_TOOL) {
        const query = typeof args.query === 'string' ? `「${args.query.slice(0, 60)}」` : '';
        const loaded = tool.output && typeof tool.output === 'object' && Array.isArray((tool.output as { loaded?: unknown }).loaded)
            ? (tool.output as { loaded: unknown[] }).loaded.filter(name => typeof name === 'string') : [];
        if (!tool.output || tool.status !== 'completed') return query || null;
        return query ? `${query} · 加载 ${loaded.length} 个工具` : `加载 ${loaded.length} 个工具`;
    }
    if (tool.name === AGENT_SUBMIT_PLAN_TOOL) {
        if (tool.status === 'running' || tool.status === 'pending') return '等待你批准';
        const output = tool.output && typeof tool.output === 'object' ? tool.output as { approved?: unknown; disabled?: unknown } : {};
        if (output.disabled === true) return '计划模式已关闭';
        return output.approved === true ? '已批准' : output.approved === false ? '要求修改' : null;
    }
    if (tool.name === AGENT_CODEMODE_TOOL) {
        // Pi lists a script's calls once it settles; while it runs its calls show as steps of their own.
        const calls = getAgentScript(tool)?.calls ?? [];
        const failed = calls.filter(call => call.status === 'error').length;
        return calls.length ? `调用 ${calls.length} 次${failed ? ` · ${failed} 次失败` : ''}` : null;
    }
    for (const key of ['query', 'name', 'type']) if (typeof args[key] === 'string') return (args[key] as string).slice(0, 120);
    return null;
}

const BACKGROUND_ACTION_LABELS: Partial<Record<string, string>> = {
    spawn: '新建并交给任务', send: '追加任务', stop: '中止当前工作', dismiss: '解散', status: '查看子分析状态',
};

/**
 * The line under a member: what it was asked to cover. A collaboration member has the user's configured focus; a
 * background subagent has the message the main agent sent it.
 */
export function getAgentMemberBrief(tool: AgentTool, member: Pick<ParallelAnalysisResult, 'focus'>): string | null {
    if (member.focus) return member.focus;
    const message = tool.name === AGENT_BACKGROUND_TOOL ? toolArgs(tool).message : undefined;
    return typeof message === 'string' && message.trim() ? message.trim() : null;
}

/** 协作成员名称连成一行；超出字数的名字收成「等 N 位」，免得步骤行被撑开。 */
export function formatMemberNames(names: readonly string[], limit = MEMBER_NAMES_LIMIT): string {
    const shown: string[] = [];
    let length = 0;
    for (const name of names) {
        const next = length + (shown.length ? 1 : 0) + Array.from(name).length;
        if (shown.length && next > limit) break;
        shown.push(name);
        length = next;
    }
    return shown.length < names.length ? `${shown.join('、')} 等 ${names.length} 位` : shown.join('、');
}
const MEMBER_NAMES_LIMIT = 16;

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
    return artifact.chartType === 'bazi' || artifact.chartType === 'ziwei' ? getSavedChartHref(artifact.chartType, artifact.chartId) : null;
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
    // 按技能计：加载和读它的文件都算用了这个技能；方法是内置技能，按方法计。
    skill: count => `已使用 ${count} 个技能`,
    plan: count => `已提交 ${count} 次计划`,
    memory: count => `已记忆 ${count} 条`,
    archive: count => `已整理 ${count} 条档案`,
    code: count => `已运行 ${count} 个脚本`,
    external: count => `已调用 ${count} 个外部工具`,
    other: count => `已运行 ${count} 个工具`,
};

function collaborationMembers(tool: AgentTool): number {
    const members = parallelAnalysisResults(tool.output).length;
    if (members) return members;
    const input = tool.input && typeof tool.input === 'object' && !Array.isArray(tool.input) ? tool.input as Record<string, unknown> : {};
    return Array.isArray(input.collaborators) ? input.collaborators.length : 0;
}

/** 思考秒数：只统计「只想不说」的那几次模型调用，显示在过程统计最前面。 */
export function summarizeThinkingTime(parts: readonly AgentProcessPart[]): string | null {
    const ms = parts.reduce((total, part) => part.type === 'reasoning' ? total + (part.durationMs ?? 0) : total, 0);
    if (ms < 1000) return null;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `已思考 ${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `已思考 ${minutes} 分 ${rest} 秒` : `已思考 ${minutes} 分`;
}

export function summarizeAgentActivity(tools: readonly AgentTool[], questionCount: number, failed: number): string {
    const counts = new Map<AgentToolFamily, number>();
    let members = 0;
    // A background subagent counts once, when it is started; later messages go to the same one.
    const subagents = new Set<string>();
    // 方法与技能按名计：同一个方法读两次仍是一套。
    const skills = new Set<string>();
    for (const tool of tools) {
        const family = getAgentToolFamily(tool.name);
        if (tool.name === AGENT_BACKGROUND_TOOL) {
            const args = toolArgs(tool);
            if (args.action === 'spawn' && typeof args.name === 'string' && tool.status !== 'failed') subagents.add(args.name);
            continue;
        }
        if (family === 'collaboration') { members += collaborationMembers(tool); continue; }
        if (family === 'todo') continue;
        if (family === 'skill') {
            if (tool.status !== 'failed') {
                const resolved = getAgentMethod(tool)?.id ?? getAgentSkillLoad(tool)?.name ?? String(toolArgs(tool).name ?? tool.id);
                skills.add(resolved);
                counts.set(family, skills.size);
            }
            continue;
        }
        counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    const phrases = (Object.keys(FAMILY_PHRASES) as AgentToolFamily[])
        .flatMap(family => counts.has(family) ? [FAMILY_PHRASES[family]!(counts.get(family)!)] : []);
    if (questionCount) phrases.push(`已确认 ${questionCount} 项信息`);
    if (members + subagents.size) phrases.push(`开启 ${members + subagents.size} 个智能体`);
    const text = phrases.join('，');
    return `${text || '任务过程'}${failed ? `，${failed} 处失败` : ''}`;
}

/**
 * Process steps of a task: every call the model made except task-list updates, which show as the task list instead.
 * A code mode script's calls are part of the script's step.
 */
export function getAgentSteps(parts: readonly AgentPart[]): AgentTool[] {
    return parts.filter((part): part is AgentTool => part.type === 'tool' && !part.parentId && getAgentToolFamily(part.name) !== 'todo');
}

/** The calls a code mode script made, keyed by the script's card, in transcript order (the order it made them). */
export function getAgentScriptCalls(parts: readonly AgentPart[]): ReadonlyMap<string, AgentTool[]> {
    const calls = new Map<string, AgentTool[]>();
    for (const part of parts) if (part.type === 'tool' && part.parentId) calls.set(part.parentId, [...calls.get(part.parentId) ?? [], part]);
    return calls;
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

export function formatAgentValue(value: unknown): string {
    if (value === undefined) return '暂无数据';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2) ?? '暂无数据';
}

/** Short tags shown on process steps, one per tool family. */
export const AGENT_TOOL_FAMILY_LABELS: Record<AgentToolFamily, string> = {
    chart: '命盘', calculation: '推演', drilldown: '详查', search: '依据', data: '资料', method: '指引', skill: '技能', plan: '计划', todo: '清单',
    question: '问题', collaboration: '协作', memory: '记忆', archive: '档案', code: '脚本', external: '外部', image: '生图', time: '时间', other: '工具',
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

/**
 * 概览行的第二行：只说缩略图里看不到的事实，避免与小图重复。
 * 八字的缩略图是四柱，这里给性别与出生时间；紫微缩略图只标命宫，这里给五行局与命身主；以此类推。
 */
export function describeOverviewFacts(tool: AgentTool, value: AgentChart): string {
    switch (value.kind) {
        case 'bazi': {
            const subject = describeAgentChartSubject(tool, value).split(' · ');
            // 去掉日主（缩略图的日柱已经写着）与时区，只留性别与出生时间。
            return subject.filter(part => !part.startsWith('日主 ') && !/^[A-Za-z]+\/[A-Za-z_]+/.test(part)).join(' · ');
        }
        case 'ziwei': {
            const basic = value.chart.基本信息;
            return [basic.五行局, basic.命主 && `命主 ${basic.命主}`, basic.身主 && `身主 ${basic.身主}`].filter(Boolean).join(' · ');
        }
        case 'liuyao': {
            const board = value.chart.卦盘;
            return board.变卦 ? `${board.本卦.卦名} → ${board.变卦.卦名}` : `${board.本卦.卦名} · 静卦`;
        }
        case 'meihua': {
            const board = value.chart.卦盘;
            return `${board.本卦.卦名} → ${board.变卦.卦名} · 体${board.体卦.卦名} 用${board.用卦.卦名}`;
        }
        case 'daliuren': {
            const basic = value.chart.基本信息;
            return [basic.课式.split(' ')[0], `月将 ${basic.月将}`].join(' · ');
        }
        case 'xiaoliuren': {
            const result = value.chart.结果;
            return [result.性质, result.五行, result.方位].filter(Boolean).join(' · ');
        }
        case 'tarot': {
            const cards = value.chart.牌阵展开;
            const reversed = cards.filter(card => card.状态 === '逆位').length;
            return `${value.chart.问卜设定.牌阵} · ${cards.length} 张${reversed ? ` · ${reversed} 张逆位` : ''}`;
        }
        case 'astrology': {
            const anchors = value.chart.命盘锚点;
            return [`太阳${anchors.太阳.星座}`, `月亮${anchors.月亮.星座}`, anchors.上升 && `上升${anchors.上升.星座}`].filter(Boolean).join(' · ');
        }
        case 'almanac': {
            const chart = value.chart;
            const yi = chart.择日宜忌.宜.slice(0, 2).join('、');
            return [chart.传统黄历基调.农历, yi && `宜 ${yi}`].filter(Boolean).join(' · ');
        }
        default:
            return value.summary;
    }
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
