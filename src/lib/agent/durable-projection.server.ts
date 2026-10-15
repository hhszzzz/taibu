import "server-only";
import type { Context } from "@earendil-works/chord";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Conversation, Cursor, EntryRecord, LiveState, ToolTaskInput } from "@earendil-works/pi-durable";
import { CompactionEntry } from "@earendil-works/pi-durable";
import type { AgentDurableStorage } from "./durable-storage.server";
import type { AgentCheckpoint, AgentPart, AgentRuntimeInfo, DomainTool } from "./types";
import { projectAgentContextUsage } from "./context-usage";
import { projectAgentUsage } from './usage';
import { projectsAgentCanonicalText } from './tool-catalog';
import { splitAgentFollowUps } from './follow-ups';

function taskTiming(task?: { startedAt?: number; endedAt?: number }) {
  return {
    ...(typeof task?.startedAt === 'number' && Number.isFinite(task.startedAt) && task.startedAt >= 0 ? { startedAt: task.startedAt } : {}),
    ...(typeof task?.endedAt === 'number' && Number.isFinite(task.endedAt) && task.endedAt >= 0 ? { endedAt: task.endedAt } : {}),
  };
}

/** Public messages are a projection; Durable entries remain the execution truth. */
export async function projectDurableConversation(
  root: Conversation, storage: AgentDurableStorage, checkpoint: AgentCheckpoint,
  tools: DomainTool[], context: Context,
) {
  const state = await root.viewState(context);
  const oldStreamingId = checkpoint.streamingAssistantId;
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
  const title = (name: string) => tools.find(t => t.name === name)?.label ?? name;
  if (checkpoint.runtime) {
    checkpoint.runtime.usage = usage;
    const transcript = await root.context(context);
    checkpoint.runtime.context = projectAgentContextUsage(transcript.messages, history.filter(entry => entry.kind === CompactionEntry.kind).length);
    const runningTool = live?.tools?.find(slot => slot.status === "running");
    const content = live?.generation?.message?.content;
    checkpoint.runtime.activity = checkpoint.question ? { phase: "awaiting_input" }
      : live?.compactions?.some(slot => slot.blocking) ? { phase: "compacting" }
      : live?.generation?.retry ? { phase: "retrying", attempt: live.generation.attempt }
      : runningTool ? { phase: "tools", toolTitle: title(runningTool.name) }
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
    const parts = checkpoint.parts.filter(p =>
      (p.type === "question" && p.id === cacheId) ||
      (p.type === "source" && p.id.startsWith(`${cacheId}:`)),
    );
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
        const key = `native-tool:${entryId}:${part.id}`;
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
        const assistant = (task?.input as ToolTaskInput | undefined)?.assistant;
        const key = assistant ? `native-tool:${assistant}:${message.toolCallId}` : byCall.get(message.toolCallId);
        const card = key ? cards.get(key) : undefined;
        if (card) {
          card.status = message.isError ? "failed" : "completed";
          card.output = message.details ?? message.content;
          Object.assign(card, taskTiming(task));
          if (typeof message.durationMs === 'number' && Number.isFinite(message.durationMs) && message.durationMs >= 0) card.durationMs = message.durationMs;
          if (projectsAgentCanonicalText(card.name)) card.canonicalText = message.content.filter(part => part.type === 'text').map(part => part.type === 'text' ? part.text : '').join('\n');
          if (entry.byTaskId) attach(card.id, `${entry.byTaskId}:${message.toolCallId}`);
        }
      }
    }
  }
  const generation = live?.generation?.message as AssistantMessage | undefined;
  if (generation && live?.run) {
    checkpoint.streamingAssistantId = `native-live:${live.run.taskId}`;
    assistantParts(generation, checkpoint.streamingAssistantId);
  } else if (!oldStreamingId || oldStreamingId.startsWith("native")) {
    checkpoint.streamingAssistantId = undefined;
  }
  for (const slot of live?.tools ?? []) {
    const task = slot.taskId ? await storage.task(slot.taskId, context) : undefined;
    const assistant = (task?.input as ToolTaskInput | undefined)?.assistant;
    const key = assistant ? `native-tool:${assistant}:${slot.callId}` : byCall.get(slot.callId);
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
  const replaceLegacyStreaming = oldStreamingId && !oldStreamingId.startsWith("native") &&
    native.some(p => p.type === "text");
  checkpoint.parts = [
    ...checkpoint.parts.filter(p => !p.id.startsWith("native:") && !p.id.startsWith("native-live:") &&
      !p.id.startsWith("native-tool:") &&
      !attachedIds.has(`${p.type}:${p.id}`) &&
      !(replaceLegacyStreaming && p.id.startsWith(`${oldStreamingId}:`))),
    ...native.flatMap(p => [p, ...(p.type === "tool" ? attached.get(p.id) ?? [] : [])]),
  ];
  if (replaceLegacyStreaming && !generation) checkpoint.streamingAssistantId = undefined;
  const followUps = latestText === null ? [] : splitAgentFollowUps(latestText).followUps;
  checkpoint.followUps = followUps.length ? followUps : undefined;
  if (checkpoint.runtime) checkpoint.runtime.responses = responses;
}
