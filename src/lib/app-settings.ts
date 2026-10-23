import { IS_NODE_TEST_RUNTIME } from "@/lib/runtime";
import { createSharedCache } from "@/lib/cache/shared.server";
import { systemDb, type ScopedDb } from "@/lib/db/context.server";
import { toDbError } from "@/lib/db/errors";

// ─── 功能模块开关 ───

export const FEATURE_MODULE_IDS = [
  'bazi', 'hepan', 'ziwei', 'tarot', 'liuyao', 'qimen',
  'daliuren', 'meihua', 'xiaoliuren',
  'face', 'palm', 'mbti', 'chat', 'daily', 'monthly',
  'records', 'community', 'knowledge-base', 'mcp-service',
  'checkin', 'credits', 'charts', 'ai-personalization',
  'notifications', 'upgrade', 'help', 'agent',
] as const;

export type FeatureModuleId = typeof FEATURE_MODULE_IDS[number];

const FEATURE_PREFIX = 'feature_disabled:';
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

async function readFeatureToggleRows(
  db: ScopedDb
): Promise<{ data: FeatureToggleRow[]; error: { message?: string } | null }> {
  try {
    const data = await db.tx((trx) => trx
      .selectFrom('app_settings')
      .select(['setting_key', 'setting_value'])
      .where('setting_key', 'like', `${FEATURE_PREFIX}%`)
      .execute());
    return { data, error: null };
  } catch (error) {
    return { data: [], error: toDbError(error) };
  }
}

async function loadAllFeatureToggles(db: ScopedDb): Promise<Record<string, boolean>> {
  const { data, error } = await readFeatureToggleRows(db);
  if (error) throw new Error(error.message ?? '读取功能开关失败');
  return normalizeFeatureToggleRows(data);
}

async function readFeatureToggleValue(
  db: ScopedDb,
  featureId: FeatureModuleId
): Promise<{ data: { setting_value?: unknown } | null; error: { message?: string } | null }> {
  try {
    const data = await db.tx((trx) => trx
      .selectFrom('app_settings')
      .select('setting_value')
      .where('setting_key', '=', `${FEATURE_PREFIX}${featureId}`)
      .executeTakeFirst());
    return { data: data ?? null, error: null };
  } catch (error) {
    return { data: null, error: toDbError(error) };
  }
}

/** 批量读取所有功能模块开关状态。返回 Record<id, boolean>，true = 已关闭 */
export async function readFeatureTogglesState(): Promise<FeatureTogglesReadResult> {
  try {
    const db = systemDb();
    const { data, error } = await readFeatureToggleRows(db);

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
    const updatedAt = new Date().toISOString();
    await systemDb().tx((trx) => trx
      .insertInto('app_settings')
      .values({
        setting_key: `${FEATURE_PREFIX}${featureId}`,
        setting_value: disabled,
        updated_at: updatedAt,
      })
      .onConflict((conflict) => conflict.column('setting_key').doUpdateSet({
        setting_value: disabled,
        updated_at: updatedAt,
      }))
      .execute());
    await featureTogglesCache.invalidate();
    return true;
  } catch (error) {
    console.error('[app-settings] Failed to set feature toggle:', error);
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
export async function readFeatureModuleStateFresh(featureId: FeatureModuleId): Promise<FeatureModuleState> {
  try {
    const db = systemDb();
    const { data, error } = await readFeatureToggleValue(db, featureId);
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
