import "server-only";
import type { Context } from "@earendil-works/chord";
import { MemoryStorage, type CommitResult, type Seq, type StorageWrite } from "@earendil-works/pi-durable";
import type { AgentStore, AgentRunRow } from "./store.server";
import type { AgentCheckpoint } from "./types";

export interface DurableStoredCommit {
  sequence: number;
  writes: StorageWrite[];
}
export interface DurableCommitPersistence {
  read(after: number): Promise<DurableStoredCommit[]>;
  append(sequence: number, writes: readonly StorageWrite[]): Promise<number>;
}

/**
 * Postgres supplies the durable commit log and the run's lease. Pi's reference
 * backend supplies validation, document history, ancestry and query semantics.
 * prepareCommit is public in the pinned backend and is also the boundary used by
 * Pi's JSONL implementation. Never apply or publish before Postgres acknowledges
 * a batch. A reopen replays only acknowledged batches.
 */
export class AgentDurableStorage extends MemoryStorage {
  private sequence = 0;
  private unavailable = false;
  private constructor(private readonly persistence: DurableCommitPersistence) {
    super();
  }
  get isUnavailable() { return this.unavailable; }
  static async open(persistence: DurableCommitPersistence, context: Context) {
    const storage = new AgentDurableStorage(persistence);
    for (;;) {
      context.abortSignal?.throwIfAborted();
      const page = await persistence.read(storage.sequence);
      if (!page.length) break;
      for (const item of page) {
        if (item.sequence !== storage.sequence + 1)
          throw new Error("AGENT_DURABLE_LOG_GAP");
        storage.prepareCommit(item.writes, item.sequence as Seq).apply();
        storage.sequence = item.sequence;
      }
    }
    return storage;
  }
  /**
   * One batch at a time: each is checked against the state the earlier ones left, which this backend shows only once
   * they are applied, and none is applied before Postgres has it. Receipts follow, as MemoryStorage gives them.
   */
  override async commit(
    batches: readonly (readonly StorageWrite[])[], receive: (index: number, seq: Seq) => void, context: Context,
  ): Promise<CommitResult> {
    context.abortSignal?.throwIfAborted();
    if (this.unavailable) throw new Error("AGENT_DURABLE_STORAGE_UNAVAILABLE");
    const stored: Seq[] = [];
    let refused: { error: unknown } | undefined;
    try {
      for (const writes of batches) {
        let prepared;
        // Durable's own checks refuse a batch before it reaches Postgres; the ones before it stay stored.
        try { prepared = this.prepareCommit(writes); }
        catch (error) { refused = { error }; break; }
        try {
          const sequence = await this.persistence.append(Number(prepared.seq), prepared.writes);
          if (sequence !== Number(prepared.seq))
            throw new Error("AGENT_DURABLE_SEQUENCE_MISMATCH");
          // The write may have been acknowledged just as this invocation was cancelled.
          // Applying an acknowledged batch is mandatory; cancellation affects its waiter.
          prepared.apply();
          this.sequence = sequence;
          stored.push(prepared.seq);
        } catch (error) {
          // An ambiguous failure cannot expose speculative state or accept later writes.
          // A fresh owner reopens the authoritative log instead of guessing its outcome.
          this.unavailable = true;
          throw error;
        }
      }
    } finally {
      for (const [index, seq] of stored.entries()) receive(index, seq);
    }
    return refused ? { stored: stored.length, refused: refused.error } : { stored: stored.length };
  }
}

export function agentDurablePersistence(
  store: AgentStore,
  run: AgentRunRow,
  checkpoint: () => AgentCheckpoint,
  serialize: <T>(operation: () => Promise<T>) => Promise<T> = operation => operation(),
): DurableCommitPersistence {
  return {
    read: after => store.rpc<DurableStoredCommit[]>("agent_durable_read", {
      ...store.lease(run), p_after: after,
    }),
    append: (sequence, writes) => serialize(async () => {
      const args = {
        ...store.lease(run), p_sequence: sequence, p_writes: writes,
        p_checkpoint: structuredClone(checkpoint()),
      };
      try {
        return await store.rpc<number>("agent_durable_commit", args);
      } catch (error) {
        if (error instanceof Error && /AGENT_LEASE_LOST|AGENT_DURABLE_CONFLICT/u.test(error.message))
          throw error;
        // An identical sequence and batch is idempotent even if its first HTTP
        // response was lost. Ownership is checked before returning that receipt.
        return store.rpc<number>("agent_durable_commit", args);
      }
    }),
  };
}
