import { IS_NODE_TEST_RUNTIME } from "@/lib/runtime";
import { createSharedCache } from "@/lib/cache/shared.server";
import { systemDb, type ScopedDb } from "@/lib/db/context.server";
import { toDbError } from "@/lib/db/errors";
import { json } from "@/lib/db/sql-helpers";
import {
  AGENT_TOOL_SCOPE_DEFINITIONS,
  AGENT_TOOL_SCOPE_IDS,
  type AgentToolScopeId,
} from "@/lib/agent/tool-catalog";
import {
  AGENT_EXTENSIONS_POLICY_KEY,
  normalizeAgentExtensionsPolicy,
  type AgentExtensionsPolicy,
} from "@/lib/agent/extensions/config";
import {
  AGENT_SCHEDULE_LIMITS_KEY,
  normalizeAgentScheduleLimits,
  type AgentScheduleLimits,
} from "@/lib/agent/schedules/config";
import { BYOK_POLICY_KEY, normalizeByokPolicy, type ByokPolicy } from "@/lib/byok/config";

// ─── 功能模块开关 ───

export const FEATURE_MODULE_IDS = [
  'bazi', 'hepan', 'ziwei', 'tarot', 'liuyao', 'qimen',
  'daliuren', 'meihua', 'xiaoliuren',
  'face', 'palm', 'mbti', 'chat', 'daily', 'monthly',
  'records', 'community', 'knowledge-base', 'mcp-service',
  'charts', 'ai-personalization',
  'notifications', 'billing', 'usage-log', 'help', 'agent',
  // Agent 的细粒度能力：各自可关，关掉后接口与入口一起失效。
  'skills', 'connectors', 'schedules', 'memory',
  'shares', 'annual-report',
  // 自定义模型（BYOK）：设置页、模型菜单与按引用调用的接口一起关闭。
  'byok',
] as const;

export type FeatureModuleId = typeof FEATURE_MODULE_IDS[number];
export type AgentToolScopeFeatureId = `agent-tool:${AgentToolScopeId}`;
export function toAgentToolScopeFeatureId(scopeId: AgentToolScopeId): AgentToolScopeFeatureId {
  return `agent-tool:${scopeId}`;
}

const FEATURE_PREFIX = 'feature_disabled:';
const AGENT_TOOL_SCOPE_PREFIX = 'agent_tool_disabled:';
const FEATURE_TOGGLE_CACHE_TTL_MS = 30_000;

type FeatureToggleRow = {
  setting_key: string;
  setting_value: unknown;
};

/** 两级缓存（内存 + Redis），管理员写入后广播失效。 */
const featureTogglesCache = createSharedCache<Record<string, boolean>>({
  name: 'feature-toggles',
  ttlMs: FEATURE_TOGGLE_CACHE_TTL_MS,
});

const agentToolScopesCache = createSharedCache<Record<string, boolean>>({
  name: 'agent-tool-scopes',
  ttlMs: FEATURE_TOGGLE_CACHE_TTL_MS,
});

export { AGENT_TOOL_SCOPE_DEFINITIONS, AGENT_TOOL_SCOPE_IDS };
export type { AgentToolScopeId };

export type FeatureTogglesReadResult = {
  loaded: boolean;
  toggles: Record<string, boolean>;
};

export type FeatureModuleState =
  | { status: 'enabled' }
  | { status: 'disabled' }
  | { status: 'unavailable'; error?: string };

function normalizeFeatureToggleRows(rows: FeatureToggleRow[] | null | undefined): Record<string, boolean> {
  const toggleStates: Record<string, boolean> = {};
  for (const row of rows ?? []) {
    if (!row?.setting_key) continue;
    const id = row.setting_key.replace(FEATURE_PREFIX, '');
    toggleStates[id] = !!row.setting_value;
  }
  return toggleStates;
}

function normalizePrefixedRows(
  rows: FeatureToggleRow[] | null | undefined,
  prefix: string,
): Record<string, boolean> {
  const states: Record<string, boolean> = {};
  for (const row of rows ?? []) {
    if (!row?.setting_key || !row.setting_key.startsWith(prefix)) continue;
    states[row.setting_key.slice(prefix.length)] = !!row.setting_value;
  }
  return states;
}

async function readSettingsByPrefix(
  db: ScopedDb,
  prefix: string,
): Promise<{ data: FeatureToggleRow[]; error: { message?: string } | null }> {
  try {
    const data = await db.tx((trx) => trx
      .selectFrom('app_settings')
      .select(['setting_key', 'setting_value'])
      .where('setting_key', 'like', `${prefix}%`)
      .execute());
    return { data, error: null };
  } catch (error) {
    return { data: [], error: toDbError(error) };
  }
}

async function loadAllFeatureToggles(db: ScopedDb): Promise<Record<string, boolean>> {
  const { data, error } = await readSettingsByPrefix(db, FEATURE_PREFIX);
  if (error) throw new Error(error.message ?? '读取功能开关失败');
  return normalizeFeatureToggleRows(data);
}

async function loadAllAgentToolScopes(db: ScopedDb): Promise<Record<string, boolean>> {
  const { data, error } = await readSettingsByPrefix(db, AGENT_TOOL_SCOPE_PREFIX);
  if (error) throw new Error(error.message ?? '读取 Agent 工具范围失败');
  return normalizePrefixedRows(data, AGENT_TOOL_SCOPE_PREFIX);
}

function readSettingRow(key: string) {
  return systemDb().tx((trx) => trx
    .selectFrom('app_settings')
    .select('setting_value')
    .where('setting_key', '=', key)
    .executeTakeFirst());
}

async function readSettingValue(key: string): Promise<unknown> {
  const row = await readSettingRow(key);
  return row?.setting_value;
}

async function writeSettingValue(key: string, value: unknown): Promise<void> {
  const updatedAt = new Date().toISOString();
  await systemDb().tx((trx) => trx
    .insertInto('app_settings')
    .values({ setting_key: key, setting_value: value as never, updated_at: updatedAt })
    .onConflict((conflict) => conflict.column('setting_key').doUpdateSet({
      setting_value: value as never,
      updated_at: updatedAt,
    }))
    .execute());
}

const agentToolScopeKey = (scopeId: AgentToolScopeId) => `${AGENT_TOOL_SCOPE_PREFIX}${scopeId}`;

function featureSettingKey(featureId: FeatureModuleId | AgentToolScopeFeatureId): string {
  return featureId.startsWith('agent-tool:')
    ? agentToolScopeKey(featureId.slice('agent-tool:'.length) as AgentToolScopeId)
    : `${FEATURE_PREFIX}${featureId}`;
}

async function readFeatureToggleValue(
  featureId: FeatureModuleId | AgentToolScopeFeatureId
): Promise<{ data: { setting_value?: unknown } | null; error: { message?: string } | null }> {
  try {
    return { data: (await readSettingRow(featureSettingKey(featureId))) ?? null, error: null };
  } catch (error) {
    return { data: null, error: toDbError(error) };
  }
}

/** 批量读取所有功能模块开关状态。返回 Record<id, boolean>，true = 已关闭 */
export async function readFeatureTogglesState(): Promise<FeatureTogglesReadResult> {
  try {
    const db = systemDb();
    const { data, error } = await readSettingsByPrefix(db, FEATURE_PREFIX);

    if (error) {
      if (!IS_NODE_TEST_RUNTIME) {
        console.error('[app-settings] Failed to read feature toggles:', error.message);
      }
      return { loaded: false, toggles: {} };
    }

    return {
      loaded: true,
      toggles: normalizeFeatureToggleRows(data),
    };
  } catch (error) {
    if (!IS_NODE_TEST_RUNTIME) {
      console.error('[app-settings] Failed to read feature toggles:', error);
    }
    return { loaded: false, toggles: {} };
  }
}

/** 批量读取所有功能模块开关状态。返回 Record<id, boolean>，true = 已关闭 */
export async function getFeatureToggles(): Promise<Record<string, boolean>> {
  const result = await readFeatureTogglesState();
  return result.toggles;
}

/** 设置单个功能模块开关。disabled=true 表示关闭该功能 */
export async function setFeatureToggle(
  featureId: FeatureModuleId,
  disabled: boolean
): Promise<boolean> {
  try {
    await writeSettingValue(`${FEATURE_PREFIX}${featureId}`, disabled);
    await featureTogglesCache.invalidate();
    return true;
  } catch (error) {
    console.error('[app-settings] Failed to set feature toggle:', error);
    return false;
  }
}

/** 批量读取 Agent 工具范围开关状态。返回 Record<scope, boolean>，true = 已关闭。 */
export async function getAgentToolScopes(): Promise<Record<string, boolean>> {
  return agentToolScopesCache.load(() => loadAllAgentToolScopes(systemDb()));
}

/** 读取单个 Agent 工具范围，数据库读取失败时返回 unavailable，服务端调用必须拒绝继续。 */
export async function readAgentToolScopeStateFresh(scopeId: AgentToolScopeId): Promise<FeatureModuleState> {
  return readFeatureModuleStateFresh(toAgentToolScopeFeatureId(scopeId));
}

export async function setAgentToolScope(scopeId: AgentToolScopeId, disabled: boolean): Promise<boolean> {
  try {
    await writeSettingValue(agentToolScopeKey(scopeId), disabled);
    await agentToolScopesCache.invalidate();
    return true;
  } catch (error) {
    console.error('[app-settings] Failed to set Agent tool scope:', error);
    return false;
  }
}

export async function isFeatureModuleEnabled(featureId: FeatureModuleId): Promise<boolean> {
  try {
    const toggles = await featureTogglesCache.load(() => loadAllFeatureToggles(systemDb()));
    return toggles[featureId] !== true;
  } catch (error) {
    if (!IS_NODE_TEST_RUNTIME) {
      console.error('[app-settings] Failed to read feature toggle:', error);
    }
    return true;
  }
}

/**
 * Read one feature state without using the permissive UI cache/fallback.
 * Server-side capability checks use this helper so a configuration read
 * failure cannot accidentally expose a disabled capability.
 */
export async function readFeatureModuleStateFresh(featureId: FeatureModuleId | AgentToolScopeFeatureId): Promise<FeatureModuleState> {
  try {
    const { data, error } = await readFeatureToggleValue(featureId);
    if (error) {
      return { status: 'unavailable', error: error.message };
    }
    if (data && typeof data.setting_value !== 'boolean') {
      return { status: 'unavailable', error: 'invalid feature setting value' };
    }
    return data?.setting_value === true
      ? { status: 'disabled' }
      : { status: 'enabled' };
  } catch (error) {
    return {
      status: 'unavailable',
      error: error instanceof Error ? error.message : 'feature state unavailable',
    };
  }
}

// ─── 以对象形式保存的设置 ───

/** Cached reads and cache-invalidating writes for one object setting; reads throw when the database cannot be read. */
function createObjectSetting<T>(name: string, key: string, normalize: (value: unknown) => T) {
  const cache = createSharedCache<T>({ name, ttlMs: FEATURE_TOGGLE_CACHE_TTL_MS });
  return {
    get: () => cache.load(async () => normalize(await readSettingValue(key))),
    set: async (value: T) => {
      await writeSettingValue(key, json(value) as never);
      await cache.invalidate();
    },
  };
}

// ─── Agent 扩展策略 ───

/** Whether users may add their own connectors and skills; administrators edit it, runtime checks read it. */
const agentExtensionsPolicy = createObjectSetting('agent-extensions-policy', AGENT_EXTENSIONS_POLICY_KEY, normalizeAgentExtensionsPolicy);

export async function getAgentExtensionsPolicy(): Promise<AgentExtensionsPolicy> {
  return agentExtensionsPolicy.get();
}

export async function setAgentExtensionsPolicy(policy: AgentExtensionsPolicy): Promise<void> {
  await agentExtensionsPolicy.set(policy);
}

// ─── 定时任务额度 ───

/** How many schedules each user may keep; the scheduler pauses the excess after the limit is lowered. */
const agentScheduleLimits = createObjectSetting('agent-schedule-limits', AGENT_SCHEDULE_LIMITS_KEY, normalizeAgentScheduleLimits);

export async function getAgentScheduleLimits(): Promise<AgentScheduleLimits> {
  return agentScheduleLimits.get();
}

export async function setAgentScheduleLimits(limits: AgentScheduleLimits): Promise<void> {
  await agentScheduleLimits.set(limits);
}

// ─── 自定义模型策略 ───

/** Whether members may store keys here, and how many connections and models each may keep. */
const byokPolicy = createObjectSetting('byok-policy', BYOK_POLICY_KEY, normalizeByokPolicy);

export async function getByokPolicy(): Promise<ByokPolicy> {
  return byokPolicy.get();
}

export async function setByokPolicy(policy: ByokPolicy): Promise<void> {
  await byokPolicy.set(policy);
}
