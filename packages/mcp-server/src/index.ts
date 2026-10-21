/** TaiBu public MCP Server (MCP 2026-07-28 HTTP, no authentication). */
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFileDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(currentFileDir, '../../..', '.env'), override: false });

import { createRequire } from 'node:module';
import express from 'express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
  type CallToolResult,
  type JsonSchemaType,
} from '@modelcontextprotocol/server';
import {
  METHOD_PROMPT_QUESTION,
  TOOL_CALL_NAME,
  TOOL_SEARCH_NAME,
  buildListToolsPayload,
  buildToolSuccessPayload,
  executeTool,
  getMethodToolDefinition,
  getServerInstructions,
  getToolGatewayDefinitions,
  isDeferredTool,
  listMethodPrompts,
  normalizeTransportDetailLevel,
  renderMethodCard,
  renderMethodPrompt,
  renderToolSearchResult,
  searchDeferredTools,
  type ToolDefinition,
  type ToolListMode,
} from 'taibu-core/mcp';
import {
  asyncRequestHandler,
  getClientIp,
  hostValidationMiddleware,
  mcpErrorMiddleware,
  originValidationMiddleware,
  rateLimitMiddleware,
  readPositiveIntEnv,
  subscriptionConnectionLimitMiddleware,
} from './middleware.js';
import {
  attachPlaceResolutionInfoToResult,
  attachPlaceResolutionNoteToPayload,
  decorateToolListPayloadForRuntime,
  preprocessToolArgsForRuntimePlace,
} from './place-resolution.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };
const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SEED_SCOPED_TOOLS = new Set(['liuyao', 'tarot']);
const PRIVATE_CLIENT_IP_HEADER = 'x-taibu-client-ip';
/** Which endpoint a request came in on: `/mcp` lists every tool, `/mcp/core` only those a reading starts from. */
const PRIVATE_TOOL_MODE_HEADER = 'x-taibu-tool-mode';
const MODERN_PROTOCOL_VERSION = '2026-07-28';
const PUBLIC_CACHE_TTL_MS = 5 * 60_000;
const runtimeTools = decorateToolListPayloadForRuntime(buildListToolsPayload()).tools;
const coreTools = runtimeTools.filter((tool) => !isDeferredTool(tool.name));
const deferredTools = runtimeTools.filter((tool) => isDeferredTool(tool.name));
const PROMPT_ARGS = fromJsonSchema<{ question?: string }>({
  type: 'object',
  properties: { question: { type: 'string', description: METHOD_PROMPT_QUESTION } },
});

if (process.env.MCP_TRUST_PROXY === 'true') app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

if (process.env.MCP_REQUEST_LOG === 'true') {
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      console.log(`[MCP] ${req.method} ${req.path} status=${res.statusCode} ip=${getClientIp(req)} duration=${Date.now() - startedAt}ms`);
    });
    next();
  });
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/info', (_req, res) => {
  res.json({
    name: 'TaiBu MCP Server',
    version,
    status: 'ok',
    transport: 'streamable-http',
    protocol_version: MODERN_PROTOCOL_VERSION,
    legacy_compatibility: 'stateless',
    auth: 'none',
    mcp_endpoint: '/mcp',
    mcp_core_endpoint: '/mcp/core',
  });
});

function withSeedScope(name: string, args: unknown, seedScope: string): unknown {
  if (!SEED_SCOPED_TOOLS.has(name)) return args === undefined ? {} : args;
  if (args === undefined) return { seedScope };
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  return { ...(args as Record<string, unknown>), seedScope };
}

function logMcpError(context: string, error: Error): void {
  console.error(`[MCP] ${context}: ${error.message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolConfig(tool: ToolDefinition) {
  return {
    title: tool.title,
    description: tool.description,
    inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType),
    annotations: tool.annotations,
  };
}

function errorResult(internalMessage: string): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: IS_PRODUCTION ? 'Tool execution failed' : `Error: ${internalMessage}`,
    }],
    isError: true,
  };
}

function createMcpServer(seedScope: string, mode: ToolListMode): McpServer {
  const server = new McpServer(
    { name: 'taibu-mcp-online', version },
    {
      capabilities: { tools: {} },
      instructions: getServerInstructions(mode),
      cacheHints: {
        'server/discover': { ttlMs: PUBLIC_CACHE_TTL_MS, cacheScope: 'public' },
        'tools/list': { ttlMs: PUBLIC_CACHE_TTL_MS, cacheScope: 'public' },
        'prompts/list': { ttlMs: PUBLIC_CACHE_TTL_MS, cacheScope: 'public' },
      },
    },
  );

  const runTool = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
    const scopedArgs = withSeedScope(name, args, seedScope);
    const { toolArgs, placeResolutionInfo } = await preprocessToolArgsForRuntimePlace(name, scopedArgs);

    try {
      const rawResult = await executeTool(name, toolArgs);
      const result = attachPlaceResolutionInfoToResult(rawResult, placeResolutionInfo);
      const detailLevel = normalizeTransportDetailLevel(args.detailLevel);
      const payload = buildToolSuccessPayload(name, result, { detailLevel }) as Record<string, unknown>;
      return attachPlaceResolutionNoteToPayload(payload, placeResolutionInfo) as CallToolResult;
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  };

  for (const tool of mode === 'core' ? coreTools : runtimeTools) {
    server.registerTool(
      tool.name,
      { ...toolConfig(tool), outputSchema: fromJsonSchema(tool.outputSchema as JsonSchemaType) },
      (args) => runTool(tool.name, args),
    );
  }

  const methodTool = getMethodToolDefinition();
  server.registerTool(methodTool.name, toolConfig(methodTool), async (args): Promise<CallToolResult> => {
    try {
      return { content: [{ type: 'text', text: renderMethodCard(String(args.id)) }] };
    } catch (error) {
      // An unknown card is the caller's mistake; its message names the id and is safe to show.
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  });

  if (mode === 'core') {
    const [search, call] = getToolGatewayDefinitions();
    server.registerTool(TOOL_SEARCH_NAME, toolConfig(search), async (args): Promise<CallToolResult> => ({
      content: [{ type: 'text', text: renderToolSearchResult(searchDeferredTools(String(args.query), deferredTools, typeof args.limit === 'number' ? args.limit : undefined)) }],
    }));
    server.registerTool(TOOL_CALL_NAME, toolConfig(call), (args) => {
      const name = String(args.name);
      if (!isDeferredTool(name)) {
        return { content: [{ type: 'text', text: `Error: ${name} 不经 tool_call 调用；已列出的工具请直接调用` }], isError: true };
      }
      return runTool(name, isRecord(args.arguments) ? args.arguments : {});
    });
  }

  for (const prompt of listMethodPrompts()) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: PROMPT_ARGS },
      ({ question }) => renderMethodPrompt(prompt.name, question),
    );
  }

  return server;
}

const mcpHandler = createMcpHandler(
  ({ requestInfo }) => {
    const clientIp = requestInfo?.headers.get(PRIVATE_CLIENT_IP_HEADER) || 'unknown';
    const mode = requestInfo?.headers.get(PRIVATE_TOOL_MODE_HEADER) === 'core' ? 'core' : 'all';
    return createMcpServer(`anonymous:${clientIp}`, mode);
  },
  {
    legacy: 'stateless',
    responseMode: 'auto',
    maxSubscriptions: readPositiveIntEnv('MCP_MAX_SUBSCRIPTIONS', 1000),
    onerror: (error) => logMcpError('Protocol error', error),
  },
);
const handleNodeMcp = toNodeHandler(mcpHandler, {
  onerror: (error) => logMcpError('Node adapter error', error),
});

function handleMcpPost(mode: ToolListMode): express.RequestHandler {
  return async (req, res) => {
    // Always overwrite these private transport headers: clients cannot choose the random seed scope, and the
    // endpoint, not a header, decides which tools are listed.
    req.headers[PRIVATE_CLIENT_IP_HEADER] = getClientIp(req);
    req.headers[PRIVATE_TOOL_MODE_HEADER] = mode;
    await handleNodeMcp(req, res, req.body);
  };
}

const networkGuards = [originValidationMiddleware, hostValidationMiddleware, rateLimitMiddleware];
app.post(
  ['/', '/mcp'],
  ...networkGuards,
  subscriptionConnectionLimitMiddleware,
  asyncRequestHandler(handleMcpPost('all')),
);
app.post(
  '/mcp/core',
  ...networkGuards,
  subscriptionConnectionLimitMiddleware,
  asyncRequestHandler(handleMcpPost('core')),
);
app.use(mcpErrorMiddleware);

const PORT = Number.parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.MCP_HOST || '127.0.0.1';
const httpServer = app.listen(PORT, HOST, () => {
  console.log(`TaiBu MCP Server (MCP ${MODERN_PROTOCOL_VERSION}, public HTTP) running on ${HOST}:${PORT} at /mcp and /mcp/core`);
});

let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] Shutting down MCP server...`);
  await mcpHandler.close().catch(() => {});
  const forceExitTimer = setTimeout(() => process.exit(0), 3000);
  httpServer.close(() => {
    clearTimeout(forceExitTimer);
    console.log('HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
