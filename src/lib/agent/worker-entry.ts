import "server-only";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadQuickJSWasm } from "@earendil-works/pi-codemode";
import { getSystemAdminClient } from "@/lib/supabase-server";
import { AgentStore, type AgentRunRow } from "./store.server";
import { executeAgentRun } from "./runtime.server";
import { AGENT_ENGINE } from "./engine";
import { checkAgentCodemode, configureAgentCodemode } from "./codemode.server";

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
  const store = new AgentStore(getSystemAdminClient());
  if (process.argv.includes("--health")) {
    process.exitCode = (await store.workerReady()) ? 0 : 1;
    return;
  }
  await configureCodemode();
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
                  p_record: null,
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
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await Promise.allSettled(active);
  } finally {
    clearInterval(heartbeat);
    shutdown.abort();
    await Promise.allSettled(active);
  }
}

void main().catch(() => {
  console.error("[agent-worker]", { code: "WORKER_FAILED" });
  process.exitCode = 1;
});
