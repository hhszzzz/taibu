import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ScopedDb, ScopedDbTransaction } from '@/lib/db/context.server';
import { arrayValue, json, lockTransactionKey } from '@/lib/db/sql-helpers';
import { normalizeThinkingLevels } from '@/lib/ai/thinking';
import {
  byokHost, byokRef, isByokDefaultEffort, parseByokRef, usesServerKey,
  type ByokConnectionInput, type ByokConnectionView, type ByokModelInput, type ByokModelView, type ByokPolicy, type ByokProtocol,
  type ByokUsage,
} from './config';
import { openByokKey, sealByokKey } from './secrets.server';

interface ConnectionRow {
  id: string;
  user_id: string;
  name: string;
  protocol: string;
  base_url: string;
  api_key_secret: unknown;
  api_key_hint: string | null;
  sort_order: number;
  updated_at: string;
}

interface ModelRow {
  id: string;
  connection_id: string;
  model_id: string;
  display_name: string;
  usage: string;
  supports_vision: boolean;
  thinking_levels: unknown;
  default_effort: string;
  context_window: number | null;
  max_output: number | null;
  sort_order: number;
}

/** A refusal with the status and message the settings page shows. */
export class ByokError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'BYOK_INVALID') {
    super(message);
  }
}

/** Namespace of the per-member connection quota lock (see lockTransactionKey). */
const QUOTA_LOCK = 914;

function modelView(row: ModelRow): ByokModelView {
  return {
    id: row.id, ref: byokRef(row.id), modelId: row.model_id, displayName: row.display_name,
    usage: row.usage as ByokUsage, supportsVision: row.supports_vision, thinkingLevels: normalizeThinkingLevels(row.thinking_levels),
    defaultEffort: isByokDefaultEffort(row.default_effort) ? row.default_effort : 'auto',
    contextWindow: row.context_window, maxOutput: row.max_output,
  };
}

function connectionView(row: ConnectionRow, models: ModelRow[]): ByokConnectionView {
  return {
    id: row.id, name: row.name, protocol: row.protocol as ByokProtocol, baseUrl: row.base_url, keyHint: row.api_key_hint,
    models: models.filter(model => model.connection_id === row.id).sort((a, b) => a.sort_order - b.sort_order).map(modelView),
    updatedAt: row.updated_at,
  };
}

const CONNECTION_COLUMNS = ['id', 'user_id', 'name', 'protocol', 'base_url', 'api_key_secret', 'api_key_hint', 'sort_order', 'updated_at'] as const;
const MODEL_COLUMNS = ['id', 'connection_id', 'model_id', 'display_name', 'usage', 'supports_vision', 'thinking_levels', 'default_effort', 'context_window', 'max_output', 'sort_order'] as const;

/** A member's connections with their models, as the settings page and the model menus read them. */
export async function listByokConnections(db: ScopedDb, userId: string): Promise<ByokConnectionView[]> {
  const [connections, models] = await db.tx(async (trx) => Promise.all([
    trx.selectFrom('user_ai_connections').select(CONNECTION_COLUMNS).where('user_id', '=', userId)
      .orderBy('sort_order').orderBy('created_at').execute(),
    trx.selectFrom('user_ai_models').select(MODEL_COLUMNS).where('user_id', '=', userId).execute(),
  ]));
  return (connections as unknown as ConnectionRow[]).map(row => connectionView(row, models as unknown as ModelRow[]));
}

function modelValues(userId: string, connectionId: string, model: ByokModelInput, index: number) {
  return {
    connection_id: connectionId, user_id: userId, model_id: model.modelId, display_name: model.displayName, usage: model.usage,
    supports_vision: model.supportsVision, thinking_levels: arrayValue(model.thinkingLevels) as never, default_effort: model.defaultEffort,
    context_window: model.contextWindow, max_output: model.maxOutput, sort_order: index,
  };
}

/**
 * Replaces a connection's models. A model keeps its row (and every reference to it) while its model ID and use stay the
 * same; one whose ID or use changed is a new model, so a swap of two IDs never collides on the unique pair.
 */
async function replaceModels(trx: ScopedDbTransaction, userId: string, connectionId: string, models: ByokModelInput[]) {
  const existing = await trx.selectFrom('user_ai_models').select(['id', 'model_id', 'usage'])
    .where('connection_id', '=', connectionId).where('user_id', '=', userId).execute();
  const keep = new Map<string, string>();
  for (const model of models) {
    const row = model.id ? existing.find(item => item.id === model.id) : undefined;
    if (row && row.model_id === model.modelId && row.usage === model.usage) keep.set(row.id, row.id);
  }
  const removed = existing.filter(row => !keep.has(row.id)).map(row => row.id);
  if (removed.length) await trx.deleteFrom('user_ai_models').where('id', 'in', removed).execute();
  for (const [index, model] of models.entries()) {
    const values = modelValues(userId, connectionId, model, index);
    if (model.id && keep.has(model.id)) {
      await trx.updateTable('user_ai_models').set(values).where('id', '=', model.id).execute();
    } else {
      await trx.insertInto('user_ai_models').values({ id: randomUUID(), ...values }).execute();
    }
  }
}

function assertImageModels(protocol: ByokProtocol, models: Array<Pick<ByokModelInput, 'usage'>>) {
  if (protocol === 'anthropic' && models.some(model => model.usage === 'image')) throw new ByokError('Anthropic 连接不能添加生图模型');
}

function serverKeysAllowed(policy: ByokPolicy) {
  if (!policy.allowServerKeys) throw new ByokError('管理员已关闭「保存到本站」，Key 只能保存在你的浏览器里', 403, 'BYOK_SERVER_KEYS_DISABLED');
}

/** Adds a connection under the member's quota; the id is chosen here because a stored key is sealed to it. */
export async function createByokConnection(db: ScopedDb, userId: string, input: ByokConnectionInput, policy: ByokPolicy): Promise<ByokConnectionView> {
  assertImageModels(input.protocol, input.models);
  const id = randomUUID();
  let sealed: ReturnType<typeof sealByokKey> | null = null;
  if (input.key.store) {
    serverKeysAllowed(policy);
    if (!input.key.value) throw new ByokError('打开「保存到本站」时需要填写 API Key');
    sealed = sealByokKey({ userId, connectionId: id, host: byokHost(input.baseUrl) }, input.key.value);
  }
  await db.tx(async (trx) => {
    await lockTransactionKey(trx, userId, QUOTA_LOCK);
    const { count, max } = await trx.selectFrom('user_ai_connections')
      .select([
        (eb) => eb.fn.countAll<string>().as('count'),
        (eb) => eb.fn.max('sort_order').as('max'),
      ])
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    if (Number(count) >= policy.maxConnections) throw new ByokError(`最多保存 ${policy.maxConnections} 个连接`, 409, 'BYOK_LIMIT');
    await trx.insertInto('user_ai_connections').values({
      id, user_id: userId, name: input.name, protocol: input.protocol, base_url: input.baseUrl,
      api_key_secret: sealed ? json(sealed.secret) as never : null, api_key_hint: sealed?.hint ?? null,
      sort_order: Number(max ?? -1) + 1,
    }).execute();
    await replaceModels(trx, userId, id, input.models);
  });
  const created = (await listByokConnections(db, userId)).find(connection => connection.id === id);
  if (!created) throw new ByokError('保存连接失败', 500, 'BYOK_FAILED');
  return created;
}

/**
 * Edits a connection. A stored key is bound to the host, so moving the address to another host needs the key again
 * (or the key kept in browsers only).
 */
export async function updateByokConnection(
  db: ScopedDb, userId: string, id: string, input: Partial<ByokConnectionInput>, policy: ByokPolicy,
): Promise<ByokConnectionView | undefined> {
  const found = await db.tx(async (trx) => {
    const current = await trx.selectFrom('user_ai_connections').select(CONNECTION_COLUMNS)
      .where('id', '=', id).where('user_id', '=', userId).forUpdate().executeTakeFirst() as unknown as ConnectionRow | undefined;
    if (!current) return false;
    const protocol = input.protocol ?? current.protocol as ByokProtocol;
    const baseUrl = input.baseUrl ?? current.base_url;
    const hostChanged = byokHost(baseUrl) !== byokHost(current.base_url);
    let secret: { value: unknown; hint: string | null } | undefined;
    if (input.key && !input.key.store) secret = { value: null, hint: null };
    else if (input.key?.store && input.key.value) {
      serverKeysAllowed(policy);
      const sealed = sealByokKey({ userId, connectionId: id, host: byokHost(baseUrl) }, input.key.value);
      secret = { value: sealed.secret, hint: sealed.hint };
    } else if (input.key?.store && !current.api_key_hint) {
      throw new ByokError('打开「保存到本站」时需要填写 API Key');
    } else if (hostChanged && current.api_key_hint) {
      throw new ByokError('接口地址换了域名，请重新填写 API Key');
    }
    if (input.models) assertImageModels(protocol, input.models);
    else if (input.protocol === 'anthropic') {
      const image = await trx.selectFrom('user_ai_models').select('id').where('connection_id', '=', id).where('usage', '=', 'image').executeTakeFirst();
      if (image) throw new ByokError('Anthropic 连接不能添加生图模型');
    }
    await trx.updateTable('user_ai_connections').set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
      ...(input.baseUrl !== undefined ? { base_url: input.baseUrl } : {}),
      ...(secret ? { api_key_secret: secret.value === null ? null : json(secret.value) as never, api_key_hint: secret.hint } : {}),
      // A save always marks the connection changed, also when only its models changed.
      updated_at: new Date().toISOString(),
    }).where('id', '=', id).execute();
    if (input.models) await replaceModels(trx, userId, id, input.models);
    return true;
  });
  if (!found) return undefined;
  return (await listByokConnections(db, userId)).find(connection => connection.id === id);
}

export async function deleteByokConnection(db: ScopedDb, userId: string, id: string): Promise<boolean> {
  const deleted = await db.tx((trx) => trx.deleteFrom('user_ai_connections').where('id', '=', id).where('user_id', '=', userId)
    .returning('id').execute());
  return deleted.length > 0;
}

/** The stored key of a connection, for a test before the member saves a new one. */
export async function storedConnectionKey(db: ScopedDb, userId: string, id: string, policy: ByokPolicy): Promise<{ key: string; connection: ByokConnectionView } | null> {
  const row = await db.tx((trx) => trx.selectFrom('user_ai_connections').select(CONNECTION_COLUMNS)
    .where('id', '=', id).where('user_id', '=', userId).executeTakeFirst()) as unknown as ConnectionRow | undefined;
  if (!row?.api_key_hint || !policy.allowServerKeys) return null;
  return { key: openByokKey({ userId, connectionId: row.id, host: byokHost(row.base_url) }, row.api_key_secret), connection: connectionView(row, []) };
}

/** An own model as a request needs it: the model, its connection, and the stored key when the site may use it. */
export interface ResolvedByokModel extends ByokModelView {
  connection: Omit<ByokConnectionView, 'models'>;
  /** Whether the site sends this model's requests (the key is stored and stored keys are allowed). */
  serverKey: boolean;
  /** Opens the stored key; throws ByokKeyError when it does not open. Null without a usable stored key. */
  openKey: () => string | null;
}

/** The own models these references name, keyed by reference; references to missing or foreign models are left out. */
export async function resolveByokModels(db: ScopedDb, userId: string, refs: readonly string[], policy: ByokPolicy): Promise<Map<string, ResolvedByokModel>> {
  const ids = [...new Set(refs.map(parseByokRef).filter((id): id is string => !!id))];
  if (!ids.length) return new Map();
  const models = await db.tx((trx) => trx.selectFrom('user_ai_models').select(MODEL_COLUMNS)
    .where('id', 'in', ids).where('user_id', '=', userId).execute()) as unknown as ModelRow[];
  const connectionIds = [...new Set(models.map(model => model.connection_id))];
  const connections = connectionIds.length ? await db.tx((trx) => trx.selectFrom('user_ai_connections').select(CONNECTION_COLUMNS)
    .where('id', 'in', connectionIds).where('user_id', '=', userId).execute()) as unknown as ConnectionRow[] : [];
  const resolved = new Map<string, ResolvedByokModel>();
  for (const model of models) {
    const row = connections.find(connection => connection.id === model.connection_id);
    if (!row) continue;
    const connection = { id: row.id, name: row.name, protocol: row.protocol as ByokProtocol, baseUrl: row.base_url, keyHint: row.api_key_hint, updatedAt: row.updated_at };
    const serverKey = usesServerKey(connection, policy);
    resolved.set(byokRef(model.id), {
      ...modelView(model), connection, serverKey,
      openKey: () => serverKey ? openByokKey({ userId, connectionId: row.id, host: byokHost(row.base_url) }, row.api_key_secret) : null,
    });
  }
  return resolved;
}

export async function resolveByokModel(db: ScopedDb, userId: string, ref: string, policy: ByokPolicy): Promise<ResolvedByokModel | null> {
  return (await resolveByokModels(db, userId, [ref], policy)).get(ref) ?? null;
}

/** Why an own model cannot run from this server, as the member reads it; null when it can. */
export function byokServerUnavailable(model: ResolvedByokModel | null, usage: 'chat' | 'image' = 'chat'): string | null {
  if (!model) return '自定义模型不存在，可能已被删除';
  if (model.usage !== usage) return usage === 'chat' ? '这个自定义模型只用于生图' : '这个自定义模型不是生图模型';
  if (!model.serverKey) return '这个模型的 Key 只保存在你的浏览器里，本站不能代为请求';
  return null;
}
