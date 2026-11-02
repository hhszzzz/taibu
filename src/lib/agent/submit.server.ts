import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { ScopedDb } from "@/lib/db/context.server";
import { systemDb } from "@/lib/db/context.server";
import { getByokPolicy, readFeatureModuleStateFresh } from "@/lib/app-settings";
import { BYOK_KEY_MAX, isByokRef } from "@/lib/byok/config";
import { byokAgentConfig } from "@/lib/byok/agent.server";
import { sealByokRunKeys } from "@/lib/byok/secrets.server";
import { resolveByokModels, type ResolvedByokModel } from "@/lib/byok/store.server";
import { getDefaultModelConfigAsync, getModelConfigAsync } from "@/lib/server/ai-config";
import { isModelOffered, UNPRICED_MODEL_MESSAGE } from "@/lib/ai/ai-access";
import { buildChatPromptContext } from "@/lib/server/chat/prompt-context";
import { getSpendableMicros, INSUFFICIENT_BALANCE_MESSAGE } from "@/lib/billing/account.server";
import { isFreeTextModel } from "@/lib/billing/pricing";
import { AI_RATE_LIMIT_CONFIG, checkRateLimit } from "@/lib/rate-limit";
import type { AIModelConfig, ChatMessage, Mention, ChatAttachment } from "@/types";
import type { AIReasoningEffort } from "@/types";
import type { AgentCollaborator } from "@/lib/chat/model-settings";
import type { AgentApprovalMode } from "./mcp/config";
import type { MessageQuote } from "@/lib/chat/quotes";
import { AgentStore, type AgentRunRow } from "./store.server";
import { AGENT_ENGINE, isCurrentAgentCheckpoint } from "./engine";
import { piHistory } from "./history.server";
import { getAgentCitationBase } from "./evidence";
import { parseAgentCompactCommand } from "./compaction";
import { SkillUnavailableError, expandSkillMessages, joinSkillTurn, skillCommandBlock } from "./skills/catalog.server";
import { parseSkillCommand } from "./skills/config";
import { DEFAULT_AGENT_PROFILE } from "./profiles/config";
import { availableProfiles } from "./profiles/members.server";
import { validateAttachmentIds } from "./attachments.server";
import type { AgentCheckpoint } from "./types";

/** `/compact` has its own, stricter bucket instead of the shared chat admission. */
export const AGENT_COMPACT_RATE_LIMIT = { maxRequests: 10, windowMs: 3_600_000 } as const;

/** An admission failure with an HTTP-shaped status and a stable code. */
export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "AGENT_REQUEST_INVALID",
  ) {
    super(message);
  }
}

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

/** The request body shape both HTTP admission and the schedule runner produce. */
export type AgentSubmitBody = {
  conversationId: string;
  clientRequestId: string;
  message: {
    id: string;
    content: string;
    attachments: { ids?: unknown; fileName?: string };
    quotes: MessageQuote[];
  };
  model?: string;
  /** The image model generate_image uses: a platform image model or the member's own (`byok:`). */
  imageModel?: string;
  /**
   * Keys of the member's own models that live only in their browser, by connection: staged for this task, sealed, and
   * deleted when it ends.
   */
  byokKeys?: Record<string, string>;
  replaceFromMessageId?: string;
  mentions: Mention[];
  webEnabled: boolean;
  codeMode: boolean;
  planMode: boolean;
  /** Whether external tools may run without asking: auto (as configured), manual (every call), allow_all. */
  approval: AgentApprovalMode;
  reasoning: boolean;
  reasoningEffort: AIReasoningEffort | null;
  collaborators: AgentCollaborator[];
  dreamMode: boolean;
  mangpaiMode: boolean;
  attachment?: ChatAttachment;
  timezone: string;
};

/** The caller's identity and database scope: the signed-in member's own, or the scheduler's system identity. */
export type AgentSubmitContext = {
  db: ScopedDb;
  userId: string;
};

/**
 * The one admission path for an Agent turn. HTTP calls it with the member's
 * scope; the schedule runner calls it with the system scope and the schedule
 * owner's id, so both admit, validate and queue identically. `origin` is kept
 * on the run for the record; `runId` lets the scheduler name the run before it
 * submits, so a completion that arrives early can still settle its schedule run.
 */
export async function submitAgentTask(
  ctx: AgentSubmitContext,
  body: AgentSubmitBody,
  origin: "http" | "schedule",
  options: { runId?: string } = {},
): Promise<AgentRunRow> {
  const chatState = await readFeatureModuleStateFresh("chat");
  if (chatState.status === "disabled") throw new AgentApiError("AI 功能当前未启用", 403, "FEATURE_DISABLED");
  if (chatState.status === "unavailable") throw new AgentApiError("AI 功能状态暂时无法确认", 503, "FEATURE_STATE_UNAVAILABLE");
  if ((await readFeatureModuleStateFresh("agent")).status !== "enabled")
    throw new AgentApiError("Agent 功能未启用", 403, "FEATURE_DISABLED");
  const compact = origin === "http" ? parseAgentCompactCommand(body.message.content) : null;
  const store = new AgentStore(systemDb());
  if (body.imageModel !== undefined && (typeof body.imageModel !== "string" || !body.imageModel || body.imageModel.length > 200))
    throw new AgentApiError("生图模型无效");
  if (body.byokKeys !== undefined && (!body.byokKeys || typeof body.byokKeys !== "object" || Array.isArray(body.byokKeys)))
    throw new AgentApiError("自定义模型 Key 无效");
  const requestHash = hashAgentRequest({
    origin,
    conversationId: body.conversationId,
    messageId: body.message.id,
    content: body.message.content,
    attachmentIds: body.message.attachments.ids ?? [],
    quotes: body.message.quotes,
    model: body.model ?? null,
    imageModel: body.imageModel ?? null,
    byokKeys: body.byokKeys ? Object.fromEntries(Object.entries(body.byokKeys).map(([id, key]) => [id, hashAgentRequest(key)])) : null,
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
    .where("user_id", "=", ctx.userId)
    .where("request_id", "=", body.clientRequestId)
    .executeTakeFirst());
  if (existing) {
    if (existing.request_hash !== requestHash)
      throw new AgentApiError("同一请求标识对应了不同内容", 409, "REQUEST_MISMATCH");
    return existing as unknown as AgentRunRow;
  }
  if (!(await store.workerReady()))
    throw new AgentApiError("后台任务服务未就绪，可切换普通对话", 503, "AGENT_WORKER_UNAVAILABLE");
  const conversation = await ctx.db.tx((trx) => trx
    .selectFrom("conversations")
    .select(["id", "messages", "title"])
    .where("id", "=", body.conversationId)
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst());
  if (!conversation)
    throw new AgentApiError("对话不存在", 404, "CONVERSATION_NOT_FOUND");
  let history = (conversation.messages ?? []) as unknown as ChatMessage[];
  if (body.replaceFromMessageId) {
    const index = history.findIndex((m) => m.id === body.replaceFromMessageId && m.role === "user");
    if (index < 0) throw new AgentApiError("找不到需要编辑的消息");
    if (history[index].metadata?.forkHistory === true) throw new AgentApiError('分叉历史只读，请发送新问题', 409);
    history = history.slice(0, index);
  }
  if (compact && !history.length) throw new AgentApiError("当前对话还没有可压缩的内容");
  // A compaction uses no collaborators: it only summarizes the context.
  const collaborators = compact ? [] : body.collaborators;
  const own = await admitOwnModels(ctx, body, collaborators, origin);
  const ownMain = isByokRef(body.model) ? own.models.get(body.model) : undefined;
  const config = ownMain
    ? byokAgentConfig(ownMain)
    : body.model
      ? await getModelConfigAsync(body.model)
      : await getDefaultModelConfigAsync("chat");
  if (!config) throw new AgentApiError("模型不存在");
  const attachments = await validateAttachmentIds(store.db, ctx.userId, body.message.attachments.ids).catch((error: Error) => {
    throw new AgentApiError(error.message);
  });
  if (attachments.some((item) => item.kind === "image") && !config.supportsVision)
    throw new AgentApiError("图片资料需要支持识图的模型", 400);
  if (!ownMain && !isModelOffered(config))
    throw new AgentApiError(UNPRICED_MODEL_MESSAGE, 403, "MODEL_UNPRICED");
  // A member's role must be one that is enabled now: the specialist always is.
  const roles = collaborators.some((member) => (member.profile ?? DEFAULT_AGENT_PROFILE) !== DEFAULT_AGENT_PROFILE)
    ? await availableProfiles() : [];
  const memberModels: AIModelConfig[] = [];
  for (const member of collaborators) {
    if (isByokRef(member.model)) continue;
    const selected = await getModelConfigAsync(member.model);
    if (!selected) throw new AgentApiError(`协作模型不存在：${member.name}`);
    if (!isModelOffered(selected))
      throw new AgentApiError(`${member.name} 的模型尚未定价，暂不可用`, 403, 'MODEL_UNPRICED');
    memberModels.push(selected);
  }
  for (const member of collaborators) {
    const role = member.profile ?? DEFAULT_AGENT_PROFILE;
    if (role !== DEFAULT_AGENT_PROFILE && !roles.some((item) => item.name === role && item.modes.includes('parallel')))
      throw new AgentApiError(`${member.name} 的角色已停用，请在「设置 → 个性化 → 多模型协作」里改选`, 400, 'PROFILE_UNAVAILABLE');
  }
  // The platform models a task runs need a positive balance to start; each request then pays for what it used. The
  // member's own models are never charged, so a task of only those is exempt.
  const platformModels = [...(ownMain ? [] : [config]), ...memberModels];
  const billing = platformModels.length ? "metered" as const : "exempt" as const;
  if (platformModels.some((model) => !isFreeTextModel(model.pricing)) &&
    await getSpendableMicros(ctx.userId, ctx.db) <= 0)
    throw new AgentApiError(INSUFFICIENT_BALANCE_MESSAGE, 402, "INSUFFICIENT_BALANCE");
  if (origin === "http") {
    const limit = compact
      ? await checkRateLimit(ctx.userId, "/api/agent/compact", AGENT_COMPACT_RATE_LIMIT)
      : await checkRateLimit(ctx.userId, "/api/chat", AI_RATE_LIMIT_CONFIG);
    if (!limit.allowed)
      throw new AgentApiError(compact ? "压缩上下文过于频繁，请稍后再试" : "请求过于频繁，请稍后再试", 429, "RATE_LIMITED");
  }
  // `/skill:名称 要求` brings the skill into this turn as pi expands it; the conversation keeps what the user typed.
  let skillTurn: Awaited<ReturnType<typeof skillCommandBlock>> = null;
  if (!compact && parseSkillCommand(body.message.content)) {
    try {
      skillTurn = await skillCommandBlock(ctx.userId, body.message.content);
    } catch (error) {
      if (error instanceof SkillUnavailableError) throw new AgentApiError(error.message, 400, "SKILL_UNAVAILABLE");
      throw error;
    }
  }
  const modelId = config.id;
  const reasoning = !!config.supportsReasoning && body.reasoning === true;
  const runId = options.runId ?? randomUUID();
  const credential = sealByokRunKeys(ctx.userId, runId, own.keys);
  const userMessage: ChatMessage = {
    id: body.message.id,
    role: "user",
    content: body.message.content,
    createdAt: new Date().toISOString(),
  };
  if (Array.isArray(body.mentions)) userMessage.mentions = body.mentions;
  if (body.message.quotes.length) userMessage.quotes = body.message.quotes;
  if (typeof body.message.attachments.fileName === "string" || attachments.length)
    userMessage.attachments = {
      fileName: body.message.attachments.fileName ?? attachments.map((item) => item.name).join('、'),
      ids: attachments.map((item) => item.id),
      webSearchEnabled: body.webEnabled !== false,
    };
  const prepared = await buildChatPromptContext(
    {
      body: {
        // The prompt is prepared from what the user asked of the skill; the skill joins the turn afterwards.
        messages: [...history, skillTurn ? { ...userMessage, content: skillTurn.args } : userMessage],
        model: modelId,
        reasoning,
        mangpaiMode: body.mangpaiMode === true,
        dreamMode: body.dreamMode === true,
        mentions: body.mentions,
        attachment: body.attachment,
        timezone: body.timezone,
      },
      userId: ctx.userId,
      metered: billing === "metered",
      requestedModelId: modelId,
      reasoningEnabled: reasoning,
    },
    {
      deferKnowledgeSearch: true,
      ...(ownMain ? { modelWindow: { contextWindow: ownMain.contextWindow, maxOutput: ownMain.maxOutput } } : {}),
    },
  );
  const previous = body.replaceFromMessageId ? null : await store.currentRun(body.conversationId, ctx.userId);
  const replay =
    previous?.status === "completed" && isCurrentAgentCheckpoint(previous.checkpoint) &&
    history.at(-1)?.id === previous.public_message.id
      ? previous.checkpoint.messages.filter((m) => m.role !== "system")
      : null;
  // The new turn as prepared, so a continued task also reads the document the message carries.
  const preparedTurn = prepared.sanitizedMessages.at(-1) ?? userMessage;
  const turn = skillTurn ? { ...preparedTurn, content: joinSkillTurn(skillTurn.block, preparedTurn.content) } : preparedTurn;
  // A rebuilt context expands the earlier `/skill:` turns again, as they were expanded when sent.
  const earlier = replay ? [] : await expandSkillMessages(prepared.sanitizedMessages.slice(0, -1), ctx.userId)
    .catch(() => prepared.sanitizedMessages.slice(0, -1));
  const checkpoint: AgentCheckpoint = {
    version: 2,
    durable: { engine: AGENT_ENGINE },
    messages: replay
      ? [...replay, ...piHistory([{ ...turn, attachments: userMessage.attachments }])]
      : piHistory([...earlier, turn].map((message) => ({ ...message, attachments: message.id === userMessage.id ? userMessage.attachments : history.find((item) => item.id === message.id)?.attachments }))),
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
    modelName: config.name,
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
    approval: body.approval,
    ...(compact ? { compact } : {}),
    systemPrompt: prepared.systemPrompt,
    memoryEnabled: prepared.agentMemoryEnabled === true,
    timezone: body.timezone,
    knowledgeBaseIds: prepared.promptKnowledgeBases.map((kb) => kb.id),
    userMessage,
    title: body.message.content.slice(0, 60),
    replaceFromMessageId: body.replaceFromMessageId ?? null,
    origin,
    ...(body.imageModel ? { imageModel: body.imageModel } : {}),
  };
  const run = await store.rpc<AgentRunRow>("agent_create_run", {
    p_id: runId,
    p_user_id: ctx.userId,
    p_conversation_id: body.conversationId,
    p_request_id: body.clientRequestId,
    p_request_hash: requestHash,
    p_input: input,
    p_checkpoint: checkpoint,
    p_message: assistant,
    p_credential: credential,
    p_billing: billing,
  });
  return run;
}

/**
 * The member's own models a task names (main, members, image), checked: each exists and fits its use, and has a key
 * the task can use: the one stored here, or one the browser sends for this task. A scheduled task has no browser.
 */
async function admitOwnModels(
  ctx: AgentSubmitContext, body: AgentSubmitBody, collaborators: readonly AgentCollaborator[], origin: "http" | "schedule",
): Promise<{ models: Map<string, ResolvedByokModel>; keys: Record<string, string> }> {
  const chatRefs = [body.model, ...collaborators.map((member) => member.model)].filter(isByokRef);
  const imageRef = isByokRef(body.imageModel) ? body.imageModel : null;
  if (!chatRefs.length && !imageRef) return { models: new Map(), keys: {} };
  const state = await readFeatureModuleStateFresh("byok");
  if (state.status === "unavailable") throw new AgentApiError("功能状态暂时无法确认", 503, "FEATURE_STATE_UNAVAILABLE");
  if (state.status !== "enabled") throw new AgentApiError("自定义模型功能当前未启用", 403, "BYOK_UNAVAILABLE");
  const models = await resolveByokModels(ctx.db, ctx.userId, [...chatRefs, ...(imageRef ? [imageRef] : [])], await getByokPolicy());
  const keys: Record<string, string> = {};
  const check = (ref: string, usage: "chat" | "image") => {
    const model = models.get(ref);
    if (!model) throw new AgentApiError("自定义模型不存在，可能已被删除", 400, "BYOK_UNAVAILABLE");
    if (model.usage !== usage)
      throw new AgentApiError(usage === "chat" ? "这个自定义模型只用于生图" : "这个自定义模型不是生图模型", 400, "BYOK_UNAVAILABLE");
    if (model.serverKey) return;
    const key = body.byokKeys?.[model.connection.id];
    if (origin === "schedule")
      throw new AgentApiError("定时任务只能使用平台模型或 Key 保存在本站的自定义模型", 400, "BYOK_KEY_UNAVAILABLE");
    if (typeof key !== "string" || !key.trim() || key.length > BYOK_KEY_MAX || /\s/u.test(key.trim()))
      throw new AgentApiError(`「${model.displayName || model.modelId}」需要先在本设备填写 API Key`, 400, "BYOK_KEY_UNAVAILABLE");
    keys[model.connection.id] = key.trim();
  };
  for (const ref of chatRefs) check(ref, "chat");
  if (imageRef) check(imageRef, "image");
  return { models, keys };
}
