/**
 * Browser calls for the MCP settings pages: administrators manage the platform's servers, members their own
 * connectors, through the same shapes.
 */
import { requestBrowserData } from '@/lib/browser-api';
import type { AgentExtensionsPolicy, ExtensionAllowanceView, McpServerInput, McpServerView } from './config';

export type McpServerScope = McpServerView['scope'];
export type McpServerListing = { servers: McpServerView[]; allowance?: ExtensionAllowanceView };
/** A failed test is a successful request; the reason is the server's `lastError`. */
export type McpServerTestResult = { ok: boolean; server: McpServerView };

const BASE: Record<McpServerScope, string> = { platform: '/api/admin/agent-mcp', user: '/api/user/connectors' };

/** `userId` pins a member's requests to the account the page was opened with. */
export function mcpServerClient(scope: McpServerScope, userId?: string) {
  const call = <T>(path: string, method: string, fallbackMessage: string, body?: unknown, signal?: AbortSignal) =>
    requestBrowserData<T>(`${BASE[scope]}${path}`, {
      method, signal,
      ...(userId ? { headers: { 'X-Expected-User-Id': userId } } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { fallbackMessage });
  const path = (id: string, suffix = '') => `/${encodeURIComponent(id)}${suffix}`;
  return {
    list: (signal?: AbortSignal) => call<McpServerListing>('', 'GET', '读取外部服务失败', undefined, signal),
    create: async (input: McpServerInput) => (await call<{ server: McpServerView }>('', 'POST', '保存失败', input)).server,
    update: async (id: string, patch: Partial<McpServerInput>) => (await call<{ server: McpServerView }>(path(id), 'PATCH', '保存失败', patch)).server,
    remove: (id: string) => call<{ deleted: boolean }>(path(id), 'DELETE', '删除失败'),
    test: (id: string, signal?: AbortSignal) => call<McpServerTestResult>(path(id, '/test'), 'POST', '测试连接失败', undefined, signal),
  };
}

export type McpServerClient = ReturnType<typeof mcpServerClient>;

export async function fetchAgentExtensionsPolicy(signal?: AbortSignal) {
  return (await requestBrowserData<{ policy: AgentExtensionsPolicy }>('/api/admin/agent-extensions-policy', { signal }, { fallbackMessage: '读取扩展策略失败' })).policy;
}

export async function saveAgentExtensionsPolicy(policy: AgentExtensionsPolicy) {
  return (await requestBrowserData<{ policy: AgentExtensionsPolicy }>('/api/admin/agent-extensions-policy', {
    method: 'PUT', body: JSON.stringify({ policy }),
  }, { fallbackMessage: '保存扩展策略失败' })).policy;
}
