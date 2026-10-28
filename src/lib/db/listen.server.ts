import 'server-only';
import pg from 'pg';

/**
 * One dedicated LISTEN connection per process. A subscription queues every
 * matching signal from the moment it is created, so a caller that subscribes
 * before reading state cannot miss a change that lands during the read. Every
 * wait keeps a timeout fallback: a dropped listener makes the system slower,
 * never incorrect.
 */
export type AgentSignal = {
  t: 'event' | 'run' | 'cmd' | 'queue' | 'resync';
  run?: string;
  seq?: number;
  status?: string;
  cancel?: boolean;
};

export type AgentSignalFilter = {
  /** Only this run's signals; `queue` carries no run and never matches. Omit for every run. */
  run?: string;
  /** Only these kinds; `resync` always matches. Omit for every kind. */
  kinds?: readonly AgentSignal['t'][];
};

export type AgentSignalSubscription = {
  /**
   * Returns every signal queued since the previous call, waiting up to
   * `timeoutMs` for the first one; empty on timeout or abort. Read the state
   * after it returns: whatever lands during that read is queued for the next
   * call. One consumer per subscription.
   */
  next(timeoutMs: number, abort?: AbortSignal): Promise<AgentSignal[]>;
  close(): void;
};

type Subscriber = {
  filter: AgentSignalFilter;
  queue: AgentSignal[];
  wake: (() => void) | null;
};

const CHANNEL = 'taibu-agent';
/** A subscriber that falls this far behind collapses its queue into one resync. */
const QUEUE_LIMIT = 256;
/** While the listener is down, every wait degrades to this polling interval. */
const DISCONNECTED_POLL_MS = 1_000;
/** TCP keepalive alone takes minutes to notice a dead peer; the ping bounds it. */
const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;

let client: pg.Client | null = null;
let connecting: Promise<void> | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<Subscriber>();

export function agentSignalMatches(signal: AgentSignal, filter: AgentSignalFilter): boolean {
  if (signal.t === 'resync') return true;
  if (filter.kinds && !filter.kinds.includes(signal.t)) return false;
  return !filter.run || signal.run === filter.run;
}

function dispatch(signal: AgentSignal): void {
  for (const subscriber of subscribers) {
    if (!agentSignalMatches(signal, subscriber.filter)) continue;
    if (subscriber.queue.length >= QUEUE_LIMIT) subscriber.queue = [{ t: 'resync' }];
    else subscriber.queue.push(signal);
    subscriber.wake?.();
  }
}

/** Test seam: delivers a signal as if it arrived on the channel. */
export const __dispatchAgentSignalForTests = dispatch;

function scheduleReconnect(): void {
  if (retryTimer || subscribers.size === 0) return;
  const delay = Math.min(10_000, 250 * 2 ** Math.min(retry, 6));
  retry += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void ensureListening();
  }, delay);
  retryTimer.unref?.();
}

function retire(candidate: pg.Client): void {
  if (client !== candidate) return;
  client = null;
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  // end() destroys the socket when a query (such as a hung ping) is in flight.
  void candidate.end().catch(() => {});
  scheduleReconnect();
}

function startPing(candidate: pg.Client): void {
  pingTimer = setInterval(() => {
    const timeout = setTimeout(() => retire(candidate), PING_TIMEOUT_MS);
    timeout.unref?.();
    candidate.query('select 1').then(
      () => clearTimeout(timeout),
      () => {
        clearTimeout(timeout);
        retire(candidate);
      },
    );
  }, PING_INTERVAL_MS);
  pingTimer.unref?.();
}

async function connect(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const candidate = new pg.Client({
    connectionString,
    application_name: 'taibu-listen',
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
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
  candidate.on('error', () => retire(candidate));
  candidate.on('end', () => retire(candidate));
  try {
    await candidate.connect();
    await candidate.query(`listen ${CHANNEL}`);
    client = candidate;
    retry = 0;
    startPing(candidate);
    // Notifications sent while no listener was connected are gone; make every
    // subscriber read its state again.
    dispatch({ t: 'resync' });
  } catch {
    await candidate.end().catch(() => {});
    scheduleReconnect();
  }
}

function ensureListening(): Promise<void> {
  if (client) return Promise.resolve();
  connecting ??= connect().finally(() => { connecting = null; });
  return connecting;
}

export function subscribeAgentSignals(filter: AgentSignalFilter): AgentSignalSubscription {
  const subscriber: Subscriber = { filter, queue: [], wake: null };
  subscribers.add(subscriber);
  void ensureListening();
  return {
    async next(timeoutMs, abort) {
      if (!subscribers.has(subscriber) || abort?.aborted) return [];
      if (!subscriber.queue.length) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            abort?.removeEventListener('abort', finish);
            subscriber.wake = null;
            resolve();
          };
          const timer = setTimeout(finish, client ? timeoutMs : Math.min(timeoutMs, DISCONNECTED_POLL_MS));
          timer.unref?.();
          subscriber.wake = finish;
          abort?.addEventListener('abort', finish, { once: true });
        });
      }
      const received = subscriber.queue;
      subscriber.queue = [];
      return abort?.aborted ? [] : received;
    },
    close() {
      subscribers.delete(subscriber);
      subscriber.queue = [];
      subscriber.wake?.();
    },
  };
}
