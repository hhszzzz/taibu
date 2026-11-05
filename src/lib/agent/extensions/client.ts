import { requestBrowserData } from '@/lib/browser-api';
import type { AgentExtensionsPolicy } from './config';

/**
 * The request shape the extension settings pages share: platform items under the administrator's path, a member's own
 * under the user path, with the account the page was opened with pinned so a switch is refused by the server.
 */
export function extensionSettingsCaller<TScope extends string>(
  base: Record<TScope, string>, scope: TScope, userId?: string,
) {
  return <T>(path: string, method: string, fallbackMessage: string, body?: unknown, signal?: AbortSignal) =>
    requestBrowserData<T>(`${base[scope]}${path}`, {
      method, signal,
      ...(userId ? { headers: { 'X-Expected-User-Id': userId } } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { fallbackMessage });
}

export async function fetchAgentExtensionsPolicy(signal?: AbortSignal) {
  return (await requestBrowserData<{ policy: AgentExtensionsPolicy }>('/api/admin/agent-extensions-policy', { signal }, { fallbackMessage: '读取扩展策略失败' })).policy;
}

export async function saveAgentExtensionsPolicy(policy: AgentExtensionsPolicy) {
  return (await requestBrowserData<{ policy: AgentExtensionsPolicy }>('/api/admin/agent-extensions-policy', {
    method: 'PUT', body: JSON.stringify({ policy }),
  }, { fallbackMessage: '保存扩展策略失败' })).policy;
}
