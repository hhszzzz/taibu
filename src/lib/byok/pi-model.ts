/**
 * Own-model requests through pi-ai, the same code in the browser (key on the device) and on the server (key stored
 * here, Agent tasks): the protocol picks pi-ai's Chat Completions or Anthropic Messages transport, and the thinking
 * mode picks its parameters.
 */
import type {
  Api, AssistantMessage, AssistantMessageEventStream, ImageContent, Message, Model, OpenAICompletionsCompat, TextContent,
  TranscriptContext, Usage,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import type { AIReasoningEffort } from '@/types';
import { byokEndpoint, type ByokConnectionView, type ByokModelView, type ByokProtocol, type ByokThinking } from './config';

/** What a request needs of an own model. */
export interface ByokRequestModel {
  protocol: ByokProtocol;
  baseUrl: string;
  modelId: string;
  displayName?: string;
  supportsVision: boolean;
  contextWindow: number | null;
  maxOutput: number | null;
}

/** A saved model with its connection's protocol and address. */
export function byokRequestModel(model: ByokModelView, connection: Pick<ByokConnectionView, 'protocol' | 'baseUrl'>): ByokRequestModel {
  return {
    protocol: connection.protocol, baseUrl: connection.baseUrl, modelId: model.modelId, displayName: model.displayName,
    supportsVision: model.supportsVision, contextWindow: model.contextWindow, maxOutput: model.maxOutput,
  };
}

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * Hosts whose request format pi-ai recognizes by address (its detectCompat). Any other host is taken for an
 * OpenAI-compatible relay that forwards to many upstreams: system prompts stay `system` and `store` is not sent.
 */
const PI_KNOWN_HOSTS = [
  'api.openai.com', 'deepseek.com', 'api.z.ai', 'open.bigmodel.cn', 'api.moonshot.', 'openrouter.ai', 'api.together.',
  'api.x.ai', 'cerebras.ai', 'chutes.ai', 'integrate.api.nvidia.com', 'api.cloudflare.com', 'gateway.ai.cloudflare.com',
  'opencode.ai', 'api.ant-ling.com',
];

function relayCompat(sdkBase: string): OpenAICompletionsCompat | undefined {
  const base = sdkBase.toLowerCase();
  return PI_KNOWN_HOSTS.some(host => base.includes(host)) ? undefined : { supportsStore: false, supportsDeveloperRole: false };
}

/** Claude 4.6 and later think adaptively at an effort; earlier Claude models take a token budget. */
function adaptiveClaude(modelId: string): boolean {
  const id = modelId.toLowerCase().split('/').pop() ?? '';
  if (/claude-(?:fable|mythos)/u.test(id)) return true;
  const version = /claude-(?:opus|sonnet|haiku)-(\d+)(?:[-.](\d{1,2})(?!\d))?/u.exec(id);
  if (!version) return false;
  const major = Number(version[1]);
  return major > 4 || (major === 4 && Number(version[2] ?? 0) >= 6);
}

const THINKING_BUDGETS: Record<AIReasoningEffort, number> = { minimal: 1024, low: 2048, medium: 8192, high: 16384, xhigh: 24576, max: 32000 };
/** Anthropic requires an output limit; this one is used when the model's is unknown. */
const ANTHROPIC_DEFAULT_OUTPUT = 8192;

/**
 * The pi-ai model. `reasoning` false sends no thinking parameters at all (the model's default); for `off` it is true
 * and the transport writes the explicit off switch where the format has one.
 */
export function byokPiModel(model: ByokRequestModel, thinking: ByokThinking): Model<Api> {
  const endpoint = byokEndpoint(model.protocol, model.baseUrl);
  const anthropic = model.protocol === 'anthropic';
  return {
    id: model.modelId,
    name: model.displayName || model.modelId,
    api: anthropic ? 'anthropic-messages' : 'openai-completions',
    // A neutral provider: no vendor-specific behaviour (such as Anthropic's federation login) applies to a member's key.
    provider: 'byok',
    baseUrl: endpoint.sdkBase,
    reasoning: thinking.mode !== 'auto',
    input: model.supportsVision ? ['text', 'image'] : ['text'],
    cost: ZERO_COST,
    contextWindow: model.contextWindow ?? 0,
    maxTokens: model.maxOutput ?? 0,
    ...(anthropic && adaptiveClaude(model.modelId) ? { compat: { forceAdaptiveThinking: true } } : {}),
    ...(!anthropic ? { compat: relayCompat(endpoint.sdkBase) } : {}),
  } as Model<Api>;
}

/** Transport options for thinking and the model's configured output cap. */
function thinkingOptions(model: ByokRequestModel, piModel: Model<Api>, thinking: ByokThinking): Record<string, unknown> {
  if (model.protocol === 'openai') return {
    ...(model.maxOutput ? { maxTokens: model.maxOutput } : {}),
    ...(thinking.mode === 'level' ? { reasoningEffort: thinking.level } : {}),
  };
  const output = model.maxOutput ?? ANTHROPIC_DEFAULT_OUTPUT;
  if (thinking.mode === 'auto') return { maxTokens: output };
  if (thinking.mode === 'off') return { maxTokens: output, thinkingEnabled: false };
  if (piModel.compat && (piModel.compat as { forceAdaptiveThinking?: boolean }).forceAdaptiveThinking) {
    return { maxTokens: output, thinkingEnabled: true, effort: thinking.level === 'minimal' ? 'low' : thinking.level };
  }
  const budget = THINKING_BUDGETS[thinking.level];
  return { maxTokens: Math.max(output, budget + 4096), thinkingEnabled: true, thinkingBudgetTokens: budget };
}

export interface ByokStreamOptions {
  apiKey: string;
  thinking: ByokThinking;
  signal?: AbortSignal;
  /** The browser passes `byokBrowserFetch`; the server its public-address guard. */
  fetch?: typeof globalThis.fetch;
  /** The server's `User-Agent`; a browser sends its own. */
  userAgent?: string;
  /**
   * The model as the transcript names it (an Agent task's `byok:` reference). pi-ai replays thinking and signatures
   * only to the model that wrote them, so a task's own model must keep the identity its earlier turns carry; the
   * provider is still asked for the upstream model ID.
   */
  transcriptModel?: { id: string; provider: string };
}

/** One request. Failures end the stream with an `error` event whose message starts with the HTTP status when known. */
export function streamByok(model: ByokRequestModel, context: TranscriptContext, options: ByokStreamOptions): AssistantMessageEventStream {
  const base = byokPiModel(model, options.thinking);
  const piModel = options.transcriptModel ? { ...base, ...options.transcriptModel } : base;
  const api = model.protocol === 'anthropic' ? anthropicMessagesApi() : openAICompletionsApi();
  return api.stream(piModel, context, {
    apiKey: options.apiKey,
    signal: options.signal,
    fetch: options.fetch,
    maxRetries: 0,
    ...(options.userAgent ? { identity: { userAgent: { custom: options.userAgent } } } : {}),
    ...(options.transcriptModel ? { onPayload: (payload: unknown) => ({ ...(payload as Record<string, unknown>), model: model.modelId }) } : {}),
    ...thinkingOptions(model, piModel, options.thinking),
  } as Parameters<typeof api.stream>[2]);
}

/**
 * The browser's fetch for provider calls: the SDKs' `x-stainless-*` and pi-ai's `User-Agent` are left out, so a
 * provider that allows cross-origin calls with only `Authorization` and `Content-Type` accepts the request.
 */
export const byokBrowserFetch: typeof globalThis.fetch = (input, init) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  for (const name of [...headers.keys()]) {
    if (name.startsWith('x-stainless-') || name === 'user-agent') headers.delete(name);
  }
  return globalThis.fetch(input, { ...init, headers });
};

export type ByokChatPart = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ByokChatMessage {
  role: 'user' | 'assistant';
  content: string | ByokChatPart[];
}

/** A plain conversation as pi-ai's transcript: the system prompt first, earlier replies as finished assistant turns. */
export function byokContext(systemPrompt: string, messages: readonly ByokChatMessage[]): TranscriptContext {
  const now = Date.now();
  const converted: Message[] = messages.map((message): Message => {
    if (message.role === 'user') {
      const content = typeof message.content === 'string' ? message.content
        : message.content.map((part): TextContent | ImageContent => part.type === 'text' ? { type: 'text', text: part.text } : { type: 'image', data: part.data, mimeType: part.mimeType });
      return { role: 'user', content, timestamp: now };
    }
    const text = typeof message.content === 'string' ? message.content
      : message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('');
    return {
      role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions', provider: 'byok', model: '',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: now,
    } satisfies AssistantMessage;
  });
  return normalizeContext({ systemPrompt: systemPrompt.trim() || undefined, messages: converted });
}

/** Token counts a provider reported, for the $0 usage record; null when it reported none. */
export type ByokTokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number };

export function byokUsage(usage: Usage | undefined): ByokTokenUsage | null {
  if (!usage) return null;
  const counted: ByokTokenUsage = {
    input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
    ...(usage.reasoning ? { reasoning: usage.reasoning } : {}),
  };
  return counted.input + counted.output + counted.cacheRead + counted.cacheWrite > 0 ? counted : null;
}

export interface ByokStreamResult {
  content: string;
  reasoning: string;
  usage: ByokTokenUsage | null;
  /** pi-ai's failure text (`401 …`), or null when the call finished. */
  error: string | null;
  aborted: boolean;
}

/** Reads a stream to its end, handing answer and reasoning text over as it arrives. */
export async function collectByokStream(
  stream: AssistantMessageEventStream,
  handlers: { onText?: (delta: string) => void; onReasoning?: (delta: string) => void } = {},
): Promise<ByokStreamResult> {
  let content = '';
  let reasoning = '';
  for await (const event of stream) {
    if (event.type === 'text_delta') {
      content += event.delta;
      handlers.onText?.(event.delta);
    } else if (event.type === 'thinking_delta') {
      reasoning += event.delta;
      handlers.onReasoning?.(event.delta);
    }
  }
  const result = await stream.result();
  const failed = result.stopReason === 'error' || result.stopReason === 'aborted';
  return {
    content, reasoning, usage: byokUsage(result.usage),
    error: failed ? result.errorMessage ?? 'Request failed' : null,
    aborted: result.stopReason === 'aborted',
  };
}
