/**
 * Browser calls for the MCP settings pages: administrators manage the platform's servers, members their own
 * connectors, through the same shapes.
 */
import { requestBrowserData } from '@/lib/browser-api';
import { extensionSettingsCaller } from '../extensions/client';
import type { ExtensionAllowanceView } from '../extensions/config';
import type { McpServerInput, McpServerView } from './config';

export type McpServerScope = McpServerView['scope'];
export type McpServerListing = { servers: McpServerView[]; allowance?: ExtensionAllowanceView };
/** A failed test is a successful request; the reason is the server's `lastError`. */
export type McpServerTestResult = { ok: boolean; server: McpServerView };

const BASE: Record<McpServerScope, string> = { platform: '/api/admin/agent-mcp', user: '/api/user/connectors' };

/** `userId` pins a member's requests to the account the page was opened with. */
export function mcpServerClient(scope: McpServerScope, userId?: string) {
  const call = extensionSettingsCaller(BASE, scope, userId);
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

/** A connector the member may use in an Agent task: the platform's or their own. */
export type AgentConnector = { id: string; name: string; description: string; scope: McpServerScope };

/** The connectors an Agent task can call, for the composer's + menu and the settings page. */
export async function fetchAgentConnectors(signal?: AbortSignal) {
  return (await requestBrowserData<{ connectors: AgentConnector[] }>('/api/agent/connectors', { signal }, { fallbackMessage: '读取连接器失败' })).connectors;
}
