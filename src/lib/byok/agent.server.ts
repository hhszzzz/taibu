import 'server-only';
import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { AIModelConfig, AIReasoningEffort } from '@/types';
import { getByokPolicy } from '@/lib/app-settings';
import { matchModelIcon } from '@/lib/ai/lobe-icons';
import { thinkingLevelMap } from '@/lib/ai/thinking';
import type { ModelContextConfig } from '@/lib/ai/model-context';
import type { ScopedDb } from '@/lib/db/context.server';
import { byokEffortLevels, clampByokLevel, isByokRef } from './config';
import { byokPiModel, byokRequestModel } from './pi-model';
import { openByokRunKeys, ByokKeyError } from './secrets.server';
import { resolveByokModels, type ResolvedByokModel } from './store.server';

/** An own model a task may call, with its key. */
export type ByokKeyedModel = { model: ResolvedByokModel; key: string };

/**
 * An own model as a task's bookkeeping sees models: a config whose ID is its `byok:` reference. It is never priced,
 * never routed through a gateway, and offers every effort level unless its levels are known.
 */
export function byokAgentConfig(model: ResolvedByokModel): AIModelConfig {
  const levels = byokEffortLevels(model.thinkingLevels);
  return {
    id: model.ref, name: model.displayName || model.modelId, vendor: 'other', icon: matchModelIcon(model.modelId),
    modelId: model.modelId, apiUrl: model.connection.baseUrl,
    supportsReasoning: true, isReasoningDefault: model.defaultEffort !== 'off', thinkingLevels: levels,
    ...(model.defaultEffort !== 'auto' && model.defaultEffort !== 'off' ? { defaultReasoningEffort: model.defaultEffort } : {}),
    supportsVision: model.supportsVision,
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxOutput ? { defaultMaxTokens: model.maxOutput } : {}),
  };
}

/** The task's Pi model for an own model: registered under the task's provider and the model's reference. */
export function byokAgentPiModel(model: ResolvedByokModel, window: ModelContextConfig | null): Model<Api> {
  return {
    ...byokPiModel(byokRequestModel(model, model.connection), { mode: 'level', level: 'medium' }),
    id: model.ref, name: model.displayName || model.modelId, provider: 'taibu',
    thinkingLevelMap: thinkingLevelMap(byokEffortLevels(model.thinkingLevels)),
    contextWindow: window?.maxContext ?? 0, maxTokens: model.maxOutput ?? 0,
  } as Model<Api>;
}

/**
 * The thinking level Pi runs an own model at: a chosen level, otherwise the model's configured default level;
 * 「模型默认」 (on, no level) and 「关闭推理」 both run as Pi's off, which the model's stream tells apart
 * (`byokOffMode`).
 */
export function byokAgentThinkingLevel(
  model: Pick<AIModelConfig, 'thinkingLevels' | 'defaultReasoningEffort'>,
  reasoning: boolean, effort: AIReasoningEffort | null | undefined,
): ModelThinkingLevel {
  if (!reasoning) return 'off';
  if (effort) return clampByokLevel(model.thinkingLevels ?? [], effort);
  return model.defaultReasoningEffort ? clampByokLevel(model.thinkingLevels ?? [], model.defaultReasoningEffort) : 'off';
}

/** Whether Pi's off means 「模型默认」 for this model in this task: someone using it chose thinking without a level. */
export function byokOffMode(uses: ReadonlyArray<{ model: string; reasoning: boolean; reasoningEffort: AIReasoningEffort | null | undefined }>, ref: string): 'auto' | 'off' {
  return uses.some(use => use.model === ref && use.reasoning && !use.reasoningEffort) ? 'auto' : 'off';
}

/**
 * The own models a task names (main, members, image), each with its key: the one stored here when the site may use it,
 * else the one the browser staged for this task. A model that is gone, or whose key is not available, is left out.
 */
export async function openTaskByokModels(
  db: ScopedDb, userId: string, runId: string, refs: readonly (string | null | undefined)[], staged: unknown,
): Promise<Map<string, ByokKeyedModel>> {
  const wanted = refs.filter(isByokRef);
  if (!wanted.length) return new Map();
  const models = await resolveByokModels(db, userId, wanted, await getByokPolicy());
  const keys = staged ? openByokRunKeys(userId, runId, staged) : {};
  const opened = new Map<string, ByokKeyedModel>();
  for (const [ref, model] of models) {
    let key: string | null = null;
    try {
      key = model.openKey();
    } catch (error) {
      if (!(error instanceof ByokKeyError)) throw error;
    }
    key ??= keys[model.connection.id] ?? null;
    if (key) opened.set(ref, { model, key });
  }
  return opened;
}
