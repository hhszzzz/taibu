import "server-only";
import { AGENT_STREAM_QUEUE_BYTES, enqueueAgentFrame, type AgentResync } from './sse';
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { availableMcpServers } from './mcp/session.server';
import { jsonError, jsonOk, requireUserContext } from "@/lib/api-utils";
import { systemDb } from "@/lib/db/context.server";
import { subscribeAgentSignals } from "@/lib/db/listen.server";
import { subscribeAgentTextDelta } from "./tail-bus.server";
import { getGlobalAIFeatureGuardResponse } from "@/lib/api/ai-feature-guard";
import { readFeatureModuleStateFresh } from "@/lib/app-settings";
import { getModelConfigAsync } from "@/lib/server/ai-config";
import { isChatAttachment } from "@/lib/ai/document-formats";
import { resolveUserTimeZone } from "@/lib/ai/prompt-time";
import { webSearchTier } from "@/lib/ai/web-search-access";
import { webRouteAvailable, webRouteLowestTier } from "./mcp/web-route.server";
import type { MembershipType } from "@/lib/user/membership";
import { getUserCreditInfo } from "@/lib/user/credits";
import { isValidUUID } from "@/lib/validation";
import type { ChatMessage, CustomProviderRequest, Mention } from "@/types";
import { normalizeMessageQuotes } from "@/lib/chat/quotes";
import { isDataSourceType } from "@/lib/data-sources/types";
import {
  AgentStore,
  type AgentRunRow,
  type AgentCommandRow,
} from "./store.server";
import { isAgentRunTerminal } from "./types";
import { parseReasoningEffort, parseAgentCollaborators } from '@/lib/chat/model-settings';
import { normalizeQuestions, validateAnswers, formatQuestionAnswers } from './questions';
import { validateAttachmentIds } from './attachments.server';
import { readAgentActivity } from './activity.server';
import { AGENT_COMPACT_INSTRUCTIONS_MAX, parseAgentCompactCommand } from './compaction';
import { SkillUnavailableError, skillCommandBlock } from './skills/catalog.server';
import { parseSkillCommand } from './skills/config';
import { getAgentArchiveProposal } from './archive';
import { readAgentArchiveStatus } from './archive.server';
import {
  AGENT_COMPACT_RATE_LIMIT, AgentApiError, hashAgentRequest, submitAgentTask, type AgentSubmitBody,
} from './submit.server';

export { AGENT_COMPACT_RATE_LIMIT, hashAgentRequest };

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
function createBody(value: Record<string, unknown>): AgentSubmitBody {
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
      // Passages quoted from earlier answers; the caps and trimming live in the shared serializer.
      quotes: normalizeMessageQuotes(message.quotes),
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
    attachment: value.attachment !== undefined && isChatAttachment(value.attachment) ? value.attachment : undefined,
    /** The browser's IANA time zone; the user's messages are dated in it. */
    timezone: resolveUserTimeZone(value.timezone),
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
  const auth = await authenticated(request);
  const state = await readFeatureModuleStateFresh("agent");
  const store = new AgentStore(systemDb());
  let mcpAvailable = false, searchAvailable = false;
  let webTier: MembershipType | null = null;
  try {
    const { membership } = await getUserCreditInfo(auth.user.id, {});
    [mcpAvailable, searchAvailable, webTier] = await Promise.all([
      availableMcpServers(auth.user.id, membership, { codeMode: true }).then((rows) => rows.length > 0),
      // Free accounts never search; whether Plus would is what tells them which plan does.
      webRouteAvailable("search", membership === "free" ? "plus" : membership),
      webRouteLowestTier("search").then(webSearchTier),
    ]);
  } catch {
    // A configuration that cannot be read does not advertise network access.
    mcpAvailable = searchAvailable = false;
    webTier = null;
  }
  return jsonOk({
    enabled: state.status === "enabled",
    ready: state.status === "enabled" && (await store.workerReady()),
    webAvailable: searchAvailable || mcpAvailable,
    plainWebAvailable: searchAvailable,
    webTier,
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
    if ((Array.isArray(body.message.attachments.ids) && body.message.attachments.ids.length) || body.message.attachments.fileName || body.mentions.length || body.attachment !== undefined || body.message.quotes.length)
      throw new AgentApiError("压缩上下文时不能附带资料或引用");
  }
  const run = await submitAgentTask({ db: auth.db, userId: auth.user.id, user: auth.user }, body, "http");
  return jsonOk(await new AgentStore(systemDb()).view(run), 201);
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
  // A skill named in a message sent into the task must be usable now; the worker expands it when it delivers the message.
  if (body.mode !== 'reply' && parseSkillCommand(body.content)) {
    try {
      await skillCommandBlock(auth.user.id, (await getUserCreditInfo(auth.user.id, {})).membership, body.content);
    } catch (error) {
      if (error instanceof SkillUnavailableError) throw new AgentApiError(error.message, 400, "SKILL_UNAVAILABLE");
      throw error;
    }
  }
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
      let epoch: number | undefined = suppliedEpoch === null ? undefined : Number(suppliedEpoch);

      const emitSnapshot = async (run: AgentRunRow, resetReason?: AgentResync['reason']) => {
        const view = { ...await store.view(run), epoch: run.fence ?? 0 };
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
        const resetFrame = resetReason
          ? `event: resync\ndata: ${JSON.stringify({ version: 1, runId: id, cursor: view.cursor, epoch: view.epoch, reason: resetReason } satisfies AgentResync)}\n\n`
          : '';
        if (!send(`${resetFrame}event: snapshot\nid: ${cursor}\ndata: ${JSON.stringify(view)}\n\n`)) return false;
        epoch = view.epoch;
        return true;
      };

      // 正文增量只是显示加速：挤不进队列就丢掉，浏览器等下一次快照。
      const sendTail = (frame: string) => {
        if (closed) return;
        const bytes = encoder.encode(frame);
        if (bytes.byteLength > (controller.desiredSize ?? 0)) return;
        controller.enqueue(bytes);
      };
      // Subscribed before the first state read: a change that lands while state
      // is read or a snapshot is sent stays queued for the next wait.
      const tailFrames = { last: 0 };
      const stopTail = subscribeAgentTextDelta(id, frame => {
        if (frame.seq <= tailFrames.last) return;
        tailFrames.last = frame.seq;
        sendTail(`event: tail\ndata: ${JSON.stringify({ ...frame, runId: id })}\n\n`);
      });
      const signals = subscribeAgentSignals({ run: id });
      try {
        const initial = await store.getRun(id, auth.user.id);
        if (!initial) return;
        const initialCursor = Number(initial.event_cursor);
        const needsSnapshot = epoch !== undefined && epoch !== (initial.fence ?? 0)
          || cursor > initialCursor
          || initialCursor > cursor
          || isAgentRunTerminal(initial.status);
        const initialReason: AgentResync['reason'] | undefined =
          epoch !== undefined && epoch !== (initial.fence ?? 0) ? 'epoch'
            : cursor > initialCursor ? 'cursor' : undefined;
        if (needsSnapshot && !(await emitSnapshot(initial, initialReason))) return;
        else if (epoch === undefined) epoch = initial.fence ?? 0;
        if (isAgentRunTerminal(initial.status)) return;

        let known = initial;
        while (!closed && !request.signal.aborted) {
          const received = await signals.next(15_000, request.signal);
          if (closed || request.signal.aborted) break;

          const state = await store.runState(id, auth.user.id);
          if (!state) break;
          const changed = Number(state.event_cursor) !== cursor
            || (state.fence ?? 0) !== (epoch ?? 0)
            || state.status !== known.status;
          if (changed) {
            const run = await store.getRun(id, auth.user.id);
            if (!run) break;
            known = run;
            const epochChanged = (run.fence ?? 0) !== (epoch ?? 0);
            if (!(await emitSnapshot(run, epochChanged ? 'epoch' : undefined))) break;
            if (isAgentRunTerminal(run.status)) break;
            continue;
          }
          if (!received.length && !send(': heartbeat\n\n')) break;
          // A signal without a state change (for example a cancel request) is
          // already reflected in the next run update; no frame is due yet.
        }
      } catch {
        if (!closed && !request.signal.aborted)
          send('event: error\ndata: {"code":"AGENT_STREAM_INTERRUPTED"}\n\n');
      } finally {
        stopTail();
        signals.close();
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
