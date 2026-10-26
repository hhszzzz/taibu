import 'server-only';
import { createHash } from 'node:crypto';
import {
  McpClient, McpConnectionClosedError, McpSessionExpiredError, StreamableHttpTransport,
  type CallToolResult, type Implementation, type McpTransport, type Tool,
} from '@earendil-works/pi-mcp';
import { mcpSafeFetch } from '../safe-fetch.server';

/** A server ready to connect: the URL with its secret query parameters, and every header including the secret ones. */
export type McpEndpoint = {
  id: string;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
};

export type McpServerDescription = { tools: Tool[]; server?: Implementation; instructions?: string };

type Connection = {
  fingerprint: string;
  client: McpClient;
  ready: Promise<void>;
  tools?: { at: number; list: Promise<Tool[]> };
  lastUsed: number;
  active: number;
  closed: boolean;
};

const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const SWEEP_MS = 60_000;

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** A failure that leaves the session unusable without a server having run anything the next attempt would repeat. */
function lostSession(error: unknown) {
  return error instanceof McpSessionExpiredError || error instanceof McpConnectionClosedError;
}

/**
 * One connection per server per process, shared by every task and by the connection test. A server's connection is
 * replaced when its address, headers or timeout change, closed after it sits idle, and the least recently used idle
 * one is closed when too many are open. A request whose session the server dropped is retried once on a new
 * connection, but a tool call only when the server refused it: a call is never repeated after it may have run.
 */
export class McpPool {
  private readonly connections = new Map<string, Connection>();
  private sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: {
    transport?: (endpoint: McpEndpoint) => McpTransport;
    idleMs?: number;
    toolsTtlMs?: number;
    maxConnections?: number;
    now?: () => number;
  } = {}) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private fingerprint(endpoint: McpEndpoint) {
    const headers = Object.entries(endpoint.headers).sort(([left], [right]) => left.localeCompare(right));
    return createHash('sha256').update(JSON.stringify([endpoint.url, headers, endpoint.timeoutMs])).digest('hex');
  }

  private drop(id: string, connection: Connection) {
    connection.closed = true;
    if (this.connections.get(id) === connection) this.connections.delete(id);
    void connection.client.close().catch(() => {});
  }

  private evict() {
    const limit = this.options.maxConnections ?? 100;
    if (this.connections.size < limit) return;
    const idle = [...this.connections].filter(([, connection]) => connection.active === 0)
      .sort(([, left], [, right]) => left.lastUsed - right.lastUsed);
    for (const [id, connection] of idle.slice(0, this.connections.size - limit + 1)) this.drop(id, connection);
  }

  private sweep() {
    const idleMs = this.options.idleMs ?? 10 * 60_000;
    for (const [id, connection] of this.connections)
      if (connection.active === 0 && this.now() - connection.lastUsed >= idleMs) this.drop(id, connection);
    if (!this.connections.size && this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = undefined;
    }
  }

  private connection(endpoint: McpEndpoint): Connection {
    const fingerprint = this.fingerprint(endpoint);
    const existing = this.connections.get(endpoint.id);
    if (existing && !existing.closed && existing.fingerprint === fingerprint) return existing;
    if (existing) this.drop(endpoint.id, existing);
    this.evict();
    const client = new McpClient({ name: 'taibu-agent', version: '1.0.0', requestTimeoutMs: endpoint.timeoutMs, capabilities: {} });
    const transport = this.options.transport?.(endpoint) ?? new StreamableHttpTransport({
      url: endpoint.url, headers: endpoint.headers, fetch: mcpSafeFetch, maxMessageBytes: MAX_MESSAGE_BYTES,
      // Tasks only call tools: no server-to-client stream to keep open between them.
      openGetStream: false, reconnect: { maxRetries: 1 },
    });
    const connection: Connection = { fingerprint, client, ready: Promise.resolve(), lastUsed: this.now(), active: 0, closed: false };
    connection.ready = client.connect(transport).then(() => undefined);
    connection.ready.catch(() => this.drop(endpoint.id, connection));
    client.onClose(() => {
      connection.closed = true;
      if (this.connections.get(endpoint.id) === connection) this.connections.delete(endpoint.id);
    });
    this.connections.set(endpoint.id, connection);
    if (!this.sweeper) {
      this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
      this.sweeper.unref?.();
    }
    return connection;
  }

  private async use<T>(
    endpoint: McpEndpoint, signal: AbortSignal | undefined, work: (connection: Connection) => Promise<T>,
    retryable: (error: unknown) => boolean,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const connection = this.connection(endpoint);
      connection.active++;
      let opened = false;
      try {
        await abortable(connection.ready, signal);
        opened = true;
        return await work(connection);
      } catch (error) {
        if (lostSession(error)) this.drop(endpoint.id, connection);
        // A server that cannot be reached now will not be a moment later; a session it dropped can be opened again.
        if (signal?.aborted || attempt > 0 || !opened || !retryable(error)) throw error;
      } finally {
        connection.active--;
        connection.lastUsed = this.now();
      }
    }
  }

  /** The server's tools (cached for a few minutes unless `fresh`), its identity and its own instructions. */
  describe(endpoint: McpEndpoint, options: { signal?: AbortSignal; fresh?: boolean } = {}): Promise<McpServerDescription> {
    return this.use(endpoint, options.signal, async (connection) => {
      const ttl = this.options.toolsTtlMs ?? 5 * 60_000;
      if (options.fresh || !connection.tools || this.now() - connection.tools.at >= ttl) {
        // Shared by whoever asks meanwhile, so one caller's abort does not cancel it for the others.
        const list = connection.client.listTools({ timeoutMs: endpoint.timeoutMs });
        const entry = { at: this.now(), list };
        connection.tools = entry;
        list.catch(() => { if (connection.tools === entry) connection.tools = undefined; });
      }
      const tools = await abortable(connection.tools.list, options.signal);
      return { tools, server: connection.client.serverInfo, instructions: connection.client.instructions };
    }, lostSession);
  }

  callTool(
    endpoint: McpEndpoint, name: string, args: Record<string, unknown>, options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<CallToolResult> {
    // An expired session refused the call outright; any other failure may have run it.
    return this.use(endpoint, options.signal, (connection) => connection.client.callTool(name, args, {
      signal: options.signal, timeoutMs: options.timeoutMs ?? endpoint.timeoutMs,
    }), (error) => error instanceof McpSessionExpiredError);
  }

  /** Closes one server's connection, e.g. after it was deleted. */
  release(id: string) {
    const connection = this.connections.get(id);
    if (connection) this.drop(id, connection);
  }

  async close() {
    const open = [...this.connections];
    this.connections.clear();
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
    await Promise.allSettled(open.map(([, connection]) => {
      connection.closed = true;
      return connection.client.close();
    }));
  }

  get size() {
    return this.connections.size;
  }
}

/** The process's pool, shared by the worker's tasks and the settings pages' connection tests. */
export const mcpPool = new McpPool();
