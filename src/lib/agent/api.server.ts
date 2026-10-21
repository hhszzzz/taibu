import "server-only";
import { AGENT_STREAM_QUEUE_BYTES, enqueueAgentFrame, type AgentResync } from './sse';
import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { parseAgentMcpServers } from './mcp-client.server';
import { jsonError, jsonOk, requireUserContext } from "@/lib/api-utils";
import { systemDb } from "@/lib/db/context.server";
import { getGlobalAIFeatureGuardResponse } from "@/lib/api/ai-feature-guard";
import { readFeatureModuleStateFresh } from "@/lib/app-settings";
import {
  getDefaultModelConfigAsync,
  getModelConfigAsync,
} from "@/lib/server/ai-config";
import {
  isModelAllowedForMembership,
  isReasoningAllowedForMembership,
} from "@/lib/ai/ai-access";
import { buildChatPromptContext } from "@/lib/server/chat/prompt-context";
import { isChatAttachment } from "@/lib/ai/document-formats";
import { webSearchConfigured } from "@/lib/ai/web-search.server";
import { getUserAuthInfo } from "@/lib/user/credits";
import { AI_RATE_LIMIT_CONFIG, checkRateLimit } from "@/lib/rate-limit";
import { isValidUUID } from "@/lib/validation";
import type { ChatMessage, CustomProviderRequest, Mention } from "@/types";
import { isDataSourceType } from "@/lib/data-sources/types";
import { validateCustomProviderInput } from "@/lib/ai/custom-provider-url";
import {
  AgentStore,
  type AgentRunRow,
  type AgentCommandRow,
} from "./store.server";
import { encryptAgentCredential } from "./credentials.server";
import { validateAgentProviderUrl } from "./safe-fetch.server";
import { isAgentRunTerminal, type AgentCheckpoint } from "./types";
import { AGENT_ENGINE, isCurrentAgentCheckpoint } from "./engine";
import { parseReasoningEffort, parseAgentCollaborators } from '@/lib/chat/model-settings';
import { piHistory } from "./history.server";
import { normalizeQuestions, validateAnswers, formatQuestionAnswers } from './questions';
import { validateAttachmentIds } from './attachments.server';
import { getAgentCitationBase } from './evidence';
import { readAgentActivity } from './activity.server';
import { AGENT_COMPACT_INSTRUCTIONS_MAX, parseAgentCompactCommand } from './compaction';
import { getAgentArchiveProposal } from './archive';
import { readAgentArchiveStatus } from './archive.server';

class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "AGENT_REQUEST_INVALID",
  ) {
    super(message);
  }
}
/** `/compact` is free, so it has its own, stricter bucket instead of the shared chat admission. */
export const AGENT_COMPACT_RATE_LIMIT = { maxRequests: 10, windowMs: 3_600_000 } as const;
export function hashAgentRequest(value: unknown) {
  const canonical = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(canonical)
      : input && typeof input === "object"
        ? Object.fromEntries(
            Object.entries(input)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => [key, canonical(value)]),
          )
        : input;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AgentApiError("请求参数无效");
  return value as Record<string, unknown>;
}
async function requestBody(request: NextRequest) {
  try {
    return object(await request.json());
  } catch {
    throw new AgentApiError("请求体不是合法 JSON 对象");
  }
}
function createBody(value: Record<string, unknown>) {
  let reasoningEffort, collaborators;
  try { reasoningEffort = parseReasoningEffort(value.reasoningEffort); collaborators = parseAgentCollaborators(value.collaborators); }
  catch (error) { throw new AgentApiError(error instanceof Error ? error.message : '模型配置无效'); }
  const message = object(value.message);
  if (
    typeof value.conversationId !== "string" ||
    !isValidUUID(value.conversationId) ||
    typeof value.clientRequestId !== "string" ||
    !value.clientRequestId.trim() ||
    value.clientRequestId.length > 160
  )
    throw new AgentApiError("任务标识无效");
  if (
    typeof message.content !== "string" ||
    !message.content.trim() ||
    typeof message.id !== "string" ||
    !message.id.trim()
  )
    throw new AgentApiError("消息内容无效");
  if (
    (value.model !== undefined && typeof value.model !== "string") ||
    (value.replaceFromMessageId !== undefined &&
      typeof value.replaceFromMessageId !== "string")
  )
    throw new AgentApiError("模型或消息标识无效");
  const mentions: Mention[] = [];
  if (value.mentions !== undefined) {
    if (!Array.isArray(value.mentions)) throw new AgentApiError("资料引用无效");
    for (const item of value.mentions.slice(0, 20)) {
      const mention = object(item);
      if (
        (mention.type !== "knowledge_base" &&
          !isDataSourceType(mention.type)) ||
        typeof mention.name !== "string" ||
        typeof mention.preview !== "string" ||
        (mention.id !== undefined &&
          (typeof mention.id !== "string" || !isValidUUID(mention.id)))
      )
        throw new AgentApiError("资料引用无效");
      mentions.push({
        type: mention.type,
        name: mention.name,
        preview: mention.preview,
        ...(typeof mention.id === "string" ? { id: mention.id } : {}),
      });
    }
  }
  let customProvider: CustomProviderRequest | undefined;
  if (value.customProvider !== undefined) {
    const custom = object(value.customProvider);
    if (
      typeof custom.apiUrl !== "string" ||
      typeof custom.apiKey !== "string" ||
      typeof custom.modelId !== "string"
    )
      throw new AgentApiError("自定义模型配置无效");
    customProvider = {
      apiUrl: custom.apiUrl,
      apiKey: custom.apiKey,
      modelId: custom.modelId,
    };
  }
  const attachments =
    message.attachments === undefined ? undefined : object(message.attachments);
  if (value.attachment !== undefined && !isChatAttachment(value.attachment))
    throw new AgentApiError("附件内容无效");
  return {
    conversationId: value.conversationId,
    clientRequestId: value.clientRequestId,
    message: {
      id: message.id,
      content: message.content,
      attachments: {
        ids: attachments?.ids,
        fileName:
          typeof attachments?.fileName === "string"
            ? attachments.fileName
            : undefined,
      },
    },
    model: value.model as string | undefined,
    replaceFromMessageId: value.replaceFromMessageId as string | undefined,
    mentions,
    customProvider,
    webEnabled: value.webEnabled !== false,
    codeMode: value.codeMode === true,
    planMode: value.planMode === true,
    reasoning: value.reasoning === true,
    reasoningEffort,
    collaborators,
    dreamMode: value.dreamMode === true,
    mangpaiMode: value.mangpaiMode === true,
    /** A plain chat document carried into Agent mode, as text the server extracted. */
    attachment: value.attachment,
  };
}

async function authenticated(request: NextRequest) {
  const auth = await requireUserContext(request);
  if ("error" in auth)
    throw new AgentApiError(
      auth.error.message,
      auth.error.status,
      "AUTH_REQUIRED",
    );
  return auth;
}
export async function agentEndpoint(action: () => Promise<Response>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AgentApiError)
      return jsonError(error.message, error.status, { code: error.code });
    const message = error instanceof Error ? error.message : "";
    const known: Record<string, [string, number, string]> = {
      INSUFFICIENT_CREDITS: ["积分不足", 402, "INSUFFICIENT_CREDITS"],
      AGENT_CONVERSATION_BUSY: [
        "当前对话有未结束任务",
        409,
        "CONVERSATION_BUSY",
      ],
      AGENT_REQUEST_MISMATCH: [
        "同一请求标识对应了不同内容",
        409,
        "REQUEST_MISMATCH",
      ],
      AGENT_QUESTION_ALREADY_ANSWERED: [
        "该问题已经提交过答案，请等待任务继续",
        409,
        "QUESTION_ALREADY_ANSWERED",
      ],
      AGENT_RUN_CLOSED: ["任务已结束，请重新发送", 409, "AGENT_RUN_CLOSED"],
      AGENT_CREDENTIAL_KEY_NOT_CONFIGURED: [
        "自定义模型任务的加密服务未配置",
        503,
        "AGENT_CREDENTIAL_KEY_NOT_CONFIGURED",
      ],
    };
    for (const [key, [text, status, code]] of Object.entries(known))
      if (message.includes(key)) return jsonError(text, status, { code });
    console.warn("[agent-api]", { code: "AGENT_SERVICE_ERROR" });
    return jsonError("任务服务暂时不可用", 503, {
      code: "AGENT_SERVICE_ERROR",
    });
  }
}
export async function agentCapabilities(request: NextRequest) {
  await authenticated(request);
  const state = await readFeatureModuleStateFresh("agent");
  const store = new AgentStore(systemDb());
  let mcpAvailable = false;
  try { mcpAvailable = parseAgentMcpServers().length > 0; } catch { /* Invalid administrator config cannot advertise network access. */ }
  return jsonOk({
    enabled: state.status === "enabled",
    ready: state.status === "enabled" && (await store.workerReady()),
    webAvailable: webSearchConfigured() || mcpAvailable,
    plainWebAvailable: webSearchConfigured(),
    customAvailable: !!process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY,
  });
}

export async function createAgentTask(request: NextRequest) {
  const guard = await getGlobalAIFeatureGuardResponse();
  if (guard) return guard;
  const auth = await authenticated(request);
  if ((await readFeatureModuleStateFresh("agent")).status !== "enabled")
    throw new AgentApiError("Agent 功能未启用", 403, "FEATURE_DISABLED");
  const body = createBody(await requestBody(request));
  // `/compact` compacts the idle conversation for the next task instead of asking the model.
  const compact = parseAgentCompactCommand(body.message.content);
  if (compact) {
    if ((compact.instructions?.length ?? 0) > AGENT_COMPACT_INSTRUCTIONS_MAX)
      throw new AgentApiError(`压缩说明最多 ${AGENT_COMPACT_INSTRUCTIONS_MAX} 字`);
    if ((Array.isArray(body.message.attachments.ids) && body.message.attachments.ids.length) || body.message.attachments.fileName || body.mentions.length || body.attachment !== undefined)
      throw new AgentApiError("压缩上下文时不能附带资料或引用");
  }
  const store = new AgentStore(systemDb());
  const custom: CustomProviderRequest | undefined = body.customProvider
    ? {
        apiUrl: body.customProvider.apiUrl,
        apiKey: body.customProvider.apiKey,
        modelId: body.customProvider.modelId,
      }
    : undefined;
  if (
    custom &&
    (!["apiUrl", "apiKey", "modelId"].every(
      (key) => typeof custom[key as keyof CustomProviderRequest] === "string",
    ) ||
      Object.keys(validateCustomProviderInput(custom)).length)
  )
    throw new AgentApiError("自定义模型配置无效");
  if (custom) {
    try {
      validateAgentProviderUrl(custom.apiUrl);
    } catch {
      throw new AgentApiError("自定义模型必须使用公开 HTTPS 地址");
    }
  }
  const requestHash = hashAgentRequest({
    conversationId: body.conversationId,
    messageId: body.message.id,
    content: body.message.content,
    attachmentIds: body.message.attachments.ids ?? [],
    model: body.model ?? null,
    custom: custom
      ? { ...custom, apiKey: hashAgentRequest(custom.apiKey) }
      : null,
    webEnabled: body.webEnabled !== false,
    codeMode: body.codeMode,
    planMode: body.planMode,
    reasoning: body.reasoning === true,
    reasoningEffort: body.reasoningEffort,
    collaborators: body.collaborators,
    replaceFromMessageId: body.replaceFromMessageId ?? null,
    mentions: Array.isArray(body.mentions) ? body.mentions : [],
    attachment: body.attachment ?? null,
    dreamMode: body.dreamMode === true,
    mangpaiMode: body.mangpaiMode === true,
  });
  const existing = await store.db.tx((trx) => trx
    .selectFrom("agent_runs")
    .selectAll()
    .where("user_id", "=", auth.user.id)
    .where("request_id", "=", body.clientRequestId)
    .executeTakeFirst());
  if (existing) {
    if (existing.request_hash !== requestHash)
      throw new AgentApiError(
        "同一请求标识对应了不同内容",
        409,
        "REQUEST_MISMATCH",
      );
    return jsonOk(await store.view(existing as unknown as AgentRunRow));
  }
  if (!(await store.workerReady()))
    throw new AgentApiError(
      "后台任务服务未就绪，可切换普通对话",
      503,
      "AGENT_WORKER_UNAVAILABLE",
    );
  const conversation = await auth.db.tx((trx) => trx
    .selectFrom("conversations")
    .select(["id", "messages", "title"])
    .where("id", "=", body.conversationId)
    .where("user_id", "=", auth.user.id)
    .executeTakeFirst());
  if (!conversation)
    throw new AgentApiError("对话不存在", 404, "CONVERSATION_NOT_FOUND");
  let history = (conversation.messages ?? []) as unknown as ChatMessage[];
  if (body.replaceFromMessageId) {
    const index = history.findIndex(
      (m) => m.id === body.replaceFromMessageId && m.role === "user",
    );
    if (index < 0) throw new AgentApiError("找不到需要编辑的消息");
    if (history[index].metadata?.forkHistory === true) throw new AgentApiError('分叉历史只读，请发送新问题', 409);
    history = history.slice(0, index);
  }
  if (compact && !history.length) throw new AgentApiError("当前对话还没有可压缩的内容");
  const account = await getUserAuthInfo(auth.user.id, {
    db: auth.db,
    user: auth.user,
  });
  const config = custom
    ? undefined
    : body.model
      ? await getModelConfigAsync(body.model)
      : await getDefaultModelConfigAsync("chat");
  if (!custom && !config) throw new AgentApiError("模型不存在");
  const attachments = await validateAttachmentIds(store.db,auth.user.id,body.message.attachments.ids).catch(error => { throw new AgentApiError(error.message); });
  if (attachments.some(item => item.kind === 'image') && (custom || !config?.supportsVision)) throw new AgentApiError('图片资料需要平台视觉模型的 Agent 模式',400);
  if (
    config &&
    !isModelAllowedForMembership(config, account.effectiveMembership)
  )
    throw new AgentApiError(
      "当前会员不能使用该模型",
      403,
      "MEMBERSHIP_REQUIRED",
    );
  // Compaction is free and has its own rate limit, so it needs no credits; it uses no collaborators either.
  if (!custom && !compact && !account.hasCredits)
    throw new AgentApiError("积分不足", 402, "INSUFFICIENT_CREDITS");
  const collaborators = compact ? [] : body.collaborators;
  if (custom && collaborators.length) throw new AgentApiError('多模型协作需要使用平台模型；可在模型菜单中关闭协作');
  for (const member of collaborators) {
    const selected = await getModelConfigAsync(member.model);
    if (!selected) throw new AgentApiError(`协作模型不存在：${member.name}`);
    if (!isModelAllowedForMembership(selected, account.effectiveMembership) ||
      (member.reasoning && !isReasoningAllowedForMembership(selected, account.effectiveMembership)))
      throw new AgentApiError(`当前会员不能使用 ${member.name} 的模型或推理配置`, 403, 'MEMBERSHIP_REQUIRED');
  }
  const limit = compact
    ? await checkRateLimit(auth.user.id, "/api/agent/compact", AGENT_COMPACT_RATE_LIMIT)
    : await checkRateLimit(auth.user.id, "/api/chat", AI_RATE_LIMIT_CONFIG);
  if (!limit.allowed)
    throw new AgentApiError(compact ? "压缩上下文过于频繁，请稍后再试" : "请求过于频繁，请稍后再试", 429, "RATE_LIMITED");
  const modelId = config?.id ?? custom!.modelId;
  const reasoning =
    !!config &&
    isReasoningAllowedForMembership(config, account.effectiveMembership) &&
    body.reasoning === true;
  const runId = randomUUID();
  const credential = custom
    ? encryptAgentCredential(custom.apiKey, auth.user.id, runId)
    : null;
  const userMessage: ChatMessage = {
    id: body.message.id,
    role: "user",
    content: body.message.content,
    createdAt: new Date().toISOString(),
  };
  if (Array.isArray(body.mentions)) userMessage.mentions = body.mentions;
  if (typeof body.message.attachments?.fileName === "string" || attachments.length)
    userMessage.attachments = {
      fileName: body.message.attachments.fileName ?? attachments.map(item=>item.name).join('、'),
      ids: attachments.map(item=>item.id),
      webSearchEnabled: body.webEnabled !== false,
    };
  const prepared = await buildChatPromptContext(
    {
      body: {
        messages: [...history, userMessage],
        model: modelId,
        reasoning,
        mangpaiMode: body.mangpaiMode === true,
        dreamMode: body.dreamMode === true,
        mentions: body.mentions,
        attachment: body.attachment,
      },
      userId: auth.user.id,
      requestedModelId: modelId,
      membershipType: account.effectiveMembership,
      reasoningEnabled: reasoning,
      creditDeducted: false,
      canSkipCredit: !!custom,
    },
    { deferKnowledgeSearch: true },
  );
  const previous = body.replaceFromMessageId
    ? null
    : await store.currentRun(body.conversationId, auth.user.id);
  const replay =
    previous?.status === "completed" && isCurrentAgentCheckpoint(previous.checkpoint) &&
    history.at(-1)?.id === previous.public_message.id
      ? previous.checkpoint.messages.filter((m) => m.role !== "system")
      : null;
  // The new turn as prepared, so a continued task also reads the document the message carries.
  const turn = prepared.sanitizedMessages.at(-1) ?? userMessage;
  const checkpoint: AgentCheckpoint = {
    version: 2,
    durable: { engine: AGENT_ENGINE },
    messages: replay
      ? [...replay, ...piHistory([{ ...turn, attachments: userMessage.attachments }])]
      : piHistory(prepared.sanitizedMessages.map(message => ({ ...message, attachments: message.id === userMessage.id ? userMessage.attachments : history.find(item => item.id === message.id)?.attachments }))),
    parts: [],
    // Evidence numbers continue across the visible branch, so a new answer never reuses one.
    citations: { base: getAgentCitationBase(history), calls: {} },
    // Background subagents continue with the context they belong to; a rebuilt context starts without them.
    ...(replay && previous?.checkpoint.background?.length ? { background: previous.checkpoint.background } : {}),
  };
  const assistant: ChatMessage = {
    id: `agent:${runId}`,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    model: modelId,
    modelName: config?.name ?? modelId,
    agent: { version: 1, runId, status: "queued", parts: [] },
    metadata: prepared.metadata,
  };
  const input = {
    model: modelId,
    reasoning,
    reasoningEffort: reasoning ? body.reasoningEffort : null,
    collaborators,
    // A compaction calls no tools: it only summarizes the context.
    webEnabled: !compact && body.webEnabled !== false,
    codeMode: !compact && body.codeMode,
    planMode: !compact && body.planMode,
    ...(compact ? { compact } : {}),
    systemPrompt: prepared.systemPrompt,
    memoryEnabled: prepared.agentMemoryEnabled === true,
    knowledgeBaseIds: prepared.promptKnowledgeBases.map((kb) => kb.id),
    userMessage,
    title: body.message.content.slice(0, 60),
    replaceFromMessageId: body.replaceFromMessageId ?? null,
    ...(custom
      ? { customProvider: { apiUrl: custom.apiUrl, modelId: custom.modelId } }
      : {}),
  };
  const run = await store.rpc<AgentRunRow>("agent_create_run", {
    p_id: runId,
    p_user_id: auth.user.id,
    p_conversation_id: body.conversationId,
    p_request_id: body.clientRequestId,
    p_request_hash: requestHash,
    p_input: input,
    p_checkpoint: checkpoint,
    p_message: assistant,
    p_credential: credential,
    p_charge: !custom && !compact,
  });
  return jsonOk(await store.view(run), 201);
}

export async function getAgentTask(request: NextRequest, id?: string) {
  if (id && !isValidUUID(id)) throw new AgentApiError("任务标识无效");
  const auth = await authenticated(request);
  const store = new AgentStore(systemDb());
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!id && (!conversationId || !isValidUUID(conversationId)))
    throw new AgentApiError("对话标识无效");
  const run = id
    ? await store.getRun(id, auth.user.id)
    : await store.currentRun(conversationId!, auth.user.id);
  if (!run && id)
    throw new AgentApiError("任务不存在", 404, "AGENT_RUN_NOT_FOUND");
  return jsonOk(run ? await store.view(run) : null);
}

/** Sidebar markers: the caller's active runs and unread task notices, read under their own RLS. */
export async function getAgentActivity(request: NextRequest) {
  const auth = await authenticated(request);
  return jsonOk(await readAgentActivity(auth.db, auth.user.id, request.signal));
}

export async function controlAgentTask(
  request: NextRequest,
  id: string,
  action: "cancel" | "message",
) {
  if (!isValidUUID(id)) throw new AgentApiError("任务标识无效");
  const auth = await authenticated(request);
  const store = new AgentStore(systemDb());
  const run = await store.getRun(id, auth.user.id);
  if (!run) throw new AgentApiError("任务不存在", 404, "AGENT_RUN_NOT_FOUND");
  if (action === "cancel") {
    await store.rpc("agent_cancel_run", { p_run_id: id });
    return jsonOk(await store.view((await store.getRun(id, auth.user.id))!));
  }
  const body = await requestBody(request);
  if (
    !body ||
    typeof body.content !== "string" ||
    !body.content.trim() ||
    typeof body.mode !== "string" ||
    !["steer", "follow_up", "reply"].includes(body.mode) ||
    typeof body.clientRequestId !== "string" ||
    !body.clientRequestId ||
    body.clientRequestId.length > 160
  )
    throw new AgentApiError("补充消息无效");
  const clientRequestId = body.clientRequestId;
  const previousCommand = await store.db.tx(trx => trx.selectFrom('agent_run_commands')
    .select(['message', 'original_message', 'mode', 'original_mode'])
    .where('run_id', '=', id).where('request_id', '=', clientRequestId).executeTakeFirst());
  if (previousCommand) {
    const old = (previousCommand.original_message ?? previousCommand.message) as unknown as ChatMessage;
    if ((previousCommand.original_mode ?? previousCommand.mode) !== body.mode || old.content !== body.content || hashAgentRequest(old.attachments?.ids ?? []) !== hashAgentRequest(body.attachmentIds ?? []) || hashAgentRequest(old.metadata?.agentAnswers ?? null) !== hashAgentRequest(body.answers ?? null) || (body.questionId !== undefined && old.metadata?.agentQuestionId !== body.questionId)) throw new AgentApiError('同一消息标识对应了不同内容', 409);
    return jsonOk({ message: previousCommand.message, run: await store.view(run) });
  }
  const message: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: body.content,
    createdAt: new Date().toISOString(),
    metadata: { agentRunId: id, agentCommandMode: body.mode },
  };
  const commandAttachments = await validateAttachmentIds(store.db,auth.user.id,body.attachmentIds).catch(error => { throw new AgentApiError(error.message); });
  if (commandAttachments.some(item=>item.kind==='image')) {
    const model=run.input.customProvider ? null : await getModelConfigAsync(run.input.model);
    if (!model?.supportsVision) throw new AgentApiError('当前任务的模型不支持图片；请在下个独立任务选择视觉模型');
  }
  if(commandAttachments.length) message.attachments={fileName:commandAttachments.map(item=>item.name).join('、'),ids:commandAttachments.map(item=>item.id)};
  if (body.mode === 'reply') {
    const question = [...run.public_message.agent?.parts ?? []].reverse().find(part => part.type === 'question');
    const questionId = typeof body.questionId === 'string' ? body.questionId : run.checkpoint.questionId ?? question?.id;
    if (body.questionId !== undefined && (!questionId || questionId !== (run.checkpoint.questionId ?? question?.id))) throw new AgentApiError('该问题已改变，请重新加载', 409);
    let answers;
    if (body.answers !== undefined) {
      const questions=normalizeQuestions(run.checkpoint.questions ?? (question?.type === 'question' ? question.questions : undefined), run.checkpoint.question ?? (question?.type === 'question' ? question.question : undefined));
      try { answers = validateAnswers(questions, body.answers); }
      catch (error) { throw new AgentApiError(error instanceof Error ? error.message : '答案无效'); }
      message.content = formatQuestionAnswers(questions, answers);
    }
    message.metadata = { ...message.metadata, agentQuestionId: questionId, ...(answers ? { agentAnswers: answers } : {}) };
  }
  const command = await store.rpc<AgentCommandRow>("agent_submit_command", {
    p_run_id: id,
    p_request_id: clientRequestId,
    p_mode: body.mode,
    p_message: message,
  });
  return jsonOk({
    message: command.message,
    run: await store.view((await store.getRun(id, auth.user.id))!),
  });
}

export async function streamAgentTask(request: NextRequest, id: string) {
  if (!isValidUUID(id)) throw new AgentApiError("任务标识无效");
  const auth = await authenticated(request);
  const store = new AgentStore(systemDb());
  if (!(await store.getRun(id, auth.user.id)))
    throw new AgentApiError("任务不存在", 404, "AGENT_RUN_NOT_FOUND");
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: string) => {
        if (closed) return false;
        if (!enqueueAgentFrame(controller, encoder.encode(frame))) { closed = true; return false; }
        return true;
      };
      let cursor = Number(
        request.nextUrl.searchParams.get("after") ??
          request.headers.get("Last-Event-ID") ??
          0,
      );
      if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
      const suppliedEpoch = request.nextUrl.searchParams.get('epoch');
      let epoch = suppliedEpoch === null ? undefined : Number(suppliedEpoch);
      try {
        while (!closed && !request.signal.aborted) {
          const run = await store.getRun(id, auth.user.id);
          if (!run) break;
          // The run row decides whether a frame is due. The public view also
          // reads the command queue, so idle heartbeats never build it.
          const runCursor = Number(run.event_cursor);
          const runEpoch = run.fence ?? 0;
          let resetReason: AgentResync['reason'] | undefined =
            epoch !== undefined && epoch !== runEpoch ? 'epoch' : cursor > runCursor ? 'cursor' : undefined;
          if (resetReason || runCursor > cursor || isAgentRunTerminal(run.status)) {
            const view = { ...await store.view(run), epoch: runEpoch };
            const resync = (reason: AgentResync['reason']) => {
              resetReason = reason;
              cursor = view.cursor;
              epoch = view.epoch;
            };
            if (resetReason) resync(resetReason);
            while (cursor < view.cursor && !closed && !request.signal.aborted) {
              const events = await store.events(id, cursor, view.cursor);
              if (!events.length) { resync('gap'); break; }
              for (const event of events) {
                if (Number(event.sequence) <= cursor || Number(event.sequence) > view.cursor) { resync('gap'); break; }
                cursor = Number(event.sequence);
                if (!send(`event: history\nid: ${cursor}\ndata: ${JSON.stringify({ version: 1, runId: id, ...event })}\n\n`)) break;
              }
            }
            cursor = view.cursor;
            const resetFrame = resetReason ? `event: resync\ndata: ${JSON.stringify({ version: 1, runId: id, cursor: view.cursor, epoch: view.epoch, reason: resetReason } satisfies AgentResync)}\n\n` : '';
            if (!send(`${resetFrame}event: snapshot\nid: ${cursor}\ndata: ${JSON.stringify(view)}\n\n`)) break;
            epoch = view.epoch;
          } else if (!send(': heartbeat\n\n')) break;
          if (isAgentRunTerminal(run.status))
            break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch {
        if (!closed && !request.signal.aborted)
          send('event: error\ndata: {"code":"AGENT_STREAM_INTERRUPTED"}\n\n');
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  }, { highWaterMark: AGENT_STREAM_QUEUE_BYTES, size: chunk => chunk.byteLength });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** A proposal card of the caller's own task: the propose_archive_entry result cached under that call. */
async function archiveCard(store: AgentStore, userId: string, id: string, callId: unknown) {
  if (!isValidUUID(id)) throw new AgentApiError("任务标识无效");
  if (typeof callId !== "string" || !callId || callId.length > 200) throw new AgentApiError("保存卡片标识无效");
  const run = await store.getRun(id, userId);
  if (!run) throw new AgentApiError("任务不存在", 404, "AGENT_RUN_NOT_FOUND");
  const artifact = await store.artifact(run, callId);
  const card = artifact?.kind === "tool" ? getAgentArchiveProposal({ name: artifact.tool_name, status: "completed", output: artifact.result.details }) : null;
  if (!card) throw new AgentApiError("保存卡片不存在", 404, "AGENT_ARCHIVE_PROPOSAL_NOT_FOUND");
  return { run, callId, proposal: card.proposal };
}

/** Whether a proposal card is saved, can still be saved, or has nothing left to fill. */
export async function getAgentArchiveEntry(request: NextRequest, id: string) {
  const auth = await authenticated(request);
  const store = new AgentStore(systemDb());
  const { run, callId, proposal } = await archiveCard(store, auth.user.id, id, request.nextUrl.searchParams.get("callId"));
  return jsonOk(await readAgentArchiveStatus(auth.db, auth.user.id, run.id, callId, proposal));
}

/**
 * The owner saves a proposal card. The entry is the task's cached result, never the request's; the database writes it
 * under the caller's own scoped context and gives a replayed click the same entry.
 */
export async function saveAgentArchiveEntry(request: NextRequest, id: string) {
  const auth = await authenticated(request);
  const body = await requestBody(request);
  const store = new AgentStore(systemDb());
  const { run, callId, proposal } = await archiveCard(store, auth.user.id, id, body.callId);
  const feature = proposal.kind === "master_review" || (proposal.kind === "event" && proposal.chart?.type === "bazi_chart") ? "bazi" : "records";
  const state = await readFeatureModuleStateFresh(feature);
  if (state.status === "unavailable") throw new AgentApiError("功能状态暂不可用，请稍后再试", 503, "FEATURE_STATE_UNAVAILABLE");
  if (state.status !== "enabled") throw new AgentApiError(feature === "bazi" ? "命盘功能已关闭" : "命理记录功能已关闭", 403, "FEATURE_DISABLED");
  try {
    await auth.db.rpc("agent_save_archive_proposal", { p_run_id: run.id, p_call_id: callId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("AGENT_ARCHIVE_CHART_NOT_FOUND")) throw new AgentApiError("关联的资料已删除，无法保存", 409, "AGENT_ARCHIVE_CHART_NOT_FOUND");
    if (message.includes("AGENT_RUN_NOT_FOUND") || message.includes("AGENT_ARCHIVE_PROPOSAL_NOT_FOUND"))
      throw new AgentApiError("保存卡片不存在", 404, "AGENT_ARCHIVE_PROPOSAL_NOT_FOUND");
    throw error;
  }
  return jsonOk(await readAgentArchiveStatus(auth.db, auth.user.id, run.id, callId, proposal));
}
