import "server-only";
import { jsonSchema, streamText, tool, type ModelMessage } from "ai";
import {
  createAssistantMessageEventStream,
  getCurrentTools,
  collapseSystemMessages,
  getSystemMessageText,
  normalizeContext,
  isContextOverflow,
  isRetryableAssistantError,
  type Api,
  type AssistantMessage,
  type JsonValue,
  type Model,
  type Message,
} from "@earendil-works/pi-ai";
import type { PiStreamFn as StreamFn } from "./types";
import { toPiUsage } from './usage';

export const AGENT_UNSUPPORTED_TOOLS_MESSAGE = "当前模型不支持工具调用，请切换普通对话";
/**
 * The failure of a request every source failed transiently (overload, rate limit, network, 5xx). Its English half is
 * what Pi's retry classification recognizes, so the generation sleeps and retries (AGENT_RETRY_POLICY).
 */
export const AGENT_TRANSIENT_ERROR_MESSAGE = "模型服务暂时不可用（service temporarily unavailable）";
/** The model spent the whole output budget thinking and left neither an answer nor a call. */
export const AGENT_OUTPUT_EXHAUSTED_MESSAGE = "模型的思考用完了单次输出上限，没来得及回答；可以调低思考等级后重新发起";
/** Stream failures whose text the task shows as is, in place of the generic failure. */
export const AGENT_PUBLIC_STREAM_ERRORS: ReadonlySet<string> = new Set([AGENT_UNSUPPORTED_TOOLS_MESSAGE, AGENT_OUTPUT_EXHAUSTED_MESSAGE]);
import type { AIModelConfig } from "@/types";
import {
  buildProviderOptions,
  createModelFromConfig,
  isModelAvailable,
} from "@/lib/ai/providers/ai-sdk-provider";
import {
  applySourceToModel,
  getOrderedModelSources,
} from "@/lib/ai/source-runtime";
import { agentSafeFetch } from "./safe-fetch.server";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const SDK_SIGNATURE = "taibu-sdk:v1:";
export function agentModelRequestSignal(signal?: AbortSignal) {
  return AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(300_000),
  ]);
}
type SDKProviderOptions = NonNullable<
  Extract<ModelMessage, { role: "assistant" }>["providerOptions"]
>;
function providerOptions(signature: unknown): SDKProviderOptions | undefined {
  if (typeof signature !== "string" || !signature.startsWith(SDK_SIGNATURE))
    return;
  try {
    return JSON.parse(
      signature.slice(SDK_SIGNATURE.length),
    ) as SDKProviderOptions;
  } catch {
    return;
  }
}
export function emptyPiAssistant(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    stopReason: "stop",
    usage: structuredClone(EMPTY_USAGE),
  };
}
export function toAgentModelMessages(messages: Message[]): ModelMessage[] {
  return collapseSystemMessages(normalizeContext({ messages })).messages.map((message) => {
    if (message.role === "system")
      return {
        role: "system",
        content: getSystemMessageText(message),
      };
    if (message.role === "user")
      return {
        role: "user",
        content:
          typeof message.content === "string"
            ? message.content
            : message.content
                .map((p) => (p.type === "text" ? p.text : "[图片]"))
                .join("\n"),
      };
    if (message.role === "toolResult")
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            output: {
              type: message.isError ? "error-text" : "text",
              value: message.content
                .map((p) => (p.type === "text" ? p.text : "[图片]"))
                .join("\n"),
            },
          },
        ],
      };
    return {
      role: "assistant",
      content: message.content.map((part) => {
        if (part.type === "text")
          return {
            type: "text",
            text: part.text,
            providerOptions: providerOptions(part.textSignature),
          };
        if (part.type === "thinking")
          return {
            type: "reasoning",
            text: part.thinking,
            providerOptions: providerOptions(part.thinkingSignature),
          };
        return {
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.name,
          input: part.arguments,
        };
      }),
    };
  });
}

/** One model request per invocation. Pi, rather than the SDK, owns tool execution and continuation. */
export function agentModelSources(config: AIModelConfig, apiKey?: string) {
  return apiKey
    ? [config]
    : getOrderedModelSources(config)
        .map((s) => applySourceToModel(config, s))
        .filter(isModelAvailable);
}
/** A provider failure a later attempt can get past: Pi's retry classification over the SDK error's message, code and status. */
function isTransientProviderError(error: unknown, message: AssistantMessage) {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  const errorMessage = error instanceof Error ? error.message : '';
  return isRetryableAssistantError({ ...message, stopReason: 'error', errorMessage: [
    errorMessage,
    (error as { code?: string } | null)?.code === 'ECONNRESET' || /ECONNRESET/iu.test(errorMessage) ? 'network error' : '',
    typeof status === 'number' && status >= 500 ? 'server_error' : status === 408 ? 'timeout' : status === 429 ? '429' : '',
  ].join(' ') });
}
export function createPiSDKStream(
  config: AIModelConfig,
  settings: { reasoning: boolean; nativeReasoning?: boolean; apiKey?: string; resolveImages?: (messages:ModelMessage[])=>Promise<ModelMessage[]> },
): StreamFn {
  return (piModel, context, options) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      const message = emptyPiAssistant(piModel);
      let started = false;
      let emitted = false;
      let emptyRecoveries = 0;
      /** Every source failed the way a later attempt can succeed, before any output: Pi retries after a backoff. */
      let transientFailure = false;
      try {
        const sources = agentModelSources(config, settings.apiKey);
        if (!sources.length) throw new Error("模型服务未配置");
        const reasoning = settings.reasoning && piModel.reasoning !== false && (!settings.nativeReasoning || options?.reasoning !== undefined);
        const declared = getCurrentTools(context.messages);
        const tools = Object.fromEntries(
          declared.map((t) => [
            t.name,
            tool({
              description: t.description,
              inputSchema: jsonSchema(t.parameters),
            }),
          ]),
        );
        for (let sourceIndex = 0; sourceIndex < 3; sourceIndex++) {
          const source = sources[Math.min(sourceIndex, sources.length - 1)];
          const requestSignal = agentModelRequestSignal(options?.signal);
          try {
            let finished = false;
            const outputLimits = [source.defaultMaxTokens, piModel.maxTokens, options?.maxTokens].filter((limit): limit is number => limit !== undefined);
            const result = streamText({
              // The SDK's default handler logs upstream exception bodies.
              // Emit our public error event instead of logging provider secrets.
              onError: () => {},
              model: createModelFromConfig(source, {
                reasoning,
                reasoningEffort: options?.reasoning ?? source.defaultReasoningEffort,
                apiKey: settings.apiKey,
                fetch: settings.apiKey ? agentSafeFetch : undefined,
              }),
              messages: settings.resolveImages && piModel.input?.includes('image') ? await settings.resolveImages(toAgentModelMessages(context.messages)) : toAgentModelMessages(context.messages),
              tools,
              maxRetries: 0,
              abortSignal: requestSignal,
              temperature: source.defaultTemperature ?? 0.7,
              maxOutputTokens: outputLimits.length ? Math.min(...outputLimits) : undefined,
              topP: source.defaultTopP ?? undefined,
              presencePenalty: source.defaultPresencePenalty ?? undefined,
              frequencyPenalty: source.defaultFrequencyPenalty ?? undefined,
              providerOptions: buildProviderOptions(source, {
                reasoning,
                reasoningEffort: options?.reasoning ?? source.defaultReasoningEffort,
              }),
            });
            const blocks = new Map<string, number>();
            for await (const event of result.fullStream) {
              if (event.type === "error") throw event.error;
              if (event.type === "abort") throw new Error("模型请求已中断");
              if (
                event.type === "start-step" &&
                event.warnings.some(
                  (warning) =>
                    /unsupported/iu.test(warning.type) &&
                    "feature" in warning &&
                    /tool/iu.test(String(warning.feature)),
                )
              )
                throw new Error("模型不支持工具调用");
              if (
                event.type === "text-start" ||
                event.type === "reasoning-start"
              ) {
                if (!started) {
                  started = true;
                  output.push({ type: "start", partial: message });
                }
                const index = message.content.length;
                blocks.set(event.id, index);
                if (event.type === "text-start") {
                  message.content.push({ type: "text", text: "" });
                  output.push({
                    type: "text_start",
                    contentIndex: index,
                    partial: message,
                  });
                } else {
                  message.content.push({ type: "thinking", thinking: "" });
                  output.push({
                    type: "thinking_start",
                    contentIndex: index,
                    partial: message,
                  });
                }
              } else if (
                event.type === "text-delta" ||
                event.type === "reasoning-delta"
              ) {
                const index = blocks.get(event.id);
                if (index === undefined) continue;
                const block = message.content[index];
                if (event.type === "text-delta" && block.type === "text") {
                  if (event.text) emitted = true;
                  block.text += event.text;
                  output.push({
                    type: "text_delta",
                    contentIndex: index,
                    delta: event.text,
                    partial: message,
                  });
                }
                if (
                  event.type === "reasoning-delta" &&
                  block.type === "thinking"
                ) {
                  if (event.text) emitted = true;
                  block.thinking += event.text;
                  output.push({
                    type: "thinking_delta",
                    contentIndex: index,
                    delta: event.text,
                    partial: message,
                  });
                }
              } else if (
                event.type === "text-end" ||
                event.type === "reasoning-end"
              ) {
                const index = blocks.get(event.id);
                if (index === undefined) continue;
                const block = message.content[index];
                const signature = event.providerMetadata
                  ? SDK_SIGNATURE + JSON.stringify(event.providerMetadata)
                  : undefined;
                if (block.type === "text") {
                  block.textSignature = signature;
                  output.push({
                    type: "text_end",
                    contentIndex: index,
                    content: block.text,
                    partial: message,
                  });
                }
                if (block.type === "thinking") {
                  block.thinkingSignature = signature;
                  output.push({
                    type: "thinking_end",
                    contentIndex: index,
                    content: block.thinking,
                    partial: message,
                  });
                }
              } else if (event.type === "tool-call") {
                emitted = true;
                if (!started) {
                  started = true;
                  output.push({ type: "start", partial: message });
                }
                const call = {
                  type: "toolCall" as const,
                  id: event.toolCallId,
                  name: event.toolName,
                  arguments: event.input as Record<string, JsonValue>,
                };
                const index = message.content.length;
                message.content.push(call);
                output.push({
                  type: "toolcall_start",
                  contentIndex: index,
                  partial: message,
                });
                output.push({
                  type: "toolcall_end",
                  contentIndex: index,
                  toolCall: call,
                  partial: message,
                });
              } else if (event.type === "tool-error") {
                throw new Error("模型返回无效的工具参数");
              } else if (event.type === "finish") {
                if (event.finishReason === "error") throw new Error('provider returned error (finish_reason: error)');
                if (event.finishReason === "content-filter" || event.finishReason === "other")
                  throw new Error("模型未正常完成回复");
                finished = true;
                message.stopReason =
                  event.finishReason === "length"
                    ? "length"
                    : message.content.some((p) => p.type === "toolCall")
                      ? "toolUse"
                      : "stop";
                message.usage = toPiUsage(event.totalUsage);
              }
            }
            // EOF and an SDK abort are not successful Pi terminal messages.
            if (!finished) throw new Error("模型回复缺少结束标记");
            requestSignal.throwIfAborted();
            // The same budget would most likely be spent the same way again, so this is not retried.
            if (message.stopReason === 'length' && !message.content.some(part => part.type === 'toolCall' || (part.type === 'text' && part.text.trim()))) throw new Error(AGENT_OUTPUT_EXHAUSTED_MESSAGE);
            if (!message.content.some(part => part.type === 'toolCall' || (part.type === 'text' && part.text.trim()) || (part.type === 'thinking' && part.thinking.trim()))) throw new Error('AGENT_EMPTY_RESPONSE');
            if (!started) {
              started = true;
              output.push({ type: "start", partial: message });
            }
            output.push({
              type: "done",
              reason: message.stopReason as "stop" | "length" | "toolUse",
              message,
            });
            return;
          } catch (error) {
            const empty = error instanceof Error && error.message === 'AGENT_EMPTY_RESPONSE';
            const transient = isTransientProviderError(error, message);
            // A request that ran out its own time already waited minutes; Pi does not wait for it again.
            transientFailure = transient && !emitted && !requestSignal.aborted;
            // Never restart a provider after emitting part of a response.
            if (
              emitted ||
              options?.signal?.aborted ||
              sourceIndex === 2
            )
              throw error;
            if (empty && emptyRecoveries++ >= 1) throw error;
            if (!empty && !transient && sourceIndex >= sources.length - 1) throw error;
            started = false; message.content = []; message.stopReason = 'stop';
          }
        }
      } catch (error) {
        message.stopReason = options?.signal?.aborted ? "aborted" : "error";
        const overflow = error instanceof Error && isContextOverflow({ ...message, stopReason: "error", errorMessage: error.message });
        message.errorMessage =
          message.stopReason === "aborted"
            ? "任务已停止"
            : error instanceof Error && error.message === "模型不支持工具调用"
              ? AGENT_UNSUPPORTED_TOOLS_MESSAGE
            : error instanceof Error && error.message === AGENT_OUTPUT_EXHAUSTED_MESSAGE ? AGENT_OUTPUT_EXHAUSTED_MESSAGE
            : overflow ? "模型上下文超出限制（context_length_exceeded）"
            : transientFailure ? AGENT_TRANSIENT_ERROR_MESSAGE
            : "模型调用失败，请确认模型支持工具调用或切换普通对话";
        output.push({
          type: "error",
          reason: message.stopReason,
          error: message,
        });
      } finally {
        output.end(message);
      }
    })();
    return output;
  };
}
