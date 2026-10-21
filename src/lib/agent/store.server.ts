import "server-only";
import type { ScopedDb } from "@/lib/db/context.server";
import { jsonPath, jsonPathText } from "@/lib/db/sql-helpers";
import type { ChatMessage, CustomProviderRequest, AIReasoningEffort } from "@/types";
import type { AgentCollaborator } from '@/lib/chat/model-settings';
import type { EncryptedAgentCredential } from "./credentials.server";
import type { AgentCheckpoint, AgentRunStatus, AgentRunView } from "./types";
import { AGENT_ENGINE } from "./engine";
import { AGENT_DRILLDOWN_BASES } from "./tool-catalog";

export interface AgentRunRow {
  id: string;
  user_id: string;
  conversation_id: string;
  request_id: string;
  request_hash: string;
  status: AgentRunStatus;
  checkpoint: AgentCheckpoint;
  public_message: ChatMessage;
  input: {
    model: string;
    reasoning: boolean;
    reasoningEffort?: AIReasoningEffort | null;
    collaborators?: AgentCollaborator[];
    webEnabled: boolean;
    /** Whether the model may run code mode scripts; fixed when the task is created. Absent means off. */
    codeMode?: boolean;
    /** Whether the model must submit a plan for approval before executing; fixed when the task is created. */
    planMode?: boolean;
    /** A `/compact` task: it compacts the conversation's context for the next task and answers nothing. */
    compact?: { instructions: string | null };
    systemPrompt: string;
    customProvider?: Omit<CustomProviderRequest, "apiKey">;
    userMessage: ChatMessage;
    title: string;
    knowledgeBaseIds?: string[];
    memoryEnabled?: boolean;
  };
  billing: "charged" | "exempt" | "refunded";
  worker_id: string | null;
  fence: number;
  cancel_requested: boolean;
  record_id: string | null;
  created_at: string;
  event_cursor: number;
}
export interface AgentArtifactRow {
  id: string;
  call_id: string;
  tool_name: string;
  kind: "calculation" | "tool";
  args: Record<string, unknown>;
  result: {
    content: Array<{ type: "text"; text: string }>;
    details: unknown;
    canonicalText?: string;
    chartSnapshot?: { kind: string; result: unknown; canonicalText: string };
    inspectionOrder?: number;
    /** Drilldowns keep the chart they read, so they count as an inspection for focus_chart. */
    inspection?: { chartReference: string; chartKind: string; result: unknown };
  };
}
export interface AgentCommandRow {
  sequence: number;
  mode: "steer" | "follow_up" | "reply";
  message: ChatMessage;
  revision?: number;
  sort_order?: number;
  delivery_state?: 'pending' | 'claimed' | 'admitted' | 'consumed' | 'cancelled';
}
export interface AgentStoredEvent {
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
}

export class AgentStore {
  constructor(readonly db: ScopedDb) {}
  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return this.db.rpc(name as never, args as never, { timeoutMs: 30_000 }) as Promise<T>;
  }
  async getRun(id: string, userId?: string) {
    const row = await this.db.tx((trx) => {
      let query = trx.selectFrom("agent_runs").selectAll().where("id", "=", id);
      if (userId) query = query.where("user_id", "=", userId);
      return query.executeTakeFirst();
    });
    return (row ?? null) as unknown as AgentRunRow | null;
  }
  async currentRun(conversationId: string, userId: string) {
    const row = await this.db.tx((trx) => trx
      .selectFrom("agent_runs")
      .selectAll()
      .where("conversation_id", "=", conversationId)
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst());
    return (row ?? null) as unknown as AgentRunRow | null;
  }
  async cursor(id: string) {
    const row = await this.db.tx((trx) => trx
      .selectFrom("agent_run_events")
      .select("sequence")
      .where("run_id", "=", id)
      .orderBy("sequence", "desc")
      .limit(1)
      .executeTakeFirst());
    return Number(row?.sequence ?? 0);
  }
  async events(id: string, after: number, through: number) {
    const rows = await this.db.tx((trx) => trx
      .selectFrom("agent_run_events")
      .select(["sequence", "type", "payload"])
      .where("run_id", "=", id)
      .where("sequence", ">", after)
      .where("sequence", "<=", through)
      .orderBy("sequence", "asc")
      .limit(100)
      .execute());
    return rows as unknown as AgentStoredEvent[];
  }
  async view(run: AgentRunRow): Promise<AgentRunView> {
    const commands = await this.commands(run, { includeConsumed: true });
    const message = structuredClone(run.public_message);
    if (message.agent) message.agent.status = run.status;
    if (
      run.record_id &&
      message.agent &&
      !message.agent.parts.some(
        (p) => p.type === "artifact" && p.id === run.record_id,
      )
    ) {
      message.agent.parts.push({
        type: "artifact",
        id: run.record_id,
        title: "已保存分析记录",
        recordId: run.record_id,
      });
    }
    return {
      id: run.id,
      conversationId: run.conversation_id,
      status: run.status,
      message,
      cursor: Number(run.event_cursor),
      epoch: run.fence ?? 0,
      createdAt: run.created_at,
      clientRequestId: run.request_id,
      userMessage: run.input?.userMessage,
      commandMessageIds: commands.filter(command => command.delivery_state !== 'cancelled').map(command => command.message.id),
      billing: run.billing,
      configuration: run.input ? { model: run.input.model, reasoning: run.input.reasoning, reasoningEffort: run.input.reasoningEffort ?? null, collaborators: run.input.collaborators ?? [], webEnabled: run.input.webEnabled, codeMode: run.input.codeMode === true, planMode: run.input.planMode === true } : undefined,
      queue: commands.map(command => ({ sequence: command.sequence, message: command.message, mode: command.mode, revision: command.revision ?? 1, sortOrder: command.sort_order ?? command.sequence, state: command.delivery_state ?? 'admitted' })),
    };
  }
  async workerReady() {
    try {
      const row = await this.db.tx((trx) => trx
        .selectFrom("agent_workers")
        .select("id")
        .where("engine", "=", AGENT_ENGINE)
        .where("heartbeat_at", ">", new Date(Date.now() - 30_000).toISOString())
        .limit(1)
        .executeTakeFirst());
      return !!row;
    } catch {
      return false;
    }
  }
  lease(run: AgentRunRow) {
    return { p_run_id: run.id, p_worker_id: run.worker_id, p_fence: run.fence };
  }
  async commands(run: AgentRunRow, { includeConsumed = false } = {}) {
    const rows = await this.db.tx((trx) => {
      let query = trx
        .selectFrom("agent_run_commands")
        .select(["sequence", "mode", "message", "revision", "sort_order", "delivery_state"])
        .where("run_id", "=", run.id);
      if (!includeConsumed) query = query.where("consumed", "=", false);
      return query.orderBy("sort_order", "asc").orderBy("sequence", "asc").execute();
    });
    return rows as unknown as AgentCommandRow[];
  }
  async credential(run: AgentRunRow) {
    const row = await this.db.tx((trx) => trx
      .selectFrom("agent_run_credentials")
      .select("ciphertext")
      .where("run_id", "=", run.id)
      .executeTakeFirst());
    return row?.ciphertext as EncryptedAgentCredential | undefined;
  }
  async artifact(run: AgentRunRow, callId: string) {
    const row = await this.db.tx((trx) => trx
      .selectFrom("agent_run_artifacts")
      .selectAll()
      .where("run_id", "=", run.id)
      .where("call_id", "=", callId)
      .executeTakeFirst());
    return (row ?? null) as unknown as AgentArtifactRow | null;
  }
  async chartArtifact(run: AgentRunRow, id: string) {
    const row = await this.db.tx((trx) => trx
      .selectFrom("agent_run_artifacts as artifact")
      .innerJoin("agent_runs as run", "run.id", "artifact.run_id")
      .selectAll("artifact")
      .where("artifact.id", "=", id)
      .where("artifact.kind", "=", "calculation")
      .where("run.user_id", "=", run.user_id)
      .where("run.conversation_id", "=", run.conversation_id)
      .executeTakeFirst());
    return (row ?? null) as unknown as AgentArtifactRow | null;
  }
  async inspectedChart(run: AgentRunRow, reference: string): Promise<AgentArtifactRow | null> {
    const rows = await this.db.tx((trx) => trx
      .selectFrom("agent_run_artifacts")
      .selectAll()
      .where("run_id", "=", run.id)
      .where("tool_name", "in", ["inspect_chart", ...Object.keys(AGENT_DRILLDOWN_BASES)])
      .where(jsonPathText("result", ["details", "chartReference"]), "=", reference)
      .orderBy(jsonPath("result", ["inspectionOrder"]), (order) => order.desc().nullsLast())
      .limit(2)
      .execute());
    const snapshots = rows as unknown as AgentArtifactRow[];
    if (snapshots.length > 1 && !Number.isSafeInteger(snapshots[0]?.result.inspectionOrder))
      throw new Error('该命盘有多次旧版查看记录，请重新调用 inspect_chart 后再定位');
    return snapshots[0] ?? null;
  }
}
