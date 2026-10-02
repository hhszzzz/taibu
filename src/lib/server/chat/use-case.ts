import type {
  ChatActor,
  ChatPreparationInput,
  ChatPreparationFailure,
  ChatPreparationResult,
  DirectChatOperations,
  ManagedChatOperations,
  ManagedChatResolutionOperations,
  PreparedChat,
  ResolvedChatPreparation,
} from '@/lib/server/chat/contracts';

/** Resolve admission and precharge once, independently of HTTP and database SDKs. */
export async function resolveManagedChat(
  actor: ChatActor,
  input: ChatPreparationInput,
  operations: ManagedChatResolutionOperations,
): Promise<ChatPreparationResult<ResolvedChatPreparation>> {
  const requestedModelId = input.model?.trim() || operations.defaultModelId;
  const model = await operations.resolveModel(requestedModelId);
  if (!model) return { ok: false, error: { kind: 'invalid-model' } };

  const account = actor.userId ? await operations.loadAccount() : null;
  if (account && !account.ok) return account;
  const membershipType = account?.value.effectiveMembership ?? 'free';
  if (!model.allowedMemberships.includes(membershipType)) {
    return { ok: false, error: { kind: 'membership-denied' } };
  }
  const reasoningEnabled = model.reasoningMemberships.includes(membershipType) ? !!input.reasoning : false;
  const canSkipCredit = actor.creditPolicy === 'trusted-bypass';

  let creditDeducted = false;
  if (actor.userId && !canSkipCredit) {
    if (!account?.value.hasCredits) {
      return { ok: false, error: { kind: 'insufficient-credits' } };
    }
    // Both streaming and non-streaming requests retain their existing precharge.
    const creditUse = await operations.deductCredit();
    if (!creditUse.ok) {
      return {
        ok: false,
        error: { kind: creditUse.reason === 'insufficient_credits' ? 'insufficient-credits' : 'deduction-failed' },
      };
    }
    creditDeducted = true;

    // Public admission is membership -> debit -> limit. A rejected slot must settle
    // the actual debit before reporting a normal 429; trusted actors never enter here.
    let admissionFailure: ChatPreparationFailure | null = null;
    try {
      if (!await operations.checkRateLimit()) admissionFailure = { kind: 'rate-limited' };
    } catch {
      admissionFailure = { kind: 'rate-limit-failed' };
    }
    if (admissionFailure) {
      let refunded = false;
      try {
        refunded = await operations.refundRateLimitFailure();
      } catch {
        // A thrown refund is also an unsettled debit, not a successful rejection.
      }
      return {
        ok: false,
        error: refunded ? admissionFailure : { kind: 'rate-limit-refund-failed' },
      };
    }
  }

  return {
    ok: true,
    value: {
      input,
      userId: actor.userId,
      canSkipCredit,
      requestedModelId: model.id,
      membershipType,
      reasoningEnabled,
      creditDeducted,
    },
  };
}

/** Owns prompt-assembly compensation only; execution/streaming still belongs to the route. */
export async function prepareManagedChat(
  actor: ChatActor,
  input: ChatPreparationInput,
  operations: ManagedChatOperations,
): Promise<ChatPreparationResult<PreparedChat>> {
  const resolved = await resolveManagedChat(actor, input, operations);
  if (!resolved.ok) return resolved;

  try {
    const prompt = await operations.buildPrompt(resolved.value);
    return { ok: true, value: { ...resolved.value, ...prompt } };
  } catch (error) {
    if (resolved.value.creditDeducted && resolved.value.userId && !resolved.value.canSkipCredit) {
      await operations.refundPromptFailure();
    }
    throw error;
  }
}

/** Browser-direct validates account membership before limiting; it never debits. */
export async function prepareDirectChat(
  actor: { userId: string },
  input: ChatPreparationInput,
  operations: DirectChatOperations,
): Promise<ChatPreparationResult<PreparedChat>> {
  const account = await operations.loadAccount();
  if (!account.ok) return account;
  if (!await operations.checkRateLimit()) {
    return { ok: false, error: { kind: 'rate-limited' } };
  }

  const resolved: ResolvedChatPreparation = {
    input,
    userId: actor.userId,
    canSkipCredit: true,
    requestedModelId: input.model?.trim() || operations.defaultModelId,
    membershipType: account.value.effectiveMembership,
    reasoningEnabled: input.reasoning === true,
    creditDeducted: false,
  };
  const prompt = await operations.buildPrompt(resolved);
  return { ok: true, value: { ...resolved, ...prompt } };
}
