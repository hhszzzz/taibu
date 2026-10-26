import {
  McpConnectionClosedError, McpSessionExpiredError,
  type CallToolResult, type JsonRpcMessage, type McpTransport, type Tool,
} from '@earendil-works/pi-mcp';
import { createInMemoryTransportPair } from '@earendil-works/pi-mcp/testing';
import type { McpServerRow } from '../../lib/agent/mcp/store.server';

/**
 * An MCP server in memory, speaking JSON-RPC over Pi's in-memory transport pair. Each `transport()` is a new session;
 * `expire` makes the next tool call fail as an expired session would, `drop` as a connection lost mid-call.
 */
export function fakeMcpServer(options: {
  tools: Tool[];
  call?: (name: string, args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;
  instructions?: string;
}) {
  const state = {
    sessions: 0,
    lists: 0,
    calls: [] as Array<{ name: string; arguments: Record<string, unknown> }>,
    expire: false,
    drop: false,
    fail: undefined as Error | undefined,
  };
  const transport = (): McpTransport => {
    const { client, server } = createInMemoryTransportPair();
    state.sessions++;
    void server.start();
    server.onMessage((message: JsonRpcMessage) => {
      if (!('method' in message) || !('id' in message)) return;
      const reply = (result: unknown) => void server.send({ jsonrpc: '2.0', id: message.id, result } as JsonRpcMessage);
      if (message.method === 'initialize') {
        reply({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' }, instructions: options.instructions });
      } else if (message.method === 'tools/list') {
        state.lists++;
        reply({ tools: options.tools });
      } else if (message.method === 'tools/call') {
        const params = message.params as { name: string; arguments?: Record<string, unknown> };
        state.calls.push({ name: params.name, arguments: params.arguments ?? {} });
        void Promise.resolve(options.call?.(params.name, params.arguments ?? {}) ?? { content: [{ type: 'text', text: 'ok' }] })
          .then(reply, (error: Error) => void server.send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } } as JsonRpcMessage));
      } else {
        reply({});
      }
    });
    const send = client.send.bind(client);
    client.send = async (message: JsonRpcMessage) => {
      if ('method' in message && message.method === 'tools/call') {
        if (state.expire) { state.expire = false; throw new McpSessionExpiredError('session gone'); }
        if (state.drop) { state.drop = false; await send(message); throw new McpConnectionClosedError('connection lost'); }
      }
      if (state.fail) throw state.fail;
      return send(message);
    };
    return client;
  };
  return { state, transport };
}

export function fixtureTool(name: string, extra: Partial<Tool> = {}): Tool {
  return { name, description: `${name} description`, inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, ...extra };
}

/** A stored server row with defaults; secrets are left empty unless given. */
export function mcpServerRow(overrides: Partial<McpServerRow> = {}): McpServerRow {
  return {
    id: '00000000-0000-4000-8000-0000000000a1', owner_id: null, name: 'archive', display_name: '档案库', description: '查询公开档案',
    url: 'https://mcp.example.com/mcp', headers: {}, secret_headers: {}, secret_query: {}, exposure: 'deferred', tool_policy: {},
    search_tool: null, fetch_tool: null, result_adapter: 'generic', route_priority: 100, required_tier: 'free', is_enabled: true,
    timeout_ms: 30_000, max_result_chars: 20_000, sort_order: 0, tools_snapshot: null, last_checked_at: null, last_error: null,
    created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z',
    ...overrides,
  };
}
