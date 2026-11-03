import 'server-only';
import type { NextRequest } from 'next/server';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { getByokPolicy } from '@/lib/app-settings';
import { recordDirectUsage, type BillingSource } from '@/lib/billing/account.server';
import { MODEL_REQUEST_USER_AGENT } from '@/lib/ai/providers/ai-sdk-provider';
import { agentSafeFetch } from '@/lib/agent/safe-fetch.server';
import { userDb, type ScopedDb } from '@/lib/db/context.server';
import { AI_RATE_LIMIT_CONFIG, checkRateLimit } from '@/lib/rate-limit';
import { prepareBrowserDirectChatRequest, type ChatRequestBody } from '@/lib/server/chat/request';
import { byokFailureFromMessage, byokThinking, formatByokError, type ByokThinking } from './config';
import { byokContext, byokRequestModel, collectByokStream, streamByok, type ByokChatMessage, type ByokStreamResult } from './pi-model';
import { ByokKeyError } from './secrets.server';
import { byokServerUnavailable, resolveByokModel, type ResolvedByokModel } from './store.server';
import { byokGate } from './api.server';

/** The stored key of a model the site may call, or the member-facing reason it cannot. */
export function openServerKey(model: ResolvedByokModel): { key: string } | { error: string } {
  try {
    const key = model.openKey();
    return key ? { key } : { error: '这个模型的 Key 只保存在你的浏览器里，本站不能代为请求' };
  } catch (error) {
    if (error instanceof ByokKeyError) return { error: '保存的 Key 无法读取，请在「设置 → 自定义模型」重新填写' };
    throw error;
  }
}

/**
 * One request on an own model whose key is stored here, read to its end; usage lands in the log at $0. `onText` and
 * `onReasoning` receive the text as it streams.
 */
export async function runServerByok(
  model: ResolvedByokModel,
  input: {
    userId: string; key: string; systemPrompt: string; messages: ByokChatMessage[]; thinking: ByokThinking; signal?: AbortSignal;
    source: BillingSource; reference?: { type: string; id: string };
    onText?: (delta: string) => void; onReasoning?: (delta: string) => void;
  },
): Promise<ByokStreamResult> {
  const result = await collectByokStream(streamByok(byokRequestModel(model, model.connection), byokContext(input.systemPrompt, input.messages), {
    apiKey: input.key, thinking: input.thinking, signal: input.signal, fetch: agentSafeFetch, userAgent: MODEL_REQUEST_USER_AGENT,
  }), { onText: input.onText, onReasoning: input.onReasoning });
  if (result.usage) {
    await recordDirectUsage({
      userId: input.userId, model: model.modelId, usage: result.usage, source: input.source,
      ...(input.reference ? { referenceType: input.reference.type, referenceId: input.reference.id } : {}),
    });
  }
  return result;
}

/** The member's own model, its key and the reason it cannot run here; shared by the routes that take a `byok:` reference. */
export async function serverByokModel(
  db: ScopedDb, userId: string, ref: string, usage: 'chat' | 'image' = 'chat',
): Promise<{ model: ResolvedByokModel; key: string } | { error: string }> {
  const model = await resolveByokModel(db, userId, ref, await getByokPolicy());
  const unavailable = byokServerUnavailable(model, usage);
  if (unavailable || !model) return { error: unavailable ?? '自定义模型不存在' };
  const opened = openServerKey(model);
  if ('error' in opened) return opened;
  return { model, key: opened.key };
}

const SERVER_BYOK_RATE_LIMIT_KEY = '/api/byok/server';

/** A completion that ended without an answer, worded for the two causes the providers actually show. */
function emptyAnswerMessage(result: ByokStreamResult): string {
  if (result.stopReason === 'length') return '模型在输出上限处结束，没有生成回答。请重试，或把推理档位调低后再试。';
  if (result.reasoning.trim()) return '模型只输出了思考过程，没有生成回答。请重试，或把推理档位调低后再试。';
  return '模型没有返回内容，请重试。';
}

/**
 * One whole answer from a stored-key own model, for the routes that return text rather than a stream (polishing, photo
 * reading). The model's thinking parameters stay unset unless `thinking` says otherwise.
 */
export async function serverByokText(input: {
  userId: string; ref: string; systemPrompt: string; content: ByokChatMessage['content']; source: BillingSource;
  thinking?: ByokThinking; signal?: AbortSignal; reference?: { type: string; id: string };
}): Promise<{ text: string; model: ResolvedByokModel } | { error: string; status: number }> {
  const resolved = await serverByokModel(userDb(input.userId), input.userId, input.ref);
  if ('error' in resolved) return { error: resolved.error, status: 400 };
  if (!(await checkRateLimit(input.userId, SERVER_BYOK_RATE_LIMIT_KEY, AI_RATE_LIMIT_CONFIG)).allowed) return { error: '请求过于频繁，请稍后再试', status: 429 };
  const result = await runServerByok(resolved.model, {
    userId: input.userId, key: resolved.key, systemPrompt: input.systemPrompt, messages: [{ role: 'user', content: input.content }],
    thinking: input.thinking ?? { mode: 'auto' }, signal: input.signal, source: input.source, reference: input.reference,
  });
  if (result.error) return { error: formatByokError(byokFailureFromMessage(result.error)), status: result.aborted ? 499 : 502 };
  return { text: result.content, model: resolved.model };
}

/**
 * A chat turn on an own model whose key is stored here: prepared like a browser call (no balance, own rate limit),
 * sent through pi-ai from this server, and streamed in the UI message format the chat client reads.
 */
export async function handleServerByokChat(request: NextRequest, body: ChatRequestBody, ref: string): Promise<Response> {
  const gate = await byokGate();
  if (gate) return gate;
  const prepared = await prepareBrowserDirectChatRequest(request, body);
  if (prepared instanceof Response) return prepared;
  if (!prepared.userId) return jsonError('请先登录后再使用 AI 对话', 401, { code: 'AUTH_REQUIRED' });
  const userId = prepared.userId;
  const resolved = await serverByokModel(userDb(userId), userId, ref);
  if ('error' in resolved) return jsonError(resolved.error, 400, { code: 'BYOK_UNAVAILABLE' });
  const { model, key } = resolved;
  const messages: ByokChatMessage[] = prepared.sanitizedMessages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({ role: message.role as 'user' | 'assistant', content: message.content }));
  const thinking = byokThinking(body.reasoning === true, body.reasoningEffort ?? null, model.thinkingLevels);
  const reference = body.conversationId ? { type: 'conversation', id: body.conversationId } : undefined;
  const run = (handlers: { onText?: (delta: string) => void; onReasoning?: (delta: string) => void }) => runServerByok(model, {
    userId, key, systemPrompt: prepared.systemPrompt, messages, thinking, signal: request.signal, source: 'chat', reference, ...handlers,
  });

  if (!body.stream) {
    const result = await run({});
    if (result.error) return jsonError(formatByokError(byokFailureFromMessage(result.error)), 502, { code: 'BYOK_REQUEST_FAILED' });
    if (!result.aborted && !result.content.trim()) return jsonError(emptyAnswerMessage(result), 502, { code: 'BYOK_EMPTY_ANSWER' });
    return jsonOk({ content: result.content, metadata: prepared.metadata });
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: 'start', messageMetadata: prepared.metadata });
      let open: 'reasoning' | 'text' | null = null;
      const enter = (part: 'reasoning' | 'text') => {
        if (open === part) return;
        if (open) writer.write({ type: open === 'reasoning' ? 'reasoning-end' : 'text-end', id: open });
        writer.write({ type: part === 'reasoning' ? 'reasoning-start' : 'text-start', id: part });
        open = part;
      };
      const result = await run({
        onReasoning: delta => { enter('reasoning'); writer.write({ type: 'reasoning-delta', id: 'reasoning', delta }); },
        onText: delta => { enter('text'); writer.write({ type: 'text-delta', id: 'text', delta }); },
      });
      if (open) writer.write({ type: open === 'reasoning' ? 'reasoning-end' : 'text-end', id: open });
      if (result.error && !result.aborted) writer.write({ type: 'error', errorText: formatByokError(byokFailureFromMessage(result.error)) });
      else if (!result.aborted && !result.content.trim()) writer.write({ type: 'error', errorText: emptyAnswerMessage(result) });
      else writer.write({ type: 'finish' });
    },
    onError: error => formatByokError(byokFailureFromMessage(error instanceof Error ? error.message : String(error))),
  });
  return createUIMessageStreamResponse({
    stream,
    headers: { 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
  });
}
