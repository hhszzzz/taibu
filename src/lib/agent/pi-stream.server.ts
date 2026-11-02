import "server-only";
import {
  createAssistantMessageEventStream,
  isContextOverflow,
  isRetryableAssistantError,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Message,
  type Model,
  type OpenAICompletionsCompat,
  type Usage,
} from "@earendil-works/pi-ai";
import { stream as streamCompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { estimateContextTokens, estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import type { PiStreamFn as StreamFn } from "./types";
import type { AIModelConfig, AIReasoningEffort } from "@/types";
import { hasTokens, type TokenUsage } from "@/lib/billing/pricing";
import {
  gatewayFetch,
  isModelAvailable,
  MODEL_REQUEST_USER_AGENT,
} from "@/lib/ai/providers/ai-sdk-provider";
import { normalizeGatewayBaseUrl } from "@/lib/ai/gateway-url";
import { byokFailureFromMessage, clampByokLevel, formatByokError } from "@/lib/byok/config";
import { byokUsage, streamByok, type ByokRequestModel } from "@/lib/byok/pi-model";
import { resolveSourceApiKey } from "@/lib/ai/gateway-secrets.server";
import { PROMPT_CACHE_SWITCH } from "@/lib/ai/prompt-cache";
import { modelPromptCacheKey } from "@/lib/ai/prompt-cache.server";
import { resolveThinkingLevel, thinkingLevelMap, THINKING_REQUEST_FIELDS } from "@/lib/ai/thinking";
import {
  applySourceToModel,
  getOrderedModelSources,
} from "@/lib/ai/source-runtime";
import { agentSafeFetch } from "./safe-fetch.server";
import type { AgentStreamTelemetry } from "./telemetry.server";

export const AGENT_UNSUPPORTED_TOOLS_MESSAGE = "当前模型不支持工具调用，请切换普通对话";
/**
 * The failure of a request every source failed transiently (overload, rate limit, network, 5xx). Its English half is
 * what Pi's retry classification recognizes, so the generation sleeps and retries (AGENT_RETRY_POLICY).
 */
export const AGENT_TRANSIENT_ERROR_MESSAGE = "模型服务暂时不可用（service temporarily unavailable）";
/** The model spent the whole output budget thinking and left neither an answer nor a call. */
export const AGENT_OUTPUT_EXHAUSTED_MESSAGE = "模型的思考用完了单次输出上限，没来得及回答；可以调低思考等级后重新发起";
/** The model ended a response with nothing to show twice in a row, the second time after being told so. */
export const AGENT_SILENT_RESPONSE_MESSAGE = "模型连续两次没有给出回复也没有调用工具；可以重新发起，或换个问法";
export const AGENT_REJECTED_KEY_MESSAGE = "模型服务拒绝了请求：密钥无效或没有这个模型的权限";
export const AGENT_UNKNOWN_MODEL_MESSAGE = "模型服务找不到这个模型，请检查上游模型 ID";
/** One request ran for the whole request time limit (agentModelRequestSignal) without finishing. */
export const AGENT_TIMEOUT_MESSAGE = "模型超过 5 分钟没有完成这次回复，已中止";
/** A saved gateway key that no longer opens: sealed under another master key, or altered. */
export const AGENT_GATEWAY_KEY_MESSAGE = "网关密钥无法读取，请管理员在设置中心「AI 服务 → 网关管理」重新填写";
/** The member's balance ran out before another request of a platform model. */
export const AGENT_INSUFFICIENT_BALANCE_MESSAGE = "余额不足，任务已停止；充值、兑换或订阅后可以继续";
/** Stream failures whose text the task shows as is, in place of the generic failure. */
export const AGENT_PUBLIC_STREAM_ERRORS: ReadonlySet<string> = new Set([
  AGENT_UNSUPPORTED_TOOLS_MESSAGE, AGENT_OUTPUT_EXHAUSTED_MESSAGE, AGENT_SILENT_RESPONSE_MESSAGE,
  AGENT_REJECTED_KEY_MESSAGE, AGENT_UNKNOWN_MODEL_MESSAGE, AGENT_TIMEOUT_MESSAGE, AGENT_GATEWAY_KEY_MESSAGE,
  AGENT_INSUFFICIENT_BALANCE_MESSAGE,
]);
const AGENT_OVERFLOW_MESSAGE = "模型上下文超出限制（context_length_exceeded）";
const AGENT_GENERIC_FAILURE_MESSAGE = "模型调用失败，请确认模型支持工具调用或切换普通对话";

/**
 * Appended to the system prompt for one more request after a response with neither visible text nor a tool call.
 * Two shapes were observed in Pi Desktop's sessions: a wholly empty response, and a finished conclusion written only
 * into the reasoning. Both need the same next move.
 */
export const SILENT_TURN_NUDGE = [
  "<no_output_recovery>",
  "你上一次回复既没有正文，也没有调用工具，用户没有得到任何结果。",
  "推理过程不算答复：已经得出结论的，现在把结论写成正文；还没做完的，先用一句话说明正在做什么，再接着做。",
  "</no_output_recovery>",
].join("\n");
/**
 * The same for a response that only announced its next step: without a tool call the answer is final, and the task
 * would stop halfway.
 */
export const PROGRESS_TURN_NUDGE = [
  "<progress_only_recovery>",
  "你上一条消息只说了接下来要做什么，却没有调用工具，任务会停在半路。",
  "现在接着做：调用刚才说要用的工具，或者直接写出完整的最终答复。说明打算的那条消息里要同时带上工具调用。",
  "</progress_only_recovery>",
].join("\n");

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
export function agentModelRequestSignal(signal?: AbortSignal) {
  return AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(300_000),
  ]);
}
export function emptyPiAssistant(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    stopReason: "stop",
    usage: structuredClone(EMPTY_USAGE),
  };
}

/** One model request per invocation. Pi owns tool execution and continuation. */
export function agentModelSources(config: AIModelConfig) {
  return getOrderedModelSources(config)
    .map((s) => applySourceToModel(config, s))
    .filter(isModelAvailable);
}

/** Request body fields the transport writes, plus control switches that are never request fields. */
const TRANSPORT_FIELDS = new Set(["model", "messages", "tools", "tool_choice", "stream", "stream_options", "max_tokens", "max_completion_tokens", PROMPT_CACHE_SWITCH, "__proto__", "constructor", "prototype"]);

/**
 * How the gateway takes the thinking switch and level: OpenAI Chat Completions `reasoning_effort`, with a level only
 * for a model that lists levels. Gateways are OpenAI-compatible proxies, so pi-ai's auto-detection by host does not
 * apply: system prompts stay `system`, the output limit is `max_tokens`, and `store` is not sent.
 */
export function agentCompletionsCompat(config: AIModelConfig): OpenAICompletionsCompat {
  return {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: !!config.thinkingLevels?.length,
    supportsUsageInStreaming: true,
    maxTokensField: "max_tokens",
    thinkingFormat: "openai",
    supportsStrictMode: false,
  };
}

/** Sampling defaults and the model's own extra body fields, written after the transport's. */
function extraBody(source: AIModelConfig): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source.customParameters ?? {})) {
    if (!TRANSPORT_FIELDS.has(key) && !THINKING_REQUEST_FIELDS.has(key)) body[key] = value;
  }
  return body;
}

function addUsage(total: Usage, next: Usage): Usage {
  return {
    input: total.input + next.input,
    output: total.output + next.output,
    cacheRead: total.cacheRead + next.cacheRead,
    cacheWrite: total.cacheWrite + next.cacheWrite,
    ...(total.reasoning !== undefined || next.reasoning !== undefined ? { reasoning: (total.reasoning ?? 0) + (next.reasoning ?? 0) } : {}),
    totalTokens: total.totalTokens + next.totalTokens,
    cost: {
      input: total.cost.input + next.cost.input,
      output: total.cost.output + next.cost.output,
      cacheRead: total.cost.cacheRead + next.cost.cacheRead,
      cacheWrite: total.cost.cacheWrite + next.cost.cacheWrite,
      total: total.cost.total + next.cost.total,
    },
  };
}

/** What one request used as the provider counted it, or Pi's estimate of its prompt and of what came back. */
function billedUsage(messages: readonly Message[], result: AssistantMessage): { usage: TokenUsage; estimated: boolean } | null {
  const { input, output, cacheRead, cacheWrite, reasoning } = result.usage;
  const counted = { input, output, cacheRead, cacheWrite, ...(reasoning ? { reasoning } : {}) };
  if (hasTokens(counted)) return { usage: counted, estimated: false };
  const reply = estimateMessageTokens(result);
  return reply > 0 ? { usage: { input: estimateContextTokens(messages).tokens, output: reply, cacheRead: 0, cacheWrite: 0 }, estimated: true } : null;
}

const hasVisibleText = (message: AssistantMessage) => message.content.some(part => part.type === "text" && part.text.trim());
const callsTools = (message: AssistantMessage) => message.content.some(part => part.type === "toolCall");

/** A forward-looking sentence about the assistant's own next action: 「我先排出命盘」「接下来我查一下大运」「Let me check」. */
const ANNOUNCED_ACTION = /(?:我(?:先|来|将|现在|这就|马上|接着|再)|接下来(?:我|先)?|下一步(?:我|先)?|下面(?:我|先|来)|让我(?:先|来)?)[^。！？\n]{0,24}?(?:排|查|算|调用|看|读|检索|搜索|核对|整理|分析|起卦|起局|定位|展示|对照|比较|推|获取|确认|计算)|\b(?:I(?:'ll| will| am going to)|let me|next,? I)\b/iu;

/**
 * A short reply that only says what comes next, without the call that would do it: a final answer ends with the
 * follow-up block, a question ends with a question mark, and an analysis runs much longer.
 */
export function isProgressOnlyTurn(message: AssistantMessage) {
  if (message.stopReason !== "stop" || callsTools(message)) return false;
  const text = message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n").trim();
  if (!text || text.length > 400 || text.includes("<followups>") || /[？?]\s*$/u.test(text)) return false;
  return ANNOUNCED_ACTION.test(text);
}

/** A source whose saved key does not open; the request goes to the next source. */
const GATEWAY_KEY_FAILURE = "gateway_key" as const;

/** A failed request, as pi-ai reports it: the raw provider text is only read here, never shown or stored. */
function failureKind(result: AssistantMessage) {
  const failed = { ...result, stopReason: "error" as const };
  const text = result.errorMessage ?? "";
  if (isContextOverflow(failed)) return "overflow";
  if (/tool/iu.test(text) && /not support|unsupported|不支持/iu.test(text)) return "unsupported_tools";
  const status = Number(/^(\d{3})\b/u.exec(text)?.[1]);
  if (status === 401 || status === 403) return "rejected_key";
  if (status === 404) return "unknown_model";
  // A gateway that ends the stream with `finish_reason: "error"` relays an upstream failure.
  if (result.rawStopReason === "error" || isRetryableAssistantError(failed)) return "transient";
  return "other";
}
type FailureKind = ReturnType<typeof failureKind> | typeof GATEWAY_KEY_FAILURE | "silent" | "exhausted" | "balance";
class StreamFailure extends Error {
  /** `detail`: the provider's failure text, shown only for the member's own model. */
  constructor(readonly kind: FailureKind, readonly transientBeforeOutput = false, readonly detail?: string) { super(kind); }
}
function publicFailure(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") return AGENT_TIMEOUT_MESSAGE;
  if (!(error instanceof StreamFailure)) return AGENT_GENERIC_FAILURE_MESSAGE;
  switch (error.kind) {
    case "overflow": return AGENT_OVERFLOW_MESSAGE;
    case "unsupported_tools": return AGENT_UNSUPPORTED_TOOLS_MESSAGE;
    case "rejected_key": return AGENT_REJECTED_KEY_MESSAGE;
    case "unknown_model": return AGENT_UNKNOWN_MODEL_MESSAGE;
    case "silent": return AGENT_SILENT_RESPONSE_MESSAGE;
    case "exhausted": return AGENT_OUTPUT_EXHAUSTED_MESSAGE;
    case "balance": return AGENT_INSUFFICIENT_BALANCE_MESSAGE;
    case GATEWAY_KEY_FAILURE: return AGENT_GATEWAY_KEY_MESSAGE;
    default: return error.transientBeforeOutput ? AGENT_TRANSIENT_ERROR_MESSAGE : AGENT_GENERIC_FAILURE_MESSAGE;
  }
}

/** A platform model the member pays for. */
export interface AgentModelBilling {
  /** Before each request: false when the balance cannot start another one. */
  admit: () => Promise<boolean>;
  /** After each request, with what it used; never throws. */
  charge: (usage: TokenUsage, estimated: boolean) => Promise<void>;
}

/** What every model stream of a task shares: metrics, images, and the live answer text. */
interface AgentStreamHooks {
  /** The run's metrics: when the first content arrives, and each request's usage. */
  telemetry?: AgentStreamTelemetry;
  /** Replaces attachment references with their images, for a vision model. */
  resolveImages?: (messages: Message[]) => Promise<Message[]>;
  /** Live answer text, for the display-only delta channel; never used for durability. */
  onAnswerStart?: () => void;
  onAnswerDelta?: (delta: string) => void;
}

export interface AgentModelStreamSettings extends AgentStreamHooks {
  /** False keeps every request of this stream without thinking, whatever the task's level. */
  reasoning?: boolean;
  /** Absent for a call nobody pays for (an evaluation). */
  billing?: AgentModelBilling;
  /** The task's conversation; its hash becomes this model's prompt cache key unless the model opts out. */
  conversationId?: string;
  /** The task owner; the key covers it, so two members' conversations never share a partition. */
  cacheScope?: string;
  fetch?: typeof globalThis.fetch;
  /** Overrides the request temperature; defaults to 0.7 (the evaluator asks for 0.3). */
  temperature?: number;
}

/** Where one stream's requests go: the platform's gateway sources in order, or the member's own provider. */
interface AgentModelRoute {
  /** How many sources a failed request may move on to. */
  sources: number;
  /** The request to source `index`; throws a StreamFailure when that source cannot be used (the next one is tried). */
  connect: (index: number) => (messages: Message[], signal: AbortSignal) => AssistantMessageEventStream;
  /** Before each request; throws a StreamFailure when it may not start. */
  admit?: () => Promise<void>;
  /** After each request, with what it used; never throws. */
  record?: (messages: readonly Message[], result: AssistantMessage) => Promise<void>;
  /** The text the task shows for a failure. */
  failure: (error: unknown) => string;
}

/**
 * One response of the task's model, over the route's requests. A request falls back to the next source only before
 * anything of the response was shown. A response with nothing to show, or one that only announced its next step, is
 * requested once more with a note appended to the system prompt (as Pi Desktop does); the second response streams
 * into the same message, so the reply reads as one.
 */
function streamAgentResponse(
  piModel: Model<Api>, context: Parameters<StreamFn>[1], options: Parameters<StreamFn>[2], hooks: AgentStreamHooks,
  open: () => AgentModelRoute,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  void (async () => {
    const message = emptyPiAssistant(piModel);
    let started = false;
    let failure: (error: unknown) => string = publicFailure;
    try {
      const route = open();
      failure = route.failure;
      const transcript = hooks.resolveImages && piModel.input?.includes("image") ? await hooks.resolveImages(context.messages) : context.messages;
      let nudge: string | undefined;
      let failures = 0;
      while (true) {
        let send: ReturnType<AgentModelRoute["connect"]>;
        try { send = route.connect(Math.min(failures, route.sources - 1)); }
        catch (error) {
          if (!(error instanceof StreamFailure) || ++failures >= route.sources) throw error;
          continue;
        }
        await route.admit?.();
        const requestSignal = agentModelRequestSignal(options?.signal);
        const messages: Message[] = nudge ? [...transcript, { role: "system", content: nudge, timestamp: Date.now() }] : transcript;
        const inner = send(messages, requestSignal);
        const base = message.content.length;
        let shown = false;
        for await (const event of inner) {
          if (event.type === "text_start") hooks.onAnswerStart?.();
          else if (event.type === "text_delta") hooks.onAnswerDelta?.(event.delta);
          if (event.type === "start" || event.type === "done" || event.type === "error") continue;
          message.content.length = base;
          message.content.push(...event.partial.content);
          if (!started) {
            started = true;
            hooks.telemetry?.firstToken();
            output.push({ type: "start", partial: message });
          }
          shown = true;
          output.push({ ...event, contentIndex: base + event.contentIndex, partial: message } as AssistantMessageEvent);
        }
        const result = await inner.result();
        // 每一轮的用量都计入运行指标：缓存读取单独记，重试与提醒后的再次请求各算一轮。
        hooks.telemetry?.usage(result.usage);
        message.usage = addUsage(message.usage, result.usage);
        // 每轮按上游报的用量入账；中断或出错没报用量时，平台模型按提示词与已产出内容估算。
        await route.record?.(messages, result);
        if (result.stopReason === "error" || result.stopReason === "aborted") {
          requestSignal.throwIfAborted();
          const kind = failureKind(result);
          // Never restart a provider after part of a response was shown, nor a recovery request.
          hooks.onAnswerStart?.();
          if (shown || nudge !== undefined || options?.signal?.aborted || ++failures >= 3) {
            message.content.length = base;
            message.content.push(...result.content);
            throw new StreamFailure(kind, kind === "transient" && !shown, result.errorMessage);
          }
          if (kind !== "transient" && failures >= route.sources) throw new StreamFailure(kind, false, result.errorMessage);
          continue;
        }
        message.content.length = base;
        message.content.push(...result.content);
        message.stopReason = result.stopReason;
        if (callsTools(message) || hasVisibleText(message)) {
          if (nudge === undefined && isProgressOnlyTurn(result)) {
            nudge = PROGRESS_TURN_NUDGE;
            hooks.onAnswerStart?.();
            continue;
          }
          break;
        }
        // The same budget would most likely be spent the same way again, so this is not requested again.
        if (result.stopReason === "length") throw new StreamFailure("exhausted");
        if (nudge !== undefined) throw new StreamFailure("silent");
        nudge = SILENT_TURN_NUDGE;
      }
      if (!started) {
        started = true;
        output.push({ type: "start", partial: message });
      }
      output.push({ type: "done", reason: message.stopReason as "stop" | "length" | "toolUse", message });
    } catch (error) {
      message.stopReason = options?.signal?.aborted ? "aborted" : "error";
      message.errorMessage = message.stopReason === "aborted" ? "任务已停止" : failure(error);
      output.push({ type: "error", reason: message.stopReason, error: message });
    } finally {
      output.end(message);
    }
  })();
  return output;
}

/**
 * Pi's model requests through pi-ai's own Chat Completions transport. It reads the reasoning the gateway streams
 * (`reasoning_content` and its variants) and sends each assistant message's reasoning back with it, so the model
 * continues from its own thinking between tool calls instead of starting over.
 */
export function createPiModelStream(config: AIModelConfig, settings: AgentModelStreamSettings = {}): StreamFn {
  const cacheKey = modelPromptCacheKey(config, settings.conversationId, settings.cacheScope);
  return (piModel, context, options) => streamAgentResponse(piModel, context, options, settings, () => {
    const sources = agentModelSources(config);
    if (!sources.length) throw new Error("模型服务未配置");
    // Each model thinks at a level it lists: an unlisted one moves to the nearest that is.
    const effort = settings.reasoning !== false && piModel.reasoning && options?.reasoning ? resolveThinkingLevel(config, options.reasoning) : undefined;
    const fetcher = settings.fetch ?? gatewayFetch;
    const billing = settings.billing;
    return {
      sources: sources.length,
      connect: index => {
        const source = sources[index];
        let apiKey: string | undefined;
        try { apiKey = resolveSourceApiKey(source) ?? undefined; }
        catch { throw new StreamFailure(GATEWAY_KEY_FAILURE); }
        const outputLimits = [source.defaultMaxTokens, piModel.maxTokens, options?.maxTokens].filter((limit): limit is number => limit !== undefined && limit > 0);
        const upstream = source.modelId;
        const body = extraBody(source);
        return (messages, signal) => streamCompletions({
          ...piModel,
          api: "openai-completions",
          baseUrl: normalizeGatewayBaseUrl(source.apiUrl),
          compat: agentCompletionsCompat(source),
          thinkingLevelMap: thinkingLevelMap(config.thinkingLevels),
        }, normalizeContext({ messages }), {
          apiKey,
          fetch: fetcher,
          signal,
          maxRetries: 0,
          identity: { userAgent: { custom: MODEL_REQUEST_USER_AGENT } },
          temperature: settings.temperature ?? 0.7,
          ...(outputLimits.length ? { maxTokens: Math.min(...outputLimits) } : {}),
          ...(effort ? { reasoningEffort: effort } : {}),
          // The transcript keeps the task's model identity; the gateway is asked for the source's upstream model.
          // Every request of the task carries the same cache key, so a provider can route them to one cache.
          onPayload: payload => ({ ...body, ...(payload as Record<string, unknown>), model: upstream, ...(cacheKey ? { prompt_cache_key: cacheKey } : {}) }),
        });
      },
      ...(billing ? {
        admit: async () => {
          // A balance that cannot be read is retried like an unavailable model service.
          const admitted = await billing.admit().catch(() => { throw new StreamFailure("transient", true); });
          if (!admitted) throw new StreamFailure("balance");
        },
        record: async (messages: readonly Message[], result: AssistantMessage) => {
          const billed = billedUsage(messages, result);
          if (billed) await billing.charge(billed.usage, billed.estimated);
        },
      } : {}),
      failure: publicFailure,
    };
  });
}

/** What the task shows for a failure of the member's own model: the provider's status and text, with a hint. */
function byokFailure(error: unknown): string {
  // Pi recovers from an overflow by compacting, which it recognizes by this text.
  if (error instanceof StreamFailure && error.detail && error.kind !== "overflow") return formatByokError(byokFailureFromMessage(error.detail));
  return publicFailure(error);
}

export interface ByokModelStreamSettings extends AgentStreamHooks {
  apiKey: string;
  /** The levels the model offers (empty: any). */
  levels: readonly AIReasoningEffort[];
  /**
   * What thinking "off" means for this model in this task: no thinking parameters at all (the model's default, chosen
   * as 「模型默认」) or the explicit off switch (「关闭推理」).
   */
  off: "auto" | "off";
  /** Each request's usage, recorded at $0. */
  record?: (usage: TokenUsage) => Promise<void>;
  fetch?: typeof globalThis.fetch;
}

/**
 * The member's own model in a task: pi-ai's transport for its protocol, its own key, through the public-address
 * guard, no temperature. The transcript keeps the task's identity for the model (its `byok:` reference), so the model
 * gets its own thinking back between tool calls.
 */
export function createByokModelStream(model: ByokRequestModel, settings: ByokModelStreamSettings): StreamFn {
  return (piModel, context, options) => streamAgentResponse(piModel, context, options, settings, () => {
    const thinking = options?.reasoning
      ? { mode: "level" as const, level: clampByokLevel(settings.levels, options.reasoning) }
      : { mode: settings.off };
    return {
      sources: 1,
      connect: () => (messages, signal) => streamByok(model, normalizeContext({ messages }), {
        apiKey: settings.apiKey, thinking, signal, fetch: settings.fetch ?? agentSafeFetch, userAgent: MODEL_REQUEST_USER_AGENT,
        transcriptModel: { id: piModel.id, provider: piModel.provider },
      }),
      ...(settings.record ? {
        record: async (_messages: readonly Message[], result: AssistantMessage) => {
          const usage = byokUsage(result.usage);
          if (usage) await settings.record!(usage);
        },
      } : {}),
      failure: byokFailure,
    };
  });
}

