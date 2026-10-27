/**
 * Browser calls for roles: the admin page lists and edits them, a member's collaboration settings read the roles they
 * may give a member.
 */
import { requestBrowserData } from '@/lib/browser-api';
import type { AIReasoningEffort } from '@/types';
import type { AgentProfileInput, AgentProfileOption, AgentProfileView } from './config';

/** What the admin editor offers besides the roles: services, skills and models it can name. */
export type AgentProfileCatalog = {
  profiles: AgentProfileView[];
  servers: Array<{ name: string; displayName: string; enabled: boolean }>;
  skills: Array<{ name: string; description: string; enabled: boolean }>;
  /** `thinkingLevels`: the efforts the model takes; empty when it only switches reasoning on and off. */
  models: Array<{ id: string; name: string; supportsReasoning: boolean; thinkingLevels: AIReasoningEffort[] }>;
};

const BASE = '/api/admin/agent-profiles';

export const agentProfileClient = {
  list: (signal?: AbortSignal) => requestBrowserData<AgentProfileCatalog>(BASE, { method: 'GET', signal }, { fallbackMessage: '读取角色失败' }),
  create: async (input: AgentProfileInput) => (await requestBrowserData<{ profile: AgentProfileView }>(BASE,
    { method: 'POST', body: JSON.stringify(input) }, { fallbackMessage: '保存失败' })).profile,
  update: async (name: string, patch: AgentProfileInput) => (await requestBrowserData<{ profile: AgentProfileView }>(`${BASE}/${encodeURIComponent(name)}`,
    { method: 'PATCH', body: JSON.stringify(patch) }, { fallbackMessage: '保存失败' })).profile,
  remove: (name: string) => requestBrowserData<{ deleted: boolean }>(`${BASE}/${encodeURIComponent(name)}`, { method: 'DELETE' }, { fallbackMessage: '删除失败' }),
};

/** The roles this member may give a collaboration member. */
export async function fetchProfileOptions(signal?: AbortSignal) {
  return (await requestBrowserData<{ profiles: AgentProfileOption[] }>('/api/agent/profiles', { signal }, { fallbackMessage: '读取角色失败' })).profiles;
}
