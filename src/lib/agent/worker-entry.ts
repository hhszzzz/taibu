import "server-only";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadQuickJSWasm } from "@earendil-works/pi-codemode";
import { systemDb } from "@/lib/db/context.server";
import { waitForAgentSignal } from "@/lib/db/listen.server";
import { AgentStore, type AgentRunRow } from "./store.server";
import { executeAgentRun } from "./runtime.server";
import { AGENT_ENGINE } from "./engine";
import { checkAgentCodemode, configureAgentCodemode } from "./codemode.server";
import { startJobWorkers, stopJobWorkers } from "@/lib/jobs/workers.server";
import { pingRedis } from "@/lib/redis.server";

/** The build ships code mode's VM worker and QuickJS binary beside this bundle; a missing one fails startup. */
async function configureCodemode() {
  configureAgentCodemode({
    wasm: await loadQuickJSWasm(fileURLToPath(new URL("./quickjs.wasm", import.meta.url))),
    workerUrl: new URL("./codemode-worker.mjs", import.meta.url),
  });
}

async function main() {
  if (process.argv.includes("--check")) {
    await configureCodemode();
    await checkAgentCodemode();
    console.info("Agent worker build OK");
    return;
  }
  const workerId = randomUUID();
  const store = new AgentStore(systemDb());
  if (process.argv.includes("--health")) {
    const [databaseReady, redisReady] = await Promise.all([store.workerReady(), pingRedis(1500)]);
    // Database and Redis clients keep the event loop alive; a probe must exit
    // deterministically instead of waiting for them to close.
    process.exit(databaseReady && redisReady ? 0 : 1);
  }
  await configureCodemode();
  await startJobWorkers();
  const shutdown = new AbortController();
  const active = new Set<Promise<void>>();
  const concurrency = Number(process.env.AGENT_WORKER_CONCURRENCY ?? 2);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error("AGENT_WORKER_CONCURRENCY must be a positive integer");
  process.once("SIGINT", () => shutdown.abort());
  process.once("SIGTERM", () => shutdown.abort());
  await store.rpc("agent_worker_heartbeat", { p_worker_id: workerId, p_engine: AGENT_ENGINE });
  const heartbeat = setInterval(() => {
    void store
      .rpc("agent_worker_heartbeat", { p_worker_id: workerId, p_engine: AGENT_ENGINE })
      .catch(() =>
        console.warn("[agent-worker]", { code: "HEARTBEAT_FAILED" }),
      );
  }, 10_000);
  heartbeat.unref();
  try {
    while (!shutdown.signal.aborted) {
      if (active.size < concurrency) {
        const run = await store.rpc<AgentRunRow | null>("agent_claim_run", {
          p_worker_id: workerId,
        });
        if (run?.id) {
          const work = executeAgentRun(store, run, shutdown.signal)
            .catch(async () => {
              if (shutdown.signal.aborted) return;
              const message = structuredClone(run.public_message);
              if (message.agent)
                message.agent.error = "任务准备失败，请检查模型配置";
              try {
                await store.rpc("agent_finish_run", {
                  ...store.lease(run),
                  p_status: "failed",
                  p_checkpoint: run.checkpoint,
                  p_message: message,
                });
              } catch {
                console.warn("[agent-worker]", {
                  runId: run.id,
                  code: "SETTLEMENT_PENDING",
                });
              }
            })
            .finally(() => active.delete(work));
          active.add(work);
          continue;
        }
      }
      // Wake on a queued run; the 5 s fallback covers a missed notification.
      await waitForAgentSignal(undefined, 5_000, shutdown.signal);
    }
    await Promise.allSettled(active);
  } finally {
    clearInterval(heartbeat);
    shutdown.abort();
    await Promise.allSettled(active);
    await stopJobWorkers();
  }
}

void main().catch(() => {
  console.error("[agent-worker]", { code: "WORKER_FAILED" });
  process.exitCode = 1;
});
