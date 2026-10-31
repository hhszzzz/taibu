/**
 * 上下文分类（claude 会话详情同款解剖）：
 * 消息 / 系统工具 / MCP / 系统提示 / 技能 / 记忆 / 自动压缩缓冲 / 空闲空间。
 *
 * taibu 只有上下文总量（Pi 实测）与工具用量是实测值，其余按固定比例拆分；MCP（工具定义 + 服务器说明）
 * 是接入时的估算；未接入的分类保留占位行（deferred），不虚构 token。
 * 技能单独一行说明本任务用了哪几个方法和哪些技能：目录随任务注入系统提示，正文由 load_skill 读进上下文，
 * 所以「未用方法」不等于「未注入」。
 */
import type { AgentRuntimeInfo } from '@/lib/agent/types';

export type AgentContext = NonNullable<AgentRuntimeInfo['context']>;

export type ContextSegment = { key: string; label: string; tokens: number; tone: string; deferred?: boolean; count?: number; meta?: string };

/** 本任务用的方法与技能：目录随系统提示注入，正文由 load_skill 读进上下文；tokens 是读进上下文的计数。 */
export interface ContextSkills { cards: Array<{ id: string; kind?: 'method' | 'skill'; title: string; version: string; tokens?: number }> }

/** Share of the measured context the system prompt is assumed to take. */
const SYSTEM_SHARE = 0.06;
/** Share of the measured context the tool definitions are assumed to take when usage has no tool totals. */
const TOOL_SHARE = 0.12;

function skillsMeta(skills: ContextSkills) {
    const loaded = skills.cards.filter(card => card.kind === 'skill').length;
    const cards = skills.cards.length - loaded;
    const parts = [cards && `${cards} 个方法`, loaded && `${loaded} 个技能`].filter(Boolean);
    return parts.length ? parts.join(' · ') : '技能目录';
}

export function buildContextSegments(runtime: AgentRuntimeInfo, context: AgentContext, skills?: ContextSkills): ContextSegment[] {
    const capacity = runtime.model.contextWindow ?? 0;
    const used = Math.max(context.tokens, 0);
    // measuredTokens 是整段前缀的实测总量（含系统提示与工具），不是消息本身。
    // 方法目录与技能目录属于系统提示，但按「技能」单独列出：先把它们从系统份额里移出，
    // 再按固定比例留出其余系统提示与工具，最后用剩余量作为消息；四者之和等于 used。
    // 早先的任务只记了方法目录的 skillsTokens；新任务把整段目录记在 runtime.skills.sectionTokens。
    const catalog = skills ? Math.max(runtime.skills?.sectionTokens ?? runtime.skillsTokens ?? 0, 0) : 0;
    const skillsTokens = catalog + (skills?.cards ?? []).reduce((sum, card) => sum + Math.max(card.tokens ?? 0, 0), 0);
    // MCP 的工具定义与「外部服务」说明都是接入时的估算；两段合并为「MCP」一行，从系统份额之外扣出。
    const mcp = runtime.mcp;
    const mcpSection = Math.min(Math.max(mcp?.sectionTokens ?? 0, 0), Math.max(used - skillsTokens, 0));
    const system = Math.max(Math.round(used * SYSTEM_SHARE) - catalog - mcpSection, 0);
    const mcpTools = Math.min(Math.max(mcp?.toolsTokens ?? 0, 0), Math.max(used - system - skillsTokens - mcpSection, 0));
    const mcpTokens = mcpTools + mcpSection;
    const reserved = system + skillsTokens + mcpTokens;
    const toolTokens = Object.values(runtime.usage?.tools ?? {}).reduce((sum, item) => sum + (item.totalTokens ?? 0), 0);
    const tools = toolTokens > 0 ? Math.min(toolTokens, Math.max(used - reserved, 0)) : Math.min(Math.round(used * TOOL_SHARE), Math.max(used - reserved, 0));
    const messages = Math.max(used - tools - reserved, 0);
    const buffer = context.compactions > 0 && capacity > used ? Math.round(capacity * 0.066) : 0;
    const free = Math.max(capacity - used - buffer, 0);
    return [
        { key: 'messages', label: '消息', tokens: messages, tone: 'messages' },
        { key: 'tools', label: '系统工具', tokens: tools, tone: 'tools' },
        mcp && mcp.direct + mcp.deferred + mcp.codemode + mcp.servers + mcp.skipped > 0
            ? { key: 'mcp', label: 'MCP', tokens: mcpTokens, tone: 'mcp' }
            : { key: 'mcp', label: 'MCP', tokens: 0, tone: 'mcp', deferred: true },
        { key: 'system', label: '系统提示', tokens: system, tone: 'system' },
        skills
            ? { key: 'skills', label: '技能', tokens: skillsTokens, tone: 'skills', meta: skillsMeta(skills) }
            : { key: 'skills', label: '技能', tokens: 0, tone: 'skills', deferred: true, count: 0 },
        { key: 'memory', label: '记忆', tokens: 0, tone: 'memory', deferred: true, count: 0 },
        { key: 'buffer', label: '自动压缩缓冲', tokens: buffer, tone: 'buffer' },
        { key: 'free', label: '空闲空间', tokens: free, tone: 'free' },
    ];
}
