import "server-only";
import type { Context } from "@earendil-works/chord";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { CompactionResult, Conversation, Cursor, EntryRecord, LiveState, TaskId, ToolTaskInput } from "@earendil-works/pi-durable";
import { CompactionEntry } from "@earendil-works/pi-durable";
import type { AgentDurableStorage } from "./durable-storage.server";
import { putAgentPart, type AgentCheckpoint, type AgentPart, type AgentRuntimeInfo, type DomainTool } from "./types";
import { projectAgentContextUsage } from "./context-usage";
import { projectAgentUsage } from './usage';
import { AGENT_CODEMODE_TOOL, CHART_TARGET_DIRECTORY_HEADING, getAgentExtensionToolTitle, projectsAgentCanonicalText } from './tool-catalog';
import { splitAgentFollowUps } from './follow-ups';
import { agentScriptCallNumber } from './codemode.server';

/** The assistant entry of a model-issued call; a nested call (a code mode script's) has none. */
export function modelCallEntry(task?: { input: unknown }) {
  const input = task?.input as ToolTaskInput | undefined;
  return input?.kind === 'model' ? input.assistant : undefined;
}

/** The public card of a model-issued call. */
export function agentToolCardId(assistant: string | number, callId: string) {
  return `native-tool:${assistant}:${callId}`;
}

/** The part of a code mode script's call, named by its tool task and nested under the script's card. */
export function scriptCallPartId(taskId: number) {
  return `nested:${taskId}`;
}

function scriptCallTask(part: AgentPart) {
  return Number(part.id.slice('nested:'.length));
}

/**
 * The text a card keeps for tools whose model-visible text is canonical (tool-catalog.ts): the first text, without the
 * artifact ID and target directory that follow it for the model. Viewing a palace returns only the directory, so it
 * keeps none. Undefined for every other tool.
 */
export function publicCanonicalText(name: string, content: ToolResultMessage["content"]): string | undefined {
  if (!projectsAgentCanonicalText(name)) return undefined;
  const canonical = content.find(part => part.type === 'text' && !part.text.startsWith(CHART_TARGET_DIRECTORY_HEADING));
  return canonical?.type === 'text' ? canonical.text : '';
}

/** Pi heads a script's result with its outcome and wall time for the model; the card has both already. */
const SCRIPT_HEADER = /^Script (?:completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/u;

/** A script's card: its calls as Pi listed them, and what it printed. */
function scriptOutput(message: ToolResultMessage) {
  const [head, ...rest] = message.content;
  const printed = head?.type === 'text' && SCRIPT_HEADER.test(head.text) ? rest : message.content;
  const details = message.details && typeof message.details === 'object' && !Array.isArray(message.details) ? message.details : {};
  return { ...details, output: printed.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n') };
}

/**
 * Pi retries a compaction with its built-in summarizer when ours fails. The task's outcome settles the record: a
 * placed summary completes it; a failure, a declined range or a summary that went stale leaves it failed.
 */
async function settleCompactionRetries(storage: AgentDurableStorage, checkpoint: AgentCheckpoint, history: EntryRecord[], context: Context) {
  for (const record of checkpoint.compactions ?? []) {
    if (record.status !== 'failed') continue;
    const task = await storage.task(Number(record.id) as TaskId, context);
    if (task?.state.status !== 'terminal' || task.state.outcome.status !== 'completed') continue;
    const result = task.state.outcome.result as CompactionResult;
    const entryId = result.entryId ?? (result.submissionId === undefined ? undefined : (await storage.submission(result.submissionId, context))?.entry);
    const message = entryId === undefined ? undefined : history.find(entry => entry.id === entryId)?.model?.[0];
    if (message?.role !== 'user') continue;
    const text = typeof message.content === 'string' ? message.content : message.content.find(part => part.type === 'text')?.text;
    if (!text) continue;
    record.status = 'completed';
    record.summary = /<summary>\n?([\s\S]*?)\n?<\/summary>/u.exec(text)?.[1] ?? text;
    delete record.reason;
  }
}

function taskTiming(task?: { startedAt?: number; endedAt?: number }) {
  return {
    ...(typeof task?.startedAt === 'number' && Number.isFinite(task.startedAt) && task.startedAt >= 0 ? { startedAt: task.startedAt } : {}),
    ...(typeof task?.endedAt === 'number' && Number.isFinite(task.endedAt) && task.endedAt >= 0 ? { endedAt: task.endedAt } : {}),
  };
}

/**
 * A code mode script's calls. The runtime puts the part of each call that ran with its result (afterTool), so only
 * those stay; while a call waits or runs, its live slot shows a placeholder. A call that never ran (blocked, invalid)
 * remains only in the script's own list of calls.
 */
async function projectScriptCalls(storage: AgentDurableStorage, checkpoint: AgentCheckpoint, live: LiveState | undefined,
  title: (name: string) => string, context: Context) {
  const running = new Map((live?.nestedTools ?? []).filter(slot => slot.status !== 'done').map(slot => [scriptCallPartId(slot.taskId), slot]));
  const settled = (part: AgentPart) => part.type === 'tool' && (part.status === 'completed' || part.status === 'failed');
  checkpoint.parts = checkpoint.parts.filter(part => part.type !== 'tool' || !part.id.startsWith('nested:') || settled(part) || running.has(part.id));
  for (const [id, slot] of running) {
    if (checkpoint.parts.some(part => part.id === id && settled(part))) continue;
    const assistant = modelCallEntry(await storage.task(slot.parentTaskId, context));
    if (assistant === undefined) continue;
    const output = slot.details ?? slot.output;
    const number = agentScriptCallNumber(slot.callId);
    putAgentPart(checkpoint.parts, {
      type: 'tool', id, name: slot.name, title: title(slot.name), status: slot.status === 'pending' ? 'pending' : 'running', input: slot.arguments,
      ...(output === undefined ? {} : { output }), parentId: agentToolCardId(assistant, slot.parentCallId),
      ...(number === undefined ? {} : { scriptCall: number }),
    });
  }
  for (const part of checkpoint.parts) {
    if (part.type !== 'tool' || !part.id.startsWith('nested:')) continue;
    Object.assign(part, taskTiming(await storage.task(scriptCallTask(part) as TaskId, context)));
  }
}

/** Public messages are a projection; Durable entries remain the execution truth. */
export async function projectDurableConversation(
  root: Conversation, storage: AgentDurableStorage, checkpoint: AgentCheckpoint,
  tools: DomainTool[], context: Context,
) {
  const state = await root.viewState(context);
  const live = state.value.docs["pi.live"] as LiveState | undefined;
  const usage = projectAgentUsage(state.value.docs['pi.usage']);
  state.dispose();
  // A compaction changes active context, not the visible execution history.
  let cursor: Cursor | undefined;
  const history: EntryRecord[] = [];
  do {
    const page = await root.entries({}, 200, cursor, context);
    history.push(...page.items);
    cursor = page.next;
  } while (cursor);
  history.reverse();
  await settleCompactionRetries(storage, checkpoint, history, context);
  const title = (name: string) => tools.find(t => t.name === name)?.label ?? getAgentExtensionToolTitle(name) ?? name;
  await projectScriptCalls(storage, checkpoint, live, title, context);
  if (checkpoint.runtime) {
    checkpoint.runtime.usage = usage;
    const transcript = await root.context(context);
    checkpoint.runtime.context = projectAgentContextUsage(transcript.messages, history.filter(entry => entry.kind === CompactionEntry.kind).length);
    const runningTool = live?.tools?.find(slot => slot.status === "running");
    const scriptCall = live?.nestedTools?.findLast(slot => slot.status === "running");
    const content = live?.generation?.message?.content;
    checkpoint.runtime.activity = checkpoint.question ? { phase: "awaiting_input" }
      : live?.compactions?.some(slot => slot.blocking) ? { phase: "compacting" }
      : live?.generation?.retry ? { phase: "retrying", attempt: live.generation.attempt }
      : runningTool ? { phase: "tools", toolTitle: scriptCall ? `${title(runningTool.name)} · ${title(scriptCall.name)}` : title(runningTool.name) }
      : live?.generation ? { phase: content?.at(-1)?.type === "thinking" ? "thinking" : content?.some(part => part.type === "text") ? "responding" : "generating" }
      : live?.run ? { phase: "preparing" } : { phase: "settling" };
  }
  const answeredTasks = new Map(history.flatMap((e, index) =>
    e.byTaskId && e.model?.some(m => m.role === "assistant" &&
      m.stopReason !== "aborted" && m.stopReason !== "error") ? [[e.byTaskId, index] as const] : [],
  ));
  const previous = new Map(checkpoint.parts.map(p => [`${p.type}:${p.id}`, p]));
  const native: AgentPart[] = [];
  const responses: NonNullable<AgentRuntimeInfo['responses']> = [];
  const cards = new Map<string, Extract<AgentPart, { type: "tool" }>>();
  const byCall = new Map<string, string>();
  const attached = new Map<string, AgentPart[]>();
  const attachedIds = new Set<string>();
  // Suggestions come from the latest answer only; an earlier block is no longer current.
  let latestText = null as string | null;
  const attach = (cardId: string, cacheId: string) => {
    const parts = [
      ...checkpoint.parts.filter(p =>
        (p.type === "question" && p.id === cacheId) ||
        (p.type === "source" && p.id.startsWith(`${cacheId}:`)),
      ),
      // A script's calls in the order it made them.
      ...checkpoint.parts.filter((p): p is Extract<AgentPart, { type: "tool" }> => p.type === "tool" && p.parentId === cardId)
        .sort((a, b) => (a.scriptCall ?? 0) - (b.scriptCall ?? 0) || scriptCallTask(a) - scriptCallTask(b)),
    ];
    attached.set(cardId, parts);
    parts.forEach(p => attachedIds.add(`${p.type}:${p.id}`));
  };
  const assistantParts = (message: AssistantMessage, id: string, entryId?: string) => {
    message.content.forEach((part, index) => {
      if (part.type === "text") {
        latestText = part.text;
        // The follow-up block is not part of the answer; a part that held only the block disappears.
        const visible = splitAgentFollowUps(part.text).text;
        if (visible === part.text || visible) native.push({ type: "text", id: `${id}:${index}`, text: visible });
      }
      if (part.type === "thinking") native.push({ type: "reasoning", id: `${id}:${index}`, text: part.thinking });
      if (part.type === "toolCall" && entryId) {
        const key = agentToolCardId(entryId, part.id);
        const old = previous.get(`tool:${key}`);
        const card: Extract<AgentPart, { type: "tool" }> = {
          type: "tool", id: key, name: part.name, title: title(part.name),
          status: old?.type === "tool" ? old.status : "pending",
          input: part.arguments, ...(old?.type === "tool" ? { output: old.output } : {}),
        };
        cards.set(key, card);
        byCall.set(part.id, key);
        native.push(card);
      }
    });
  };
  for (const [index, entry] of history.entries()) {
    if (entry.kind === "taibu.history") continue;
    for (const [messageIndex, message] of (entry.model ?? []).entries()) {
      if (message.role === "assistant" && !(message.stopReason === "aborted" && entry.byTaskId &&
        (answeredTasks.get(entry.byTaskId) ?? -1) > index)) {
        assistantParts(message, `native:${entry.id}`, String(entry.id));
        const task = entry.byTaskId ? await storage.task(entry.byTaskId, context) : undefined;
        responses.push({ id: `${entry.id}:${messageIndex}`, ...taskTiming(task),
          ...(typeof message.durationMs === 'number' && Number.isFinite(message.durationMs) && message.durationMs >= 0 ? { durationMs: message.durationMs } : {}),
        });
      }
      if (message.role === "toolResult") {
        const task = entry.byTaskId ? await storage.task(entry.byTaskId, context) : undefined;
        const assistant = modelCallEntry(task);
        const key = assistant ? agentToolCardId(assistant, message.toolCallId) : byCall.get(message.toolCallId);
        const card = key ? cards.get(key) : undefined;
        if (card) {
          card.status = message.isError ? "failed" : "completed";
          card.output = card.name === AGENT_CODEMODE_TOOL ? scriptOutput(message) : message.details ?? message.content;
          Object.assign(card, taskTiming(task));
          if (typeof message.durationMs === 'number' && Number.isFinite(message.durationMs) && message.durationMs >= 0) card.durationMs = message.durationMs;
          // 第一段是 Core 或资料源的规范文本；其后的成果 ID 与定位目录只写给模型，不进公开文本。
          const canonicalText = publicCanonicalText(card.name, message.content);
          if (canonicalText !== undefined) card.canonicalText = canonicalText;
          if (entry.byTaskId) attach(card.id, `${entry.byTaskId}:${message.toolCallId}`);
        }
      }
    }
  }
  const generation = live?.generation?.message as AssistantMessage | undefined;
  if (generation && live?.run) {
    checkpoint.streamingAssistantId = `native-live:${live.run.taskId}`;
    assistantParts(generation, checkpoint.streamingAssistantId);
  } else checkpoint.streamingAssistantId = undefined;
  for (const slot of live?.tools ?? []) {
    const task = slot.taskId ? await storage.task(slot.taskId, context) : undefined;
    const assistant = modelCallEntry(task);
    const key = assistant ? agentToolCardId(assistant, slot.callId) : byCall.get(slot.callId);
    const card = key ? cards.get(key) : undefined;
    if (card) {
      Object.assign(card, taskTiming(task));
      if (slot.taskId) attach(card.id, `${slot.taskId}:${slot.callId}`);
      if (slot.status === "done" && !slot.entry) card.status = "failed";
      if (slot.status !== "done") {
        card.status = slot.name === "ask_user" && checkpoint.question ? "awaiting_input" : slot.status === "pending" ? "pending" : "running";
        card.output = slot.details ?? slot.output ?? card.output;
      }
    }
  }
  checkpoint.parts = [
    ...checkpoint.parts.filter(p => !p.id.startsWith("native:") && !p.id.startsWith("native-live:") &&
      !p.id.startsWith("native-tool:") && !attachedIds.has(`${p.type}:${p.id}`)),
    ...native.flatMap(p => [p, ...(p.type === "tool" ? attached.get(p.id) ?? [] : [])]),
  ];
  const followUps = latestText === null ? [] : splitAgentFollowUps(latestText).followUps;
  checkpoint.followUps = followUps.length ? followUps : undefined;
  if (checkpoint.runtime) checkpoint.runtime.responses = responses;
}
