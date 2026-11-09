/**
 * 自定义模型（BYOK）的约定，浏览器与服务端共用：连接与模型的形状、地址规则、思考强度语义、报错格式与管理端策略。
 *
 * 一个连接是一个服务商地址（OpenAI 兼容或 Anthropic Messages）加若干模型；模型以 `byok:<模型行 ID>` 引用。
 * Key 默认只在用户浏览器里；连接打开「保存到本站」后才加密存库，该连接的调用改由本站服务器发起。
 */
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import { isPlainObject } from '@/lib/validation';

export const BYOK_PROTOCOLS = ['openai', 'anthropic'] as const;
export type ByokProtocol = (typeof BYOK_PROTOCOLS)[number];
export const BYOK_USAGES = ['chat', 'image'] as const;
export type ByokUsage = (typeof BYOK_USAGES)[number];
/** A model's default thinking: a level, `auto` (no thinking parameters: the model decides) or `off`. */
export type ByokDefaultEffort = AIReasoningEffort | 'auto' | 'off';

export const BYOK_PROTOCOL_LABELS: Record<ByokProtocol, string> = { openai: 'OpenAI 兼容', anthropic: 'Anthropic Messages' };
export const BYOK_NAME_MAX = 40;
export const BYOK_URL_MAX = 256;
export const BYOK_KEY_MAX = 512;
export const BYOK_MODEL_ID_MAX = 128;
export const BYOK_DISPLAY_NAME_MAX = 128;
/** Upstream error text shown to the user is cut here. */
export const BYOK_ERROR_TEXT_MAX = 600;
export const BYOK_CONTEXT_RANGE = { min: 1024, max: 10_000_000 } as const;
export const BYOK_OUTPUT_RANGE = { min: 1, max: 1_000_000 } as const;

// ─── References ───

const REF_PREFIX = 'byok:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function byokRef(modelRowId: string): string {
  return `${REF_PREFIX}${modelRowId}`;
}

/** The model row a reference names; null for a platform model key or anything malformed. */
export function parseByokRef(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(REF_PREFIX)) return null;
  const id = value.slice(REF_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

export function isByokRef(value: unknown): value is string {
  return parseByokRef(value) !== null;
}

/** Model keys an administrator may not take, so a platform key never reads as an own model. */
export function isReservedModelKey(key: string): boolean {
  return key.startsWith(REF_PREFIX) || key.startsWith('custom:');
}

// ─── Policy ───

export interface ByokPolicy {
  /** Whether members may store keys here; turned off, stored keys stay but are not used. */
  allowServerKeys: boolean;
  maxConnections: number;
  maxModelsPerConnection: number;
}

export const BYOK_POLICY_KEY = 'byok_policy';
export const DEFAULT_BYOK_POLICY: ByokPolicy = { allowServerKeys: true, maxConnections: 10, maxModelsPerConnection: 50 };
export const BYOK_CONNECTIONS_LIMIT = { min: 1, max: 100 } as const;
export const BYOK_MODELS_LIMIT = { min: 1, max: 200 } as const;

function limit(value: unknown, range: { min: number; max: number }): number | null {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number >= range.min && number <= range.max ? number : null;
}

/** The stored policy with defaults for anything missing or out of range. */
export function normalizeByokPolicy(value: unknown): ByokPolicy {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    allowServerKeys: typeof input.allowServerKeys === 'boolean' ? input.allowServerKeys : DEFAULT_BYOK_POLICY.allowServerKeys,
    maxConnections: limit(input.maxConnections, BYOK_CONNECTIONS_LIMIT) ?? DEFAULT_BYOK_POLICY.maxConnections,
    maxModelsPerConnection: limit(input.maxModelsPerConnection, BYOK_MODELS_LIMIT) ?? DEFAULT_BYOK_POLICY.maxModelsPerConnection,
  };
}

/** An administrator's edit; throws with the message to show when a value is out of range. */
export function parseByokPolicy(value: unknown): ByokPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ByokInputError('策略格式无效');
  const input = value as Record<string, unknown>;
  if (typeof input.allowServerKeys !== 'boolean') throw new ByokInputError('「允许保存到本站」须为开或关');
  const maxConnections = limit(input.maxConnections, BYOK_CONNECTIONS_LIMIT);
  if (maxConnections === null) throw new ByokInputError(`每人连接上限须为 ${BYOK_CONNECTIONS_LIMIT.min}–${BYOK_CONNECTIONS_LIMIT.max} 的整数`);
  const maxModelsPerConnection = limit(input.maxModelsPerConnection, BYOK_MODELS_LIMIT);
  if (maxModelsPerConnection === null) throw new ByokInputError(`每个连接的模型上限须为 ${BYOK_MODELS_LIMIT.min}–${BYOK_MODELS_LIMIT.max} 的整数`);
  return { allowServerKeys: input.allowServerKeys, maxConnections, maxModelsPerConnection };
}

// ─── Views ───

export interface ByokModelView {
  id: string;
  /** `byok:<id>`: how conversations, tasks and presets name this model. */
  ref: string;
  modelId: string;
  displayName: string;
  usage: ByokUsage;
  supportsVision: boolean;
  /** Known levels; empty when unknown, and the menu then offers all six. */
  thinkingLevels: AIReasoningEffort[];
  defaultEffort: ByokDefaultEffort;
  contextWindow: number | null;
  maxOutput: number | null;
}

export interface ByokConnectionView {
  id: string;
  name: string;
  protocol: ByokProtocol;
  baseUrl: string;
  /** What is shown of a key stored here (`sk-…abcd`); null when the key lives only in browsers. */
  keyHint: string | null;
  models: ByokModelView[];
  updatedAt: string;
}

export interface ByokCatalog {
  connections: ByokConnectionView[];
  policy: ByokPolicy;
}

/** What models.dev knows of a model ID, as the settings page fills a new model in. */
export type ByokCapability = { contextWindow: number | null; maxOutput: number | null; vision: boolean; thinkingLevels: AIReasoningEffort[] };

/** Whether the site sends this connection's requests: a key is stored and the administrator allows stored keys. */
export function usesServerKey(connection: Pick<ByokConnectionView, 'keyHint'>, policy: Pick<ByokPolicy, 'allowServerKeys'>): boolean {
  return !!connection.keyHint && policy.allowServerKeys;
}

// ─── Addresses ───

export interface ByokEndpoint {
  /** The SDK's base: chat goes to `${sdkBase}/chat/completions` (OpenAI) or `${sdkBase}/v1/messages` (Anthropic). */
  sdkBase: string;
  chatUrl: string;
  modelsUrl: string;
  /** OpenAI-compatible connections only. */
  imagesUrl: string | null;
}

const VERSION_SEGMENT = /\/v\d+/iu;

/**
 * The request addresses an entered address resolves to. OpenAI compatible: a full `…/chat/completions` address is used
 * as is; otherwise `/v1` is added when the path has no version segment (`/api/paas/v4` and `/v1beta/openai` keep theirs).
 * Anthropic: a trailing `/v1/messages` or `/v1` is dropped, since the SDK always requests `/v1/messages`.
 */
export function byokEndpoint(protocol: ByokProtocol, address: string): ByokEndpoint {
  const parsed = new URL(address.trim());
  parsed.search = '';
  parsed.hash = '';
  let path = parsed.pathname.replace(/\/+$/u, '');
  if (protocol === 'anthropic') {
    path = path.replace(/\/v1\/messages$/iu, '').replace(/\/v1$/iu, '');
    const base = `${parsed.origin}${path}`;
    return { sdkBase: base, chatUrl: `${base}/v1/messages`, modelsUrl: `${base}/v1/models`, imagesUrl: null };
  }
  if (/\/chat\/completions$/iu.test(path)) path = path.replace(/\/chat\/completions$/iu, '');
  else if (!VERSION_SEGMENT.test(path)) path = `${path}/v1`;
  const base = `${parsed.origin}${path}`;
  return { sdkBase: base, chatUrl: `${base}/chat/completions`, modelsUrl: `${base}/models`, imagesUrl: `${base}/images/generations` };
}

/**
 * The same OpenAI-compatible address with `/v1` before the endpoint added or removed, written as a full request URL so
 * it is used as is. Null when the address carries another version (`/v4`), where toggling `/v1` makes no sense.
 */
export function toggleV1Address(address: string): string | null {
  const { chatUrl } = byokEndpoint('openai', address);
  const url = new URL(chatUrl);
  if (/\/v1\/chat\/completions$/iu.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/v1\/chat\/completions$/iu, '/chat/completions');
  } else if (VERSION_SEGMENT.test(url.pathname.replace(/\/chat\/completions$/iu, ''))) {
    return null;
  } else {
    url.pathname = url.pathname.replace(/\/chat\/completions$/iu, '/v1/chat/completions');
  }
  return url.toString();
}

/** The protocol an address implies on its own, or null when any may apply. */
export function inferByokProtocol(address: string): ByokProtocol | null {
  try {
    return new URL(address.trim()).hostname.toLowerCase() === 'api.anthropic.com' ? 'anthropic' : null;
  } catch {
    return null;
  }
}

/** Null when the address can be saved; otherwise what is wrong with it. */
export function byokAddressError(address: string): string | null {
  const value = address.trim();
  if (!value) return '请填写接口地址';
  if (value.length > BYOK_URL_MAX) return '接口地址过长';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return '接口地址格式无效';
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) return '仅支持 HTTPS 地址';
  if (parsed.username || parsed.password) return '接口地址不应包含认证信息';
  if (parsed.search || parsed.hash) return '接口地址不应包含查询参数或片段';
  return null;
}

/** The address as stored: trimmed, without trailing slashes. */
export function normalizeByokAddress(address: string): string {
  return address.trim().replace(/\/+$/u, '');
}

export function byokHost(address: string): string {
  return new URL(address).host.toLowerCase();
}

/** What is shown of a key: enough to tell two keys apart, never enough to use one. */
export function byokKeyHint(key: string): string {
  return key.length >= 12 ? `${key.slice(0, 3)}…${key.slice(-4)}` : `…${key.slice(-2)}`;
}

/** Why a trimmed key cannot be saved, or null when it can. */
export function byokKeyFormatError(key: string): string | null {
  return key.length > BYOK_KEY_MAX || /\s/u.test(key) ? 'API Key 格式无效' : null;
}

// ─── Effort ───

/** The levels the effort menu offers: the known ones, or all six when nothing is known. */
export function byokEffortLevels(levels: readonly AIReasoningEffort[]): AIReasoningEffort[] {
  return levels.length ? AI_REASONING_EFFORTS.filter(level => levels.includes(level)) : [...AI_REASONING_EFFORTS];
}

/** A new model's default: medium, or the highest level offered when medium is not. */
export function defaultByokEffort(levels: readonly AIReasoningEffort[]): AIReasoningEffort {
  const offered = byokEffortLevels(levels);
  return offered.includes('medium') ? 'medium' : offered[offered.length - 1];
}

/** A level the model offers: an unlisted one moves to the nearest listed level, upwards first. */
export function clampByokLevel(levels: readonly AIReasoningEffort[], level: AIReasoningEffort): AIReasoningEffort {
  const offered = byokEffortLevels(levels);
  if (offered.includes(level)) return level;
  const index = AI_REASONING_EFFORTS.indexOf(level);
  return AI_REASONING_EFFORTS.slice(index).find(item => offered.includes(item))
    ?? [...AI_REASONING_EFFORTS.slice(0, index)].reverse().find(item => offered.includes(item))
    ?? offered[0];
}

/** How a request thinks: at a level, the model's own default (no parameters), or explicitly off. */
export type ByokThinking = { mode: 'level'; level: AIReasoningEffort } | { mode: 'auto' } | { mode: 'off' };

/** The composer's switch and level, read for an own model: off, on without a level (the model's default), or a level. */
export function byokThinking(
  reasoning: boolean, effort: AIReasoningEffort | null | undefined, levels: readonly AIReasoningEffort[] = [],
  defaultEffort: ByokDefaultEffort = 'auto',
): ByokThinking {
  if (!reasoning) return { mode: 'off' };
  if (effort) return { mode: 'level', level: clampByokLevel(levels, effort) };
  if (defaultEffort === 'auto' || defaultEffort === 'off') return { mode: 'auto' };
  return { mode: 'level', level: clampByokLevel(levels, defaultEffort) };
}

/** The composer state a model's default selects, applied when the user switches to that model. */
export function byokComposerEffort(defaultEffort: ByokDefaultEffort): { reasoning: boolean; reasoningEffort: AIReasoningEffort | null } {
  if (defaultEffort === 'off') return { reasoning: false, reasoningEffort: null };
  if (defaultEffort === 'auto') return { reasoning: true, reasoningEffort: null };
  return { reasoning: true, reasoningEffort: defaultEffort };
}

export function isByokDefaultEffort(value: unknown): value is ByokDefaultEffort {
  return value === 'auto' || value === 'off' || AI_REASONING_EFFORTS.includes(value as AIReasoningEffort);
}

// ─── Errors ───

/** A failed call as it reached us: the provider's status and text, or a transport failure. */
export interface ByokFailure {
  status?: number | null;
  text?: string | null;
  kind?: 'network' | 'timeout' | 'redirect' | 'private' | 'aborted';
}

/** pi-ai writes provider failures as `401 …` or `401: …`; transport failures carry the SDK's words. */
export function byokFailureFromMessage(message: string | null | undefined): ByokFailure {
  const text = (message ?? '').trim();
  const status = /^(\d{3})\b[:\s]*/u.exec(text);
  if (status) return { status: Number(status[1]), text: text.slice(status[0].length) };
  if (/timed? ?out|timeout/iu.test(text)) return { kind: 'timeout', text };
  if (/重定向/u.test(text)) return { kind: 'redirect', text };
  if (/AGENT_PRIVATE_ADDRESS_BLOCKED|公开 HTTPS/u.test(text)) return { kind: 'private', text };
  if (/connection error|failed to fetch|networkerror|load failed|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/iu.test(text)) return { kind: 'network', text };
  return { text };
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length > BYOK_ERROR_TEXT_MAX ? `${flat.slice(0, BYOK_ERROR_TEXT_MAX)}…` : flat;
}

/** One Chinese sentence on what to try next. `browser`: the call went straight from the user's browser. */
export function byokErrorHint(failure: ByokFailure, options: { browser?: boolean } = {}): string {
  switch (failure.kind) {
    case 'network':
      return options.browser
        ? '浏览器直连失败：服务商可能不允许跨域（CORS），或网络不通。可以在「设置 → 自定义模型」打开「保存到本站」，改由本站服务器请求。'
        : '连不上服务商：检查接口地址是否正确、是否对公网开放。';
    case 'timeout': return '服务商长时间没有响应，稍后再试。';
    case 'redirect': return '服务商返回了重定向：请填写最终的接口地址。';
    case 'private': return '接口地址指向内网或本机，本站服务器不能访问；请改用公网地址，或关闭「保存到本站」从浏览器直连。';
    case 'aborted': return '请求已取消。';
  }
  const status = failure.status ?? 0;
  if (status === 401 || status === 403) return 'Key 无效、已过期，或没有这个模型的权限。';
  if (status === 404) return '地址或模型 ID 不对：检查接口地址（是否需要 /v1）与模型 ID。';
  if (status === 402) return '服务商账户余额不足。';
  if (status === 429) return '请求太频繁或额度已用完，稍后再试，或检查服务商的余额与限额。';
  if (status === 400 || status === 422) return '请求被拒绝：模型可能不支持当前的思考强度、图片或工具；可以把思考强度改成「模型默认」，或换个模型。';
  if (status === 413) return '请求内容太长，超出了模型的上下文。';
  if (status >= 500) return '服务商暂时不可用，稍后再试。';
  return '检查接口地址、Key 与模型 ID。';
}

/** What the user reads: `HTTP 401 · 上游原文`, then the hint on its own line. */
export function formatByokError(failure: ByokFailure, options: { browser?: boolean } = {}): string {
  const text = failure.text ? truncate(failure.text) : '';
  const head = failure.status ? `HTTP ${failure.status}${text ? ` · ${text}` : ''}` : text || '自定义模型请求失败';
  return `${head}\n${byokErrorHint(failure, options)}`;
}

/** A failed own-model call; its message is already what the user reads, so error mapping passes it through. */
export class ByokRequestError extends Error {
  readonly failure: ByokFailure;
  constructor(failure: ByokFailure, options: { browser?: boolean } = {}) {
    super(formatByokError(failure, options));
    this.name = 'ByokRequestError';
    this.failure = failure;
  }
}

// ─── Input ───

export class ByokInputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface ByokModelInput {
  /** An existing model of the connection keeps its id, so references to it stay valid. */
  id?: string;
  modelId: string;
  displayName: string;
  usage: ByokUsage;
  supportsVision: boolean;
  thinkingLevels: AIReasoningEffort[];
  defaultEffort: ByokDefaultEffort;
  contextWindow: number | null;
  maxOutput: number | null;
}

/** `store: false` keeps the key in browsers only; `store: true` without a value keeps the key already stored. */
export type ByokKeyInput = { store: false } | { store: true; value?: string };

export interface ByokConnectionInput {
  name: string;
  protocol: ByokProtocol;
  baseUrl: string;
  key: ByokKeyInput;
  models: ByokModelInput[];
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new ByokInputError(`请填写${field}`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ByokInputError(`${field}不能超过 ${max} 个字符`);
  return trimmed;
}

function capacity(value: unknown, field: string, range: { min: number; max: number }): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < range.min || number > range.max) {
    throw new ByokInputError(`${field}须为 ${range.min}–${range.max} 的整数`);
  }
  return number;
}

function parseModel(value: unknown, protocol: ByokProtocol): ByokModelInput {
  if (!isPlainObject(value)) throw new ByokInputError('模型配置无效');
  const modelId = text(value.modelId, '模型 ID', BYOK_MODEL_ID_MAX);
  const usage = value.usage === undefined ? 'chat' : value.usage;
  if (!BYOK_USAGES.includes(usage as ByokUsage)) throw new ByokInputError(`「${modelId}」的用途无效`);
  if (usage === 'image' && protocol === 'anthropic') throw new ByokInputError('Anthropic 连接不能添加生图模型');
  const displayName = typeof value.displayName === 'string' && value.displayName.trim()
    ? text(value.displayName, '显示名称', BYOK_DISPLAY_NAME_MAX) : modelId;
  const id = value.id === undefined || value.id === null ? undefined : value.id;
  if (id !== undefined && (typeof id !== 'string' || !UUID.test(id))) throw new ByokInputError('模型标识无效');
  if (usage === 'image') {
    return { ...(id ? { id: id.toLowerCase() } : {}), modelId, displayName, usage, supportsVision: false, thinkingLevels: [], defaultEffort: 'auto', contextWindow: null, maxOutput: null };
  }
  const levels = Array.isArray(value.thinkingLevels) ? value.thinkingLevels : [];
  if (levels.some(level => !AI_REASONING_EFFORTS.includes(level as AIReasoningEffort))) throw new ByokInputError(`「${modelId}」的思考强度无效`);
  const thinkingLevels = AI_REASONING_EFFORTS.filter(level => levels.includes(level));
  const requested = value.defaultEffort === undefined ? defaultByokEffort(thinkingLevels) : value.defaultEffort;
  if (!isByokDefaultEffort(requested)) throw new ByokInputError(`「${modelId}」的默认思考强度无效`);
  const defaultEffort = requested === 'auto' || requested === 'off' ? requested : clampByokLevel(thinkingLevels, requested);
  const contextWindow = capacity(value.contextWindow, `「${modelId}」的上下文`, BYOK_CONTEXT_RANGE);
  const maxOutput = capacity(value.maxOutput, `「${modelId}」的输出上限`, BYOK_OUTPUT_RANGE);
  return {
    ...(id ? { id: id.toLowerCase() } : {}), modelId, displayName, usage: 'chat', supportsVision: value.supportsVision === true,
    thinkingLevels, defaultEffort, contextWindow, maxOutput,
  };
}

function parseModels(value: unknown, protocol: ByokProtocol, maxModels: number): ByokModelInput[] {
  if (!Array.isArray(value)) throw new ByokInputError('模型列表无效');
  if (value.length > maxModels) throw new ByokInputError(`每个连接最多 ${maxModels} 个模型`);
  const models = value.map(item => parseModel(item, protocol));
  const seen = new Set<string>();
  for (const model of models) {
    const key = `${model.usage}:${model.modelId}`;
    if (seen.has(key)) throw new ByokInputError(`模型「${model.modelId}」重复添加了`);
    seen.add(key);
  }
  return models;
}

function parseKey(value: unknown): ByokKeyInput {
  if (!isPlainObject(value) || typeof value.store !== 'boolean') throw new ByokInputError('Key 设置无效');
  if (!value.store) return { store: false };
  if (value.value === undefined || value.value === null) return { store: true };
  if (typeof value.value !== 'string' || !value.value.trim()) throw new ByokInputError('请填写 API Key');
  const key = value.value.trim();
  const formatError = byokKeyFormatError(key);
  if (formatError) throw new ByokInputError(formatError);
  return { store: true, value: key };
}

/**
 * A connection as the settings page saves it. `partial` (an edit) leaves out what was not sent; the model list, when
 * sent, replaces the connection's models.
 */
export function parseByokConnectionInput(value: unknown, options: { partial: true; maxModels: number; protocol?: ByokProtocol }): Partial<ByokConnectionInput>;
export function parseByokConnectionInput(value: unknown, options: { partial: false; maxModels: number }): ByokConnectionInput;
export function parseByokConnectionInput(value: unknown, options: { partial: boolean; maxModels: number; protocol?: ByokProtocol }): Partial<ByokConnectionInput> {
  if (!isPlainObject(value)) throw new ByokInputError('连接配置无效');
  const result: Partial<ByokConnectionInput> = {};
  if (!options.partial || value.name !== undefined) result.name = text(value.name, '连接名称', BYOK_NAME_MAX);
  if (!options.partial || value.protocol !== undefined) {
    if (!BYOK_PROTOCOLS.includes(value.protocol as ByokProtocol)) throw new ByokInputError('协议无效');
    result.protocol = value.protocol as ByokProtocol;
  }
  if (!options.partial || value.baseUrl !== undefined) {
    const address = typeof value.baseUrl === 'string' ? value.baseUrl : '';
    const error = byokAddressError(address);
    if (error) throw new ByokInputError(error);
    result.baseUrl = normalizeByokAddress(address);
  }
  if (!options.partial || value.key !== undefined) result.key = parseKey(value.key);
  if (!options.partial || value.models !== undefined) {
    result.models = parseModels(value.models, result.protocol ?? options.protocol ?? 'openai', options.maxModels);
  }
  return result;
}
