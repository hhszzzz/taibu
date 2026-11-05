import 'server-only';
import type { NextRequest } from 'next/server';
import { jsonError, jsonOk, readJsonBody, requireAdminUser, requireUserContext } from '@/lib/api-utils';
import { getByokPolicy, readFeatureModuleStateFresh, setByokPolicy } from '@/lib/app-settings';
import { allModelsDevModels } from '@/lib/admin/models-dev.server';
import { exactModelsDevMatch } from '@/lib/admin/models-dev';
import { MODEL_REQUEST_USER_AGENT } from '@/lib/ai/providers/ai-sdk-provider';
import { agentSafeFetch, validateAgentProviderUrl } from '@/lib/agent/safe-fetch.server';
import { toDbError } from '@/lib/db/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { isValidUUID } from '@/lib/validation';
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import {
  BYOK_MODEL_ID_MAX, BYOK_PROTOCOLS, ByokInputError, byokAddressError, byokKeyFormatError, normalizeByokAddress,
  parseByokConnectionInput, parseByokPolicy, type ByokConnectionInput, type ByokPolicy, type ByokProtocol,
} from './config';
import { probeByokConnection, testByokModel } from './probe';
import { ByokKeyError } from './secrets.server';
import {
  ByokError, createByokConnection, deleteByokConnection, listByokConnections, storedConnectionKey, updateByokConnection,
} from './store.server';

/** Feature switch for own models; fail closed when the state cannot be read. */
export async function byokGate(): Promise<Response | null> {
  const state = await readFeatureModuleStateFresh('byok');
  if (state.status === 'enabled') return null;
  if (state.status === 'unavailable') return jsonError('功能状态暂时无法确认，请稍后重试', 503, { code: 'FEATURE_STATE_UNAVAILABLE' });
  return jsonError('自定义模型功能当前未启用', 403, { code: 'FEATURE_DISABLED' });
}

const PROBE_RATE_LIMIT = { endpoint: '/api/byok/probe', maxRequests: 20, windowMs: 60_000 } as const;
const CAPABILITIES_RATE_LIMIT = { endpoint: '/api/byok/capabilities', maxRequests: 30, windowMs: 60_000 } as const;

const readBody = async (request: NextRequest) => {
  const parsed = await readJsonBody(request, 256 * 1024);
  if ('error' in parsed) throw new ByokInputError(parsed.error.message, parsed.error.status);
  return parsed.body;
};

async function member(request: NextRequest) {
  const gate = await byokGate();
  if (gate) return gate;
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  const expected = request.headers.get('X-Expected-User-Id');
  if (expected !== null && expected !== auth.user.id) return jsonError('账号已切换', 409);
  return auth;
}

function failure(error: unknown, action: string): Response {
  if (error instanceof ByokInputError) return jsonError(error.message, error.status, { code: 'BYOK_INVALID' });
  if (error instanceof ByokError) return jsonError(error.message, error.status, { code: error.code });
  if (error instanceof ByokKeyError) return jsonError('保存的 Key 无法读取，请重新填写', 409, { code: 'BYOK_KEY_INVALID' });
  console.error('[byok]', { action, code: toDbError(error).code });
  return jsonError(`${action}失败`, 500);
}

/** A key stored here is only used for public addresses: the site's own network is not the member's to reach. */
function checkServerAddress(input: Partial<ByokConnectionInput>, storing: boolean) {
  if (!storing || !input.baseUrl) return;
  try {
    validateAgentProviderUrl(input.baseUrl);
  } catch (error) {
    throw new ByokInputError(error instanceof Error ? error.message : '接口地址无效');
  }
}

export async function listConnections(request: NextRequest) {
  const auth = await member(request);
  if (auth instanceof Response) return auth;
  try {
    const [connections, policy] = await Promise.all([listByokConnections(auth.db, auth.user.id), getByokPolicy()]);
    return jsonOk({ connections, policy });
  } catch (error) {
    return failure(error, '读取自定义模型');
  }
}

export async function createConnection(request: NextRequest) {
  const auth = await member(request);
  if (auth instanceof Response) return auth;
  try {
    const policy = await getByokPolicy();
    const input = parseByokConnectionInput(await readBody(request), { partial: false, maxModels: policy.maxModelsPerConnection });
    checkServerAddress(input, input.key.store);
    return jsonOk({ connection: await createByokConnection(auth.db, auth.user.id, input, policy) }, 201);
  } catch (error) {
    return failure(error, '保存连接');
  }
}

export async function updateConnection(request: NextRequest, id: string) {
  if (!isValidUUID(id)) return jsonError('连接标识无效', 400);
  const auth = await member(request);
  if (auth instanceof Response) return auth;
  try {
    const [policy, connections] = await Promise.all([
      getByokPolicy(),
      listByokConnections(auth.db, auth.user.id),
    ]);
    const current = connections.find(connection => connection.id === id);
    if (!current) return jsonError('连接不存在', 404);
    const input = parseByokConnectionInput(await readBody(request), { partial: true, maxModels: policy.maxModelsPerConnection, protocol: current.protocol });
    const storing = input.key ? input.key.store : !!current.keyHint;
    checkServerAddress({ baseUrl: input.baseUrl ?? current.baseUrl }, storing);
    const connection = await updateByokConnection(auth.db, auth.user.id, id, input, policy);
    if (!connection) return jsonError('连接不存在', 404);
    return jsonOk({ connection });
  } catch (error) {
    return failure(error, '保存连接');
  }
}

export async function deleteConnection(request: NextRequest, id: string) {
  if (!isValidUUID(id)) return jsonError('连接标识无效', 400);
  const auth = await member(request);
  if (auth instanceof Response) return auth;
  try {
    if (!(await deleteByokConnection(auth.db, auth.user.id, id))) return jsonError('连接不存在', 404);
    return jsonOk({ deleted: true });
  } catch (error) {
    return failure(error, '删除连接');
  }
}

type ProbeRequest = {
  connectionId: string | null;
  protocol: ByokProtocol;
  baseUrl: string;
  apiKey: string | null;
  action: 'models' | 'chat';
  modelId: string;
  effort: AIReasoningEffort | null;
};

function parseProbe(value: unknown): ProbeRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ByokInputError('测试请求无效');
  const input = value as Record<string, unknown>;
  const connectionId = input.connectionId === undefined || input.connectionId === null ? null : input.connectionId;
  if (connectionId !== null && (typeof connectionId !== 'string' || !isValidUUID(connectionId))) throw new ByokInputError('连接标识无效');
  if (!BYOK_PROTOCOLS.includes(input.protocol as ByokProtocol)) throw new ByokInputError('协议无效');
  const address = typeof input.baseUrl === 'string' ? input.baseUrl : '';
  const addressError = byokAddressError(address);
  if (addressError) throw new ByokInputError(addressError);
  const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : null;
  const keyError = apiKey ? byokKeyFormatError(apiKey) : null;
  if (keyError) throw new ByokInputError(keyError);
  const action = input.action === 'chat' ? 'chat' : input.action === 'models' ? 'models' : null;
  if (!action) throw new ByokInputError('测试类型无效');
  const modelId = typeof input.modelId === 'string' ? input.modelId.trim() : '';
  if (action === 'chat' && (!modelId || modelId.length > BYOK_MODEL_ID_MAX)) throw new ByokInputError('请填写模型 ID');
  const effort = input.effort === undefined || input.effort === null ? null : input.effort;
  if (effort !== null && !AI_REASONING_EFFORTS.includes(effort as AIReasoningEffort)) throw new ByokInputError('努力程度无效');
  return {
    connectionId, protocol: input.protocol as ByokProtocol, baseUrl: normalizeByokAddress(address), apiKey, action, modelId,
    effort: effort as AIReasoningEffort | null,
  };
}

/**
 * Tests a connection whose calls this site makes: with the key just typed, or the one stored. A failed test is still a
 * successful request; the provider's status and text travel in the body.
 */
export async function probe(request: NextRequest) {
  const auth = await member(request);
  if (auth instanceof Response) return auth;
  try {
    const policy: ByokPolicy = await getByokPolicy();
    if (!policy.allowServerKeys) return jsonError('管理员已关闭「保存到本站」，请在浏览器里直接测试', 403, { code: 'BYOK_SERVER_KEYS_DISABLED' });
    if (!(await checkRateLimit(auth.user.id, PROBE_RATE_LIMIT.endpoint, PROBE_RATE_LIMIT)).allowed) return jsonError('测试过于频繁，请稍后再试', 429);
    const input = parseProbe(await readBody(request));
    checkServerAddress(input, true);
    let apiKey = input.apiKey;
    if (!apiKey && input.connectionId) {
      const stored = await storedConnectionKey(auth.db, auth.user.id, input.connectionId, policy);
      // The stored key is bound to its host: testing it against another one would hand it to that host.
      if (stored && new URL(stored.connection.baseUrl).host === new URL(input.baseUrl).host) apiKey = stored.key;
    }
    if (!apiKey) return jsonError('请填写 API Key', 400, { code: 'BYOK_KEY_REQUIRED' });
    const options = { fetch: agentSafeFetch, signal: request.signal, userAgent: MODEL_REQUEST_USER_AGENT };
    if (input.action === 'models') return jsonOk(await probeByokConnection(input.protocol, input.baseUrl, apiKey, options));
    return jsonOk(await testByokModel({
      protocol: input.protocol, baseUrl: input.baseUrl, modelId: input.modelId, supportsVision: false, contextWindow: null, maxOutput: null,
    }, apiKey, input.effort, options));
  } catch (error) {
    if (request.signal.aborted) return jsonError('测试已取消', 499);
    return failure(error, '测试连接');
  }
}

/** What models.dev knows of each model ID: context, output limit, image input and thinking levels. */
export async function capabilities(request: NextRequest) {
  const auth = await member(request);
  if (auth instanceof Response) return auth;
  if (!(await checkRateLimit(auth.user.id, CAPABILITIES_RATE_LIMIT.endpoint, CAPABILITIES_RATE_LIMIT)).allowed) return jsonError('请求过于频繁，请稍后再试', 429);
  let body: { modelIds?: unknown } | null;
  try {
    body = await readBody(request) as { modelIds?: unknown } | null;
  } catch (error) {
    return failure(error, '读取模型能力');
  }
  const ids = Array.isArray(body?.modelIds) ? body.modelIds.filter((id): id is string => typeof id === 'string' && !!id.trim() && id.length <= BYOK_MODEL_ID_MAX).slice(0, 200) : [];
  if (!ids.length) return jsonOk({ models: {} });
  let catalog;
  try {
    catalog = await allModelsDevModels();
  } catch {
    return jsonOk({ models: {}, unavailable: true });
  }
  const models: Record<string, { contextWindow: number | null; maxOutput: number | null; vision: boolean; thinkingLevels: AIReasoningEffort[] }> = {};
  for (const id of ids) {
    const match = exactModelsDevMatch(catalog, [id]);
    if (!match) continue;
    models[id] = {
      contextWindow: match.contextWindow ?? null,
      maxOutput: match.maxTokens ?? null,
      vision: match.vision,
      thinkingLevels: match.reasoning ? match.thinkingLevels : [],
    };
  }
  return jsonOk({ models });
}

export async function readPolicy(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  try {
    return jsonOk({ policy: await getByokPolicy() });
  } catch (error) {
    return failure(error, '读取自定义模型策略');
  }
}

export async function savePolicy(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  let policy: ByokPolicy;
  try {
    policy = parseByokPolicy((await readBody(request) as { policy?: unknown } | null)?.policy);
  } catch (error) {
    if (error instanceof ByokInputError) return failure(error, '保存自定义模型策略');
    return jsonError(error instanceof Error ? error.message : '策略格式无效', 400);
  }
  try {
    await setByokPolicy(policy);
    return jsonOk({ policy });
  } catch (error) {
    return failure(error, '保存自定义模型策略');
  }
}
