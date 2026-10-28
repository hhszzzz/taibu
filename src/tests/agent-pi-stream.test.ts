import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeContext,
  isContextOverflow,
  Type,
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createGuardedAgentModels } from '../lib/agent/model-registry.server';
import { generateSummary } from '../lib/agent/summary-usage.server';
import {
  AGENT_GATEWAY_KEY_MESSAGE,
  AGENT_OUTPUT_EXHAUSTED_MESSAGE,
  AGENT_PUBLIC_STREAM_ERRORS,
  AGENT_REJECTED_KEY_MESSAGE,
  AGENT_SILENT_RESPONSE_MESSAGE,
  AGENT_TIMEOUT_MESSAGE,
  AGENT_TRANSIENT_ERROR_MESSAGE,
  AGENT_UNKNOWN_MODEL_MESSAGE,
  AGENT_UNSUPPORTED_TOOLS_MESSAGE,
  PROGRESS_TURN_NUDGE,
  SILENT_TURN_NUDGE,
  createPiModelStream,
  isProgressOnlyTurn,
} from "../lib/agent/pi-stream.server";
import { MODEL_REQUEST_USER_AGENT } from '../lib/ai/providers/ai-sdk-provider';
import { promptCacheKey } from '../lib/ai/prompt-cache.server';
import type { AIModelConfig } from "../types";
import { sealedGateway } from './helpers/gateway-key';

const piModel = {
  id: "fixture",
  name: "fixture",
  provider: "taibu",
  api: "openai-completions",
  baseUrl: "",
  reasoning: true,
  input: ["text"],
  contextWindow: 0,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<Api>;
const config: AIModelConfig = {
  id: "fixture",
  name: "fixture",
  vendor: "other",
  modelId: "fixture-upstream",
  apiUrl: "https://model.example/v1/chat/completions",
  supportsReasoning: true,
  sources: [{ sourceKey: 'model', sourceName: 'model', apiUrl: "https://model.example/v1/chat/completions", ...sealedGateway('gateway-model'), modelIdOverride: 'fixture-upstream' }],
};
const sourced = (...keys: string[]): AIModelConfig => ({
  ...config,
  sources: keys.map(key => ({ sourceKey: key, sourceName: key, apiUrl: `https://${key}.example/v1/chat/completions`, ...sealedGateway(`gateway-${key}`), modelIdOverride: `${key}-upstream` })),
});
const context = (messages: Message[] = [{ role: "user", content: "query", timestamp: 1 }]) =>
  normalizeContext({
    systemPrompt: "existing personality",
    messages,
    tools: [{ name: "search", description: "fixture tool", parameters: Type.Object({ query: Type.String() }) }],
  });

type Delta = { content?: string; reasoning_content?: string; tool_calls?: unknown[] };
type Chunk = { delta?: Delta; finish_reason?: string | null; usage?: Record<string, unknown> };
const USAGE = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8, completion_tokens_details: { reasoning_tokens: 1 } };
const frame = ({ delta = {}, finish_reason = null, usage }: Chunk) =>
  `data: ${JSON.stringify({ id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1, model: "upstream", choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
type Sent = { url: string; headers: Headers; body: Record<string, unknown> & { messages: Array<Record<string, unknown>> } };
type Answer = (request: Sent, init?: RequestInit) => Response | Promise<Response>;
/** A gateway answer streamed as server-sent events; each request gets a fresh body (a cloned one stalls the SDK). */
const sse = (chunks: Chunk[], { done = true } = {}): Answer => () =>
  new Response(chunks.map(frame).join("") + (done ? "data: [DONE]\n\n" : ""), { status: 200, headers: { "content-type": "text/event-stream" } });
const reply = (text: string, finish = "stop") => sse([{ delta: { content: text } }, { finish_reason: finish, usage: USAGE }]);
const call = (name: string, args: unknown, id = "call_1") =>
  sse([{ delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }, { finish_reason: "tool_calls", usage: USAGE }]);
const failure = (status: number, message: string): Answer => () =>
  new Response(JSON.stringify({ error: { message, type: "error" } }), { status, headers: { "content-type": "application/json" } });

/** Records every request and answers with the next response, repeating the last one. */
function gateway(...responses: Answer[]) {
  const requests: Sent[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Sent = { url: input instanceof Request ? input.url : String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
    requests.push(request);
    return responses[Math.min(requests.length - 1, responses.length - 1)](request, init);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}
const systemText = (request: Sent) => request.body.messages.filter(message => message.role === "system").map(message => String(message.content)).join("\n");
async function drain(stream: ReturnType<ReturnType<typeof createPiModelStream>>) {
  const events = [];
  for await (const event of stream) events.push(event);
  return { events, message: await stream.result() };
}

test('requests send one system prompt with the latest sections, in the system role, to the source URL', async () => {
  const gw = gateway(reply('answer with guide'));
  const input = normalizeContext({ messages: [
    { role: 'system', content: '系统约定', timestamp: 1, sections: { taibu_skills: '<taibu_skills>旧目录</taibu_skills>', instructions: '<instructions>先计算后解读</instructions>', obsolete: '已移除权限' } },
    { role: 'user', content: 'query', timestamp: 2 },
    { role: 'system', content: '', timestamp: 3, sections: { taibu_skills: '<taibu_skills>解读前读取八字指引</taibu_skills>', obsolete: null } },
  ] });
  const message = await createPiModelStream(config, { fetch: gw.fetch })(piModel, input).result();
  assert.equal(message.stopReason, 'stop');
  const [request] = gw.requests;
  assert.equal(request.url, 'https://model.example/v1/chat/completions');
  assert.equal(request.headers.get('authorization'), 'Bearer gateway-fixture-key');
  assert.equal(request.headers.get('user-agent'), MODEL_REQUEST_USER_AGENT);
  assert.equal(request.body.model, 'fixture-upstream');
  assert.equal(request.body.store, undefined);
  assert.deepEqual(request.body.messages.map(item => item.role), ['system', 'user']);
  const prompt = systemText(request);
  assert.match(prompt, /<taibu_skills>解读前读取八字指引<\/taibu_skills>/);
  assert.doesNotMatch(prompt, /旧目录|已移除权限/);
  assert.ok(prompt.indexOf('<taibu_skills>') < prompt.indexOf('<instructions>'));
  assert.equal(message.model, piModel.id, 'the transcript keeps the task model, not the upstream name');
});

test('output tokens respect the smallest source, native model and per-request budget', async () => {
  for (const [sourceLimit, requestLimit, expected] of [[12288, undefined, 2400], [12288, 1200, 1200], [800, 1200, 800]] as const) {
    const gw = gateway(reply('budgeted answer'));
    const message = await createPiModelStream({ ...config, defaultMaxTokens: sourceLimit }, { fetch: gw.fetch })({ ...piModel, maxTokens: 2400 }, context(), { maxTokens: requestLimit }).result();
    assert.equal(message.stopReason, 'stop');
    assert.equal(gw.requests[0].body.max_tokens, expected);
    assert.equal(gw.requests[0].body.max_completion_tokens, undefined);
  }
});

test('reasoning streams as thinking and goes back with the assistant message, whichever source serves the next step', async () => {
  const first = gateway(sse([
    { delta: { reasoning_content: '先排盘再看大运' } },
    { delta: { content: '我先排出命盘。' } },
    { delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"query":"星象"}' } }] } },
    { finish_reason: 'tool_calls', usage: USAGE },
  ]));
  const { events, message } = await drain(createPiModelStream(sourced('first'), { fetch: first.fetch })(piModel, context(), { reasoning: 'high' }));
  assert.equal(message.stopReason, 'toolUse');
  assert.deepEqual(message.content.map(part => part.type), ['thinking', 'text', 'toolCall']);
  assert.equal(message.content[0].type === 'thinking' && message.content[0].thinkingSignature, 'reasoning_content');
  assert.deepEqual(message.content.find(part => part.type === 'toolCall')?.arguments, { query: '星象' });
  assert.ok(events.some(event => event.type === 'thinking_end') && events.some(event => event.type === 'toolcall_end'));
  assert.equal(message.usage.totalTokens, 8);
  assert.equal(message.usage.reasoning, 1);

  const second = gateway(reply('大运走火地'));
  const next = context([
    { role: 'user', content: 'query', timestamp: 1 },
    message,
    { role: 'toolResult', toolCallId: 'call_1', toolName: 'search', content: [{ type: 'text', text: '命盘' }], isError: false, timestamp: 3 },
  ]);
  await createPiModelStream(sourced('second'), { fetch: second.fetch })(piModel, next, { reasoning: 'high' }).result();
  const replayed = second.requests[0].body.messages.find(item => item.role === 'assistant');
  assert.equal(second.requests[0].body.model, 'second-upstream');
  assert.equal(replayed?.reasoning_content, '先排盘再看大运');
  assert.equal(replayed?.content, '我先排出命盘。');
});

test('the thinking switch and level follow the model\'s thinking format, and an unlisted level moves to the nearest listed one', async () => {
  const sent = async (model: AIModelConfig, settings: { reasoning?: boolean }, reasoning?: 'medium' | 'high' | 'max' | 'xhigh', native = piModel) => {
    const gw = gateway(reply('ok'));
    await createPiModelStream(model, { ...settings, fetch: gw.fetch })(native, context(), reasoning ? { reasoning } : undefined).result();
    const { enable_thinking, reasoning_effort, reasoning: object, thinking, model: upstream } = gw.requests[0].body;
    return { enable_thinking, reasoning_effort, reasoning: object, thinking, upstream };
  };
  const none = { enable_thinking: undefined, reasoning_effort: undefined, reasoning: undefined, thinking: undefined, upstream: 'fixture-upstream' };
  // The test gateway's model: DeepSeek format with low / high / max.
  const deepseek: AIModelConfig = { ...config, thinkingFormat: 'deepseek', thinkingLevels: ['low', 'high', 'max'] };
  assert.deepEqual(await sent(deepseek, {}, 'high'), { ...none, thinking: { type: 'enabled' }, reasoning_effort: 'high' });
  assert.deepEqual(await sent(deepseek, {}, 'medium'), { ...none, thinking: { type: 'enabled' }, reasoning_effort: 'high' });
  assert.deepEqual(await sent(deepseek, {}, 'xhigh'), { ...none, thinking: { type: 'enabled' }, reasoning_effort: 'max' });
  assert.deepEqual(await sent(deepseek, {}), { ...none, thinking: { type: 'disabled' } });
  assert.deepEqual(await sent(deepseek, { reasoning: false }, 'high'), { ...none, thinking: { type: 'disabled' } });
  // A model that lists no levels only switches thinking.
  assert.deepEqual(await sent({ ...config, thinkingFormat: 'qwen' }, {}, 'high'), { ...none, enable_thinking: true });
  assert.deepEqual(await sent({ ...config, thinkingFormat: 'qwen' }, {}), { ...none, enable_thinking: false });
  assert.deepEqual(await sent({ ...config, thinkingLevels: ['low', 'medium', 'high', 'xhigh'] }, {}, 'xhigh'), { ...none, reasoning_effort: 'xhigh' });
  assert.deepEqual(await sent({ ...config, thinkingFormat: 'openrouter', thinkingLevels: ['high'] }, {}, 'high'), { ...none, reasoning: { effort: 'high' } });
  // A model that cannot think gets no thinking field at all; a separate reasoning model serves the thinking requests.
  assert.deepEqual(await sent(deepseek, {}, 'high', { ...piModel, reasoning: false }), none);
  assert.equal((await sent({ ...config, reasoningModelId: 'fixture-reasoner', sources: [{ ...config.sources![0], reasoningModelId: 'fixture-reasoner' }] }, {}, 'high')).upstream, 'fixture-reasoner');
});

test('a saved key that does not open moves to the next source, and with none left the task says to re-enter it', async () => {
  const gw = gateway(reply('ok'));
  const broken = { ...sourced('first', 'second') };
  broken.sources = [{ ...broken.sources![0], gatewayId: 'gateway-moved' }, broken.sources![1]];
  const message = await createPiModelStream(broken, { fetch: gw.fetch })(piModel, context()).result();
  assert.equal(message.stopReason, 'stop');
  assert.deepEqual(gw.requests.map(request => request.body.model), ['second-upstream']);
  const none = gateway(reply('ok'));
  const failed = await createPiModelStream({ ...config, sources: [{ ...config.sources![0], gatewayId: 'gateway-moved' }] }, { fetch: none.fetch })(piModel, context()).result();
  assert.equal(none.requests.length, 0);
  assert.equal(failed.errorMessage, AGENT_GATEWAY_KEY_MESSAGE);
});

test('custom parameters and sampling defaults reach the body, but never replace transport or thinking fields', async () => {
  const gw = gateway(reply('ok'));
  await createPiModelStream({ ...config, thinkingFormat: 'qwen', defaultTopP: 0.9, defaultPresencePenalty: 0.1, customParameters: { top_k: 20, enable_thinking: true, max_tokens: 1, model: 'other' } }, { fetch: gw.fetch })(piModel, context()).result();
  const { body } = gw.requests[0];
  assert.equal(body.top_k, 20);
  assert.equal(body.top_p, 0.9);
  assert.equal(body.presence_penalty, 0.1);
  assert.equal(body.enable_thinking, false);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.model, 'fixture-upstream');
  assert.equal(body.temperature, 0.7);
});

test('agent requests carry this conversation prompt cache key only when the model opts in', async () => {
  const enabled = { ...config, customParameters: { promptCacheKey: true, top_k: 20 } };
  const first = gateway(reply('ok'));
  await createPiModelStream(enabled, { fetch: first.fetch, conversationId: 'conversation-a', cacheScope: 'member-a' })(piModel, context()).result();
  const [request] = first.requests;
  assert.equal(request.body.prompt_cache_key, promptCacheKey('member-a', 'conversation-a'));
  assert.equal(request.body.promptCacheKey, undefined, 'the switch is not a request field');
  assert.equal(request.body.top_k, 20);

  const same = gateway(reply('ok'));
  await createPiModelStream(enabled, { fetch: same.fetch, conversationId: 'conversation-a', cacheScope: 'member-a' })(piModel, context()).result();
  assert.equal(same.requests[0].body.prompt_cache_key, request.body.prompt_cache_key, 'stable within one conversation');

  const other = gateway(reply('ok'));
  await createPiModelStream(enabled, { fetch: other.fetch, conversationId: 'conversation-b', cacheScope: 'member-a' })(piModel, context()).result();
  assert.notEqual(other.requests[0].body.prompt_cache_key, request.body.prompt_cache_key);

  // Two members never share a partition, and a task whose owner is unknown sends no key at all.
  const otherMember = gateway(reply('ok'));
  await createPiModelStream(enabled, { fetch: otherMember.fetch, conversationId: 'conversation-a', cacheScope: 'member-b' })(piModel, context()).result();
  assert.notEqual(otherMember.requests[0].body.prompt_cache_key, request.body.prompt_cache_key);

  const ownerless = gateway(reply('ok'));
  await createPiModelStream(enabled, { fetch: ownerless.fetch, conversationId: 'conversation-a' })(piModel, context()).result();
  assert.equal(ownerless.requests[0].body.prompt_cache_key, undefined);

  const off = gateway(reply('ok'));
  await createPiModelStream({ ...config, customParameters: { promptCacheKey: false } }, { fetch: off.fetch, conversationId: 'conversation-a', cacheScope: 'member-a' })(piModel, context()).result();
  assert.equal(off.requests[0].body.prompt_cache_key, undefined);
  assert.equal(off.requests[0].body.promptCacheKey, undefined);
});

test('a response with nothing to show is asked once more with a note, and the answer joins the same message', async () => {
  const gw = gateway(sse([{ delta: { reasoning_content: '结论是火旺' } }, { finish_reason: 'stop', usage: USAGE }]), reply('火旺，宜用水。'));
  const { events, message } = await drain(createPiModelStream(config, { fetch: gw.fetch })(piModel, context(), { reasoning: 'high' }));
  assert.equal(message.stopReason, 'stop');
  assert.deepEqual(message.content.map(part => part.type), ['thinking', 'text']);
  assert.equal(message.usage.totalTokens, 16, 'both requests are counted');
  assert.equal(events.filter(event => event.type === 'start').length, 1);
  assert.equal(events.at(-1)?.type, 'done');
  assert.equal(gw.requests.length, 2);
  assert.doesNotMatch(systemText(gw.requests[0]), /no_output_recovery/);
  assert.ok(systemText(gw.requests[1]).includes(SILENT_TURN_NUDGE));

  const silent = gateway(sse([{ finish_reason: 'stop', usage: USAGE }]));
  const failed = await createPiModelStream(config, { fetch: silent.fetch })(piModel, context()).result();
  assert.equal(silent.requests.length, 2);
  assert.equal(failed.stopReason, 'error');
  assert.equal(failed.errorMessage, AGENT_SILENT_RESPONSE_MESSAGE);
  assert.ok(AGENT_PUBLIC_STREAM_ERRORS.has(failed.errorMessage!));
});

test('a response that only announces its next step is continued once; answers and questions are not', async () => {
  const gw = gateway(reply('我先排出八字命盘，再看大运流年。'), call('search', { query: '八字' }));
  const message = await createPiModelStream(config, { fetch: gw.fetch })(piModel, context()).result();
  assert.equal(message.stopReason, 'toolUse');
  assert.deepEqual(message.content.map(part => part.type), ['text', 'toolCall']);
  assert.equal(gw.requests.length, 2);
  assert.ok(systemText(gw.requests[1]).includes(PROGRESS_TURN_NUDGE));
  // Announcing again after the note ends the turn instead of looping.
  const stubborn = gateway(reply('我先排出八字命盘。'));
  assert.equal((await createPiModelStream(config, { fetch: stubborn.fetch })(piModel, context()).result()).stopReason, 'stop');
  assert.equal(stubborn.requests.length, 2);

  const final = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' }) as AssistantMessage;
  assert.equal(isProgressOnlyTurn(final('我先排出八字命盘，再看大运流年。')), true);
  assert.equal(isProgressOnlyTurn(final('Let me check the chart first.')), true);
  assert.equal(isProgressOnlyTurn(final('日主偏弱，接下来三年运势平稳。\n<followups>\n今年适合换工作吗\n</followups>')), false);
  assert.equal(isProgressOnlyTurn(final('我先排盘还是先看你的问题？')), false);
  assert.equal(isProgressOnlyTurn(final(`${'日主乙木生于巳月，'.repeat(50)}接下来我再看大运。`)), false, 'an analysis is long');
  assert.equal(isProgressOnlyTurn({ ...final('我先排盘。'), content: [{ type: 'text', text: '我先排盘。' }, { type: 'toolCall', id: 'c', name: 'search', arguments: {} }] }), false);
});

test('a response that spends the whole output budget thinking fails once with the reason, without another request', async () => {
  const gw = gateway(sse([{ delta: { reasoning_content: '先比较各个候选时辰……' } }, { finish_reason: 'length', usage: USAGE }]));
  const result = await createPiModelStream(config, { fetch: gw.fetch })(piModel, context(), { reasoning: 'high' }).result();
  assert.equal(result.stopReason, 'error');
  assert.equal(result.errorMessage, AGENT_OUTPUT_EXHAUSTED_MESSAGE);
  assert.ok(AGENT_PUBLIC_STREAM_ERRORS.has(result.errorMessage!), 'the task shows this reason instead of the generic failure');
  assert.equal(gw.requests.length, 1);
  // A cut-off answer is still an answer: only a budget with no text and no call is this failure.
  const cut = gateway(reply('日主乙木生于巳月', 'length'));
  assert.equal((await createPiModelStream(config, { fetch: cut.fetch })(piModel, context()).result()).stopReason, 'length');
});

test('source fallback and transient failures share three requests; quota, key and model errors are not retried', async () => {
  const busy = gateway(failure(503, 'server_busy'));
  let result = await createPiModelStream(sourced('a', 'b', 'c', 'd', 'e'), { fetch: busy.fetch })(piModel, context()).result();
  assert.equal(result.stopReason, 'error');
  assert.equal(result.errorMessage, AGENT_TRANSIENT_ERROR_MESSAGE, 'Pi retries the whole request after a backoff');
  assert.deepEqual(busy.requests.map(request => new URL(request.url).hostname), ['a.example', 'b.example', 'c.example']);

  const offline = gateway(() => { throw new TypeError('fetch failed'); });
  assert.equal((await createPiModelStream(config, { fetch: offline.fetch })(piModel, context()).result()).errorMessage, AGENT_TRANSIENT_ERROR_MESSAGE);
  assert.equal(offline.requests.length, 3);
  const upstreamError = gateway(sse([{ finish_reason: 'error', usage: USAGE }]));
  assert.equal((await createPiModelStream(config, { fetch: upstreamError.fetch })(piModel, context()).result()).errorMessage, AGENT_TRANSIENT_ERROR_MESSAGE);
  assert.equal(upstreamError.requests.length, 3);

  for (const [response, expected] of [
    [failure(429, 'insufficient_quota'), '模型调用失败，请确认模型支持工具调用或切换普通对话'],
    [failure(401, 'invalid api key'), AGENT_REJECTED_KEY_MESSAGE],
    [failure(404, 'model not found'), AGENT_UNKNOWN_MODEL_MESSAGE],
    [failure(400, 'tools is not supported for this model'), AGENT_UNSUPPORTED_TOOLS_MESSAGE],
  ] as const) {
    const gw = gateway(response);
    result = await createPiModelStream(config, { fetch: gw.fetch })(piModel, context()).result();
    assert.equal(result.errorMessage, expected);
    assert.equal(gw.requests.length, 1);
  }
});

test('a failing source falls back before anything is shown, never after; provider errors stay private', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const first = gateway(failure(500, 'private provider error api-key-secret'), reply('fallback success'));
  let result = await createPiModelStream(sourced('first', 'second'), { fetch: first.fetch })(piModel, context()).result();
  assert.equal(result.stopReason, 'stop');
  assert.deepEqual(first.requests.map(request => new URL(request.url).hostname), ['first.example', 'second.example']);

  const encoder = new TextEncoder();
  // Pulled one read at a time, so the text arrives before the connection breaks.
  let reads = 0;
  const partial = gateway(() => new Response(new ReadableStream({
    pull(controller) {
      if (reads++ === 0) controller.enqueue(encoder.encode(frame({ delta: { content: 'already visible' } })));
      else controller.error(new Error('api-key-secret'));
    },
  }), { headers: { 'content-type': 'text/event-stream' } }), reply('fallback success'));
  const { events, message } = await drain(createPiModelStream(sourced('first', 'second'), { fetch: partial.fetch })(piModel, context()));
  assert.equal(message.stopReason, 'error');
  assert.equal(partial.requests.length, 1);
  assert.equal(message.content[0].type === 'text' && message.content[0].text, 'already visible');
  assert.equal(events.some(event => event.type === 'done'), false);
  assert.ok(!JSON.stringify(message).includes('api-key-secret'));
  result = await createPiModelStream(config, { fetch: gateway(failure(400, 'context_length_exceeded private-user-content secret-key')).fetch })(piModel, context()).result();
  assert.equal(isContextOverflow(result), true);
  assert.doesNotMatch(JSON.stringify(result), /private-user-content|secret-key/);
  assert.equal(logged.mock.callCount(), 0);
});

test('cached input maps to Pi usage without double-counting', async () => {
  const gw = gateway(sse([{ delta: { content: 'answer' } }, { finish_reason: 'stop', usage: { prompt_tokens: 900, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 30 } } }]));
  const { usage } = await createPiModelStream(config, { fetch: gw.fetch })(piModel, context()).result();
  assert.deepEqual([usage.input, usage.cacheRead, usage.cacheWrite, usage.output, usage.reasoning, usage.totalTokens], [600, 200, 100, 100, 30, 1000]);
});

test('the first content and each request usage reach the run telemetry', async () => {
  const seen = { first: 0, usages: [] as Array<{ input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number }> };
  const telemetry = {
    firstToken: () => { seen.first += 1; },
    usage: (usage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number }) => { seen.usages.push(usage); },
  };
  const gw = gateway(sse([{ delta: { content: 'answer' } }, { finish_reason: 'stop', usage: {
    prompt_tokens: 900, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
  } }]));
  await createPiModelStream(config, { fetch: gw.fetch, telemetry })(piModel, context()).result();
  assert.equal(seen.first, 1, 'the first streamed content is timed once per request');
  assert.equal(seen.usages.length, 1);
  assert.deepEqual([seen.usages[0]?.input, seen.usages[0]?.cacheRead, seen.usages[0]?.cacheWrite, seen.usages[0]?.output],
    [600, 200, 100, 100], 'cache-read tokens are kept for the run metrics');
});

test('a stream that ends without a finish reason fails, keeping the partial text and sending no done event', async () => {
  const gw = gateway(sse([{ delta: { content: 'partial' } }], { done: false }));
  const { events, message } = await drain(createPiModelStream(config, { fetch: gw.fetch })(piModel, context()));
  assert.equal(message.stopReason, 'error');
  assert.equal(events.some(event => event.type === 'done'), false);
  assert.equal(events.at(-1)?.type, 'error');
  assert.equal(message.content[0].type, 'text');
  const filtered = gateway(sse([{ delta: { content: 'partial' } }, { finish_reason: 'content_filter', usage: USAGE }]));
  assert.equal((await createPiModelStream(config, { fetch: filtered.fetch })(piModel, context()).result()).stopReason, 'error');
});

test('the request time limit and a user stop both end the stream after partial output, without another request', async t => {
  // One mock for both runs: a second mock of the same method would restore to the first, aborted one.
  let timeout = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
  for (const scenario of ['timeout', 'user'] as const) {
    timeout = new AbortController();
    const user = new AbortController();
    const encoder = new TextEncoder();
    const gw = gateway((_request, init) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(frame({ delta: { content: 'partial' } })));
        init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true });
      },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const stream = createPiModelStream(config, { fetch: gw.fetch })(piModel, context(), { signal: user.signal });
    const events = [];
    for await (const event of stream) {
      events.push(event);
      if (event.type !== 'text_delta') continue;
      if (scenario === 'timeout') timeout.abort(new DOMException('timed out', 'TimeoutError'));
      else user.abort();
    }
    const message = await stream.result();
    assert.equal(message.stopReason, scenario === 'timeout' ? 'error' : 'aborted');
    assert.equal(message.errorMessage, scenario === 'timeout' ? AGENT_TIMEOUT_MESSAGE : '任务已停止');
    assert.equal(events.some(event => event.type === 'done'), false, scenario);
    assert.equal(gw.requests.length, 1);
  }
});

test('a user key goes only to the user URL, and images reach a vision model as image parts', async () => {
  const image = { type: 'image' as const, data: Buffer.from('png').toString('base64'), mimeType: 'image/png' };
  let resolved = 0;
  const gw = gateway(reply('看到了'));
  await createPiModelStream(sourced('platform'), {
    apiKey: 'ephemeral-fixture', fetch: gw.fetch,
    resolveImages: async messages => { resolved++; return messages.map(message => message.role === 'user' ? { ...message, content: [{ type: 'text', text: '看图' }, image] } : message); },
  })({ ...piModel, input: ['text', 'image'] }, context()).result();
  const [request] = gw.requests;
  assert.equal(resolved, 1);
  assert.equal(request.url, 'https://model.example/v1/chat/completions');
  assert.equal(request.headers.get('authorization'), 'Bearer ephemeral-fixture');
  assert.deepEqual(request.body.messages.at(-1)?.content, [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${image.data}` } }]);
  // A text model never loads them.
  await createPiModelStream(config, { fetch: gateway(reply('ok')).fetch, resolveImages: async () => { throw new Error('text model must not load images'); } })(piModel, context()).result();
});

test('summaries keep guarded source fallback and send no thinking fields', async () => {
  const gw = gateway(failure(503, 'server_busy private upstream details'), reply('保留原盘事实和引用来源'));
  const nativeModel = { ...piModel, reasoning: true, input: ['text', 'image'] } as Model<Api>;
  let checks = 0;
  const models = createGuardedAgentModels(nativeModel, createPiModelStream({ ...sourced('first', 'second'), vendor: 'deepseek' }, { fetch: gw.fetch, resolveImages: async () => { throw new Error('summary must remain text-only'); } }), async () => { checks++; });
  const result = await generateSummary({ models }, nativeModel, [{ role: 'user', content: '目标与已确认资料', timestamp: 1 }], BACKGROUND_CONTEXT);
  assert.equal(result.summary, '保留原盘事实和引用来源');
  assert.equal(checks, 1);
  assert.deepEqual(gw.requests.map(request => new URL(request.url).hostname), ['first.example', 'second.example']);
  assert.equal(gw.requests[1].body.max_tokens, 2000);
  assert.equal(gw.requests[1].body.enable_thinking, undefined);
  assert.equal(result.usage.totalTokens, 8);
});
