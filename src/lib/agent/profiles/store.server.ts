import 'server-only';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { isUniqueViolation } from '@/lib/db/errors';
import { arrayValue, json } from '@/lib/db/sql-helpers';
import { createSharedCache } from '@/lib/cache/shared.server';
import {
  AGENT_BUILTIN_PROFILES_KEY, AGENT_PROFILE_EFFORTS, AGENT_PROFILE_MODES, BUILTIN_AGENT_PROFILES, DEFAULT_AGENT_PROFILE,
  type AgentProfileEffort, type AgentProfileMode, type AgentProfileTools, type AgentProfileView,
} from './config';
import { ProfileInputError, type ProfileFields } from './input.server';

/** The roles as stored: administrators' rows, and which built-in roles they switched off. */
type ProfileCatalog = { rows: AgentProfileView[]; disabled: string[] };

const catalogCache = createSharedCache<ProfileCatalog>({ name: 'agent-profiles', ttlMs: 60_000 });

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function toolsOf(value: unknown): AgentProfileTools {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { inherit: raw.inherit === true, allow: strings(raw.allow), deny: strings(raw.deny) };
}

type ProfileRow = {
  name: string; display_name: string; description: string; instructions: string; tools: unknown; skills: unknown;
  model: string | null; reasoning_effort: string | null; modes: unknown; is_enabled: boolean;
  sort_order: number; updated_at: string;
};

function toView(row: ProfileRow): AgentProfileView {
  return {
    name: row.name, builtin: false, displayName: row.display_name, description: row.description, instructions: row.instructions,
    tools: toolsOf(row.tools), skills: strings(row.skills), model: row.model,
    reasoningEffort: AGENT_PROFILE_EFFORTS.includes(row.reasoning_effort as AgentProfileEffort) ? row.reasoning_effort as AgentProfileEffort : null,
    modes: AGENT_PROFILE_MODES.filter(mode => strings(row.modes).includes(mode)),
    enabled: row.is_enabled, sortOrder: row.sort_order, updatedAt: row.updated_at,
  };
}

/** A transaction as ScopedDb hands it out (only the db layer imports Kysely). */
type Trx = Parameters<Parameters<ScopedDb['tx']>[0]>[0];

const COLUMNS = [
  'name', 'display_name', 'description', 'instructions', 'tools', 'skills', 'model', 'reasoning_effort', 'modes',
  'is_enabled', 'sort_order', 'updated_at',
] as const;

function rowsOf(trx: Trx) {
  return trx.selectFrom('agent_profiles').select(COLUMNS).orderBy('sort_order', 'asc').orderBy('created_at', 'asc');
}

async function readCatalog(): Promise<ProfileCatalog> {
  return systemDb().tx(async (trx) => {
    const rows = (await rowsOf(trx).execute()) as ProfileRow[];
    const setting = await trx.selectFrom('app_settings').select('setting_value').where('setting_key', '=', AGENT_BUILTIN_PROFILES_KEY).executeTakeFirst();
    const disabled = strings((setting?.setting_value as { disabled?: unknown } | undefined)?.disabled);
    return { rows: rows.map(toView), disabled };
  });
}

/**
 * Every role, built-in ones first, each with whether it is on; shared across processes, and an administrator's change
 * invalidates it. The specialist cannot be switched off: a member given only a system is one.
 */
export async function profileCatalog(): Promise<AgentProfileView[]> {
  const { rows, disabled } = await catalogCache.load(readCatalog);
  return [
    ...BUILTIN_AGENT_PROFILES.map(profile => ({ ...profile, enabled: profile.name === DEFAULT_AGENT_PROFILE || !disabled.includes(profile.name) })),
    ...rows,
  ];
}

export function invalidateProfileCatalog(): Promise<void> {
  return catalogCache.invalidate();
}

export async function listCustomProfiles(db: ScopedDb): Promise<AgentProfileView[]> {
  return ((await db.tx((trx) => rowsOf(trx).execute())) as ProfileRow[]).map(toView);
}

function nameTaken(error: unknown): never {
  if (isUniqueViolation(error)) throw new ProfileInputError('已有同名角色，请换一个标识');
  throw error;
}

function columnsOf(fields: Partial<ProfileFields>) {
  return {
    ...(fields.displayName !== undefined ? { display_name: fields.displayName } : {}),
    ...(fields.description !== undefined ? { description: fields.description } : {}),
    ...(fields.instructions !== undefined ? { instructions: fields.instructions } : {}),
    ...(fields.tools !== undefined ? { tools: json(fields.tools) as never } : {}),
    ...(fields.skills !== undefined ? { skills: arrayValue(fields.skills) as never } : {}),
    ...(fields.model !== undefined ? { model: fields.model } : {}),
    ...(fields.reasoningEffort !== undefined ? { reasoning_effort: fields.reasoningEffort } : {}),
    ...(fields.modes !== undefined ? { modes: arrayValue<AgentProfileMode>(fields.modes) as never } : {}),
    ...(fields.enabled !== undefined ? { is_enabled: fields.enabled } : {}),
    ...(fields.sortOrder !== undefined ? { sort_order: fields.sortOrder } : {}),
  };
}

export async function insertProfile(db: ScopedDb, fields: ProfileFields & { name: string }): Promise<AgentProfileView> {
  try {
    const row = await db.tx((trx) => trx.insertInto('agent_profiles').values({ name: fields.name, display_name: fields.displayName, ...columnsOf(fields) })
      .returning(COLUMNS).executeTakeFirstOrThrow());
    return toView(row as ProfileRow);
  } catch (error) {
    return nameTaken(error);
  }
}

export async function updateProfile(db: ScopedDb, name: string, fields: Partial<ProfileFields>): Promise<AgentProfileView | undefined> {
  const set = columnsOf(fields);
  const row = await db.tx((trx) => Object.keys(set).length
    ? trx.updateTable('agent_profiles').set(set).where('name', '=', name).returning(COLUMNS).executeTakeFirst()
    : trx.selectFrom('agent_profiles').select(COLUMNS).where('name', '=', name).executeTakeFirst());
  return row ? toView(row as ProfileRow) : undefined;
}

export async function deleteProfile(db: ScopedDb, name: string): Promise<boolean> {
  return (await db.tx((trx) => trx.deleteFrom('agent_profiles').where('name', '=', name).returning('name').execute())).length > 0;
}

/** Switches a built-in role on or off; the list is read and written in one transaction. */
export async function setBuiltinProfileEnabled(name: string, enabled: boolean): Promise<void> {
  await systemDb().tx(async (trx) => {
    const current = await trx.selectFrom('app_settings').select('setting_value').where('setting_key', '=', AGENT_BUILTIN_PROFILES_KEY).forUpdate().executeTakeFirst();
    const disabled = new Set(strings((current?.setting_value as { disabled?: unknown } | undefined)?.disabled));
    if (enabled) disabled.delete(name); else disabled.add(name);
    const value = json({ disabled: [...disabled].sort() }) as never;
    const updatedAt = new Date().toISOString();
    await trx.insertInto('app_settings').values({ setting_key: AGENT_BUILTIN_PROFILES_KEY, setting_value: value, updated_at: updatedAt })
      .onConflict((conflict) => conflict.column('setting_key').doUpdateSet({ setting_value: value, updated_at: updatedAt })).execute();
  });
  await invalidateProfileCatalog();
}
