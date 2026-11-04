import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Message, ToolResultMessage } from '@earendil-works/pi-ai';
import type { StorageWrite } from '@earendil-works/pi-durable';
import type { ChatMessage } from '@/types';
import type { AIModelConfig } from '@/types';
import { AgentStore, type AgentArtifactRow, type AgentRunRow } from '../store.server';
import { executeAgentRun } from '../runtime.server';
import { builtinSkillsSession } from '../skills/catalog.server';
import { assertAgentEvaluation, judgeAgentEvaluation } from '../evaluation.server';
import { AGENT_SKILL_TOOLS, getAgentDrilldownBase } from '../tool-catalog';
import { createPiModelStream } from '../pi-stream.server';
import { AGENT_ENGINE } from '../engine';
import type { AgentStreamTelemetry } from '../telemetry.server';
import type {
  AgentCheckpoint, AgentFeatureStateProvider, AgentRunStatus, AgentRuntimeInfo, PiStreamFn,
} from '../types';
import type { AgentEvalCase, AgentEvalToolCall } from './types';
import { CHARTLESS_EVAL_TOOL } from './types';

/** The evaluation runs as this synthetic member: no user data, no billing, no run rows. */
const EVAL_USER_ID = '00000000-0000-4000-8000-00000000e5a1';
const TRACE_ARGUMENT_LIMIT = 2000;
const TRACE_LIMIT = 50;
const TRACE_ERROR_LIMIT = 500;

interface StoredEntry {
  model?: Message[];
}

export interface AgentEvalFinished {
  status: AgentRunStatus;
  message: ChatMessage;
  checkpoint: AgentCheckpoint;
}

/**
 * A production-grade isolated store for one evaluation case. It keeps Pi's durable writes and tool artifacts in
 * memory, so the runner never creates `agent_runs`, never bills anyone and never reads or writes a member's data.
 */
export class EvalAgentStore extends AgentStore {
  readonly drafts = new Map<string, AgentArtifactRow>();
  readonly commits: Array<{ sequence: number; writes: StorageWrite[] }> = [];
  finished: AgentEvalFinished | undefined;

  constructor() {
    super({} as never);
  }

  override async commands() {
    return [];
  }

  override async credential() {
    return undefined;
  }

  override async artifact(...args: Parameters<AgentStore['artifact']>) {
    return this.drafts.get(args[1]) ?? null;
  }

  override async chartArtifact(...args: Parameters<AgentStore['chartArtifact']>) {
    const id = args[1];
    return [...this.drafts.values()].find(artifact => artifact.kind === 'calculation' && artifact.id === id) ?? null;
  }

  override async inspectedChart(...args: Parameters<AgentStore['inspectedChart']>) {
    const reference = args[1];
    return [...this.drafts.values()].reverse().find(artifact => (artifact.tool_name === 'inspect_chart' || getAgentDrilldownBase(artifact.tool_name))
      && (artifact.result.details as { chartReference?: string }).chartReference === reference) ?? null;
  }

  /** Evaluation runs produce no performance rows. */
  override async recordRunMetrics() {}

  override async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (name === 'agent_durable_read') {
      return this.commits.filter(commit => commit.sequence > Number(args.p_after)).slice(0, 200) as T;
    }
    if (name === 'agent_durable_commit') {
      const sequence = Number(args.p_sequence);
      const writes = structuredClone(args.p_writes) as StorageWrite[];
      const existing = this.commits.find(commit => commit.sequence === sequence);
      if (existing) {
        if (JSON.stringify(existing.writes) !== JSON.stringify(writes)) throw new Error('AGENT_DURABLE_CONFLICT');
      } else {
        if (sequence !== this.commits.length + 1) throw new Error('AGENT_DURABLE_CONFLICT');
        this.commits.push({ sequence, writes });
      }
      return sequence as T;
    }
    if (name === 'agent_cache_tool') {
      const artifact: AgentArtifactRow = {
        id: randomUUID(),
        call_id: String(args.p_call_id),
        tool_name: String(args.p_tool_name),
        kind: args.p_kind as AgentArtifactRow['kind'],
        args: args.p_args as Record<string, unknown>,
        result: args.p_result as AgentArtifactRow['result'],
      };
      this.drafts.set(artifact.call_id, artifact);
      return artifact as T;
    }
    if (name === 'agent_finish_run') {
      this.finished = {
        status: args.p_status as AgentRunStatus,
        message: structuredClone(args.p_message) as ChatMessage,
        checkpoint: structuredClone(args.p_checkpoint) as AgentCheckpoint,
      };
      return { status: args.p_status } as T;
    }
    if (name === 'agent_renew_lease') return false as T;
    if (name === 'agent_claim_command') return null as T;
    if (name === 'agent_checkpoint') return undefined as T;
    // Evaluation cases only exercise Core tools. A model that wanders into a member-data or archive tool gets a tool
    // error instead of touching a database it does not have.
    throw new Error(`评测运行不支持 ${name}`);
  }

  artifacts(): AgentArtifactRow[] {
    return [...this.drafts.values()];
  }

  nativeEntries(): StoredEntry[] {
    return this.commits.flatMap(commit => commit.writes)
      .filter(write => write.type === 'entry')
      .map(write => write.value as StoredEntry);
  }

  /**
   * What the model read: each result at the detail level it asked for, plus the full chart snapshot
   * inspect_chart shows in the workspace (杂曜、神煞 exist only there when the call used the default level).
   */
  coreTexts(): string[] {
    return this.artifacts()
      .filter(artifact => artifact.kind === 'calculation' || getAgentDrilldownBase(artifact.tool_name))
      .flatMap(artifact => [artifact.result.canonicalText ?? '', artifact.result.chartSnapshot?.canonicalText ?? ''])
      .filter((text, index, all) => text.length > 0 && all.indexOf(text) === index);
  }

  guideLoaded(): boolean {
    return this.nativeEntries().some(entry => entry.model?.some(message =>
      message.role === 'toolResult' && message.toolName === AGENT_SKILL_TOOLS.load && !message.isError));
  }

  /** The method ids the model asked to load, in call order. */
  loadedGuides(): string[] {
    return this.toolCalls()
      .filter(call => call.name === AGENT_SKILL_TOOLS.load)
      .map(call => String((call.arguments as { name?: unknown } | undefined)?.name ?? ''))
      .filter(Boolean);
  }

  private toolMessages() {
    return this.nativeEntries().flatMap(entry => entry.model ?? []);
  }

  private toolCalls() {
    return this.toolMessages()
      .filter((message): message is Extract<Message, { role: 'assistant' }> => message.role === 'assistant')
      .flatMap(message => message.content.flatMap(part => part.type === 'toolCall'
        ? [{ name: part.name, arguments: part.arguments }]
        : []));
  }

  requestedTools(): string[] {
    return [...new Set(this.toolCalls().map(call => call.name))];
  }

  calledTools(): string[] {
    return [...new Set(this.toolMessages()
      .filter((message): message is ToolResultMessage => message.role === 'toolResult')
      .map(message => message.toolName))];
  }

  /** Every model-issued tool call in execution order, with its result status and a bounded argument record. */
  toolTrace(): AgentEvalToolCall[] {
    const calls = new Map<string, { name: string; arguments?: unknown }>();
    const results = new Map<string, { isError: boolean; text: string; durationMs?: number }>();
    for (const message of this.toolMessages()) {
      if (message.role === 'assistant') {
        for (const part of message.content) {
          if (part.type === 'toolCall') calls.set(part.id, { name: part.name, arguments: part.arguments });
        }
      } else if (message.role === 'toolResult') {
        results.set(message.toolCallId, {
          isError: message.isError,
          text: message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n'),
          durationMs: message.durationMs,
        });
      }
    }
    return [...calls].slice(0, TRACE_LIMIT).map(([id, call]) => {
      const result = results.get(id);
      return {
        name: call.name,
        ...(call.arguments === undefined ? {} : { arguments: boundedArguments(call.arguments) }),
        status: result?.isError ? 'error' as const : 'ok' as const,
        ...(result?.durationMs === undefined ? {} : { durationMs: result.durationMs }),
        ...(result?.isError ? { error: result.text.slice(0, TRACE_ERROR_LIMIT) } : {}),
      };
    });
  }
}

function boundedArguments(value: unknown): unknown {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return undefined;
    return text.length <= TRACE_ARGUMENT_LIMIT ? value : { truncated: true, bytes: Buffer.byteLength(text) };
  } catch {
    return { truncated: true };
  }
}

/** The synthetic run one case executes as. Its id seeds server-owned tool randomness like a real run's. */
export function evalRunRow(evalId: string, evalCase: AgentEvalCase, config: AIModelConfig): AgentRunRow {
  const id = randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    user_id: EVAL_USER_ID,
    conversation_id: randomUUID(),
    request_id: `eval:${evalId}:${evalCase.id}:${randomUUID()}`,
    request_hash: 'eval',
    status: 'running',
    checkpoint: {
      version: 2,
      durable: { engine: AGENT_ENGINE },
      messages: [{ role: 'user', content: evalCase.prompt, timestamp: Date.now() }],
      parts: [],
    },
    public_message: {
      id: `agent:${id}`,
      role: 'assistant',
      content: '',
      createdAt: now,
      agent: { version: 1, runId: id, status: 'running', parts: [] },
    },
    input: {
      model: config.id,
      reasoning: false,
      webEnabled: false,
      systemPrompt: '评测任务',
      timezone: 'Asia/Shanghai',
      title: `测评 ${evalCase.id}`,
      userMessage: { id: 'eval-user', role: 'user', content: evalCase.prompt, createdAt: now },
    },
    billing: 'exempt',
    worker_id: 'agent-eval',
    fence: 1,
    cancel_requested: false,
    record_id: null,
    created_at: now,
    event_cursor: 0,
  };
}

/** The stream factory sees the isolated store, so an offline script can call tools exactly as a model would. */
export interface AgentEvalStreamContext {
  config: AIModelConfig;
  case: AgentEvalCase;
  store: EvalAgentStore;
  telemetry: AgentStreamTelemetry;
}
export type AgentEvalStreamFactory = (context: AgentEvalStreamContext) => PiStreamFn;

export interface AgentEvalJudgeOptions {
  config: AIModelConfig;
  stream?: PiStreamFn;
  /** The judge reads the whole chart as evidence; absent falls back to the case's signal. */
  signal?: AbortSignal;
}

export interface RunAgentEvalCaseOptions {
  /** The parent evaluation run; only used to keep request ids readable. */
  evalId: string;
  case: AgentEvalCase;
  config: AIModelConfig;
  createStream?: AgentEvalStreamFactory;
  featureState?: AgentFeatureStateProvider;
  /** Absent skips quality scoring (the CLI's offline mode). */
  judge?: AgentEvalJudgeOptions | null;
  signal?: AbortSignal;
}

export interface AgentEvalCaseOutcome {
  stage: 'execution' | 'core-integrity' | 'guide-loading' | 'quality-judge' | 'completed';
  status: AgentRunStatus | undefined;
  error?: string;
  diagnostic?: { name?: string; message?: string; statusCode?: number; judgeStatus?: string };
  hardPassed: boolean;
  completed: boolean;
  /** Its card told the model to ask the user first, so the task parked on purpose. */
  askedUser?: boolean;
  failedAssertions: string[];
  guideLoaded: boolean;
  answer: string;
  core: string[];
  toolTrace: AgentEvalToolCall[];
  calledTools: string[];
  requestedTools: string[];
  durationMs: number;
  firstTokenMs: number | null;
  tokens: { input: number; output: number; total: number };
  /** Raw per-model and per-tool usage from the run checkpoint, as reports have always kept it. */
  usage?: AgentRuntimeInfo['usage'];
  quality: { passed: boolean; failedAssertions: string[] } | null;
  judgeResponse?: string;
  judgeError?: string;
}

const EVAL_FEATURES: AgentFeatureStateProvider = async () => ({ status: 'enabled' });

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '任务执行失败';
}

function diagnosticOf(error: unknown): AgentEvalCaseOutcome['diagnostic'] {
  const value = error as { name?: unknown; statusCode?: unknown; judgeStatus?: unknown; message?: unknown };
  return {
    ...(typeof value?.name === 'string' ? { name: value.name } : {}),
    ...(typeof value?.message === 'string' && value.message.trim() ? { message: value.message.slice(0, 2000) } : {}),
    ...(Number.isInteger(value?.statusCode) ? { statusCode: value.statusCode as number } : {}),
    ...(typeof value?.judgeStatus === 'string' ? { judgeStatus: value.judgeStatus } : {}),
  };
}

function usageTotals(finished: AgentEvalFinished | undefined) {
  const usage = finished?.checkpoint.runtime?.usage;
  const buckets = [...Object.values(usage?.models ?? {}), ...Object.values(usage?.tools ?? {})];
  const sum = (key: 'input' | 'output' | 'totalTokens') => buckets.reduce((total, item) => {
    const value = item[key];
    return total + (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
  }, 0);
  return { input: sum('input'), output: sum('output'), total: usage?.totalTokens ?? sum('totalTokens') };
}

/**
 * Runs one case against one model through the same runtime a user task uses. Hard checks recompute Core results from
 * the stored artifacts; the optional judge scores the answer against the case assertions.
 */
export async function runAgentEvalCase(options: RunAgentEvalCaseOptions): Promise<AgentEvalCaseOutcome> {
  const evalCase = options.case;
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  const telemetry: AgentStreamTelemetry = {
    firstToken: () => { firstTokenAt ??= Date.now(); },
    usage: () => {},
  };
  const store = new EvalAgentStore();
  const run = evalRunRow(options.evalId, evalCase, options.config);
  const createStream: AgentEvalStreamFactory = options.createStream
    ?? (context => createPiModelStream(context.config, { reasoning: false, telemetry: context.telemetry }));
  const streamFn = createStream({ config: options.config, case: evalCase, store, telemetry });

  let stage: AgentEvalCaseOutcome['stage'] = 'execution';
  let executionError: string | undefined;
  let diagnostic: AgentEvalCaseOutcome['diagnostic'];
  try {
    await executeAgentRun(store, run, options.signal, {
      config: options.config,
      streamFn,
      featureState: options.featureState ?? EVAL_FEATURES,
      // An evaluation compares single models; collaboration members are not part of a case.
      profiles: [],
      // 方法是内置的，评测不需要数据库：技能目录固定为内置方法，各模型读到同一份断法。
      skills: builtinSkillsSession(),
    });
  } catch (error) {
    executionError = errorMessage(error);
    diagnostic = diagnosticOf(error);
  }

  const finished = store.finished;
  const status = finished?.status;
  const completed = status === 'completed';
  const base = {
    status,
    guideLoaded: store.guideLoaded(),
    answer: finished?.message.content ?? '',
    core: store.coreTexts(),
    toolTrace: store.toolTrace(),
    calledTools: store.calledTools(),
    requestedTools: store.requestedTools(),
    durationMs: Math.max(0, Date.now() - startedAt),
    firstTokenMs: firstTokenAt === null ? null : Math.max(0, firstTokenAt - startedAt),
    tokens: usageTotals(finished),
    ...(finished?.checkpoint.runtime?.usage ? { usage: finished.checkpoint.runtime.usage } : {}),
  };

  if (status === 'awaiting_input' && evalCase.mayAskUser) {
    return {
      ...base,
      stage: 'completed',
      hardPassed: true,
      completed: false,
      askedUser: true,
      failedAssertions: [],
      quality: null,
    };
  }
  if (!completed) {
    const failure = executionError ?? finished?.message.agent?.error;
    return {
      ...base,
      stage,
      ...(failure ? { error: failure } : {}),
      ...(diagnostic ? { diagnostic } : {}),
      hardPassed: false,
      completed: false,
      failedAssertions: [failure ?? '任务未完成'],
      quality: null,
    };
  }

  stage = 'core-integrity';
  try {
    // A visual case has no Core tool to recompute; its image assertions are the caller's check.
    if (evalCase.visual) {
      // The caller checks the image.
    } else if (evalCase.tool === CHARTLESS_EVAL_TOOL) {
      if (!store.loadedGuides().includes(evalCase.guide)) throw new Error(`未加载 ${evalCase.guide} 方法`);
      if (store.artifacts().some(artifact => artifact.kind === 'calculation')) throw new Error('无需排盘的用例不应产生计算成果');
    } else {
      await assertAgentEvaluation(run, evalCase.tool, store.artifacts(), store);
    }
  } catch (error) {
    return {
      ...base,
      stage,
      error: errorMessage(error),
      ...(diagnostic ? { diagnostic } : {}),
      hardPassed: false,
      completed: true,
      failedAssertions: [errorMessage(error)],
      quality: null,
    };
  }

  const outcome: AgentEvalCaseOutcome = {
    ...base,
    stage: 'completed',
    hardPassed: true,
    completed: true,
    failedAssertions: [],
    quality: null,
    ...(diagnostic ? { diagnostic } : {}),
  };
  if (!options.judge) return outcome;

  stage = 'quality-judge';
  outcome.stage = stage;
  try {
    // The judge builds its own stream unless a test injects one: its factory pins the judging temperature.
    const scored = await judgeAgentEvaluation(
      options.judge.config,
      { question: evalCase.prompt, assertions: evalCase.assertions, answer: outcome.answer, core: outcome.core },
      options.judge.stream,
      options.judge.signal ?? options.signal,
    );
    outcome.quality = scored.quality;
    outcome.judgeResponse = scored.judgeResponse;
    outcome.failedAssertions = [...scored.quality.failedAssertions];
    outcome.stage = 'completed';
  } catch (error) {
    outcome.judgeError = errorMessage(error);
    outcome.diagnostic = { ...outcome.diagnostic, ...diagnosticOf(error) };
  }
  return outcome;
}
