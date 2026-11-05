import 'server-only';
import type { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { getAgentExtensionsPolicy, readFeatureModuleStateFresh } from '@/lib/app-settings';
import { toDbError } from '@/lib/db/errors';
import { isValidUUID } from '@/lib/validation';
import { extensionAllowance, type ExtensionAllowanceView } from '../extensions/config';
import { administratorOwner, memberOwner, readSettingsBody as readBody, type SettingsOwner as Owner } from '../settings-owner.server';
import { BUILTIN_SKILL_NAMES } from './builtin.server';
import { skillCommands } from './catalog.server';
import { SkillInputError, parseSkillInput, type SkillFields } from './input.server';
import {
  SkillLimitError, countSkills, deleteSkill, getSkillDetailRow, insertSkill, invalidatePlatformSkills, listSkillRows,
  platformSkills, toSkillDetail, toSkillView, updateSkill,
} from './store.server';

/** Feature switch for this area; fail closed when the state cannot be read. */
async function skillsGate(): Promise<Response | null> {
  const state = await readFeatureModuleStateFresh('skills');
  if (state.status === 'enabled') return null;
  if (state.status === 'unavailable') return jsonError('功能状态暂时无法确认，请稍后重试', 503, { code: 'FEATURE_STATE_UNAVAILABLE' });
  return jsonError('技能功能当前未启用', 403, { code: 'FEATURE_DISABLED' });
}

/**
 * Settings endpoints for skills, shaped like the connectors': administrators manage the platform's (owner null)
 * through the system identity, users their own through theirs, so row security keeps each to its rows.
 */

function failure(error: unknown, action: string): Response {
  if (error instanceof SkillInputError) return jsonError(error.message, 400);
  if (error instanceof SkillLimitError) return jsonError(error.message, 409);
  console.error('[agent-skills]', { action, code: toDbError(error).code });
  return jsonError(`${action}失败`, 500);
}

async function changed(owner: Owner) {
  if (owner.owner === null) await invalidatePlatformSkills();
}

/** Names a user's skills cannot take; a user's list marks the skills that one keeps out of tasks. */
async function platformNames(owner: Owner): Promise<ReadonlySet<string> | undefined> {
  return owner.owner === null ? undefined : new Set((await platformSkills()).map((row) => row.name));
}

/** A skill may not take a method's name or, for a user, a platform skill's: the other would keep it out of every task. */
async function reserveName(owner: Owner, name: string | undefined) {
  if (name === undefined) return;
  if (BUILTIN_SKILL_NAMES.has(name)) throw new SkillInputError(`「${name}」是内置方法的名字，请修改 SKILL.md 里的 name`);
  if (owner.owner === null) return;
  if ((await platformSkills()).some((row) => row.name === name)) throw new SkillInputError(`平台已有名为「${name}」的技能，请修改 SKILL.md 里的 name`);
}

/** The user's allowance: whether the administrator allows skills at all, and how many. */
async function skillAllowance(owner: Owner): Promise<ExtensionAllowanceView> {
  const [policy, used] = await Promise.all([getAgentExtensionsPolicy(), countSkills(owner.db, owner.userId)]);
  return { enabled: policy.skills.enabled, limit: extensionAllowance(policy.skills), used };
}

async function list(owner: Owner) {
  try {
    const names = await platformNames(owner);
    const skills = (await listSkillRows(owner.db, owner.owner)).map((row) => toSkillView(row, names));
    if (owner.owner === null) return jsonOk({ skills });
    return jsonOk({ skills, allowance: await skillAllowance(owner) });
  } catch (error) {
    return failure(error, '读取技能');
  }
}

async function detail(owner: Owner, id: string) {
  if (!isValidUUID(id)) return jsonError('技能标识无效', 400);
  try {
    const row = await getSkillDetailRow(owner.db, owner.owner, id);
    if (!row) return jsonError('技能不存在', 404);
    return jsonOk({ skill: toSkillDetail(row, await platformNames(owner)) });
  } catch (error) {
    return failure(error, '读取技能');
  }
}

async function create(owner: Owner, request: NextRequest) {
  try {
    const fields = parseSkillInput(await readBody(request), false) as
      Partial<SkillFields> & Pick<SkillFields, 'document'>;
    let limit: number | undefined;
    if (owner.owner !== null) {
      const allowance = await skillAllowance(owner);
      if (!allowance.enabled || allowance.limit === 0) return jsonError('管理员已关闭个人技能', 403);
      limit = allowance.limit;
    }
    await reserveName(owner, fields.document.name);
    const row = await insertSkill(owner.db, owner.owner, fields, { limit });
    await changed(owner);
    return jsonOk({ skill: toSkillView(row, await platformNames(owner)) }, 201);
  } catch (error) {
    return failure(error, '保存技能');
  }
}

async function update(owner: Owner, request: NextRequest, id: string) {
  if (!isValidUUID(id)) return jsonError('技能标识无效', 400);
  try {
    const fields = parseSkillInput(await readBody(request), true);
    await reserveName(owner, fields.document?.name);
    const row = await updateSkill(owner.db, owner.owner, id, fields);
    if (!row) return jsonError('技能不存在', 404);
    await changed(owner);
    return jsonOk({ skill: toSkillView(row, await platformNames(owner)) });
  } catch (error) {
    return failure(error, '保存技能');
  }
}

async function remove(owner: Owner, id: string) {
  if (!isValidUUID(id)) return jsonError('技能标识无效', 400);
  try {
    if (!(await deleteSkill(owner.db, owner.owner, id))) return jsonError('技能不存在', 404);
    await changed(owner);
    return jsonOk({ deleted: true });
  } catch (error) {
    return failure(error, '删除技能');
  }
}

export async function listPlatformSkills(request: NextRequest) {
  const owner = await administratorOwner(request);
  return owner instanceof Response ? owner : list(owner);
}
export async function readPlatformSkill(request: NextRequest, id: string) {
  const owner = await administratorOwner(request);
  return owner instanceof Response ? owner : detail(owner, id);
}
export async function createPlatformSkill(request: NextRequest) {
  const owner = await administratorOwner(request);
  return owner instanceof Response ? owner : create(owner, request);
}
export async function updatePlatformSkill(request: NextRequest, id: string) {
  const owner = await administratorOwner(request);
  return owner instanceof Response ? owner : update(owner, request, id);
}
export async function deletePlatformSkill(request: NextRequest, id: string) {
  const owner = await administratorOwner(request);
  return owner instanceof Response ? owner : remove(owner, id);
}

export async function listUserSkills(request: NextRequest) {
  const gate = await skillsGate();
  if (gate) return gate;
  const owner = await memberOwner(request);
  return owner instanceof Response ? owner : list(owner);
}
export async function readUserSkill(request: NextRequest, id: string) {
  const gate = await skillsGate();
  if (gate) return gate;
  const owner = await memberOwner(request);
  return owner instanceof Response ? owner : detail(owner, id);
}
export async function createUserSkill(request: NextRequest) {
  const gate = await skillsGate();
  if (gate) return gate;
  const owner = await memberOwner(request);
  return owner instanceof Response ? owner : create(owner, request);
}
export async function updateUserSkill(request: NextRequest, id: string) {
  const gate = await skillsGate();
  if (gate) return gate;
  const owner = await memberOwner(request);
  return owner instanceof Response ? owner : update(owner, request, id);
}
export async function deleteUserSkill(request: NextRequest, id: string) {
  const gate = await skillsGate();
  if (gate) return gate;
  const owner = await memberOwner(request);
  return owner instanceof Response ? owner : remove(owner, id);
}

/** The skills the composer's `/skill:` menu offers this user: none while the Agent is off. */
export async function listSkillCommands(request: NextRequest) {
  const owner = await memberOwner(request);
  if (owner instanceof Response) return owner;
  try {
    if ((await readFeatureModuleStateFresh('agent')).status !== 'enabled') return jsonOk({ skills: [] });
    if ((await readFeatureModuleStateFresh('skills')).status !== 'enabled') return jsonOk({ skills: [] });
    return jsonOk({ skills: await skillCommands(owner.userId) });
  } catch (error) {
    return failure(error, '读取技能');
  }
}
