import "server-only";
import type { ScopedDb } from "@/lib/db/context.server";
import { json, jsonPath, jsonPathText } from "@/lib/db/sql-helpers";
import type { ChatMessage, CustomProviderRequest, AIReasoningEffort } from "@/types";
import type { AgentCollaborator } from '@/lib/chat/model-settings';
import type { EncryptedAgentCredential } from "./credentials.server";
import type { AgentCheckpoint, AgentRunStatus, AgentRunView } from "./types";
import { AGENT_ENGINE } from "./engine";
import { AGENT_DRILLDOWN_BASES } from "./tool-catalog";
import type { AgentRunMetricsRow } from "./admin-metrics";

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
    /** The IANA zone the user's messages are dated in, from their browser when the task was created. */
    timezone: string;
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

export type AgentRunState = {
  id: string;
  status: AgentRunRow['status'];
  event_cursor: string | number;
  fence: number | null;
  cancel_requested: boolean | null;
  lease_until: string | null;
  updated_at: string | null;
};

export class AgentStore {
  constructor(readonly db: ScopedDb) {}
  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return this.db.rpc(name as never, args as never, { timeoutMs: 30_000 }) as Promise<T>;
  }
  /** Writes a terminal run's metrics; a takeover that settles the same run again replaces its row. */
  async recordRunMetrics(row: AgentRunMetricsRow) {
    const values = {
      run_id: row.runId, model_id: row.modelId, status: row.status,
      queued_ms: row.queuedMs, total_ms: row.totalMs, first_token_ms: row.firstTokenMs,
      generation_count: row.generationCount, generation_ms: row.generationMs,
      tool_count: row.toolCount, tool_ms: row.toolMs,
      compaction_count: row.compactionCount, compaction_ms: row.compactionMs,
      retries: row.retries, faults: row.faults, hangs: row.hangs,
      input_tokens: row.inputTokens, output_tokens: row.outputTokens,
      cache_read_tokens: row.cacheReadTokens, cache_write_tokens: row.cacheWriteTokens,
      // pg encodes a JS array as a PostgreSQL array literal, so the timeline goes through json() as JSON text.
      total_tokens: row.totalTokens, phases: json(row.phases) as never,
      started_at: row.startedAt, ended_at: row.endedAt,
    };
    await this.db.tx(trx => trx.insertInto("agent_run_metrics").values(values)
      .onConflict(oc => oc.column("run_id").doUpdateSet({
        model_id: values.model_id, status: values.status, queued_ms: values.queued_ms, total_ms: values.total_ms,
        first_token_ms: values.first_token_ms, generation_count: values.generation_count, generation_ms: values.generation_ms,
        tool_count: values.tool_count, tool_ms: values.tool_ms, compaction_count: values.compaction_count,
        compaction_ms: values.compaction_ms, retries: values.retries, faults: values.faults, hangs: values.hangs,
        input_tokens: values.input_tokens, output_tokens: values.output_tokens, cache_read_tokens: values.cache_read_tokens,
        cache_write_tokens: values.cache_write_tokens, total_tokens: values.total_tokens, phases: values.phases,
        started_at: values.started_at, ended_at: values.ended_at,
      }))
      .execute());
  }
  async getRun(id: string, userId?: string) {
    const row = await this.db.tx((trx) => {
      let query = trx.selectFrom("agent_runs").selectAll().where("id", "=", id);
      if (userId) query = query.where("user_id", "=", userId);
      return query.executeTakeFirst();
    });
    return (row ?? null) as unknown as AgentRunRow | null;
  }
  /** Narrow columns used by wake-up loops; avoids reading checkpoints. */
  async runState(id: string, userId?: string) {
    const row = await this.db.tx((trx) => {
      let query = trx.selectFrom("agent_runs")
        .select(["id", "status", "event_cursor", "fence", "cancel_requested", "lease_until", "updated_at"])
        .where("id", "=", id);
      if (userId) query = query.where("user_id", "=", userId);
      return query.executeTakeFirst();
    });
    return (row ?? null) as unknown as AgentRunState | null;
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
