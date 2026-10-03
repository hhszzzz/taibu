/** Transport-independent analysis preparation and completion policies.
 * SDK/HTTP adaptation stays at the existing composition boundary.
 */

/** Request-local allowlisted telemetry; adapters supply the trusted ID, clock and sink. */
export type RequestPhase = 'admission' | 'prompt' | 'generation' | 'persistence' | 'compensation';
export type RequestFailure = 'none' | 'admission' | 'prompt' | 'stream-adapter' | 'inference' | 'persistence' | 'empty';
export interface RequestObservationState {
  failure: RequestFailure;
  generation: 'not-started' | 'completed' | 'empty' | 'failed' | 'aborted' | 'external';
  persistence: 'not-needed' | 'saved' | 'failed';
  billing: 'not-applicable' | 'charged' | 'refunded' | 'refund-failed';
  refundFailure?: 'rejected' | 'exception';
}
export interface RequestObservationEvent extends RequestObservationState {
  requestId: string;
  source: string;
  phase: RequestPhase | 'terminal';
  durationMs: number;
}
export interface RequestObservation {
  fail: (failure?: Exclude<RequestFailure, 'none'>) => void;
  phase: (phase: RequestPhase) => void;
  update: (state: Partial<RequestObservationState>) => void;
  finish: (state?: Partial<RequestObservationState>) => void;
}
export function createRequestObservation(
  requestId: string,
  source: string,
  now: () => number,
  sink: (event: RequestObservationEvent) => void | Promise<void>,
): RequestObservation {
  const started = now();
  let phaseStarted = started;
  let current: RequestPhase = 'admission';
  let terminal = false;
  const state: RequestObservationState = { failure: 'none', generation: 'not-started', persistence: 'not-needed', billing: 'not-applicable' };
  const update = (next: Partial<RequestObservationState>) => {
    // Project explicitly; output/error objects must never reach the sink.
    if (next.failure !== undefined) state.failure = next.failure;
    if (next.generation !== undefined) state.generation = next.generation;
    if (next.persistence !== undefined) state.persistence = next.persistence;
    if (next.billing !== undefined) state.billing = next.billing;
    if (next.refundFailure !== undefined) state.refundFailure = next.refundFailure;
  };
  const emit = (phase: RequestPhase | 'terminal', durationMs: number) => {
    try {
      const result = sink({ requestId, source, phase, durationMs: Math.max(0, durationMs), ...state });
      if (result) void Promise.resolve(result).catch(() => undefined);
    } catch { /* Logging must never change compensation or response semantics. */ }
  };
  return {
    fail: failure => {
      if (!terminal && state.failure === 'none') state.failure = failure ?? (current === 'prompt' ? 'prompt' : 'admission');
    },
    update: next => { if (!terminal) update(next); },
    phase: next => {
      if (terminal || current === next) return;
      const at = now();
      emit(current, at - phaseStarted);
      current = next;
      phaseStarted = at;
    },
    finish: next => {
      if (terminal) return;
      terminal = true;
      if (next) update(next);
      const at = now();
      emit(current, at - phaseStarted);
      emit('terminal', at - started);
    },
  };
}

/** False and thrown refunds are distinct safe states, never raw financial errors in logs. */
export async function observeRefund(refund: () => Promise<boolean>, observation?: RequestObservation): Promise<boolean> {
  observation?.phase('compensation');
  try {
    const refunded = await refund();
    observation?.update({ billing: refunded ? 'refunded' : 'refund-failed', ...(!refunded ? { refundFailure: 'rejected' as const } : {}) });
    return refunded;
  } catch {
    observation?.update({ billing: 'refund-failed', refundFailure: 'exception' });
    return false;
  }
}

export type AnalysisAdmissionBilling =
  | { kind: 'charged'; refund: () => Promise<boolean> }
  | { kind: 'not-applicable' };

export type AnalysisAdmissionResult<TInput, TContext> =
  | { ok: true; value: PreparedAnalysis<TInput, TContext> }
  | {
      ok: false;
      reason: 'limited' | 'rate-error' | 'prompt-error';
      billing: 'not-applicable' | 'refunded' | 'refund-failed';
      error?: unknown;
      refundError?: unknown;
    };

/** Called only after account/member admission and any managed debit.
 * Owns compensation until prompts are ready; inference completion stays separate.
 */
export async function prepareAdmittedAnalysis<TInput, TContext>(
  billing: AnalysisAdmissionBilling,
  operations: {
    checkRateLimit: () => Promise<boolean>;
    prepare: () => Promise<PreparedAnalysis<TInput, TContext>>;
    observation?: RequestObservation;
  },
): Promise<AnalysisAdmissionResult<TInput, TContext>> {
  const fail = async (
    reason: 'limited' | 'rate-error' | 'prompt-error',
    error?: unknown,
  ): Promise<AnalysisAdmissionResult<TInput, TContext>> => {
    operations.observation?.fail(reason === 'prompt-error' ? 'prompt' : 'admission');
    if (billing.kind === 'not-applicable') {
      return { ok: false, reason, billing: 'not-applicable', error };
    }
    operations.observation?.phase('compensation');
    try {
      const refunded = await billing.refund();
      operations.observation?.update({ billing: refunded ? 'refunded' : 'refund-failed', ...(!refunded ? { refundFailure: 'rejected' as const } : {}) });
      return { ok: false, reason, billing: refunded ? 'refunded' : 'refund-failed', error };
    } catch (refundError) {
      operations.observation?.update({ billing: 'refund-failed', refundFailure: 'exception' });
      return { ok: false, reason, billing: 'refund-failed', error, refundError };
    }
  };

  let allowed: boolean;
  try {
    allowed = await operations.checkRateLimit();
  } catch (error) {
    return fail('rate-error', error);
  }
  if (!allowed) return fail('limited');

  try {
    operations.observation?.phase('prompt');
    return { ok: true, value: await operations.prepare() };
  } catch (error) {
    return fail('prompt-error', error);
  }
}

export interface AnalysisActor {
  userId: string;
}

export interface AnalysisPrompts {
  systemPrompt: string;
  userPrompt: string;
}

export interface AuthorizedAnalysis<TInput, TContext> {
  actor: AnalysisActor;
  input: TInput;
  context?: TContext;
}

export interface PreparedAnalysis<TInput, TContext> extends AuthorizedAnalysis<TInput, TContext> {
  prompts: AnalysisPrompts;
}

export async function prepareAnalysis<TInput, TContext>(
  authorized: AuthorizedAnalysis<TInput, TContext>,
  operations: {
    buildPrompts: (input: TInput, context?: TContext) => AnalysisPrompts | Promise<AnalysisPrompts>;
    buildOutputContract: (input: TInput, context?: TContext) => string | undefined;
  },
): Promise<PreparedAnalysis<TInput, TContext>> {
  const prompts = await operations.buildPrompts(authorized.input, authorized.context);
  const outputContract = operations.buildOutputContract(authorized.input, authorized.context);
  return {
    ...authorized,
    prompts: {
      systemPrompt: outputContract
        ? `${prompts.systemPrompt}\n\n${outputContract}`
        : prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
    },
  };
}

export interface AnalysisOutput {
  content: string;
  // Preserve undefined for the legacy non-stream response; storage normalizes it.
  reasoning?: string | null;
}

type GenerationState = 'completed' | 'empty' | 'failed';
type RefundState = 'refunded' | 'refund-failed';
export type AnalysisRefundReason = 'empty-result' | 'stream-empty' | 'persistence' | 'ai-call' | 'stream-persist';

export type ManagedAnalysisOutcome =
  | {
      status: 'saved';
      generation: 'completed' | 'empty';
      persistence: 'saved';
      billing: 'charged';
      output: AnalysisOutput;
      conversationId: string;
    }
  | {
      status: 'aborted';
      generation: 'aborted';
      persistence: 'not-needed';
      billing: 'charged';
    }
  | {
      status: 'failed';
      generation: GenerationState;
      persistence: 'not-needed' | 'failed';
      billing: RefundState;
      failure: 'empty' | 'inference' | 'persistence';
      error?: unknown;
      refundError?: unknown;
    };

export type ManagedAnalysisCompletion =
  | { kind: 'output'; output: AnalysisOutput }
  | { kind: 'aborted' }
  | { kind: 'inference-failed'; error: unknown };

export type CompleteManagedAnalysis = (completion: ManagedAnalysisCompletion) => Promise<ManagedAnalysisOutcome>;

/** One completion owner per charged request, not cross-request idempotency.
 * Text, vision and stream deliberately retain their existing empty/refund rules.
 * Explicit stream abort neither saves partial content nor refunds the charge.
 */
export function createManagedAnalysisCompletion(
  mode: 'text' | 'vision' | 'stream',
  operations: {
    persist: (output: AnalysisOutput) => Promise<string>;
    refund: (reason: AnalysisRefundReason) => Promise<boolean>;
    isPersistenceError: (error: unknown) => boolean;
    observation?: RequestObservation;
  },
): CompleteManagedAnalysis {
  let terminal: Promise<ManagedAnalysisOutcome> | undefined;

  async function fail(
    failure: 'empty' | 'inference' | 'persistence',
    generation: GenerationState,
    reason: AnalysisRefundReason,
    error?: unknown,
  ): Promise<ManagedAnalysisOutcome> {
    operations.observation?.update({ generation, persistence: failure === 'persistence' ? 'failed' : 'not-needed' });
    operations.observation?.phase('compensation');
    let billing: RefundState;
    let refundError: unknown;
    let refundThrew = false;
    try {
      billing = await operations.refund(reason) ? 'refunded' : 'refund-failed';
    } catch (error) {
      billing = 'refund-failed';
      refundError = error;
      refundThrew = true;
    }
    operations.observation?.update({ billing, ...(billing === 'refund-failed' ? { refundFailure: refundThrew ? 'exception' as const : 'rejected' as const } : {}) });
    return {
      status: 'failed',
      failure,
      generation,
      persistence: failure === 'persistence' ? 'failed' : 'not-needed',
      billing,
      error,
      refundError,
    };
  }

  async function finish(completion: ManagedAnalysisCompletion): Promise<ManagedAnalysisOutcome> {
    if (completion.kind === 'aborted') {
      return { status: 'aborted', generation: 'aborted', persistence: 'not-needed', billing: 'charged' };
    }
    if (completion.kind === 'inference-failed') {
      // Preserve the existing error-class distinction at the adapter boundary.
      const persistenceError = operations.isPersistenceError(completion.error);
      return fail(persistenceError ? 'persistence' : 'inference', 'failed',
        persistenceError ? 'persistence' : 'ai-call', completion.error);
    }

    const { output } = completion;
    const generation = output.content?.trim() ? 'completed' : 'empty';
    if (generation === 'empty' && mode !== 'vision') {
      return fail('empty', generation, mode === 'stream' ? 'stream-empty' : 'empty-result');
    }

    try {
      operations.observation?.update({ generation });
      operations.observation?.phase('persistence');
      const conversationId = await operations.persist(output);
      return { status: 'saved', generation, persistence: 'saved', billing: 'charged', output, conversationId };
    } catch (error) {
      // Legacy non-stream post-persist hooks report generic failures as ai-call.
      const reason = mode === 'stream'
        ? 'stream-persist'
        : operations.isPersistenceError(error) ? 'persistence' : 'ai-call';
      return fail('persistence', generation, reason, error);
    }
  }

  return (completion) => {
    // Latch before invoking any injected operation, including synchronous stubs.
    terminal ??= Promise.resolve().then(() => finish(completion)).then(outcome => {
      operations.observation?.finish(outcome);
      return outcome;
    });
    return terminal;
  };
}

/** Non-stream inference is injected; the completion owner decides save/refund. */
export async function runManagedAnalysis(
  infer: () => Promise<AnalysisOutput>,
  complete: CompleteManagedAnalysis,
): Promise<ManagedAnalysisOutcome> {
  let output: AnalysisOutput;
  try {
    output = await infer();
  } catch (error) {
    return complete({ kind: 'inference-failed', error });
  }
  return complete({ kind: 'output', output });
}

export type DirectAnalysisOutcome =
  | { status: 'saved'; persistence: 'saved'; billing: 'not-applicable'; conversationId: string }
  | { status: 'empty'; persistence: 'not-needed'; billing: 'not-applicable' }
  | { status: 'failed'; persistence: 'failed'; billing: 'not-applicable'; error: unknown };

/** A separately authenticated browser submission, never a managed completion.
 * No inference, platform billing, prepare receipt or cancellation policy here.
 */
export async function persistDirectAnalysis(
  output: AnalysisOutput,
  persist: (output: AnalysisOutput) => Promise<string>,
): Promise<DirectAnalysisOutcome> {
  if (!output.content.trim()) {
    return { status: 'empty', persistence: 'not-needed', billing: 'not-applicable' };
  }
  try {
    const conversationId = await persist(output);
    return { status: 'saved', persistence: 'saved', billing: 'not-applicable', conversationId };
  } catch (error) {
    return { status: 'failed', persistence: 'failed', billing: 'not-applicable', error };
  }
}
