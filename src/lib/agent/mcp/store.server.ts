import 'server-only';
import { randomUUID } from 'node:crypto';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { isUniqueViolation } from '@/lib/db/errors';
import { json, lockTransactionKey } from '@/lib/db/sql-helpers';
import { createSharedCache } from '@/lib/cache/shared.server';
import type { MembershipType } from '@/lib/user/membership';
import {
  MCP_RESULT_CHARS_RANGE, MCP_TIMEOUT_RANGE, isMembershipTier,
  type McpExposure, type McpServerSnapshot, type McpServerView, type McpToolPolicy,
} from './config';
import { McpInputError, type McpServerFields } from './input.server';
import { applyMcpSecretChanges, sealedEntries, type SealedSecretMap } from './secrets.server';

export interface McpServerRow {
  id: string;
  owner_id: string | null;
  name: string;
  display_name: string;
  description: string;
  url: string;
  headers: Record<string, string>;
  secret_headers: SealedSecretMap;
  secret_query: SealedSecretMap;
  exposure: McpExposure;
  tool_policy: Record<string, McpToolPolicy>;
  search_tool: string | null;
  fetch_tool: string | null;
  route_priority: number;
  required_tier: MembershipType;
  is_enabled: boolean;
  timeout_ms: number;
  max_result_chars: number;
  sort_order: number;
  tools_snapshot: McpServerSnapshot | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Thrown when a user already has as many connectors as the policy allows. */
export class McpLimitError extends Error {}

/** Namespace of the per-owner quota lock (see lockTransactionKey). */
const QUOTA_LOCK = 912;

const platformCache = createSharedCache<McpServerRow[]>({ name: 'agent-mcp-servers', ttlMs: 60_000 });

function rows(value: unknown): McpServerRow[] {
  return value as McpServerRow[];
}

export async function listMcpServerRows(db: ScopedDb, owner: string | null): Promise<McpServerRow[]> {
  return rows(await db.tx((trx) => {
    const query = trx.selectFrom('agent_mcp_servers').selectAll();
    return (owner === null ? query.where('owner_id', 'is', null) : query.where('owner_id', '=', owner))
      .orderBy('created_at', 'desc').execute();
  }));
}

export async function getMcpServerRow(db: ScopedDb, owner: string | null, id: string): Promise<McpServerRow | undefined> {
  return (await db.tx((trx) => {
    const query = trx.selectFrom('agent_mcp_servers').selectAll().where('id', '=', id);
    return (owner === null ? query.where('owner_id', 'is', null) : query.where('owner_id', '=', owner)).executeTakeFirst();
  })) as unknown as McpServerRow | undefined;
}

/** Platform servers for every task, shared across processes; administrator writes invalidate it. */
export function platformMcpServers(): Promise<McpServerRow[]> {
  return platformCache.load(() => listMcpServerRows(systemDb(), null));
}

export function invalidatePlatformMcpServers(): Promise<void> {
  return platformCache.invalidate();
}

/** One user's connectors as the worker reads them: fresh on every task and every call. */
export function userMcpServers(userId: string): Promise<McpServerRow[]> {
  return listMcpServerRows(systemDb(), userId);
}

/** The current state of one server, for the check before each call. Platform servers come from the shared cache. */
export async function currentMcpServer(id: string, owner: string | null): Promise<McpServerRow | undefined> {
  if (owner === null) return (await platformMcpServers()).find((row) => row.id === id);
  return getMcpServerRow(systemDb(), owner, id);
}

function headerClash(headers: Record<string, string>, secrets: SealedSecretMap) {
  const clash = Object.keys(secrets).find((name) => Object.hasOwn(headers, name));
  if (clash) throw new McpInputError(`请求头「${clash}」不能同时作为普通请求头和密钥`);
}

function nameTaken(error: unknown): never {
  if (isUniqueViolation(error)) throw new McpInputError('这个标识已被使用，请换一个');
  throw error;
}

/**
 * `limit` (users only) is checked under a per-owner lock, so concurrent additions cannot exceed it. The id is chosen
 * here because the secrets are sealed to it.
 */
export async function insertMcpServer(
  db: ScopedDb, owner: string | null, fields: Partial<McpServerFields> & Pick<McpServerFields, 'name' | 'displayName' | 'url'>,
  options: { limit?: number } = {},
): Promise<McpServerRow> {
  const id = randomUUID();
  const scope = { serverId: id, ownerId: owner };
  const headers = fields.headers ?? {};
  const secretHeaders = applyMcpSecretChanges(scope, 'header', {}, fields.secretHeaders);
  headerClash(headers, secretHeaders);
  const secretQuery = applyMcpSecretChanges(scope, 'query', {}, fields.secretQuery);
  try {
    return (await db.tx(async (trx) => {
      if (owner !== null && options.limit !== undefined) {
        await lockTransactionKey(trx, owner, QUOTA_LOCK);
        // 额度按启用中的连接器计算；新增超出时停用最早添加的连接器。
        const enabled = await trx.selectFrom('agent_mcp_servers').select('id')
          .where('owner_id', '=', owner).where('is_enabled', '=', true)
          .orderBy('created_at', 'asc').limit(options.limit).execute();
        if (enabled.length >= options.limit) {
          const retire = enabled.slice(0, enabled.length - options.limit + 1).map((row) => row.id);
          await trx.updateTable('agent_mcp_servers').set({ is_enabled: false }).where('id', 'in', retire).execute();
        }
      }
      return trx.insertInto('agent_mcp_servers').values({
        id, owner_id: owner, name: fields.name, display_name: fields.displayName, description: fields.description ?? '',
        url: fields.url, headers: json(headers) as never, secret_headers: json(secretHeaders) as never, secret_query: json(secretQuery) as never,
        exposure: fields.exposure ?? 'deferred', tool_policy: json(fields.toolPolicy ?? {}) as never,
        search_tool: owner === null ? fields.searchTool ?? null : null,
        fetch_tool: owner === null ? fields.fetchTool ?? null : null,
        route_priority: fields.routePriority ?? 100,
        required_tier: owner === null ? fields.requiredTier ?? 'plus' : 'free',
        is_enabled: fields.enabled ?? true,
        timeout_ms: fields.timeoutMs ?? MCP_TIMEOUT_RANGE.default,
        max_result_chars: fields.maxResultChars ?? MCP_RESULT_CHARS_RANGE.default,
        sort_order: fields.sortOrder ?? 0,
      }).returningAll().executeTakeFirstOrThrow();
    })) as unknown as McpServerRow;
  } catch (error) {
    return nameTaken(error);
  }
}

export async function updateMcpServer(
  db: ScopedDb, owner: string | null, id: string, fields: Partial<McpServerFields>,
): Promise<McpServerRow | undefined> {
  try {
    return (await db.tx(async (trx) => {
      const scoped = trx.selectFrom('agent_mcp_servers').selectAll().where('id', '=', id);
      const current = await (owner === null ? scoped.where('owner_id', 'is', null) : scoped.where('owner_id', '=', owner))
        .forUpdate().executeTakeFirst() as unknown as McpServerRow | undefined;
      if (!current) return undefined;
      const scope = { serverId: id, ownerId: owner };
      const headers = fields.headers ?? current.headers;
      const secretHeaders = applyMcpSecretChanges(scope, 'header', current.secret_headers, fields.secretHeaders);
      headerClash(headers, secretHeaders);
      const set = {
        ...(fields.name !== undefined ? { name: fields.name } : {}),
        ...(fields.displayName !== undefined ? { display_name: fields.displayName } : {}),
        ...(fields.description !== undefined ? { description: fields.description } : {}),
        ...(fields.url !== undefined ? { url: fields.url } : {}),
        ...(fields.headers !== undefined ? { headers: json(headers) as never } : {}),
        ...(fields.secretHeaders !== undefined ? { secret_headers: json(secretHeaders) as never } : {}),
        ...(fields.secretQuery !== undefined
          ? { secret_query: json(applyMcpSecretChanges(scope, 'query', current.secret_query, fields.secretQuery)) as never } : {}),
        ...(fields.exposure !== undefined ? { exposure: fields.exposure } : {}),
        ...(fields.toolPolicy !== undefined ? { tool_policy: json(fields.toolPolicy) as never } : {}),
        ...(owner === null && fields.searchTool !== undefined ? { search_tool: fields.searchTool } : {}),
        ...(owner === null && fields.fetchTool !== undefined ? { fetch_tool: fields.fetchTool } : {}),
        ...(fields.routePriority !== undefined ? { route_priority: fields.routePriority } : {}),
        ...(owner === null && fields.requiredTier !== undefined ? { required_tier: fields.requiredTier } : {}),
        ...(fields.enabled !== undefined ? { is_enabled: fields.enabled } : {}),
        ...(fields.timeoutMs !== undefined ? { timeout_ms: fields.timeoutMs } : {}),
        ...(fields.maxResultChars !== undefined ? { max_result_chars: fields.maxResultChars } : {}),
        ...(fields.sortOrder !== undefined ? { sort_order: fields.sortOrder } : {}),
      };
      if (!Object.keys(set).length) return current;
      return trx.updateTable('agent_mcp_servers').set(set).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    })) as unknown as McpServerRow | undefined;
  } catch (error) {
    return nameTaken(error);
  }
}

export async function deleteMcpServer(db: ScopedDb, owner: string | null, id: string): Promise<boolean> {
  const deleted = await db.tx((trx) => {
    const query = trx.deleteFrom('agent_mcp_servers').where('id', '=', id);
    return (owner === null ? query.where('owner_id', 'is', null) : query.where('owner_id', '=', owner)).returning('id').execute();
  });
  return deleted.length > 0;
}

/** Stores what a connection test saw, or why it failed; the error text is already free of secrets. */
export async function recordMcpServerCheck(
  db: ScopedDb, owner: string | null, id: string, outcome: { snapshot: McpServerSnapshot | null; error: string | null },
): Promise<McpServerRow | undefined> {
  return (await db.tx((trx) => {
    const query = trx.updateTable('agent_mcp_servers').set({
      ...(outcome.snapshot ? { tools_snapshot: json(outcome.snapshot) as never } : {}),
      last_error: outcome.error, last_checked_at: new Date().toISOString(),
    }).where('id', '=', id);
    return (owner === null ? query.where('owner_id', 'is', null) : query.where('owner_id', '=', owner))
      .returningAll().executeTakeFirst();
  })) as unknown as McpServerRow | undefined;
}

/** Enabled connectors only: a retired connector stays stored but does not take an active slot. */
export async function countMcpServers(db: ScopedDb, owner: string): Promise<number> {
  const { count } = await db.tx((trx) => trx.selectFrom('agent_mcp_servers')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('owner_id', '=', owner).where('is_enabled', '=', true).executeTakeFirstOrThrow());
  return Number(count);
}

/** The browser's view: secret values never leave the server, only their names. */
export function toMcpServerView(row: McpServerRow): McpServerView {
  return {
    id: row.id,
    scope: row.owner_id === null ? 'platform' : 'user',
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    url: row.url,
    headers: row.headers ?? {},
    secretHeaders: Object.keys(sealedEntries(row.secret_headers)),
    secretQuery: Object.keys(sealedEntries(row.secret_query)),
    exposure: row.exposure,
    toolPolicy: row.tool_policy ?? {},
    searchTool: row.search_tool,
    fetchTool: row.fetch_tool,
    routePriority: row.route_priority,
    requiredTier: isMembershipTier(row.required_tier) ? row.required_tier : 'pro',
    enabled: row.is_enabled,
    timeoutMs: row.timeout_ms,
    maxResultChars: row.max_result_chars,
    sortOrder: row.sort_order,
    snapshot: row.tools_snapshot,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}
