import 'server-only';
import type { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser, requireUserContext } from '@/lib/api-utils';
import { readFeatureModuleStateFresh } from '@/lib/app-settings';
import { systemDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { getModelConfigAsync, getModelsByUsageTypeAsync } from '@/lib/server/ai-config';
import { readSettingsBody as readBody } from '../settings-owner.server';
import { platformMcpServers } from '../mcp/store.server';
import { platformSkills } from '../skills/store.server';
import { AGENT_PROFILE_NAME_PATTERN, BUILTIN_AGENT_PROFILE_NAMES, DEFAULT_AGENT_PROFILE, type AgentProfileOption, type AgentProfileView } from './config';
import { ProfileInputError, parseBuiltinProfileInput, parseProfileInput, type ProfileFields } from './input.server';
import { availableProfiles } from './members.server';
import { deleteProfile, insertProfile, invalidateProfileCatalog, profileCatalog, setBuiltinProfileEnabled, updateProfile } from './store.server';

/**
 * Settings endpoints for roles. Administrators see every role and edit the ones they added, through the system identity
 * (row security keeps the table to administrators); members read the roles they may give their collaboration members.
 */

function failure(error: unknown, action: string): Response {
  if (error instanceof ProfileInputError) return jsonError(error.message, 400);
  console.error('[agent-profiles]', { action, code: toDbError(error).code });
  return jsonError(`${action}失败`, 500);
}

/** A role's own model must be one the site serves for chat. */
async function checkModel(fields: Partial<ProfileFields>) {
  if (fields.model && !(await getModelConfigAsync(fields.model))) throw new ProfileInputError('所选模型不存在');
}

async function changed() {
  await invalidateProfileCatalog();
}

/** Every role, and what the editor offers: platform MCP services, platform skills and chat models. */
export async function listAdminProfiles(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  try {
    const [profiles, servers, skills, models] = await Promise.all([profileCatalog(), platformMcpServers(), platformSkills(), getModelsByUsageTypeAsync('chat')]);
    return jsonOk({
      profiles,
      servers: servers.filter(row => row.exposure !== 'hidden').map(row => ({ name: row.name, displayName: row.display_name, enabled: row.is_enabled })),
      skills: skills.map(row => ({ name: row.name, description: row.description, enabled: row.is_enabled })),
      models: models.map(model => ({ id: model.id, name: model.name, supportsReasoning: model.supportsReasoning, thinkingLevels: model.thinkingLevels ?? [] })),
    });
  } catch (error) {
    return failure(error, '读取角色');
  }
}

export async function createAdminProfile(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  try {
    const fields = parseProfileInput(await readBody(request), false) as ProfileFields & { name: string };
    await checkModel(fields);
    const profile = await insertProfile(systemDb(), fields);
    await changed();
    return jsonOk({ profile }, 201);
  } catch (error) {
    return failure(error, '保存角色');
  }
}

export async function updateAdminProfile(request: NextRequest, name: string) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  if (!AGENT_PROFILE_NAME_PATTERN.test(name)) return jsonError('角色标识无效', 400);
  try {
    let profile: AgentProfileView | undefined;
    if (BUILTIN_AGENT_PROFILE_NAMES.has(name)) {
      const { enabled } = parseBuiltinProfileInput(await readBody(request));
      if (name === DEFAULT_AGENT_PROFILE && !enabled) return jsonError('体系专家是成员的默认角色，不能停用', 400);
      await setBuiltinProfileEnabled(name, enabled);
      profile = (await profileCatalog()).find(item => item.name === name);
    } else {
      const fields = parseProfileInput(await readBody(request), true);
      await checkModel(fields);
      profile = await updateProfile(systemDb(), name, fields);
      if (profile) await changed();
    }
    if (!profile) return jsonError('角色不存在', 404);
    return jsonOk({ profile });
  } catch (error) {
    return failure(error, '保存角色');
  }
}

export async function deleteAdminProfile(request: NextRequest, name: string) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  if (!AGENT_PROFILE_NAME_PATTERN.test(name)) return jsonError('角色标识无效', 400);
  if (BUILTIN_AGENT_PROFILE_NAMES.has(name)) return jsonError('内置角色不能删除，可以停用', 400);
  try {
    if (!(await deleteProfile(systemDb(), name))) return jsonError('角色不存在', 404);
    await changed();
    return jsonOk({ deleted: true });
  } catch (error) {
    return failure(error, '删除角色');
  }
}

/** The roles a user may give a collaboration member: none while the Agent is off. */
export async function listProfileOptions(request: NextRequest) {
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  try {
    if ((await readFeatureModuleStateFresh('agent')).status !== 'enabled') return jsonOk({ profiles: [] });
    const profiles: AgentProfileOption[] = (await availableProfiles()).filter(profile => profile.modes.includes('parallel'))
      .map(({ name, displayName, description, model, modes }) => ({ name, displayName, description, model, modes }));
    return jsonOk({ profiles });
  } catch (error) {
    return failure(error, '读取角色');
  }
}
