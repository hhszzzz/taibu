import 'server-only';
import type { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser, requireUserContext } from '@/lib/api-utils';
import { getAgentExtensionsPolicy, readFeatureModuleStateFresh } from '@/lib/app-settings';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { getUserCreditInfo } from '@/lib/user/credits';
import { isValidUUID } from '@/lib/validation';
import { extensionAllowance, type ExtensionAllowanceView } from '../mcp/config';
import { BUILTIN_SKILL_NAMES } from './builtin.server';
import { skillCommands } from './catalog.server';
import { SkillInputError, parseSkillInput, type SkillFields } from './input.server';
import {
  SkillLimitError, countSkills, deleteSkill, getSkillDetailRow, insertSkill, invalidatePlatformSkills, listSkillRows,
  platformSkills, toSkillDetail, toSkillView, updateSkill,
} from './store.server';

/**
 * Settings endpoints for skills, shaped like the connectors': administrators manage the platform's (owner null)
 * through the system identity, users their own through theirs, so row security keeps each to its rows.
 */
type Owner = { db: ScopedDb; owner: string | null; userId: string };

async function administrator(request: NextRequest): Promise<Owner | Response> {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  return { db: systemDb(), owner: null, userId: auth.user.id };
}

async function member(request: NextRequest): Promise<Owner | Response> {
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  const expected = request.headers.get('X-Expected-User-Id');
  if (expected !== null && expected !== auth.user.id) return jsonError('账号已切换', 409);
  return { db: auth.db, owner: auth.user.id, userId: auth.user.id };
}

function failure(error: unknown, action: string): Response {
  if (error instanceof SkillInputError) return jsonError(error.message, 400);
  if (error instanceof SkillLimitError) return jsonError(error.message, 409);
  console.error('[agent-skills]', { action, code: toDbError(error).code });
  return jsonError(`${action}失败`, 500);
}

const readBody = (request: NextRequest) => request.json().catch(() => null) as Promise<unknown>;

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

/** The user's allowance: whether the administrator allows skills at all, for their tier, and how many. */
async function skillAllowance(owner: Owner): Promise<ExtensionAllowanceView> {
  const [policy, account, used] = await Promise.all([
    getAgentExtensionsPolicy(), getUserCreditInfo(owner.userId, {}), countSkills(owner.db, owner.userId),
  ]);
  const gate = policy.skills;
  return {
    enabled: gate.enabled, tierAllowed: gate.tiers.includes(account.membership),
    limit: extensionAllowance(gate, account.membership), used, tiers: gate.tiers.filter(tier => gate.limits[tier] > 0),
  };
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
    const fields = parseSkillInput(await readBody(request), owner.owner === null ? 'platform' : 'user', false) as
      Partial<SkillFields> & Pick<SkillFields, 'document'>;
    let limit: number | undefined;
    if (owner.owner !== null) {
      const allowance = await skillAllowance(owner);
      if (!allowance.enabled) return jsonError('管理员已关闭个人技能', 403);
      if (!allowance.tierAllowed || allowance.limit === 0) return jsonError('当前会员不能添加技能', 403);
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
    const fields = parseSkillInput(await readBody(request), owner.owner === null ? 'platform' : 'user', true);
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
  const owner = await administrator(request);
  return owner instanceof Response ? owner : list(owner);
}
export async function readPlatformSkill(request: NextRequest, id: string) {
  const owner = await administrator(request);
  return owner instanceof Response ? owner : detail(owner, id);
}
export async function createPlatformSkill(request: NextRequest) {
  const owner = await administrator(request);
  return owner instanceof Response ? owner : create(owner, request);
}
export async function updatePlatformSkill(request: NextRequest, id: string) {
  const owner = await administrator(request);
  return owner instanceof Response ? owner : update(owner, request, id);
}
export async function deletePlatformSkill(request: NextRequest, id: string) {
  const owner = await administrator(request);
  return owner instanceof Response ? owner : remove(owner, id);
}

export async function listUserSkills(request: NextRequest) {
  const owner = await member(request);
  return owner instanceof Response ? owner : list(owner);
}
export async function readUserSkill(request: NextRequest, id: string) {
  const owner = await member(request);
  return owner instanceof Response ? owner : detail(owner, id);
}
export async function createUserSkill(request: NextRequest) {
  const owner = await member(request);
  return owner instanceof Response ? owner : create(owner, request);
}
export async function updateUserSkill(request: NextRequest, id: string) {
  const owner = await member(request);
  return owner instanceof Response ? owner : update(owner, request, id);
}
export async function deleteUserSkill(request: NextRequest, id: string) {
  const owner = await member(request);
  return owner instanceof Response ? owner : remove(owner, id);
}

/** The skills the composer's `/skill:` menu offers this member: none while the Agent is off. */
export async function listSkillCommands(request: NextRequest) {
  const owner = await member(request);
  if (owner instanceof Response) return owner;
  try {
    if ((await readFeatureModuleStateFresh('agent')).status !== 'enabled') return jsonOk({ skills: [] });
    const { membership } = await getUserCreditInfo(owner.userId, {});
    return jsonOk({ skills: await skillCommands(owner.userId, membership) });
  } catch (error) {
    return failure(error, '读取技能');
  }
}
