import type { JoinPolicy, SubmissionRecord, TaskOutcome, TaskState } from '@earendil-works/pi-durable';
import type { JsonValue } from '@earendil-works/chord';
import type { AgentRunStatus } from './types';

/** A task as the settings center's Agent task list shows it (`/api/admin/agent-runs`). */
export interface AgentAdminRun {
  id: string;
  conversationId: string;
  userId: string;
  /** Absent when the account lookup fails; the list does not depend on it. */
  userEmail: string | null;
  status: AgentRunStatus;
  billing: 'metered' | 'exempt';
  title: string;
  model: string;
  /** The configuration the task was created with. */
  modes: { codeMode: boolean; planMode: boolean; compact: boolean; web: boolean; collaborators: number };
  workerId: string | null;
  fence: number;
  leaseUntil: string | null;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a durable task is to the reader: a model call, a tool call (a code mode script's when `nested`), a compaction,
 * the task holding a background subagent, or the delivery of one message to a subagent and its report back.
 */
export type AgentTaskRole = 'generation' | 'tool' | 'compaction' | 'subagent' | 'report' | 'other';

/** One Pi Durable task of a run, terminal ones included, with the tasks and conversations it owns. */
export interface AgentTaskNode {
  id: number;
  kind: string;
  role: AgentTaskRole;
  /** The tool a tool task runs. */
  tool?: string;
  /** A code mode script's call rather than the model's. */
  nested?: true;
  /** The background subagent a report task delivers to. */
  subagent?: string;
  status: TaskState<JsonValue, JsonValue>['status'];
  /** A live task's phase; a generation's attempt and requested model while it has them. */
  phase?: string;
  attempt?: number;
  model?: string;
  waitingOn?: number[];
  policy?: JoinPolicy;
  /** A sleeping task (a retry or poll backoff) resumes when the Harness clock reaches this time, in epoch milliseconds. */
  sleepUntil?: number;
  /** Times in a row a crash or takeover cut the task off without it committing a new state; at Pi's limit it ends. */
  restarts?: number;
  outcome?: TaskOutcome<JsonValue>['status'];
  /** The failure's message, or why the task was aborted or could not resume. */
  reason?: string;
  /** Excluded from the conversation's idle waits and aborts. */
  background?: true;
  abortRequested?: true;
  /** Abort-marked because the run that created it did not survive a restart. */
  abandoned?: true;
  /** Wall-clock milliseconds of its first run and of its end. */
  startedAt?: number;
  endedAt?: number;
  /** Commit time of its latest change. */
  changedAt: string;
  tasks: AgentTaskNode[];
  conversations: AgentTaskConversation[];
}

/** The main conversation, a collaboration member's, a background subagent's, a fork, or another task's conversation. */
export type AgentTaskConversationRole = 'main' | 'member' | 'subagent' | 'fork' | 'child';

export interface AgentTaskSubmission {
  id: number;
  type: SubmissionRecord['type'];
  status: SubmissionRecord['status'];
  /** Who submitted it: `initial`, a user command, a member's assignment, a subagent's message or report. */
  requestId?: string;
  /** Why an input went unanswered, and Pi's detail when it is text (such as a compaction failure). */
  reason?: string;
  detail?: string;
}

export interface AgentTaskConversation {
  id: number;
  role: AgentTaskConversationRole;
  /** A background subagent's name, as its messages carry it. */
  name?: string;
  forkOf?: number;
  submissions: AgentTaskSubmission[];
  /** Tasks the conversation owns. */
  tasks: AgentTaskNode[];
}

/** A run's tasks rebuilt from its Pi Durable commit log: conversations at the top, each owned task below its owner. */
export interface AgentTaskTree {
  commits: number;
  lastCommitAt: string | null;
  /** The log was longer than one read covers; the tree shows its beginning. */
  truncated: boolean;
  conversations: AgentTaskConversation[];
  counts: { live: number; completed: number; failed: number; aborted: number };
}
