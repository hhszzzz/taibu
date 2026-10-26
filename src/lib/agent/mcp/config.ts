/**
 * MCP connectors and the extension policy, shared by the server and the settings pages. Platform servers belong to the
 * site (owner null) and are managed by administrators; a user's own connectors only ever serve that user.
 */
import type { MembershipType } from '@/lib/user/membership';

export const MEMBERSHIP_TIERS = ['free', 'plus', 'pro'] as const satisfies readonly MembershipType[];
const TIER_RANK: Record<MembershipType, number> = { free: 0, plus: 1, pro: 2 };
export const MEMBERSHIP_TIER_LABELS: Record<MembershipType, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };
export function meetsTier(membership: MembershipType, required: MembershipType) {
  return TIER_RANK[membership] >= TIER_RANK[required];
}
export function isMembershipTier(value: unknown): value is MembershipType {
  return typeof value === 'string' && (MEMBERSHIP_TIERS as readonly string[]).includes(value);
}

/**
 * How a server's tools reach the model: offered with every request, found through `tool_search`, callable only from
 * code mode scripts, or not registered at all (search routing still uses the server).
 */
export const MCP_EXPOSURES = ['direct', 'deferred', 'codemode', 'hidden'] as const;
export type McpExposure = (typeof MCP_EXPOSURES)[number];
export const USER_MCP_EXPOSURES = ['direct', 'deferred'] as const satisfies readonly McpExposure[];
export const MCP_EXPOSURE_LABELS: Record<McpExposure, string> = {
  direct: '常驻', deferred: '按需检索', codemode: '仅代码模式', hidden: '不注册（仅联网路由）',
};
export const MCP_EXPOSURE_HINTS: Record<McpExposure, string> = {
  direct: '工具随每次请求提供给模型，会占用上下文，适合少量常用工具。',
  deferred: '模型先用 tool_search 检索到才加载，适合工具多或不常用的服务。',
  codemode: '只能在代码模式的脚本里调用，不出现在模型的工具表中。',
  hidden: '不注册任何工具，只供联网搜索与网页抓取的路由使用。',
};

export const MCP_RESULT_ADAPTERS = ['exa', 'tavily', 'generic'] as const;
export type McpResultAdapter = (typeof MCP_RESULT_ADAPTERS)[number];

export const MCP_SERVER_NAME_PATTERN = /^[a-z][a-z0-9_]{1,30}$/;
/** Tools one server may register; a user's connector gets fewer so one cannot flood the model's tool list. */
export const MCP_PLATFORM_TOOL_LIMIT = 200;
export const MCP_USER_TOOL_LIMIT = 50;
export const MCP_TIMEOUT_RANGE = { min: 5_000, max: 120_000, default: 30_000 } as const;
export const MCP_RESULT_CHARS_RANGE = { min: 2_000, max: 100_000, default: 20_000 } as const;

/** Per-tool settings, keyed by the tool's name on the server. */
export type McpToolPolicy = {
  /** Default true: a tool the administrator never turned off is registered. */
  enabled?: boolean;
  /** Chinese name shown on cards and matched by `tool_search`. */
  title?: string;
  /** Extra search words for `tool_search`, separated by spaces. */
  keywords?: string;
  /** Ask the user before every call. */
  confirm?: boolean;
};

export type McpToolSnapshot = {
  name: string;
  title?: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
};

/** What the last connection test saw. The server's own instructions are shown to administrators, never to models. */
export type McpServerSnapshot = {
  server?: { name: string; version: string; title?: string };
  instructions?: string;
  tools: McpToolSnapshot[];
  /** True when the server lists more tools than may be registered. */
  truncated?: boolean;
};

/** A server as the browser sees it: secrets appear only by name. */
export type McpServerView = {
  id: string;
  scope: 'platform' | 'user';
  name: string;
  displayName: string;
  description: string;
  url: string;
  headers: Record<string, string>;
  secretHeaders: string[];
  secretQuery: string[];
  exposure: McpExposure;
  toolPolicy: Record<string, McpToolPolicy>;
  searchTool: string | null;
  fetchTool: string | null;
  resultAdapter: McpResultAdapter;
  routePriority: number;
  requiredTier: MembershipType;
  enabled: boolean;
  timeoutMs: number;
  maxResultChars: number;
  sortOrder: number;
  snapshot: McpServerSnapshot | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

/**
 * What the settings pages send. Secret maps are write-only: a string sets or replaces a value, null removes it, and a
 * name that is absent keeps the stored value.
 */
export type McpServerInput = {
  name: string;
  displayName: string;
  description?: string;
  url: string;
  headers?: Record<string, string>;
  secretHeaders?: Record<string, string | null>;
  secretQuery?: Record<string, string | null>;
  exposure?: McpExposure;
  toolPolicy?: Record<string, McpToolPolicy>;
  searchTool?: string | null;
  fetchTool?: string | null;
  resultAdapter?: McpResultAdapter;
  routePriority?: number;
  requiredTier?: MembershipType;
  enabled?: boolean;
  timeoutMs?: number;
  maxResultChars?: number;
  sortOrder?: number;
};

/** Presets for the administrator's new-server form; the tool names are defaults, the test lists the real ones. */
export const MCP_SERVER_TEMPLATES = {
  exa: {
    label: 'Exa',
    input: {
      name: 'exa', displayName: 'Exa', url: 'https://mcp.exa.ai/mcp', exposure: 'hidden', resultAdapter: 'exa',
      searchTool: 'web_search_exa', fetchTool: 'web_fetch_exa', requiredTier: 'plus',
      description: 'Exa 联网搜索与网页正文抓取。',
    },
    secretHeader: { name: 'x-api-key', placeholder: 'Exa API Key' },
  },
  tavily: {
    label: 'Tavily',
    input: {
      name: 'tavily', displayName: 'Tavily', url: 'https://mcp.tavily.com/mcp/', exposure: 'hidden', resultAdapter: 'tavily',
      searchTool: 'tavily_search', fetchTool: 'tavily_extract', requiredTier: 'plus',
      description: 'Tavily 联网搜索与网页正文提取。',
    },
    secretHeader: { name: 'authorization', placeholder: 'Bearer tvly-…' },
  },
} as const satisfies Record<string, { label: string; input: McpServerInput; secretHeader: { name: string; placeholder: string } }>;

/** Whether users may add their own connectors or skills, which tiers, and how many each. */
export type ExtensionGate = { enabled: boolean; tiers: MembershipType[]; limits: Record<MembershipType, number> };
export type AgentExtensionsPolicy = { connectors: ExtensionGate; skills: ExtensionGate };
export const AGENT_EXTENSIONS_POLICY_KEY = 'agent_extensions_policy';
export const EXTENSION_LIMIT_MAX: Record<keyof AgentExtensionsPolicy, number> = { connectors: 50, skills: 100 };
export const DEFAULT_AGENT_EXTENSIONS_POLICY: AgentExtensionsPolicy = {
  connectors: { enabled: true, tiers: ['plus', 'pro'], limits: { free: 0, plus: 3, pro: 10 } },
  skills: { enabled: true, tiers: ['free', 'plus', 'pro'], limits: { free: 3, plus: 10, pro: 30 } },
};

function gateOf(value: unknown, fallback: ExtensionGate, max: number, strict: boolean): ExtensionGate {
  const fail = (message: string): never => { throw new Error(message); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return strict ? fail('扩展策略格式无效') : structuredClone(fallback);
  const raw = value as Record<string, unknown>;
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : strict ? fail('扩展策略缺少开关') : fallback.enabled;
  let tiers = fallback.tiers;
  if (Array.isArray(raw.tiers) && raw.tiers.every(isMembershipTier)) tiers = MEMBERSHIP_TIERS.filter(tier => (raw.tiers as string[]).includes(tier));
  else if (strict) fail('会员等级无效');
  const limits = { ...fallback.limits };
  const rawLimits = raw.limits && typeof raw.limits === 'object' ? raw.limits as Record<string, unknown> : null;
  if (!rawLimits && strict) fail('数量上限无效');
  for (const tier of MEMBERSHIP_TIERS) {
    const limit = rawLimits?.[tier];
    if (Number.isInteger(limit) && (limit as number) >= 0 && (limit as number) <= max) limits[tier] = limit as number;
    else if (strict) fail(`数量上限须为 0–${max} 的整数`);
  }
  return { enabled, tiers: [...tiers], limits };
}

/** Stored policy read leniently: a missing or damaged field falls back to its default. */
export function normalizeAgentExtensionsPolicy(value: unknown): AgentExtensionsPolicy {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    connectors: gateOf(raw.connectors, DEFAULT_AGENT_EXTENSIONS_POLICY.connectors, EXTENSION_LIMIT_MAX.connectors, false),
    skills: gateOf(raw.skills, DEFAULT_AGENT_EXTENSIONS_POLICY.skills, EXTENSION_LIMIT_MAX.skills, false),
  };
}

/** An administrator's submission, checked strictly. */
export function parseAgentExtensionsPolicy(value: unknown): AgentExtensionsPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('扩展策略格式无效');
  const raw = value as Record<string, unknown>;
  return {
    connectors: gateOf(raw.connectors, DEFAULT_AGENT_EXTENSIONS_POLICY.connectors, EXTENSION_LIMIT_MAX.connectors, true),
    skills: gateOf(raw.skills, DEFAULT_AGENT_EXTENSIONS_POLICY.skills, EXTENSION_LIMIT_MAX.skills, true),
  };
}

/** How many of the kind this member may keep in use: zero when the administrator closed it or the tier is excluded. */
export function extensionAllowance(gate: ExtensionGate, membership: MembershipType) {
  return gate.enabled && gate.tiers.includes(membership) ? gate.limits[membership] : 0;
}

/** What a user's settings page needs to know about one kind of extension. */
export type ExtensionAllowanceView = {
  /** False when the administrator closed user additions altogether. */
  enabled: boolean;
  /** False when this member's tier is not among the allowed ones. */
  tierAllowed: boolean;
  limit: number;
  used: number;
  /** The tiers that may add at least one, to tell a member which plan would. */
  tiers: MembershipType[];
};
