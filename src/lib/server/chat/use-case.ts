import type {
  ChatActor,
  ChatPreparationInput,
  ChatPreparationResult,
  DirectChatOperations,
  ManagedChatOperations,
  ManagedChatResolutionOperations,
  PreparedChat,
  ResolvedChatPreparation,
} from '@/lib/server/chat/contracts';

/**
 * Resolve admission once, independently of HTTP and database SDKs. Nothing is charged here: a metered call needs a
 * positive balance to start and pays for its usage when it ends.
 */
export async function resolveManagedChat(
  actor: ChatActor,
  input: ChatPreparationInput,
  operations: ManagedChatResolutionOperations,
): Promise<ChatPreparationResult<ResolvedChatPreparation>> {
  const requestedModelId = input.model?.trim() || operations.defaultModelId;
  const model = await operations.resolveModel(requestedModelId);
  if (!model) return { ok: false, error: { kind: 'invalid-model' } };
  if (!model.offered) return { ok: false, error: { kind: 'model-unpriced' } };

  const metered = actor.billing === 'metered';
  if (metered) {
    let admitted: boolean;
    try {
      admitted = await operations.admit(model);
    } catch {
      return { ok: false, error: { kind: 'balance-unavailable' } };
    }
    if (!admitted) return { ok: false, error: { kind: 'insufficient-balance' } };
    try {
      if (!await operations.checkRateLimit()) return { ok: false, error: { kind: 'rate-limited' } };
    } catch {
      return { ok: false, error: { kind: 'rate-limit-failed' } };
    }
  }

  return {
    ok: true,
    value: {
      input,
      userId: actor.userId,
      metered,
      requestedModelId: model.id,
      reasoningEnabled: model.supportsReasoning ? !!input.reasoning : false,
    },
  };
}

/** Prompt assembly follows admission; execution and streaming still belong to the route. */
export async function prepareManagedChat(
  actor: ChatActor,
  input: ChatPreparationInput,
  operations: ManagedChatOperations,
): Promise<ChatPreparationResult<PreparedChat>> {
  const resolved = await resolveManagedChat(actor, input, operations);
  if (!resolved.ok) return resolved;
  const prompt = await operations.buildPrompt(resolved.value);
  return { ok: true, value: { ...resolved.value, ...prompt } };
}

/** Browser-direct calls the user's own model: limited, never billed. */
export async function prepareDirectChat(
  actor: { userId: string },
  input: ChatPreparationInput,
  operations: DirectChatOperations,
): Promise<ChatPreparationResult<PreparedChat>> {
  if (!await operations.checkRateLimit()) {
    return { ok: false, error: { kind: 'rate-limited' } };
  }

  const resolved: ResolvedChatPreparation = {
    input,
    userId: actor.userId,
    metered: false,
    requestedModelId: input.model?.trim() || operations.defaultModelId,
    reasoningEnabled: input.reasoning === true,
  };
  const prompt = await operations.buildPrompt(resolved);
  return { ok: true, value: { ...resolved, ...prompt } };
}
