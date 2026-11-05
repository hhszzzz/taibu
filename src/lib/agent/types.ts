import type { Message, Tool, AssistantMessageEventStream, Model, Api, TranscriptContext, SimpleStreamOptions, Usage } from "@earendil-works/pi-ai";
import type { Schema, Static } from "@earendil-works/pi-schema";
import type { ChatMessage } from "@/types";
import type { AgentQuestion } from './questions';
import type { AgentTodo } from './todos';

export type AgentRunStatus =
  | "queued"
  | "running"
  | "awaiting_input"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";
export type AgentPart =
  | { type: "text"; id: string; text: string }
  | { type: "reasoning"; id: string; text: string; durationMs?: number }
  | {
      type: "tool";
      id: string;
      name: string;
      title: string;
      status: "pending" | "running" | "awaiting_input" | "completed" | "failed";
      input?: unknown;
      output?: unknown;
      canonicalText?: string;
      /** Tool execution time (durable since 1.1.0), shown on completed cards. */
      durationMs?: number;
      /** Native task wall-clock timestamps, including waits and takeover. */
      startedAt?: number;
      endedAt?: number;
      /** The card of the call that made this one: a code mode script's tool calls are nested under it. */
      parentId?: string;
      /** Which of its script's calls this is: the number of the row the script's card lists for it. */
      scriptCall?: number;
    }
  | { type: "source"; id: string; title: string; url: string; content?: string }
  | { type: "question"; id: string; question: string; questions?: AgentQuestion[] }
  | { type: 'todo'; id: string; revision: number; items: AgentTodo[] }
  | {
      type: "artifact";
      id: string;
      title: string;
      recordId?: string;
      chartId?: string;
      chartType?: string;
    };

export interface AgentMessageData {
  version: 1;
  runId: string;
  status: AgentRunStatus;
  parts: AgentPart[];
  error?: string;
  runtime?: AgentRuntimeInfo;
  compactions?: Array<{ id: string; summary?: string; through?: string; retainedFrom?: string; status: 'completed' | 'failed'; reason?: string }>;
  /** Questions the final answer suggests asking next (follow-ups.ts). */
  followUps?: string[];
}

/** Public projection of Pi's active context, never credentials or the full prompt. */
export interface AgentRuntimeInfo {
  model: { id: string; name: string; icon?: string | null; contextWindow: number | null; limitSource: "configured" | "unknown" };
  /** Settled model response measurements; old entries may have no measurements. */
  responses?: Array<{ id: string; durationMs?: number; startedAt?: number; endedAt?: number }>;
  /** 系统提示里注入的方法目录占的 token（网关 count_tokens 计数，不可用时估算）；上下文卡把它计入「技能」而不是「系统提示」。 */
  skillsTokens?: number;
  /** 系统提示里的技能目录：列出几个技能（只能由用户调用的不列）与这段的 token；没有可列的技能时不记。 */
  skills?: { listed: number; sectionTokens: number };
  /** 本任务接入的 MCP：接上与没连上的服务数、各暴露方式的工具数、常驻工具定义与「外部服务」小节的估算 token。 */
  mcp?: { servers: number; skipped: number; direct: number; deferred: number; codemode: number; toolsTokens: number; sectionTokens: number };
  context?: {
    tokens: number;
    measuredTokens: number;
    estimatedTokens: number;
    source: "usage" | "mixed" | "estimated";
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    reasoning?: number;
    compactions: number;
  };
  /** `background`: the main conversation is idle and the task waits for background subagents to report. */
  activity?: { phase: "preparing" | "generating" | "thinking" | "responding" | "tools" | "compacting" | "retrying" | "awaiting_input" | "background" | "settling"; toolTitle?: string; attempt?: number; /** 本次生成的请求开始时间（epoch ms），用于实时计时。 */ startedAt?: number };
  usage?: { models: Record<string, Partial<Pick<Usage, 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'totalTokens' | 'reasoning'>>>; tools: Record<string, Partial<Pick<Usage, 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'totalTokens' | 'reasoning'>>>; totalTokens: number };
}

/**
 * A background subagent carried into the next task: its name, role, the method it was given and its condensed
 * transcript. A subagent without a role is a specialist.
 */
export interface AgentBackgroundResident {
  name: string;
  profile?: string;
  system?: string;
  messages: Message[];
}

export interface AgentCheckpoint {
  version: 2;
  /** Initial context seed and completed context; execution history lives in Durable. */
  messages: Message[];
  parts: AgentPart[];
  question?: string;
  questions?: AgentQuestion[];
  questionId?: string;
  todos?: { revision: number; items: AgentTodo[] };
  compactions?: AgentMessageData['compactions'];
  summary?: string;
  /** Plan mode: the user approved the submitted plan; gated tools are available again. */
  planApproved?: boolean;
  /** Plan mode was disabled while this task was running; unanswered plans never grant approval. */
  planModeDisabled?: boolean;
  /** Plan mode: how often the model answered without submitting a plan, so the nudge cannot loop forever. */
  planNudges?: number;
  summaryThrough?: number;
  knowledgeQueries?: Record<string, number>;
  /**
   * Evidence numbering (evidence.ts): the conversation's highest number before
   * this task, and the last number each tool call used. Keyed by call so a
   * replayed result records the same numbers again instead of advancing.
   */
  citations?: { base: number; calls: Record<string, number> };
  /** Suggestions parsed from the latest answer text; the block itself is not shown. */
  followUps?: string[];
  /**
   * The conversation's resident background subagents (background.server.ts): written when the task ends and recreated
   * by the next task that continues this context, each with its requests and answers but not its tool calls.
   */
  background?: AgentBackgroundResident[];
  /**
   * Deferred tools the main conversation loaded (`control.addTools`: a search, or a direct call that loaded its tool),
   * offered again by the next task that continues this context: Pi keeps them in the conversation's `pi.agent`, which
   * every task creates anew.
   */
  loadedTools?: string[];
  streamingAssistantId?: string;
  runtime?: AgentRuntimeInfo;
  durable: {
    engine: typeof import('./engine').AGENT_ENGINE;
    seeded?: boolean;
    started?: boolean;
    waitingToolId?: string;
    answeredCommands?: number[];
  };
}

export type PiStreamFn = (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => AssistantMessageEventStream;
/** Feature modules as a run sees them: an evaluation run does not depend on platform switches. */
export type AgentFeatureState =
  | { status: 'enabled' }
  | { status: 'disabled' }
  | { status: 'unavailable'; error?: string };
export type AgentFeatureStateProvider = (id: string) => Promise<AgentFeatureState>;
export type AgentRunAccess = { featureState?: AgentFeatureStateProvider };
export interface DomainToolResult<T = unknown> {
  content: Array<{ type: "text"; text: string }>;
  details: T;
  canonicalText?: string;
  usage?: Usage;
}

/** Who made a call: a collaboration member or background subagent rather than the main agent. */
export type DomainToolCaller = { member?: boolean };

/** Business tools have no dependency on an agent loop implementation. */
export interface DomainTool<T extends Schema = Schema, R = unknown> extends Tool<T> {
  label: string;
  replay?: "safe";
  execute(callId: string, args: Static<T>, signal?: AbortSignal, caller?: DomainToolCaller): Promise<DomainToolResult<R>>;
}

export interface AgentRunView {
  id: string;
  conversationId: string;
  status: AgentRunStatus;
  message: ChatMessage;
  cursor: number;
  epoch?: number;
  createdAt: string;
  clientRequestId?: string;
  userMessage?: ChatMessage;
  commandMessageIds?: string[];
  queue?: Array<{ sequence: number; mode: 'steer' | 'follow_up' | 'reply'; message: ChatMessage; revision: number; sortOrder: number; state: 'pending' | 'claimed' | 'admitted' | 'consumed' | 'cancelled' }>;
  configuration?: import('@/lib/chat/model-settings').NextTaskConfiguration;
  /** A metered task pays for each model request from the member's balance; an exempt one runs on their own model. */
  billing?: 'metered' | 'exempt';
}

export const AGENT_ACTIVE_STATUSES: AgentRunStatus[] = [
  "queued",
  "running",
  "awaiting_input",
  "cancelling",
];
export function isAgentRunTerminal(status: AgentRunStatus) {
  return (
    status === "completed" || status === "cancelled" || status === "failed"
  );
}

/** Replace the part with the same type and ID in place, or append it. */
export function putAgentPart(parts: AgentPart[], part: AgentPart) {
  const index = parts.findIndex(item => item.type === part.type && item.id === part.id);
  if (index < 0) parts.push(part);
  else parts[index] = part;
}

export function agentMessageContent(parts: AgentPart[]) {
  return parts
    .filter(
      (part): part is Extract<AgentPart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n\n");
}
