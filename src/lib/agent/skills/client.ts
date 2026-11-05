/**
 * Browser calls for the skills settings pages and the composer: administrators manage the platform's skills, members
 * their own, through the same shapes.
 */
import { requestBrowserData } from '@/lib/browser-api';
import { extensionSettingsCaller } from '../extensions/client';
import type { ExtensionAllowanceView } from '../extensions/config';
import type { SkillCommand, SkillDetail, SkillInput, SkillScope, SkillView } from './config';

export type SkillListing = { skills: SkillView[]; allowance?: ExtensionAllowanceView };

const BASE: Record<SkillScope, string> = { platform: '/api/admin/agent-skills', user: '/api/user/skills' };

/** `userId` pins a member's requests to the account the page was opened with. */
export function skillClient(scope: SkillScope, userId?: string) {
  const call = extensionSettingsCaller(BASE, scope, userId);
  const path = (id: string) => `/${encodeURIComponent(id)}`;
  return {
    list: (signal?: AbortSignal) => call<SkillListing>('', 'GET', '读取技能失败', undefined, signal),
    detail: async (id: string, signal?: AbortSignal) => (await call<{ skill: SkillDetail }>(path(id), 'GET', '读取技能失败', undefined, signal)).skill,
    create: async (input: SkillInput) => (await call<{ skill: SkillView }>('', 'POST', '保存失败', input)).skill,
    update: async (id: string, patch: SkillInput) => (await call<{ skill: SkillView }>(path(id), 'PATCH', '保存失败', patch)).skill,
    remove: (id: string) => call<{ deleted: boolean }>(path(id), 'DELETE', '删除失败'),
  };
}

export type SkillClient = ReturnType<typeof skillClient>;

/** The skills the member can call with `/skill:` in an Agent conversation. */
export async function fetchSkillCommands(signal?: AbortSignal) {
  return (await requestBrowserData<{ skills: SkillCommand[] }>('/api/agent/skills', { signal }, { fallbackMessage: '读取技能失败' })).skills;
}
