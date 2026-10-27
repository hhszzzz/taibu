import type { ChatMessage } from "@/types";
import { isAgentRunTerminal, type AgentRunView } from "./types";
import { AGENT_STREAM_IDLE_MS, AGENT_STREAM_QUEUE_BYTES, type AgentResync } from './sse';

export function canAdoptAgentRun(
  current: AgentRunView | undefined,
  incoming: AgentRunView,
) {
  if (!current || current.conversationId !== incoming.conversationId)
    return true;
  if (current.id === incoming.id) return (incoming.epoch ?? 0) >= (current.epoch ?? 0) && (incoming.epoch !== current.epoch || incoming.cursor >= current.cursor);
  return Date.parse(incoming.createdAt) >= Date.parse(current.createdAt);
}

export function mergeAgentSnapshot(messages: ChatMessage[], run: AgentRunView) {
  const index = messages.findIndex((m) => m.id === run.message.id);
  if (index < 0)
    return isAgentRunTerminal(run.status)
      ? messages
      : [...messages, run.message];
  const next = [...messages];
  next[index] = run.message;
  return next;
}

/** A task's aggregate output follows its in-run inputs in the visible transcript. */
export function orderAgentMessagesForDisplay(messages: ChatMessage[], currentRun?: AgentRunView): ChatMessage[] {
  const moveAfter = new Map<number, number>();
  const commands = new Set(currentRun?.commandMessageIds);
  let assistantIndex = -1;
  let runId: string | undefined;
  for (const [index, message] of messages.entries()) {
    if (message.role === 'assistant') {
      assistantIndex = index;
      runId = message.agent?.runId;
    } else if (message.role === 'user' && runId) {
      // The snapshot also associates older inputs without changing loaded history.
      const inputRunId = commands.has(message.id) ? currentRun?.id : message.metadata?.agentRunId;
      if (inputRunId === runId) moveAfter.set(assistantIndex, index);
    }
  }
  if (!moveAfter.size) return messages;
  const insertAfter = new Map([...moveAfter].map(([from, to]) => [to, messages[from]]));
  return messages.flatMap((message, index) => moveAfter.has(index) ? []
    : insertAfter.has(index) ? [message, insertAfter.get(index)!] : [message]);
}
export type AgentTail = { runId: string; seq: number; text: string };

export type AgentStreamHandlers = {
  onResync?: (resync: AgentResync) => void;
  /** 正文增量（只用于显示）；快照永远更权威。 */
  onTail?: (frame: AgentTail) => void;
  idleTimeoutMs?: number;
};

export async function readAgentStream(
  response: Response,
  signal: AbortSignal,
  onRun: (run: AgentRunView) => void,
  { onResync, onTail, idleTimeoutMs = AGENT_STREAM_IDLE_MS }: AgentStreamHandlers = {},
) {
  if (!response.ok || !response.body) throw new Error("任务连接中断");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (!signal.aborted) {
      let timer!: ReturnType<typeof setTimeout>;
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('AGENT_STREAM_IDLE')), idleTimeoutMs); }),
      ]).finally(() => clearTimeout(timer));
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replaceAll("\r\n", "\n");
      if (buffer.length > AGENT_STREAM_QUEUE_BYTES) throw new Error('AGENT_STREAM_FRAME_TOO_LARGE');
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split(/\r?\n/u)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const event = frame.split(/\r?\n/u).find(line => line.startsWith('event:'))?.slice(6).trim();
        if (event === 'error') throw new Error('AGENT_STREAM_INTERRUPTED');
        if (event === 'tail') {
          const tail = JSON.parse(data) as AgentTail;
          if (typeof tail.runId === 'string' && Number.isSafeInteger(tail.seq) && typeof tail.text === 'string') onTail?.(tail);
          continue;
        }
        if (event === 'resync') {
          const resync = JSON.parse(data) as AgentResync;
          if (resync.version === 1 && typeof resync.runId === 'string' && Number.isSafeInteger(resync.cursor) && resync.cursor >= 0 && Number.isSafeInteger(resync.epoch) && resync.epoch >= 0) onResync?.(resync);
          continue;
        }
        const run = JSON.parse(data) as AgentRunView;
        if (
          typeof run.id === "string" &&
          typeof run.conversationId === "string" &&
          Number.isSafeInteger(run.cursor) &&
          run.cursor >= 0 &&
          run.message?.agent?.version === 1 &&
          Array.isArray(run.message.agent.parts)
        )
          onRun(run);
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class AgentHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function postAgentRun(body: Record<string, unknown>) {
  return postAgentJson<AgentRunView>("/api/agent/runs", body);
}
export async function postAgentCommand(
  runId: string,
  body: { content: string; clientRequestId: string; mode: "steer" | "follow_up" | "reply"; questionId?: string; answers?: import('./questions').AgentAnswers; attachmentIds?: string[] },
) {
  return postAgentJson<{ message: ChatMessage; run: AgentRunView }>(
    `/api/agent/runs/${runId}/messages`, body,
  );
}
async function postAgentJson<T>(url: string, body: Record<string, unknown>) {
  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  try {
    return await agentJson<T>(url, request);
  } catch (error) {
    if (
      error instanceof AgentHttpError &&
      error.status >= 400 &&
      error.status < 500
    )
      throw error;
    return agentJson<T>(url, request);
  }
}
export async function agentJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const value = await response.json().catch(() => {
    throw new AgentHttpError("任务服务暂时不可用", response.status);
  });
  if (!response.ok)
    throw new AgentHttpError(
      typeof value.error === "string" ? value.error : "任务服务暂时不可用",
      response.status,
    );
  return value as T;
}
