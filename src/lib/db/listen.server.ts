import 'server-only';
import pg from 'pg';

/**
 * One dedicated LISTEN connection per process. Every wait has a timeout
 * fallback, so a dropped listener makes the system slower, never incorrect.
 */
export type AgentSignal = {
  t: 'event' | 'run' | 'cmd' | 'queue' | 'resync';
  run?: string;
  seq?: number;
  status?: string;
  cancel?: boolean;
};

type BufferedSignal = AgentSignal & { at: number };

const CHANNEL = 'taibu_agent';
const RECENT_LIMIT = 50;

let client: pg.Client | null = null;
let connecting: Promise<void> | null = null;
let connected = false;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const waiters = new Set<(signal: AgentSignal) => void>();
const recent: BufferedSignal[] = [];

function dispatch(signal: AgentSignal): void {
  const at = Date.now();
  recent.push({ ...signal, at });
  if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT);
  for (const resolve of [...waiters]) resolve(signal);
}

function scheduleReconnect(): void {
  if (retryTimer || waiters.size === 0) return;
  const delay = Math.min(10_000, 250 * 2 ** Math.min(retry, 6));
  retry += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void ensureListening();
  }, delay);
  retryTimer.unref?.();
}

async function connect(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const candidate = new pg.Client({
    connectionString,
    application_name: 'taibu-listen',
    connectionTimeoutMillis: 5_000,
  });
  candidate.on('notification', (message) => {
    if (message.channel !== CHANNEL || !message.payload) return;
    try {
      const parsed = JSON.parse(message.payload) as AgentSignal;
      if (parsed && ['event', 'run', 'cmd', 'queue'].includes(parsed.t)) dispatch(parsed);
    } catch {
      // A malformed payload is ignored; the timeout fallback still advances.
    }
  });
  candidate.on('error', () => { /* reconnect via end handler */ });
  candidate.on('end', () => {
    if (client !== candidate) return;
    client = null;
    connected = false;
    scheduleReconnect();
  });
  try {
    await candidate.connect();
    await candidate.query(`listen ${CHANNEL}`);
    client = candidate;
    connected = true;
    retry = 0;
    dispatch({ t: 'resync' });
  } catch {
    connected = false;
    await candidate.end().catch(() => {});
    scheduleReconnect();
  }
}

function ensureListening(): Promise<void> {
  if (client) return Promise.resolve();
  connecting ??= connect().finally(() => { connecting = null; });
  return connecting;
}

export function agentSignalMatches(signal: AgentSignal, runId?: string): boolean {
  return signal.t === 'resync' || !runId || signal.run === runId;
}

/**
 * Waits for a relevant signal. `since` is the wall-clock timestamp taken before
 * the caller read the current state, so notifications that arrived during that
 * read are not missed. Returns null on timeout or abort.
 */
export async function waitForAgentSignal(
  runId: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
  since = Date.now(),
): Promise<AgentSignal | null> {
  if (signal?.aborted) return null;
  void ensureListening();

  if (connected) {
    const buffered = recent.find((entry) => entry.at >= since && agentSignalMatches(entry, runId));
    if (buffered) return buffered;
  }

  const effectiveTimeout = connected ? timeoutMs : Math.min(timeoutMs, 1_000);
  return await new Promise<AgentSignal | null>((resolve) => {
    let settled = false;
    const finish = (value: AgentSignal | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      waiters.delete(onSignal);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onSignal = (entry: AgentSignal) => {
      if (agentSignalMatches(entry, runId)) finish(entry);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), effectiveTimeout);
    timer.unref?.();
    waiters.add(onSignal);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function listenerReady(): boolean {
  return connected;
}
