#!/usr/bin/env node
/** TaiBu local MCP Server (stdio, MCP 2026-07-28 with legacy compatibility). */

import { createRequire } from 'node:module';
import {
  McpServer,
  fromJsonSchema,
  type CallToolResult,
  type JsonSchemaType,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
  METHOD_PROMPT_QUESTION,
  TOOL_CALL_NAME,
  TOOL_SEARCH_NAME,
  buildToolSuccessPayload,
  executeTool,
  getMethodToolDefinition,
  getServerInstructions,
  getToolGatewayDefinitions,
  isDeferredTool,
  listMethodPrompts,
  listToolDefinitions,
  normalizeTransportDetailLevel,
  parseToolListMode,
  renderMethodCard,
  renderMethodPrompt,
  renderToolSearchResult,
  searchDeferredTools,
  type ToolDefinition,
} from 'taibu-core/mcp';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };
const PUBLIC_CACHE_TTL_MS = 5 * 60_000;
/** `TAIBU_MCP_TOOLS=core` lists only the tools a reading starts from; the rest are found with tool_search. */
const TOOL_LIST_MODE = parseToolListMode(process.env.TAIBU_MCP_TOOLS);
const PROMPT_ARGS = fromJsonSchema<{ question?: string }>({
  type: 'object',
  properties: { question: { type: 'string', description: METHOD_PROMPT_QUESTION } },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

async function runTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const result = await executeTool(name, args);
    const detailLevel = normalizeTransportDetailLevel(args.detailLevel);
    return buildToolSuccessPayload(name, result, { detailLevel });
  } catch (error) {
    return errorResult(error);
  }
}

function toolConfig(tool: ToolDefinition) {
  return {
    title: tool.title,
    description: tool.description,
    inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType),
    annotations: tool.annotations,
  };
}

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'taibu-mcp', version },
    {
      capabilities: { tools: {} },
      instructions: getServerInstructions(TOOL_LIST_MODE),
      cacheHints: {
        'server/discover': { ttlMs: PUBLIC_CACHE_TTL_MS, cacheScope: 'public' },
        'tools/list': { ttlMs: PUBLIC_CACHE_TTL_MS, cacheScope: 'public' },
        'prompts/list': { ttlMs: PUBLIC_CACHE_TTL_MS, cacheScope: 'public' },
      },
    },
  );

  const tools = listToolDefinitions();
  for (const tool of TOOL_LIST_MODE === 'core' ? tools.filter((item) => !isDeferredTool(item.name)) : tools) {
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
      return errorResult(error);
    }
  });

  if (TOOL_LIST_MODE === 'core') {
    const deferred = tools.filter((item) => isDeferredTool(item.name));
    const [search, call] = getToolGatewayDefinitions();
    server.registerTool(TOOL_SEARCH_NAME, toolConfig(search), async (args): Promise<CallToolResult> => ({
      content: [{ type: 'text', text: renderToolSearchResult(searchDeferredTools(String(args.query), deferred, typeof args.limit === 'number' ? args.limit : undefined)) }],
    }));
    server.registerTool(TOOL_CALL_NAME, toolConfig(call), (args) => {
      const name = String(args.name);
      if (!isDeferredTool(name)) return errorResult(new Error(`${name} 不经 tool_call 调用；已列出的工具请直接调用`));
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

serveStdio(createMcpServer, {
  legacy: 'serve',
  onerror: (error) => console.error('[MCP stdio]', error),
});
