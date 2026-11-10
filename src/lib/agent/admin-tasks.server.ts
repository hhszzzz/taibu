import "server-only";
import type { ScopedDb } from "@/lib/db/context.server";
import { referenceCosts } from "@/lib/billing/ledger.server";
import type { ReferenceCost } from "@/lib/billing/config";
import type { JsonValue } from "@earendil-works/chord";
import type { ConversationRecord, JsonObject, StorageWrite, SubmissionRecord, TaskRecord } from "@earendil-works/pi-durable";
import { AGENT_ACTIVE_STATUSES, AGENT_BLOCKING_STATUSES, type AgentRunStatus } from "./types";
import { AGENT_BACKGROUND_TASKS } from "./tool-catalog";
import type {
  AgentAdminRun, AgentTaskConversation, AgentTaskConversationRole, AgentTaskNode, AgentTaskRole, AgentTaskTree,
} from "./admin-tasks";

/** One commit of `agent_admin_task_log`: each write keeps its shape but only the fields the tree reads. */
export interface AgentTaskLogCommit {
  sequence: number;
  at: string;
  writes: StorageWrite[];
}

export const AGENT_ADMIN_RUN_LIMIT = 50;
const TASK_LOG_PAGE = 200;
/** A tree reads at most this many pages (10,000 commits); a longer log shows its beginning. */
const TASK_LOG_PAGES = 50;
const REASON_LIMIT = 2000;

type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;
const isRecord = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Pi's own task kinds, as `TaskRecord.kind` persists them. */
const ROLES: Readonly<Record<string, AgentTaskRole>> = {
  "pi.generation": "generation", "pi.tool": "tool", "pi.compaction": "compaction",
  [AGENT_BACKGROUND_TASKS.anchor]: "subagent", [AGENT_BACKGROUND_TASKS.reporter]: "report",
};

function taskNode(task: StoredTask, changedAt: string, toolNames: ReadonlyMap<string, string>): AgentTaskNode {
  const { state } = task;
  const input = isRecord(task.input) ? task.input : undefined;
  const checkpoint = state.status === "completing" || state.status === "terminal" || !isRecord(state.checkpoint) ? undefined : state.checkpoint;
  const node: AgentTaskNode = {
    id: Number(task.id), kind: task.kind, role: ROLES[task.kind] ?? "other", status: state.status, changedAt, tasks: [], conversations: [],
  };
  if (node.role === "tool" && input?.kind === "nested" && isRecord(input.call) && typeof input.call.name === "string") {
    node.tool = input.call.name;
    node.nested = true;
  } else if (node.role === "tool" && input?.kind === "model") {
    const name = toolNames.get(`${input.assistant}:${input.callId}`);
    if (name) node.tool = name;
  }
  if (node.role === "report" && typeof input?.name === "string") node.subagent = input.name;
  if (typeof checkpoint?.phase === "string") node.phase = checkpoint.phase;
  if (typeof checkpoint?.attempt === "number") node.attempt = checkpoint.attempt;
  if (isRecord(checkpoint?.model) && typeof checkpoint.model.modelId === "string") node.model = checkpoint.model.modelId;
  if (state.status === "waiting") {
    node.waitingOn = state.on.map(Number);
    node.policy = state.policy;
  }
  if (state.status === "sleeping") node.sleepUntil = state.until;
  if (task.restarts) node.restarts = task.restarts;
  if (state.status === "completing" || state.status === "terminal") {
    const { outcome } = state;
    node.outcome = outcome.status;
    const reason = outcome.status === "failed" || outcome.status === "faulted" ? outcome.error.message : outcome.reason;
    if (reason) node.reason = reason.slice(0, REASON_LIMIT);
  }
  if (task.background) node.background = true;
  if (task.abortRequested) node.abortRequested = true;
  if (task.abortReason === "restart") node.abandoned = true;
  if (task.startedAt !== undefined) node.startedAt = task.startedAt;
  if (task.endedAt !== undefined) node.endedAt = task.endedAt;
  return node;
}

function conversationRole(conversation: ConversationRecord, owner: AgentTaskNode | undefined, main: boolean): AgentTaskConversationRole {
  if (conversation.parent) return "fork";
  if (!owner) return main ? "main" : "child";
  if (owner.role === "subagent") return "subagent";
  return owner.role === "tool" && owner.tool === "parallel_analysis" ? "member" : "child";
}

/**
 * Rebuilds a run's tasks from its commit log. A write replaces its record, so the latest write of each task,
 * conversation and submission is its state; a tool task's tool comes from the call in its assistant entry. Tasks sit
 * under their owner task, or their conversation when it owns them; a task-owned conversation sits under its task.
 */
export function buildAgentTaskTree(commits: readonly AgentTaskLogCommit[], truncated = false): AgentTaskTree {
  const conversations = new Map<number, ConversationRecord>();
  const tasks = new Map<number, { task: StoredTask; at: string }>();
  const submissions = new Map<number, SubmissionRecord>();
  const toolNames = new Map<string, string>();
  for (const commit of commits) for (const write of commit.writes) {
    if (write.type === "conversation") conversations.set(Number(write.value.id), write.value);
    else if (write.type === "task") tasks.set(Number(write.value.id), { task: write.value, at: commit.at });
    else if (write.type === "submission") submissions.set(Number(write.value.id), write.value);
    else if (write.type === "entry") {
      for (const message of write.value.model ?? []) if (message.role === "assistant")
        for (const part of message.content) if (part.type === "toolCall") toolNames.set(`${write.value.id}:${part.id}`, part.name);
    }
  }
  const byId = <T,>(map: ReadonlyMap<number, T>) => [...map].sort(([a], [b]) => a - b);
  const nodes = new Map(byId(tasks).map(([id, { task, at }]) => [id, taskNode(task, at, toolNames)]));
  const names = new Map<number, string>();
  for (const { task } of tasks.values()) {
    const input = isRecord(task.input) ? task.input : undefined;
    if (task.kind === AGENT_BACKGROUND_TASKS.reporter && typeof input?.name === "string" && typeof input.conversationId === "number")
      names.set(input.conversationId, input.name);
  }
  const views = new Map<number, AgentTaskConversation>();
  const top: AgentTaskConversation[] = [];
  for (const [id, conversation] of byId(conversations)) {
    const owner = conversation.owner ? nodes.get(Number(conversation.owner.taskId)) : undefined;
    const role = conversationRole(conversation, owner, !owner && !top.some(view => view.role === "main"));
    const name = role === "subagent" ? names.get(id) : undefined;
    const view: AgentTaskConversation = {
      id, role, ...(name ? { name } : {}), ...(conversation.parent ? { forkOf: Number(conversation.parent.conversationId) } : {}),
      submissions: [], tasks: [],
    };
    views.set(id, view);
    (owner?.conversations ?? top).push(view);
  }
  for (const [, submission] of byId(submissions)) views.get(Number(submission.conversationId))?.submissions.push({
    id: Number(submission.id), type: submission.type, status: submission.status,
    ...(submission.requestId ? { requestId: submission.requestId } : {}),
    ...(submission.status === "unanswered" ? { reason: submission.reason } : {}),
    ...(submission.status === "unanswered" && typeof submission.detail === "string" ? { detail: submission.detail.slice(0, REASON_LIMIT) } : {}),
  });
  const counts = { live: 0, completed: 0, failed: 0, aborted: 0 };
  for (const [id, node] of nodes) {
    const { task } = tasks.get(id)!;
    // A record whose owner the read did not reach still shows, under its conversation.
    const owner = task.owner === undefined ? undefined : nodes.get(Number(task.owner));
    (owner?.tasks ?? views.get(Number(task.conversationId))?.tasks)?.push(node);
    if (node.status !== "terminal") counts.live++;
    else if (node.outcome === "completed") counts.completed++;
    else if (node.outcome === "aborted") counts.aborted++;
    else counts.failed++;
  }
  return { commits: commits.length, lastCommitAt: commits.at(-1)?.at ?? null, truncated, conversations: top, counts };
}

interface AdminRunRow {
  id: string; conversation_id: string; user_id: string; status: string; billing: AgentAdminRun["billing"];
  worker_id: string | null; fence: number; lease_until: string | null; cancel_requested: boolean;
  created_at: string; updated_at: string; input: JsonValue;
}

function adminRun(row: AdminRunRow, emails: ReadonlyMap<string, string>): AgentAdminRun {
  const input = isRecord(row.input) ? row.input : undefined;
  return {
    id: row.id, conversationId: row.conversation_id, userId: row.user_id, userEmail: emails.get(row.user_id) ?? null,
    status: row.status as AgentRunStatus, billing: row.billing,
    title: typeof input?.title === "string" ? input.title : "", model: typeof input?.model === "string" ? input.model : "",
    modes: {
      codeMode: input?.codeMode === true, planMode: input?.planMode === true, compact: isRecord(input?.compact),
      web: input?.webEnabled === true, collaborators: Array.isArray(input?.collaborators) ? input.collaborators.length : 0,
    },
    workerId: row.worker_id, fence: Number(row.fence), leaseUntil: row.lease_until, cancelRequested: row.cancel_requested,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** The accounts' emails, to tell users apart; a failed lookup leaves them out rather than failing the list. */
async function userEmails(db: ScopedDb, ids: readonly string[]) {
  if (!ids.length) return new Map<string, string>();
  const data = await db.rpc("admin_get_auth_user_emails", { p_user_ids: [...ids] }).catch(() => null);
  if (!Array.isArray(data)) return new Map<string, string>();
  return new Map((data as Array<{ user_id: string; email: string | null }>).flatMap(row => row.email ? [[row.user_id, row.email] as const] : []));
}

/**
 * The newest tasks first: active ones (queued, running, awaiting input, stopping), the ones an update would interrupt,
 * or every recent one. A search, which the route has checked is a UUID, finds a task, a conversation's tasks or a
 * user's tasks in any state.
 */
export async function listAgentRunsForAdmin(db: ScopedDb, options: { scope: "active" | "blocking" | "recent"; search?: string }): Promise<AgentAdminRun[]> {
  const rows = await db.tx((trx) => {
    let query = trx.selectFrom("agent_runs")
      .select(["id", "conversation_id", "user_id", "status", "billing", "worker_id", "fence", "lease_until", "cancel_requested", "created_at", "updated_at", "input"]);
    if (options.search) query = query.where((eb) => eb.or([
      eb("id", "=", options.search!),
      eb("conversation_id", "=", options.search!),
      eb("user_id", "=", options.search!),
    ]));
    else if (options.scope === "active") query = query.where("status", "in", [...AGENT_ACTIVE_STATUSES]);
    else if (options.scope === "blocking") query = query.where("status", "in", [...AGENT_BLOCKING_STATUSES]);
    return query.orderBy("updated_at", "desc").limit(AGENT_ADMIN_RUN_LIMIT).execute();
  });
  const emails = await userEmails(db, [...new Set(rows.map(row => row.user_id))]);
  return (rows as unknown as AdminRunRow[]).map(row => adminRun(row, emails));
}

/** How many tasks an update would interrupt; a paused awaiting-input run resumes after the restart, so it does not count. */
export async function countBlockingAgentRuns(db: ScopedDb): Promise<number> {
  const row = await db.tx((trx) => trx.selectFrom("agent_runs")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("status", "in", [...AGENT_BLOCKING_STATUSES])
    .executeTakeFirst());
  return Number(row?.count ?? 0);
}

/** A task with its task tree and what its model calls cost (null when that lookup fails), or null when there is no such task. */
export async function readAgentTaskTreeForAdmin(db: ScopedDb, id: string): Promise<{ run: AgentAdminRun; tree: AgentTaskTree; cost: ReferenceCost | null } | null> {
  const row = await db.tx((trx) => trx.selectFrom("agent_runs")
    .select(["id", "conversation_id", "user_id", "status", "billing", "worker_id", "fence", "lease_until", "cancel_requested", "created_at", "updated_at", "input"])
    .where("id", "=", id).executeTakeFirst());
  if (!row) return null;
  const commits: AgentTaskLogCommit[] = [];
  let truncated = false;
  for (let page = 1; ; page++) {
    const batch = await db.rpc("agent_admin_task_log", { p_run_id: id, p_after: commits.at(-1)?.sequence ?? 0 });
    const read = (batch ?? []) as unknown as AgentTaskLogCommit[];
    commits.push(...read);
    if (read.length < TASK_LOG_PAGE) break;
    if (page === TASK_LOG_PAGES) { truncated = true; break; }
  }
  const [emails, cost] = await Promise.all([
    userEmails(db, [row.user_id]),
    referenceCosts("agent_run", [id], db).then(costs => costs.get(id) ?? { calls: 0, spentMicros: 0 }, () => null),
  ]);
  return { run: adminRun(row as unknown as AdminRunRow, emails), tree: buildAgentTaskTree(commits, truncated), cost };
}
