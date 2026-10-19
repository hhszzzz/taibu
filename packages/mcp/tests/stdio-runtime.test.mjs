import test from 'node:test';
import assert from 'node:assert/strict';
import { listToolDefinitions } from 'taibu-core/mcp';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_PROTOCOL_VERSION = '2025-06-18';

function modernMeta() {
  return {
    'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'stdio-test', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

function startStdioServer() {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: resolve(process.cwd(), 'packages/mcp'),
    env: { ...process.env, NODE_OPTIONS: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let stdoutBuffer = '';
  let stderr = '';

  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    while (stdoutBuffer.includes('\n')) {
      const newline = stdoutBuffer.indexOf('\n');
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id).resolve(message);
        pending.delete(message.id);
      }
    }
  });
  child.once('exit', (code) => {
    for (const { reject } of pending.values()) {
      reject(new Error(`stdio server exited with ${code}: ${stderr}`));
    }
    pending.clear();
  });

  function send(message) {
    if (message.id === undefined) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
      return Promise.resolve(undefined);
    }
    return new Promise((resolveResponse, rejectResponse) => {
      const timeout = setTimeout(() => {
        pending.delete(message.id);
        rejectResponse(new Error(`Timed out waiting for ${message.method}: ${stderr}`));
      }, 10_000);
      pending.set(message.id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolveResponse(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectResponse(error);
        },
      });
      child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async function stop() {
    if (child.exitCode !== null) return;
    child.stdin.end();
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 500)),
    ]);
    if (child.exitCode === null) child.kill('SIGTERM');
  }

  return { child, send, stop, getStderr: () => stderr };
}

test('stdio runtime serves MCP 2026-07-28 discovery, list, and tool calls', async () => {
  const runtime = startStdioServer();
  try {
    const discovered = await runtime.send({
      jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: modernMeta() },
    });
    assert.deepEqual(discovered.result.supportedVersions, [MODERN_PROTOCOL_VERSION]);
    assert.equal(discovered.result.resultType, 'complete');
    assert.equal(discovered.result.ttlMs, 300_000);
    assert.equal(discovered.result.cacheScope, 'public');
    assert.equal(discovered.result._meta['io.modelcontextprotocol/serverInfo'].name, 'taibu-mcp');

    const listed = await runtime.send({
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: modernMeta() },
    });
    assert.equal(listed.result.resultType, 'complete');
    assert.equal(listed.result.tools.length, listToolDefinitions().length);
    assert.equal(listed.result.tools.find((tool) => tool.name === 'bazi').title, '八字命盘');

    const called = await runtime.send({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: {
        _meta: modernMeta(),
        name: 'xiaoliuren',
        arguments: { lunarMonth: 1, lunarDay: 1, hour: 1, question: '测试' },
      },
    });
    assert.equal(called.result.resultType, 'complete');
    assert.equal(called.result.structuredContent.结果.落宫, '大安');
  } finally {
    await runtime.stop();
  }
});

test('stdio runtime keeps the legacy initialize flow compatible', async () => {
  const runtime = startStdioServer();
  try {
    const initialized = await runtime.send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: LEGACY_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'legacy-stdio-test', version: '1.0.0' },
      },
    });
    assert.equal(initialized.result.protocolVersion, LEGACY_PROTOCOL_VERSION);
    assert.equal(initialized.result.serverInfo.name, 'taibu-mcp');

    await runtime.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    const listed = await runtime.send({
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });
    assert.equal(listed.result.resultType, undefined);
    assert.equal(listed.result.tools.length, listToolDefinitions().length, runtime.getStderr());
  } finally {
    await runtime.stop();
  }
});
