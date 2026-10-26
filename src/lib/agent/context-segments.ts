/**
 * 上下文分类（claude 会话详情同款解剖）：
 * 消息 / 系统工具 / MCP 工具 / 系统提示 / 技能 / 记忆文件 / MCP 服务器说明 / 自动压缩缓冲 / 空闲空间。
 *
 * taibu 只有上下文总量（Pi 实测）与工具用量是实测值，其余按固定比例拆分；MCP 两行是接入时的估算；
 * 未接入的分类保留占位行（deferred），不虚构 token。
 * 技能单独一行说明本任务用了哪几张卡：目录随任务注入系统提示，正文由 load_analysis_method 读进上下文，
 * 所以「未用卡」不等于「未注入」。
 */
import type { AgentRuntimeInfo } from '@/lib/agent/types';

export type AgentContext = NonNullable<AgentRuntimeInfo['context']>;

export type ContextSegment = { key: string; label: string; tokens: number; tone: string; deferred?: boolean; count?: number; meta?: string };

/** 本任务用的方法卡：目录随系统提示注入，正文由 load_analysis_method 读进上下文；tokens 是卡在上下文里的计数。 */
export interface ContextSkills { listed: boolean; cards: Array<{ id: string; title: string; version: string; tokens?: number }> }

/** Share of the measured context the system prompt is assumed to take. */
const SYSTEM_SHARE = 0.06;
/** Share of the measured context the tool definitions are assumed to take when usage has no tool totals. */
const TOOL_SHARE = 0.12;

function mcpMeta(mcp: NonNullable<AgentRuntimeInfo['mcp']>) {
    return [mcp.direct && `${mcp.direct} 个常驻`, mcp.deferred && `${mcp.deferred} 个按需`, mcp.codemode && `${mcp.codemode} 个仅脚本`]
        .filter(Boolean).join(' · ');
}

export function buildContextSegments(runtime: AgentRuntimeInfo, context: AgentContext, skills?: ContextSkills): ContextSegment[] {
    const capacity = runtime.model.contextWindow ?? 0;
    const used = Math.max(context.tokens, 0);
    // measuredTokens 是整段前缀的实测总量（含系统提示与工具），不是消息本身。
    // 方法目录属于系统提示，但按「技能」单独列出：先把它从系统份额里移出，
    // 再按固定比例留出其余系统提示与工具，最后用剩余量作为消息；四者之和等于 used。
    const catalog = skills ? Math.max(runtime.skillsTokens ?? 0, 0) : 0;
    const skillsTokens = catalog + (skills?.cards ?? []).reduce((sum, card) => sum + Math.max(card.tokens ?? 0, 0), 0);
    // MCP 的常驻工具定义与「外部服务」小节是估算值，同样从系统份额之外的部分里扣出，四类之和仍等于 used。
    const mcp = runtime.mcp;
    const mcpSection = Math.min(Math.max(mcp?.sectionTokens ?? 0, 0), Math.max(used - skillsTokens, 0));
    const system = Math.max(Math.round(used * SYSTEM_SHARE) - catalog - mcpSection, 0);
    const mcpTools = Math.min(Math.max(mcp?.toolsTokens ?? 0, 0), Math.max(used - system - skillsTokens - mcpSection, 0));
    const reserved = system + skillsTokens + mcpSection + mcpTools;
    const toolTokens = Object.values(runtime.usage?.tools ?? {}).reduce((sum, item) => sum + (item.totalTokens ?? 0), 0);
    const tools = toolTokens > 0 ? Math.min(toolTokens, Math.max(used - reserved, 0)) : Math.min(Math.round(used * TOOL_SHARE), Math.max(used - reserved, 0));
    const messages = Math.max(used - tools - reserved, 0);
    const buffer = context.compactions > 0 && capacity > used ? Math.round(capacity * 0.066) : 0;
    const free = Math.max(capacity - used - buffer, 0);
    return [
        { key: 'messages', label: '消息', tokens: messages, tone: 'messages' },
        { key: 'tools', label: '系统工具', tokens: tools, tone: 'tools' },
        mcp && mcp.direct + mcp.deferred + mcp.codemode > 0
            ? { key: 'mcp', label: 'MCP 工具', tokens: mcpTools, tone: 'mcp', count: mcp.direct + mcp.deferred + mcp.codemode, meta: mcpMeta(mcp) }
            : { key: 'mcp', label: 'MCP 工具', tokens: 0, tone: 'mcp', deferred: true, count: 0 },
        { key: 'system', label: '系统提示', tokens: system, tone: 'system' },
        skills
            ? { key: 'skills', label: '技能', tokens: skillsTokens, tone: 'skills', meta: skills.cards.length ? `${skills.cards.length} 张卡` : '方法目录' }
            : { key: 'skills', label: '技能', tokens: 0, tone: 'skills', deferred: true, count: 0 },
        { key: 'memory', label: '记忆文件', tokens: 0, tone: 'memory', deferred: true, count: 0 },
        mcp && mcp.servers + mcp.skipped > 0
            ? { key: 'mcp-instructions', label: 'MCP 服务器说明', tokens: mcpSection, tone: 'mcp', meta: [mcp.servers && `${mcp.servers} 个服务`, mcp.skipped && `${mcp.skipped} 个未连上`].filter(Boolean).join(' · ') }
            : { key: 'mcp-instructions', label: 'MCP 服务器说明', tokens: 0, tone: 'mcp', deferred: true },
        { key: 'buffer', label: '自动压缩缓冲', tokens: buffer, tone: 'buffer' },
        { key: 'free', label: '空闲空间', tokens: free, tone: 'free' },
    ];
}
