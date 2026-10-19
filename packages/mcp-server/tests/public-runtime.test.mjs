import test from 'node:test';
import assert from 'node:assert/strict';
import { listToolDefinitions } from 'taibu-core/mcp';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_PROTOCOL_VERSION = '2025-06-18';

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.listen(0, '127.0.0.1', (error) => error ? rejectListen(error) : resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to allocate port');
  const port = address.port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`MCP server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await wait(100);
  }
  throw new Error('Timed out waiting for MCP server');
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), wait(3_500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function modernMeta(version = MODERN_PROTOCOL_VERSION) {
  return {
    'io.modelcontextprotocol/protocolVersion': version,
    'io.modelcontextprotocol/clientInfo': { name: 'public-test', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

function parseRpcPayload(text) {
  if (!text) return null;
  if (!text.startsWith('event:')) return JSON.parse(text);
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  return dataLine ? JSON.parse(dataLine.slice(6)) : null;
}

async function rpc(url, body, { modern = true, extraHeaders = {}, signal } = {}) {
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...(modern ? {
      'mcp-protocol-version': body.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ?? MODERN_PROTOCOL_VERSION,
      'mcp-method': body.method,
      ...(body.method === 'tools/call' ? { 'mcp-name': body.params.name } : {}),
    } : {}),
    ...extraHeaders,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  return { response, payload: parseRpcPayload(text) };
}

function startRuntime(port, env = {}) {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: resolve(process.cwd(), 'packages/mcp-server'),
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      NODE_ENV: 'test',
      PORT: String(port),
      MCP_HOST: '127.0.0.1',
      MCP_ALLOWED_HOSTS: `127.0.0.1:${port}`,
      MCP_RATE_LIMIT_PER_MINUTE: '100',
      ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  return { child, getStderr: () => stderr };
}

test('public runtime serves MCP 2026-07-28 and stateless legacy clients', async () => {
  const port = await getFreePort();
  const { child, getStderr } = startRuntime(port);

  try {
    await waitForHealth(port, child);
    const baseUrl = `http://127.0.0.1:${port}`;
    const endpoint = `${baseUrl}/mcp`;
    const info = await fetch(`${baseUrl}/info`).then((response) => response.json());
    assert.equal(info.auth, 'none');
    assert.equal(info.protocol_version, MODERN_PROTOCOL_VERSION);
    assert.equal(info.legacy_compatibility, 'stateless');
    assert.equal(info.mcp_endpoint, '/mcp');
    assert.equal((await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).status, 404);
    assert.equal((await fetch(endpoint)).status, 404);
    assert.equal((await fetch(endpoint, { method: 'DELETE' })).status, 404);

    const malformed = await fetch(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{invalid-json',
    });
    const malformedPayload = await malformed.json();
    assert.equal(malformed.status, 400);
    assert.equal(malformedPayload.error.code, -32700);

    const discovered = await rpc(endpoint, {
      jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: modernMeta() },
    });
    assert.equal(discovered.response.status, 200, getStderr());
    assert.deepEqual(discovered.payload.result.supportedVersions, [MODERN_PROTOCOL_VERSION]);
    assert.equal(discovered.payload.result.capabilities.tools.listChanged, true);
    assert.equal(discovered.payload.result.resultType, 'complete');
    assert.equal(discovered.payload.result.ttlMs, 300_000);
    assert.equal(discovered.payload.result.cacheScope, 'public');
    assert.equal(
      discovered.payload.result._meta['io.modelcontextprotocol/serverInfo'].name,
      'taibu-mcp-online',
    );

    const listed = await rpc(endpoint, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: modernMeta() },
    });
    assert.equal(listed.response.status, 200, getStderr());
    assert.equal(listed.payload.result.resultType, 'complete');
    assert.equal(listed.payload.result.ttlMs, 300_000);
    assert.equal(listed.payload.result.cacheScope, 'public');
    const toolByName = new Map(listed.payload.result.tools.map((tool) => [tool.name, tool]));
    assert.equal(toolByName.size, listToolDefinitions().length);
    assert.ok(toolByName.get('bazi_relations').inputSchema.properties.birthPlace, 'drilldowns resolve places like their base tool');
    assert.equal(toolByName.get('meihua').title, '梅花易数起卦');
    assert.equal(toolByName.get('xiaoliuren').title, '小六壬占测');

    const called = await rpc(endpoint, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: {
        _meta: modernMeta(),
        name: 'xiaoliuren',
        arguments: { lunarMonth: 1, lunarDay: 1, hour: 1, question: '测试' },
      },
    });
    assert.equal(called.response.status, 200, getStderr());
    assert.equal(called.payload.result.resultType, 'complete');
    assert.equal(called.payload.result.isError, undefined);
    assert.equal(called.payload.result.structuredContent.结果.落宫, '大安');

    const missingMethodHeader = await rpc(endpoint, {
      jsonrpc: '2.0', id: 4, method: 'tools/list', params: { _meta: modernMeta() },
    }, { extraHeaders: { 'mcp-method': '' } });
    assert.equal(missingMethodHeader.response.status, 400);
    assert.equal(missingMethodHeader.payload.error.code, -32020);

    const missingNameHeader = await rpc(endpoint, {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { _meta: modernMeta(), name: 'xiaoliuren', arguments: {} },
    }, { extraHeaders: { 'mcp-name': '' } });
    assert.equal(missingNameHeader.response.status, 400);
    assert.equal(missingNameHeader.payload.error.code, -32020);

    const unsupported = await rpc(endpoint, {
      jsonrpc: '2.0', id: 6, method: 'tools/list', params: { _meta: modernMeta('2099-01-01') },
    });
    assert.equal(unsupported.response.status, 400);
    assert.equal(unsupported.payload.error.code, -32022);
    assert.deepEqual(unsupported.payload.error.data.supported, [MODERN_PROTOCOL_VERSION]);

    const initialized = await rpc(endpoint, {
      jsonrpc: '2.0', id: 7, method: 'initialize',
      params: {
        protocolVersion: LEGACY_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'legacy-test', version: '1.0.0' },
      },
    }, { modern: false, extraHeaders: { authorization: 'Bearer ignored-legacy-token' } });
    assert.equal(initialized.response.status, 200, getStderr());
    assert.equal(initialized.response.headers.get('mcp-session-id'), null);
    assert.equal(initialized.payload.result.protocolVersion, LEGACY_PROTOCOL_VERSION);
    assert.equal(initialized.payload.result.serverInfo.name, 'taibu-mcp-online');

    const legacyListed = await rpc(endpoint, {
      jsonrpc: '2.0', id: 8, method: 'tools/list', params: {},
    }, { modern: false });
    assert.equal(legacyListed.response.status, 200, getStderr());
    assert.equal(legacyListed.payload.result.resultType, undefined);
    assert.equal(legacyListed.payload.result.ttlMs, undefined);
    assert.ok(legacyListed.payload.result.tools.some((tool) => tool.name === 'meihua'));

    const legacyCalled = await rpc(endpoint, {
      jsonrpc: '2.0', id: 9, method: 'tools/call',
      params: {
        name: 'xiaoliuren',
        arguments: { lunarMonth: 1, lunarDay: 1, hour: 1, question: '测试' },
      },
    }, { modern: false });
    assert.equal(legacyCalled.response.status, 200, getStderr());
    assert.equal(legacyCalled.payload.result.structuredContent.结果.落宫, '大安');
  } finally {
    await stopProcess(child);
  }
});

test('public runtime limits subscriptions/listen streams per client IP', async () => {
  const port = await getFreePort();
  const { child, getStderr } = startRuntime(port, {
    MCP_TRUST_PROXY: 'true',
    MCP_MAX_SUBSCRIPTIONS_PER_IP: '1',
  });

  try {
    await waitForHealth(port, child);
    const endpoint = `http://127.0.0.1:${port}/mcp`;
    const listenBody = (id) => ({
      jsonrpc: '2.0',
      id,
      method: 'subscriptions/listen',
      params: { _meta: modernMeta(), notifications: { toolsListChanged: true } },
    });
    const headers = {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
      'mcp-method': 'subscriptions/listen',
      'x-forwarded-for': '198.51.100.20',
    };

    const firstResponse = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(listenBody('listen-1')),
    });
    assert.equal(firstResponse.status, 200, getStderr());
    assert.match(firstResponse.headers.get('content-type') || '', /text\/event-stream/u);

    const blocked = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(listenBody('listen-2')),
    });
    const blockedPayload = await blocked.json();
    assert.equal(blocked.status, 429, getStderr());
    assert.equal(blockedPayload.error.code, -32603);

    await firstResponse.body.cancel();
    await wait(50);
    const afterClose = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(listenBody('listen-3')),
    });
    assert.equal(afterClose.status, 200, getStderr());
    await afterClose.body.cancel();
  } finally {
    await stopProcess(child);
  }
});
