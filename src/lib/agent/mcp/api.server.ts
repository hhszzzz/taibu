import 'server-only';
import type { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser, requireUserContext } from '@/lib/api-utils';
import { getAgentExtensionsPolicy, readFeatureModuleStateFresh, setAgentExtensionsPolicy } from '@/lib/app-settings';

import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { isValidUUID } from '@/lib/validation';
import { extensionAllowance, parseAgentExtensionsPolicy, type ExtensionAllowanceView } from './config';
import { testMcpServer } from './endpoint.server';
import { McpInputError, parseMcpServerInput, type McpServerFields } from './input.server';
import { mcpPool } from './pool.server';
import {
  McpLimitError, countMcpServers, deleteMcpServer, getMcpServerRow, insertMcpServer, invalidatePlatformMcpServers,
  listMcpServerRows, recordMcpServerCheck, toMcpServerView, updateMcpServer,
} from './store.server';

/** Feature switch for this area; fail closed when the state cannot be read. */
async function connectorsGate(): Promise<Response | null> {
  const state = await readFeatureModuleStateFresh('connectors');
  if (state.status === 'enabled') return null;
  if (state.status === 'unavailable') return jsonError('功能状态暂时无法确认，请稍后重试', 503, { code: 'FEATURE_STATE_UNAVAILABLE' });
  return jsonError('连接器功能当前未启用', 403, { code: 'FEATURE_DISABLED' });
}

/**
 * Settings endpoints for MCP servers: administrators manage the platform's (owner null) through the system identity,
 * users their own connectors through their own, so row security keeps each to its rows. Responses carry secret names
 * only; logs carry error codes only.
 */
type Owner = { db: ScopedDb; owner: string | null; userId: string };

const TEST_RATE_LIMIT = { endpoint: '/api/user/connectors/test', maxRequests: 10, windowMs: 60_000 } as const;

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
  if (error instanceof McpInputError) return jsonError(error.message, 400);
  if (error instanceof McpLimitError) return jsonError(error.message, 409);
  console.error('[agent-mcp]', { action, code: toDbError(error).code });
  return jsonError(`${action}失败`, 500);
}

const readBody = (request: NextRequest) => request.json().catch(() => null) as Promise<unknown>;

async function changed(owner: Owner) {
  if (owner.owner === null) await invalidatePlatformMcpServers();
}

/** The user's allowance: whether the administrator allows connectors at all, and how many. */
async function connectorAllowance(owner: Owner): Promise<ExtensionAllowanceView> {
  const [policy, used] = await Promise.all([getAgentExtensionsPolicy(), countMcpServers(owner.db, owner.userId)]);
  return { enabled: policy.connectors.enabled, limit: extensionAllowance(policy.connectors), used };
}

async function list(owner: Owner) {
  try {
    const servers = (await listMcpServerRows(owner.db, owner.owner)).map(toMcpServerView);
    if (owner.owner === null) return jsonOk({ servers });
    return jsonOk({ servers, allowance: await connectorAllowance(owner) });
  } catch (error) {
    return failure(error, '读取外部服务');
  }
}

async function create(owner: Owner, request: NextRequest) {
  try {
    const fields = parseMcpServerInput(await readBody(request), owner.owner === null ? 'platform' : 'user', false) as
      Partial<McpServerFields> & Pick<McpServerFields, 'name' | 'displayName' | 'url'>;
    let limit: number | undefined;
    if (owner.owner !== null) {
      const allowance = await connectorAllowance(owner);
      if (!allowance.enabled || allowance.limit === 0) return jsonError('管理员已关闭个人连接器', 403);
      limit = allowance.limit;
    }
    const row = await insertMcpServer(owner.db, owner.owner, fields, { limit });
    await changed(owner);
    return jsonOk({ server: toMcpServerView(row) }, 201);
  } catch (error) {
    return failure(error, '保存外部服务');
  }
}

async function update(owner: Owner, request: NextRequest, id: string) {
  if (!isValidUUID(id)) return jsonError('外部服务标识无效', 400);
  try {
    const fields = parseMcpServerInput(await readBody(request), owner.owner === null ? 'platform' : 'user', true);
    const row = await updateMcpServer(owner.db, owner.owner, id, fields);
    if (!row) return jsonError('外部服务不存在', 404);
    await changed(owner);
    return jsonOk({ server: toMcpServerView(row) });
  } catch (error) {
    return failure(error, '保存外部服务');
  }
}

async function remove(owner: Owner, id: string) {
  if (!isValidUUID(id)) return jsonError('外部服务标识无效', 400);
  try {
    if (!(await deleteMcpServer(owner.db, owner.owner, id))) return jsonError('外部服务不存在', 404);
    mcpPool.release(id);
    await changed(owner);
    return jsonOk({ deleted: true });
  } catch (error) {
    return failure(error, '删除外部服务');
  }
}

/**
 * Connects with the saved settings, lists the tools and records what was seen (or why it failed). A failed test is
 * still a successful request: the reason travels as the server's `lastError`, since the browser helper reads a
 * top-level `error` as a failed request.
 */
async function test(owner: Owner, request: NextRequest, id: string) {
  if (!isValidUUID(id)) return jsonError('外部服务标识无效', 400);
  try {
    const row = await getMcpServerRow(owner.db, owner.owner, id);
    if (!row) return jsonError('外部服务不存在', 404);
    if (owner.owner !== null) {
      const allowance = await connectorAllowance(owner);
      if (allowance.limit === 0) return jsonError('管理员已关闭个人连接器', 403);
      if (!(await checkRateLimit(owner.userId, TEST_RATE_LIMIT.endpoint, TEST_RATE_LIMIT)).allowed)
        return jsonError('测试过于频繁，请稍后再试', 429);
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(row.timeout_ms + 5_000)]);
    const outcome = await testMcpServer(row, { signal });
    const saved = await recordMcpServerCheck(owner.db, owner.owner, id, outcome);
    await changed(owner);
    const view = toMcpServerView(saved ?? row);
    return jsonOk({ ok: outcome.error === null, server: { ...view, lastError: outcome.error, snapshot: outcome.snapshot ?? view.snapshot } });
  } catch (error) {
    if (request.signal.aborted) return jsonError('测试已取消', 499);
    if (error instanceof Error && error.name === 'TimeoutError') return jsonError('外部服务响应超时', 504);
    return failure(error, '测试外部服务');
  }
}

export async function listPlatformMcpServers(request: NextRequest) {
  const owner = await administrator(request);
  return owner instanceof Response ? owner : list(owner);
}
export async function createPlatformMcpServer(request: NextRequest) {
  const owner = await administrator(request);
  return owner instanceof Response ? owner : create(owner, request);
}
export async function updatePlatformMcpServer(request: NextRequest, id: string) {
  const owner = await administrator(request);
  return owner instanceof Response ? owner : update(owner, request, id);
}
export async function deletePlatformMcpServer(request: NextRequest, id: string) {
  const owner = await administrator(request);
  return owner instanceof Response ? owner : remove(owner, id);
}
export async function testPlatformMcpServer(request: NextRequest, id: string) {
  const owner = await administrator(request);
  return owner instanceof Response ? owner : test(owner, request, id);
}

export async function listUserConnectors(request: NextRequest) {
  const gate = await connectorsGate();
  if (gate) return gate;
  const owner = await member(request);
  return owner instanceof Response ? owner : list(owner);
}
export async function createUserConnector(request: NextRequest) {
  const gate = await connectorsGate();
  if (gate) return gate;
  const owner = await member(request);
  return owner instanceof Response ? owner : create(owner, request);
}
export async function updateUserConnector(request: NextRequest, id: string) {
  const gate = await connectorsGate();
  if (gate) return gate;
  const owner = await member(request);
  return owner instanceof Response ? owner : update(owner, request, id);
}
export async function deleteUserConnector(request: NextRequest, id: string) {
  const gate = await connectorsGate();
  if (gate) return gate;
  const owner = await member(request);
  return owner instanceof Response ? owner : remove(owner, id);
}
export async function testUserConnector(request: NextRequest, id: string) {
  const gate = await connectorsGate();
  if (gate) return gate;
  const owner = await member(request);
  return owner instanceof Response ? owner : test(owner, request, id);
}

export async function readExtensionsPolicy(request: NextRequest) {
  const owner = await administrator(request);
  if (owner instanceof Response) return owner;
  try {
    return jsonOk({ policy: await getAgentExtensionsPolicy() });
  } catch (error) {
    return failure(error, '读取扩展策略');
  }
}

export async function saveExtensionsPolicy(request: NextRequest) {
  const owner = await administrator(request);
  if (owner instanceof Response) return owner;
  let policy;
  try {
    policy = parseAgentExtensionsPolicy((await readBody(request) as { policy?: unknown } | null)?.policy);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '扩展策略格式无效', 400);
  }
  try {
    await setAgentExtensionsPolicy(policy);
    return jsonOk({ policy });
  } catch (error) {
    return failure(error, '保存扩展策略');
  }
}
