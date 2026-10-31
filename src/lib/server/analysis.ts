/** Transport-independent analysis preparation and completion policies.
 * SDK/HTTP adaptation stays at the existing composition boundary.
 */

/** Request-local allowlisted telemetry; adapters supply the trusted ID, clock and sink. */
export type RequestPhase = 'admission' | 'prompt' | 'generation' | 'persistence';
export type RequestFailure = 'none' | 'admission' | 'prompt' | 'stream-adapter' | 'inference' | 'persistence' | 'empty';
export interface RequestObservationState {
  failure: RequestFailure;
  generation: 'not-started' | 'completed' | 'empty' | 'failed' | 'aborted' | 'external';
  persistence: 'not-needed' | 'saved' | 'failed';
  /** A metered request pays for what its model calls used; nothing is charged up front or refunded. */
  billing: 'not-applicable' | 'metered';
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

export type AnalysisAdmissionResult<TInput, TContext> =
  | { ok: true; value: PreparedAnalysis<TInput, TContext> }
  | { ok: false; reason: 'limited' | 'rate-error' | 'prompt-error'; error?: unknown };

/** Called only after model and balance admission: the endpoint rate, then the prompts. Nothing has been charged. */
export async function prepareAdmittedAnalysis<TInput, TContext>(
  operations: {
    checkRateLimit: () => Promise<boolean>;
    prepare: () => Promise<PreparedAnalysis<TInput, TContext>>;
    observation?: RequestObservation;
  },
): Promise<AnalysisAdmissionResult<TInput, TContext>> {
  const fail = (
    reason: 'limited' | 'rate-error' | 'prompt-error',
    error?: unknown,
  ): AnalysisAdmissionResult<TInput, TContext> => {
    operations.observation?.fail(reason === 'prompt-error' ? 'prompt' : 'admission');
    return { ok: false, reason, error };
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

export type ManagedAnalysisOutcome =
  | {
      status: 'saved';
      generation: 'completed' | 'empty';
      persistence: 'saved';
      output: AnalysisOutput;
      conversationId: string;
    }
  | {
      status: 'aborted';
      generation: 'aborted';
      persistence: 'not-needed';
    }
  | {
      status: 'failed';
      generation: GenerationState;
      persistence: 'not-needed' | 'failed';
      failure: 'empty' | 'inference' | 'persistence';
      error?: unknown;
    };

export type ManagedAnalysisCompletion =
  | { kind: 'output'; output: AnalysisOutput }
  | { kind: 'aborted' }
  | { kind: 'inference-failed'; error: unknown };

export type CompleteManagedAnalysis = (completion: ManagedAnalysisCompletion) => Promise<ManagedAnalysisOutcome>;

/** One completion owner per request, not cross-request idempotency. The model call bills its own usage, so the
 * outcome only decides what is saved and reported. Text and stream reject an empty result; vision keeps it.
 * Explicit stream abort saves nothing.
 */
export function createManagedAnalysisCompletion(
  mode: 'text' | 'vision' | 'stream',
  operations: {
    persist: (output: AnalysisOutput) => Promise<string>;
    isPersistenceError: (error: unknown) => boolean;
    observation?: RequestObservation;
  },
): CompleteManagedAnalysis {
  let terminal: Promise<ManagedAnalysisOutcome> | undefined;

  function fail(
    failure: 'empty' | 'inference' | 'persistence',
    generation: GenerationState,
    error?: unknown,
  ): ManagedAnalysisOutcome {
    const persistence = failure === 'persistence' ? 'failed' : 'not-needed';
    operations.observation?.update({ generation, persistence });
    return { status: 'failed', failure, generation, persistence, error };
  }

  async function finish(completion: ManagedAnalysisCompletion): Promise<ManagedAnalysisOutcome> {
    if (completion.kind === 'aborted') {
      return { status: 'aborted', generation: 'aborted', persistence: 'not-needed' };
    }
    if (completion.kind === 'inference-failed') {
      // Preserve the existing error-class distinction at the adapter boundary.
      return fail(operations.isPersistenceError(completion.error) ? 'persistence' : 'inference', 'failed', completion.error);
    }

    const { output } = completion;
    const generation = output.content?.trim() ? 'completed' : 'empty';
    if (generation === 'empty' && mode !== 'vision') {
      return fail('empty', generation);
    }

    try {
      operations.observation?.update({ generation });
      operations.observation?.phase('persistence');
      const conversationId = await operations.persist(output);
      return { status: 'saved', generation, persistence: 'saved', output, conversationId };
    } catch (error) {
      return fail('persistence', generation, error);
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

/** Non-stream inference is injected; the completion owner decides what is saved. */
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
