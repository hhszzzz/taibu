/**
 * The extension policy: whether members may add their own connectors and skills, and how many each may keep. It is one
 * policy for both kinds, so it lives beside neither: the MCP and skills settings pages read the same gates.
 */

/** One kind of extension: whether members may add any, and how many. */
export type ExtensionGate = { enabled: boolean; limit: number };
export type AgentExtensionsPolicy = { connectors: ExtensionGate; skills: ExtensionGate };
export const AGENT_EXTENSIONS_POLICY_KEY = 'agent_extensions_policy';
export const EXTENSION_LIMIT_MAX: Record<keyof AgentExtensionsPolicy, number> = { connectors: 50, skills: 100 };
export const DEFAULT_AGENT_EXTENSIONS_POLICY: AgentExtensionsPolicy = {
  connectors: { enabled: true, limit: 10 },
  skills: { enabled: true, limit: 30 },
};

function gateOf(value: unknown, fallback: ExtensionGate, max: number, strict: boolean): ExtensionGate {
  const fail = (message: string): never => { throw new Error(message); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return strict ? fail('扩展策略格式无效') : { ...fallback };
  const raw = value as Record<string, unknown>;
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : strict ? fail('扩展策略缺少开关') : fallback.enabled;
  const valid = Number.isInteger(raw.limit) && (raw.limit as number) >= 0 && (raw.limit as number) <= max;
  if (!valid && strict) fail(`数量上限须为 0–${max} 的整数`);
  return { enabled, limit: valid ? raw.limit as number : fallback.limit };
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

/** How many of the kind a member may keep in use: zero when the administrator closed it. */
export function extensionAllowance(gate: ExtensionGate) {
  return gate.enabled ? gate.limit : 0;
}

/** What a member's settings page needs to know about one kind of extension. */
export type ExtensionAllowanceView = {
  /** False when the administrator closed additions altogether. */
  enabled: boolean;
  limit: number;
  used: number;
};
