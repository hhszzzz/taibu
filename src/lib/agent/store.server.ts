import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage, CustomProviderRequest, AIReasoningEffort } from "@/types";
import type { AgentCollaborator } from '@/lib/chat/model-settings';
import type { EncryptedAgentCredential } from "./credentials.server";
import type { AgentCheckpoint, AgentRunStatus, AgentRunView } from "./types";
import { AGENT_ENGINE } from "./engine";

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
  };
  chart_id?: string;
  chart_type?: string;
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
  constructor(readonly db: SupabaseClient) {}
  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, args)
      .abortSignal(AbortSignal.timeout(30_000));
    if (error) throw new Error(error.message);
    return data as T;
  }
  async getRun(id: string, userId?: string) {
    let query = this.db.from("agent_runs").select("*").eq("id", id);
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    return data as AgentRunRow | null;
  }
  async currentRun(conversationId: string, userId: string) {
    const { data, error } = await this.db
      .from("agent_runs")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as AgentRunRow | null;
  }
  async cursor(id: string) {
    const { data, error } = await this.db
      .from("agent_run_events")
      .select("sequence")
      .eq("run_id", id)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Number(data?.sequence ?? 0);
  }
  async events(id: string, after: number, through: number) {
    const { data, error } = await this.db
      .from("agent_run_events")
      .select("sequence,type,payload")
      .eq("run_id", id)
      .gt("sequence", after)
      .lte("sequence", through)
      .order("sequence")
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as AgentStoredEvent[];
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
      configuration: run.input ? { model: run.input.model, reasoning: run.input.reasoning, reasoningEffort: run.input.reasoningEffort ?? null, collaborators: run.input.collaborators ?? [], webEnabled: run.input.webEnabled } : undefined,
      queue: commands.map(command => ({ sequence: command.sequence, message: command.message, mode: command.mode, revision: command.revision ?? 1, sortOrder: command.sort_order ?? command.sequence, state: command.delivery_state ?? 'admitted' })),
    };
  }
  async workerReady() {
    const { data, error } = await this.db
      .from("agent_workers")
      .select("id")
      .eq("engine", AGENT_ENGINE)
      .gt("heartbeat_at", new Date(Date.now() - 30_000).toISOString())
      .limit(1);
    if (error) return false;
    return !!data?.length;
  }
  lease(run: AgentRunRow) {
    return { p_run_id: run.id, p_worker_id: run.worker_id, p_fence: run.fence };
  }
  async commands(run: AgentRunRow, { includeConsumed = false } = {}) {
    let query = this.db
      .from("agent_run_commands")
      .select("sequence,mode,message,revision,sort_order,delivery_state")
      .eq("run_id", run.id);
    if (!includeConsumed) query = query.eq("consumed", false);
    const { data, error } = await query.order("sort_order").order("sequence");
    if (error) throw new Error(error.message);
    return (data ?? []) as AgentCommandRow[];
  }
  async credential(run: AgentRunRow) {
    const { data, error } = await this.db
      .from("agent_run_credentials")
      .select("ciphertext")
      .eq("run_id", run.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.ciphertext as EncryptedAgentCredential | undefined;
  }
  async artifact(run: AgentRunRow, callId: string) {
    const { data, error } = await this.db
      .from("agent_run_artifacts")
      .select("*")
      .eq("run_id", run.id)
      .eq("call_id", callId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as AgentArtifactRow | null;
  }
  async artifacts(run: AgentRunRow) {
    const { data, error } = await this.db
      .from("agent_run_artifacts")
      .select("*")
      .eq("run_id", run.id)
      .eq("kind", "calculation");
    if (error) throw new Error(error.message);
    return (data ?? []) as AgentArtifactRow[];
  }
  async chartArtifact(run: AgentRunRow, id: string) {
    const { data, error } = await this.db.from('agent_run_artifacts')
      .select('*,agent_runs!inner(user_id,conversation_id)')
      .eq('id', id).eq('kind', 'calculation')
      .eq('agent_runs.user_id', run.user_id).eq('agent_runs.conversation_id', run.conversation_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as AgentArtifactRow | null;
  }
  async inspectedChart(run: AgentRunRow, reference: string): Promise<AgentArtifactRow | null> {
    const { data, error } = await this.db.from('agent_run_artifacts').select('*')
      .eq('run_id', run.id).eq('tool_name', 'inspect_chart')
      .eq('result->details->>chartReference', reference)
      .order('result->inspectionOrder', { ascending: false, nullsFirst: false }).limit(2);
    if (error) throw new Error(error.message);
    const snapshots = (data ?? []) as AgentArtifactRow[];
    if (snapshots.length > 1 && !Number.isSafeInteger(snapshots[0]?.result.inspectionOrder))
      throw new Error('该命盘有多次旧版查看记录，请重新调用 inspect_chart 后再定位');
    return snapshots[0] ?? null;
  }
}
