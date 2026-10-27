import 'server-only';
import type { MembershipType } from '@/lib/user/membership';
import { isMembershipTier } from '../mcp/config';
import { SKILL_NAME_MAX, SKILL_NAME_PATTERN } from '../skills/config';
import {
  AGENT_PROFILE_EFFORTS, AGENT_PROFILE_LIMITS, AGENT_PROFILE_MODES, AGENT_PROFILE_NAME_PATTERN, BUILTIN_AGENT_PROFILE_NAMES, profileTokenProblem,
  type AgentProfileEffort, type AgentProfileMode, type AgentProfileTools,
} from './config';

/** Thrown with a message the admin page shows as it is. */
export class ProfileInputError extends Error {}

export type ProfileFields = {
  displayName: string;
  description: string;
  instructions: string;
  tools: AgentProfileTools;
  skills: string[];
  model: string | null;
  reasoningEffort: AgentProfileEffort | null;
  modes: AgentProfileMode[];
  requiredTier: MembershipType;
  enabled: boolean;
  sortOrder: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new ProfileInputError(`${label}须为文本`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ProfileInputError(`请填写${label}`);
  if (trimmed.length > max) throw new ProfileInputError(`${label}最多 ${max} 个字`);
  return trimmed;
}

function tokens(value: unknown, list: 'allow' | 'deny'): string[] {
  if (!Array.isArray(value) || value.length > AGENT_PROFILE_LIMITS.tokens || value.some(item => typeof item !== 'string'))
    throw new ProfileInputError(`${list === 'allow' ? '允许' : '禁止'}的工具最多 ${AGENT_PROFILE_LIMITS.tokens} 项`);
  const unique = [...new Set((value as string[]).map(item => item.trim()).filter(Boolean))];
  for (const token of unique) {
    const problem = profileTokenProblem(token, list);
    if (problem) throw new ProfileInputError(problem);
  }
  return unique;
}

function toolsOf(value: unknown): AgentProfileTools {
  if (!isRecord(value) || typeof value.inherit !== 'boolean') throw new ProfileInputError('工具设置无效');
  return { inherit: value.inherit, allow: tokens(value.allow ?? [], 'allow'), deny: tokens(value.deny ?? [], 'deny') };
}

function skillsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length > SKILL_NAME_MAX || !SKILL_NAME_PATTERN.test(item)))
    throw new ProfileInputError('预载技能须为技能名');
  const unique = [...new Set(value as string[])];
  if (unique.length > AGENT_PROFILE_LIMITS.skills) throw new ProfileInputError(`预载技能最多 ${AGENT_PROFILE_LIMITS.skills} 个`);
  return unique;
}

/**
 * What the admin page sent for a custom role: a new one carries its name and display name, an edit only what changed.
 * A built-in role is edited through `parseBuiltinProfileInput`.
 */
export function parseProfileInput(body: unknown, partial: boolean): Partial<ProfileFields> & { name?: string } {
  if (!isRecord(body)) throw new ProfileInputError('请求格式无效');
  const fields: Partial<ProfileFields> & { name?: string } = {};
  if (!partial) {
    if (typeof body.name !== 'string' || !AGENT_PROFILE_NAME_PATTERN.test(body.name))
      throw new ProfileInputError('标识须以小写字母开头，由 2–32 个小写字母、数字或连字符组成');
    if (BUILTIN_AGENT_PROFILE_NAMES.has(body.name)) throw new ProfileInputError(`「${body.name}」是内置角色的标识`);
    fields.name = body.name;
  }
  if (!partial || body.displayName !== undefined) fields.displayName = text(body.displayName, '名称', AGENT_PROFILE_LIMITS.displayName, true);
  if (body.description !== undefined) fields.description = text(body.description, '说明', AGENT_PROFILE_LIMITS.description);
  if (body.instructions !== undefined) fields.instructions = text(body.instructions, '指令', AGENT_PROFILE_LIMITS.instructions);
  if (body.tools !== undefined) fields.tools = toolsOf(body.tools);
  if (body.skills !== undefined) fields.skills = skillsOf(body.skills);
  if (body.model !== undefined) {
    if (body.model !== null && (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 200)) throw new ProfileInputError('模型无效');
    fields.model = body.model === null ? null : body.model.trim();
  }
  if (body.reasoningEffort !== undefined) {
    if (body.reasoningEffort !== null && !AGENT_PROFILE_EFFORTS.includes(body.reasoningEffort as AgentProfileEffort)) throw new ProfileInputError('推理档位无效');
    fields.reasoningEffort = body.reasoningEffort as AgentProfileEffort | null;
  }
  if (body.modes !== undefined) {
    if (!Array.isArray(body.modes) || body.modes.some(mode => !AGENT_PROFILE_MODES.includes(mode as AgentProfileMode)))
      throw new ProfileInputError('用途无效');
    const modes = AGENT_PROFILE_MODES.filter(mode => (body.modes as string[]).includes(mode));
    if (!modes.length) throw new ProfileInputError('至少选择一种用途');
    fields.modes = modes;
  }
  if (body.requiredTier !== undefined) {
    if (!isMembershipTier(body.requiredTier)) throw new ProfileInputError('会员等级无效');
    fields.requiredTier = body.requiredTier;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new ProfileInputError('启用状态无效');
    fields.enabled = body.enabled;
  }
  if (body.sortOrder !== undefined) {
    if (!Number.isInteger(body.sortOrder) || Math.abs(body.sortOrder as number) > 10_000) throw new ProfileInputError('排序须为 -10000–10000 的整数');
    fields.sortOrder = body.sortOrder as number;
  }
  return fields;
}

/** A built-in role keeps its definition; the admin page can only switch it on or off. */
export function parseBuiltinProfileInput(body: unknown): { enabled: boolean } {
  if (!isRecord(body) || typeof body.enabled !== 'boolean' || Object.keys(body).some(key => key !== 'enabled'))
    throw new ProfileInputError('内置角色只能启用或停用');
  return { enabled: body.enabled };
}
