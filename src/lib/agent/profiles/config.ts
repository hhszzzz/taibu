/**
 * Agent roles, shared by the server and the settings pages. A collaboration member or a background subagent works as a
 * role: its instructions, the tools it may use and, optionally, its model. pi's desktop app defines a subagent the same
 * way, as a file whose tools are the parent's minus a deny list or a list of their own. Three roles are built in;
 * administrators add others, stored in agent_profiles.
 */
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import {
  AGENT_CHART_NAMES, AGENT_MEMBER_DENIED_TOOLS, AGENT_SKILL_TOOLS, AGENT_WEB_TOOLS, getAgentToolFeatureId, getAgentToolScope, isAgentCoreTool,
  type AgentChartKind,
} from '../tool-catalog';

export const AGENT_PROFILE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/u;
export const AGENT_PROFILE_LIMITS = { displayName: 12, description: 300, instructions: 8000, skills: 4, tokens: 64 } as const;
/** Preloaded skills go into the member's instructions; their text beyond this is left out. */
export const AGENT_PROFILE_SKILL_CHARS = 24_000;

/** Where a role may work: as a member of a parallel analysis, or as a background subagent. */
export const AGENT_PROFILE_MODES = ['parallel', 'background'] as const;
export type AgentProfileMode = (typeof AGENT_PROFILE_MODES)[number];
export const AGENT_PROFILE_MODE_LABELS: Record<AgentProfileMode, string> = { parallel: '协作成员', background: '后台子分析' };

export type AgentProfileEffort = 'off' | AIReasoningEffort;
export const AGENT_PROFILE_EFFORTS: readonly AgentProfileEffort[] = ['off', ...AI_REASONING_EFFORTS];

/**
 * Which tools a role may use. With `inherit` it starts from every tool the task offers its main agent, otherwise from
 * none; `allow` adds tools by name or family and `deny` removes them. The tools no member may use are never granted.
 */
export type AgentProfileTools = { inherit: boolean; allow: string[]; deny: string[] };

export type AgentProfileView = {
  /** The role's key: a member card, a preset and a kept subagent name it, so it never changes. */
  name: string;
  builtin: boolean;
  displayName: string;
  /** What the main agent reads when it chooses members. */
  description: string;
  /** Added to the member's instructions. */
  instructions: string;
  tools: AgentProfileTools;
  /** Skills whose SKILL.md the member reads with its instructions. */
  skills: string[];
  /** Null: the member keeps the model its preset or the main agent gives it. */
  model: string | null;
  /** The model's effort; null: the model's default. Only used with `model`. */
  reasoningEffort: AgentProfileEffort | null;
  modes: AgentProfileMode[];
  enabled: boolean;
  sortOrder: number;
  updatedAt: string | null;
};

/** What the admin page sends; a built-in role takes only `enabled`. */
export type AgentProfileInput = Partial<Omit<AgentProfileView, 'builtin' | 'updatedAt'>>;

/** A role as a member's settings offer it. */
export type AgentProfileOption = Pick<AgentProfileView, 'name' | 'displayName' | 'description' | 'model' | 'modes'>;

export const DEFAULT_AGENT_PROFILE = 'specialist';
/** Built-in roles stay in code; administrators can only switch one off, stored under this key. */
export const AGENT_BUILTIN_PROFILES_KEY = 'agent_builtin_profiles';

const builtin = (profile: Pick<AgentProfileView, 'name' | 'displayName' | 'description' | 'instructions' | 'tools' | 'sortOrder'>): AgentProfileView => ({
  ...profile, builtin: true, skills: [], model: null, reasoningEffort: null, modes: [...AGENT_PROFILE_MODES], enabled: true, updatedAt: null,
});

export const BUILTIN_AGENT_PROFILES: readonly AgentProfileView[] = [
  builtin({
    name: DEFAULT_AGENT_PROFILE, displayName: '体系专家', sortOrder: -30,
    description: '用所给体系的 Core 工具与方法排盘、详查和解读；必须填写 system。',
    instructions: '',
    tools: { inherit: false, allow: ['system'], deny: [] },
  }),
  builtin({
    name: 'researcher', displayName: '研究员', sortOrder: -20,
    description: '联网检索、读取网页与检索知识库，可加载技能；不排盘，适合查资料、核对外部说法。',
    instructions: '你负责查找与核对资料：先检索，再读取最相关的原文；区分来源的原话与你的推断，说明每条结论出自哪个来源。找不到可靠来源时如实说明，不凭印象补充。',
    tools: { inherit: false, allow: ['web', 'knowledge', 'skills'], deny: [] },
  }),
  builtin({
    name: 'verifier', displayName: '复核员', sortOrder: -10,
    description: '独立重排命盘、用计算与详查核对数据，读取网页与知识库核对引用；不写入任何内容。',
    instructions: '你负责复核：用工具独立重算所给的命盘与数据，逐条核对结论的依据与引用来源；列出一致与不一致之处及其依据，不重复原分析，也不另起一套结论。',
    tools: { inherit: false, allow: ['core', 'data', 'web_fetch', 'search_knowledge'], deny: [] },
  }),
];

export const BUILTIN_AGENT_PROFILE_NAMES: ReadonlySet<string> = new Set(BUILTIN_AGENT_PROFILES.map(profile => profile.name));

/** The families `allow` and `deny` name besides single tools; `mcp:<服务名>` names one platform MCP service. */
export const AGENT_PROFILE_TOOL_FAMILIES: ReadonlyArray<{ token: string; label: string; description: string }> = [
  { token: 'system', label: '所给体系', description: '任务 system 所指方法的 Core 工具；没有给 system 时不提供' },
  { token: 'core', label: '全部 Core 工具', description: '各体系的排盘、计算与详查' },
  ...(Object.entries(AGENT_CHART_NAMES) as Array<[AgentChartKind, string]>).map(([kind, title]) => ({
    token: `core:${kind}`, label: title, description: `${title}的排盘、计算与详查`,
  })),
  { token: 'data', label: '用户资料', description: '读取用户的命盘、记录、笔记、附件与个性化档案' },
  { token: 'web', label: '联网', description: 'web_search 与 web_fetch；任务开启联网时才有' },
  { token: 'knowledge', label: '知识库', description: 'search_knowledge' },
  { token: 'skills', label: '技能', description: 'load_skill 与 read_skill_file' },
];
const FAMILY_TOKENS: ReadonlySet<string> = new Set(AGENT_PROFILE_TOOL_FAMILIES.map(family => family.token));
export const MCP_PROFILE_TOKEN = 'mcp:';

/** Why `allow` or `deny` cannot hold a token, or null. */
export function profileTokenProblem(token: string, list: 'allow' | 'deny'): string | null {
  if (FAMILY_TOKENS.has(token)) return null;
  if (token.startsWith(MCP_PROFILE_TOKEN)) return /^[a-z][a-z0-9_]{1,30}$/u.test(token.slice(MCP_PROFILE_TOKEN.length)) ? null : `「${token}」不是有效的 MCP 服务名`;
  if (!/^[A-Za-z0-9_]{1,64}$/u.test(token)) return `「${token}」不是工具名或工具族`;
  if (list === 'allow' && AGENT_MEMBER_DENIED_TOOLS.has(token)) return `「${token}」只有主任务能用，不能授予成员`;
  return null;
}

/** What a grant needs from the task: the tools of the method it named, and each MCP tool's platform service. */
export type ProfileGrantContext = { systemTools: ReadonlySet<string>; mcpServer: (tool: string) => string | undefined };

export function profileTokenMatches(token: string, tool: string, context: ProfileGrantContext): boolean {
  if (token === tool) return true;
  switch (token) {
    case 'system': return context.systemTools.has(tool);
    case 'core': return isAgentCoreTool(tool);
    case 'data': return getAgentToolScope(tool) === 'user-data';
    case 'web': return AGENT_WEB_TOOLS.has(tool);
    case 'knowledge': return tool === 'search_knowledge';
    case 'skills': return tool === AGENT_SKILL_TOOLS.load || tool === AGENT_SKILL_TOOLS.read;
  }
  if (token.startsWith('core:')) return isAgentCoreTool(tool) && getAgentToolFeatureId(tool) === token.slice('core:'.length);
  if (token.startsWith(MCP_PROFILE_TOKEN)) return context.mcpServer(tool) === token.slice(MCP_PROFILE_TOKEN.length);
  return false;
}

/** The tools of `offered` a role may use, in their order. */
export function profileGrants(tools: AgentProfileTools, offered: readonly string[], context: ProfileGrantContext): string[] {
  const named = (list: readonly string[], tool: string) => list.some(token => profileTokenMatches(token, tool, context));
  return offered.filter(tool => !AGENT_MEMBER_DENIED_TOOLS.has(tool) && (tools.inherit || named(tools.allow, tool)) && !named(tools.deny, tool));
}

/** A token as the admin page shows it. */
export function profileTokenLabel(token: string): string {
  const family = AGENT_PROFILE_TOOL_FAMILIES.find(item => item.token === token);
  if (family) return family.label;
  return token.startsWith(MCP_PROFILE_TOKEN) ? `MCP：${token.slice(MCP_PROFILE_TOKEN.length)}` : token;
}
