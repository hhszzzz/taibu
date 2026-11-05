/**
 * The settings page's editing state for one connection and the request body it saves; pure, so the rules the page
 * checks before saving are the server's rules seen from the browser.
 */
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import {
  BYOK_CONTEXT_RANGE, BYOK_MODEL_ID_MAX, BYOK_NAME_MAX, BYOK_OUTPUT_RANGE,
  byokAddressError, byokHost, byokKeyFormatError, clampByokLevel, defaultByokEffort, normalizeByokAddress,
  type ByokCapability, type ByokConnectionView, type ByokDefaultEffort, type ByokModelView, type ByokPolicy, type ByokProtocol,
  type ByokUsage,
} from './config';

export interface ByokModelDraft {
  /** Stable row key for the list. */
  key: string;
  /** The saved model row; references to it stay valid while its model ID and use stay the same. */
  id?: string;
  modelId: string;
  displayName: string;
  usage: ByokUsage;
  supportsVision: boolean;
  thinkingLevels: AIReasoningEffort[];
  defaultEffort: ByokDefaultEffort;
  /** Typed numbers; empty means unknown. */
  contextWindow: string;
  maxOutput: string;
}

export interface ByokConnectionDraft {
  id: string | null;
  name: string;
  protocol: ByokProtocol;
  baseUrl: string;
  /** The key just typed; empty keeps the one already kept (on the site or on this device). */
  key: string;
  storeOnSite: boolean;
  models: ByokModelDraft[];
}

/** What the page saves; `key` decides where the key lives. */
export type ByokConnectionBody = {
  name: string;
  protocol: ByokProtocol;
  baseUrl: string;
  key: { store: false } | { store: true; value?: string };
  models: Array<{
    id?: string;
    modelId: string;
    displayName: string;
    usage: ByokUsage;
    supportsVision: boolean;
    thinkingLevels: AIReasoningEffort[];
    defaultEffort: ByokDefaultEffort;
    contextWindow: number | null;
    maxOutput: number | null;
  }>;
};

let draftKey = 0;
const nextKey = () => `model-${++draftKey}`;

export function modelDraft(model: ByokModelView): ByokModelDraft {
  return {
    key: nextKey(), id: model.id, modelId: model.modelId, displayName: model.displayName, usage: model.usage,
    supportsVision: model.supportsVision, thinkingLevels: model.thinkingLevels, defaultEffort: model.defaultEffort,
    contextWindow: model.contextWindow ? String(model.contextWindow) : '', maxOutput: model.maxOutput ? String(model.maxOutput) : '',
  };
}

/** A connection as the editor opens it; a new one keeps its key on the device until the member chooses otherwise. */
export function connectionDraft(connection: ByokConnectionView | null): ByokConnectionDraft {
  if (!connection) return { id: null, name: '', protocol: 'openai', baseUrl: '', key: '', storeOnSite: false, models: [] };
  return {
    id: connection.id, name: connection.name, protocol: connection.protocol, baseUrl: connection.baseUrl, key: '',
    storeOnSite: !!connection.keyHint, models: connection.models.map(modelDraft),
  };
}

/** Image models in a provider's list, guessed by name so a pulled list lands under the right use. */
const IMAGE_MODEL = /(?:^|[/_.-])(?:dall-e|gpt-image|chatgpt-image|imagen|flux|seedream|cogview|kolors|wanx|wan2|stable-diffusion|sdxl|midjourney|ideogram|recraft)|image-(?:gen|preview)/iu;

export function guessUsage(modelId: string, protocol: ByokProtocol): ByokUsage {
  return protocol === 'openai' && IMAGE_MODEL.test(modelId) ? 'image' : 'chat';
}

/** A new model; what models.dev knows fills its limits, image input and thinking levels. */
export function newModelDraft(modelId: string, usage: ByokUsage, capability?: ByokCapability | null): ByokModelDraft {
  const levels = usage === 'chat' ? capability?.thinkingLevels ?? [] : [];
  return applyCapability({
    key: nextKey(), modelId, displayName: modelId, usage, supportsVision: false, thinkingLevels: levels,
    defaultEffort: usage === 'image' ? 'auto' : defaultByokEffort(levels), contextWindow: '', maxOutput: '',
  }, capability);
}

/** Fills what is still blank from models.dev; values the member typed are kept. */
export function applyCapability(model: ByokModelDraft, capability: ByokCapability | null | undefined): ByokModelDraft {
  if (!capability || model.usage === 'image') return model;
  const levels = model.thinkingLevels.length ? model.thinkingLevels : capability.thinkingLevels;
  return {
    ...model,
    supportsVision: model.supportsVision || capability.vision,
    thinkingLevels: levels,
    defaultEffort: model.defaultEffort === 'auto' || model.defaultEffort === 'off' ? model.defaultEffort : clampByokLevel(levels, model.defaultEffort),
    contextWindow: model.contextWindow || (capability.contextWindow ? String(capability.contextWindow) : ''),
    maxOutput: model.maxOutput || (capability.maxOutput ? String(capability.maxOutput) : ''),
  };
}

/** The connection name an address suggests: its host without `api.` and `www.`. */
export function nameFromAddress(address: string): string {
  try {
    return new URL(address.trim()).hostname.replace(/^(?:api|www)\./iu, '').slice(0, BYOK_NAME_MAX);
  } catch {
    return '';
  }
}

function capacity(value: string, label: string, range: { min: number; max: number }): number | null {
  if (!value.trim()) return null;
  const number = Number(value.trim());
  if (!Number.isInteger(number) || number < range.min || number > range.max) throw new Error(`${label}须为 ${range.min}–${range.max} 的整数`);
  return number;
}

/** Whether a saved key would be handed to another host: the key is bound to the host it was stored for. */
export function storedKeyMoves(draft: ByokConnectionDraft, saved: ByokConnectionView | null): boolean {
  if (!saved?.keyHint || byokAddressError(draft.baseUrl)) return false;
  return byokHost(normalizeByokAddress(draft.baseUrl)) !== byokHost(saved.baseUrl);
}

/** The body to save, or throws with the first problem as the member reads it. */
export function connectionBody(draft: ByokConnectionDraft, saved: ByokConnectionView | null, policy: ByokPolicy): ByokConnectionBody {
  const name = draft.name.trim() || nameFromAddress(draft.baseUrl);
  if (!name) throw new Error('请填写连接名称');
  if (name.length > BYOK_NAME_MAX) throw new Error(`连接名称不能超过 ${BYOK_NAME_MAX} 个字符`);
  const addressError = byokAddressError(draft.baseUrl);
  if (addressError) throw new Error(addressError);
  const key = draft.key.trim();
  const keyError = key ? byokKeyFormatError(key) : null;
  if (keyError) throw new Error(keyError);
  if (draft.storeOnSite) {
    if (!policy.allowServerKeys) throw new Error('管理员已关闭「保存到本站」，Key 只能保存在你的浏览器里');
    if (!key && !saved?.keyHint) throw new Error('打开「保存到本站」时需要填写 API Key');
    if (!key && storedKeyMoves(draft, saved)) throw new Error('接口地址换了域名，请重新填写 API Key');
  }
  if (draft.models.length > policy.maxModelsPerConnection) throw new Error(`每个连接最多 ${policy.maxModelsPerConnection} 个模型`);
  const seen = new Set<string>();
  const models = draft.models.map(model => {
    const modelId = model.modelId.trim();
    if (!modelId) throw new Error('请填写模型 ID');
    if (modelId.length > BYOK_MODEL_ID_MAX) throw new Error(`模型 ID 不能超过 ${BYOK_MODEL_ID_MAX} 个字符`);
    if (model.usage === 'image' && draft.protocol === 'anthropic') throw new Error('Anthropic 连接不能添加生图模型');
    const unique = `${model.usage}:${modelId}`;
    if (seen.has(unique)) throw new Error(`模型「${modelId}」重复添加了`);
    seen.add(unique);
    const displayName = modelId;
    const chat = model.usage === 'chat';
    const levels = chat ? AI_REASONING_EFFORTS.filter(level => model.thinkingLevels.includes(level)) : [];
    return {
      ...(model.id ? { id: model.id } : {}),
      modelId, displayName, usage: model.usage,
      supportsVision: chat && model.supportsVision,
      thinkingLevels: levels,
      defaultEffort: chat ? model.defaultEffort : 'auto' as const,
      contextWindow: chat ? capacity(model.contextWindow, `「${modelId}」的上下文`, BYOK_CONTEXT_RANGE) : null,
      maxOutput: chat ? capacity(model.maxOutput, `「${modelId}」的输出上限`, BYOK_OUTPUT_RANGE) : null,
    };
  });
  return {
    name, protocol: draft.protocol, baseUrl: normalizeByokAddress(draft.baseUrl),
    key: draft.storeOnSite ? (key ? { store: true, value: key } : { store: true }) : { store: false },
    models,
  };
}

/** Whether the editor holds changes not saved yet. */
export function draftChanged(draft: ByokConnectionDraft, saved: ByokConnectionView | null): boolean {
  const strip = (value: ByokConnectionDraft) => JSON.stringify({ ...value, models: value.models.map(({ key: _key, ...model }) => model) });
  return strip(draft) !== strip(connectionDraft(saved));
}
