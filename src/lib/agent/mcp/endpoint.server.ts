import 'server-only';
import {
  McpAuthRequiredError, McpConnectionClosedError, McpError, McpHttpError, McpSessionExpiredError, McpTimeoutError,
  type Tool,
} from '@earendil-works/pi-mcp';
import { MCP_PLATFORM_TOOL_LIMIT, MCP_USER_TOOL_LIMIT, type McpServerSnapshot } from './config';
import { openMcpSecrets } from './secrets.server';
import { mcpPool, type McpEndpoint, type McpPool } from './pool.server';
import type { McpServerRow } from './store.server';

export type ResolvedMcpServer = {
  endpoint: McpEndpoint;
  /** Removes every secret of the server, in the forms a server or an error could echo, from text. */
  scrub: (text: string) => string;
};

const REDACTED = '[REDACTED]';

/** The forms a secret can come back in: as given, without its scheme (`Bearer …`), and URL-encoded. */
function secretForms(secret: string) {
  const forms = new Set([secret, encodeURIComponent(secret)]);
  const token = /^\S+\s+(\S.*)$/u.exec(secret)?.[1];
  if (token) forms.add(token).add(encodeURIComponent(token));
  return [...forms].filter((form) => form.length >= 4);
}

export function secretScrubber(secrets: readonly string[]): (text: string) => string {
  const forms = [...new Set(secrets.flatMap(secretForms))].sort((left, right) => right.length - left.length);
  return (text) => forms.reduce((result, form) => result.replaceAll(form, REDACTED), text);
}

/** The server's endpoint with its secrets opened: query parameters appended to the URL, headers merged. */
export function resolveMcpServer(row: McpServerRow): ResolvedMcpServer {
  const scope = { serverId: row.id, ownerId: row.owner_id };
  const secretHeaders = openMcpSecrets(scope, 'header', row.secret_headers);
  const secretQuery = openMcpSecrets(scope, 'query', row.secret_query);
  const url = new URL(row.url);
  for (const [name, value] of Object.entries(secretQuery)) url.searchParams.set(name, value);
  return {
    endpoint: { id: row.id, url: url.href, headers: { ...row.headers, ...secretHeaders }, timeoutMs: row.timeout_ms, platform: row.owner_id === null },
    scrub: secretScrubber([...Object.values(secretHeaders), ...Object.values(secretQuery)]),
  };
}

/** The error and the causes under it, so a network wrapper's "fetch failed" still shows why the socket refused. */
function causeChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    if (current.message) parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

/** A failure in words the settings pages and the model can see; remote text is cut short and scrubbed. */
export function describeMcpError(error: unknown, scrub: (text: string) => string): string {
  const remote = (text: string) => scrub(text).replace(/\s+/gu, ' ').trim().slice(0, 300);
  const chain = causeChain(error);
  if (error instanceof McpAuthRequiredError || (error instanceof McpHttpError && (error.status === 401 || error.status === 403)))
    return '外部服务拒绝了认证，请检查密钥设置';
  if (error instanceof McpSessionExpiredError) return '外部服务的会话已失效，请重试';
  if (error instanceof McpHttpError) return `外部服务返回 HTTP ${error.status}`;
  if (error instanceof McpTimeoutError) return '外部服务响应超时';
  if (error instanceof McpConnectionClosedError) return '与外部服务的连接中断';
  if (error instanceof McpError) return `外部服务报错：${remote(error.message) || `错误码 ${error.code}`}`;
  const message = error instanceof Error ? error.message : '';
  if (message === 'AGENT_MCP_SECRET_INVALID') return '保存的密钥无法解密，请重新填写';
  if (/AGENT_PRIVATE_ADDRESS_BLOCKED/u.test(chain)) return '外部服务地址解析到非公开网络，已拒绝连接';
  if (/^MCP 服务/u.test(message)) return message;
  if (/unsupported protocol version/iu.test(chain)) return '外部服务的 MCP 协议版本不受支持';
  if (error instanceof TypeError || /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/iu.test(chain)) return '无法连接外部服务';
  return '外部服务调用失败';
}

const SNAPSHOT_DESCRIPTION_MAX = 2000;
const SNAPSHOT_INSTRUCTIONS_MAX = 8000;

/** What the settings pages show about the server's tools; every text is the server's own and treated as data. */
export function snapshotOf(
  description: { tools: Tool[]; server?: { name: string; version: string; title?: string }; instructions?: string },
  scrub: (text: string) => string, limit: number,
): McpServerSnapshot {
  const tools = description.tools.slice(0, limit).map((tool) => ({
    name: tool.name.slice(0, 128),
    ...(tool.title ?? tool.annotations?.title ? { title: scrub(String(tool.title ?? tool.annotations?.title)).slice(0, 200) } : {}),
    ...(tool.description ? { description: scrub(tool.description).slice(0, SNAPSHOT_DESCRIPTION_MAX) } : {}),
    ...(tool.annotations ? {
      annotations: Object.fromEntries((['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const)
        .filter((key) => typeof tool.annotations?.[key] === 'boolean').map((key) => [key, tool.annotations![key]])),
    } : {}),
  }));
  return {
    ...(description.server ? { server: {
      name: scrub(description.server.name).slice(0, 200), version: scrub(description.server.version).slice(0, 100),
      ...(description.server.title ? { title: scrub(description.server.title).slice(0, 200) } : {}),
    } } : {}),
    ...(description.instructions ? { instructions: scrub(description.instructions).slice(0, SNAPSHOT_INSTRUCTIONS_MAX) } : {}),
    tools,
    ...(description.tools.length > limit ? { truncated: true } : {}),
  };
}

/** Connects afresh and lists the tools, for the settings pages' test button. */
export async function testMcpServer(
  row: McpServerRow, options: { signal?: AbortSignal; pool?: McpPool } = {},
): Promise<{ snapshot: McpServerSnapshot | null; error: string | null }> {
  let resolved: ResolvedMcpServer;
  try {
    resolved = resolveMcpServer(row);
  } catch (error) {
    return { snapshot: null, error: describeMcpError(error, (text) => text) };
  }
  try {
    const description = await (options.pool ?? mcpPool).describe(resolved.endpoint, { signal: options.signal, fresh: true });
    return { snapshot: snapshotOf(description, resolved.scrub, row.owner_id === null ? MCP_PLATFORM_TOOL_LIMIT : MCP_USER_TOOL_LIMIT), error: null };
  } catch (error) {
    options.signal?.throwIfAborted();
    return { snapshot: null, error: describeMcpError(error, resolved.scrub) };
  }
}

/** Test an unsaved MCP server input directly without saving to database. */
export async function testMcpServerInput(
  fields: { url: string; headers?: Record<string, string>; secretHeaders?: Record<string, string>; secretQuery?: Record<string, string>; timeoutMs?: number },
  options: { signal?: AbortSignal; pool?: McpPool } = {},
): Promise<{ snapshot: McpServerSnapshot | null; error: string | null }> {
  try {
    const secretHeaders = fields.secretHeaders ?? {};
    const secretQuery = fields.secretQuery ?? {};
    const url = new URL(fields.url);
    for (const [name, value] of Object.entries(secretQuery)) url.searchParams.set(name, value);

    const endpoint: McpEndpoint = {
      id: 'test-preview',
      url: url.href,
      headers: { ...fields.headers, ...secretHeaders },
      timeoutMs: fields.timeoutMs ?? 30_000,
    };

    const scrub = secretScrubber([...Object.values(secretHeaders), ...Object.values(secretQuery)]);
    const description = await (options.pool ?? mcpPool).describe(endpoint, { signal: options.signal, fresh: true });
    return { snapshot: snapshotOf(description, scrub, MCP_PLATFORM_TOOL_LIMIT), error: null };
  } catch (error) {
    options.signal?.throwIfAborted();
    const scrub = secretScrubber(Object.values(fields.secretHeaders ?? {}).concat(Object.values(fields.secretQuery ?? {})));
    return { snapshot: null, error: describeMcpError(error, scrub) };
  }
}
