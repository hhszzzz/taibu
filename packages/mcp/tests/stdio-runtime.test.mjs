import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFERRED_TOOL_NAMES, listAnalysisMethods, listToolDefinitions, renderMethod } from 'taibu-core/mcp';
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

function startStdioServer(env = {}) {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: resolve(process.cwd(), 'packages/mcp'),
    env: { ...process.env, NODE_OPTIONS: '', TAIBU_MCP_TOOLS: '', ...env },
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
    // Every Core tool, and the tool through which the model loads a method.
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), [...listToolDefinitions().map((tool) => tool.name), 'load_analysis_method']);
    assert.equal(listed.result.tools.find((tool) => tool.name === 'bazi').title, '八字命盘');
    assert.match(discovered.result.instructions, /load_analysis_method/);
    assert.ok(discovered.result.capabilities.prompts, 'the method prompts are advertised');
    assert.doesNotMatch(discovered.result.instructions, /tool_search/);

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
    assert.equal(listed.result.tools.length, listToolDefinitions().length + 1, runtime.getStderr());
    assert.ok(listed.result.tools.some((tool) => tool.name === 'load_analysis_method'));
  } finally {
    await runtime.stop();
  }
});

test('stdio runtime offers every method as a prompt and as a tool the model can call', async () => {
  const runtime = startStdioServer();
  try {
    const listed = await runtime.send({ jsonrpc: '2.0', id: 1, method: 'prompts/list', params: { _meta: modernMeta() } });
    assert.equal(listed.result.ttlMs, 300_000);
    assert.deepEqual(listed.result.prompts.map((prompt) => prompt.name), listAnalysisMethods().map((method) => method.id));
    const mangpai = listed.result.prompts.find((prompt) => prompt.name === 'bazi-mangpai');
    assert.equal(mangpai.title, '盲派八字');
    assert.deepEqual(mangpai.arguments.map(({ name, required }) => ({ name, required: required ?? false })), [{ name: 'question', required: false }]);

    const asked = await runtime.send({
      jsonrpc: '2.0', id: 2, method: 'prompts/get',
      params: { _meta: modernMeta(), name: 'bazi-mangpai', arguments: { question: '1990年5月20日8点男，看事业' } },
    });
    assert.equal(asked.result.resultType, 'complete');
    const text = asked.result.messages[0].content.text;
    assert.ok(text.includes(renderMethod('bazi-mangpai')) && text.endsWith('1990年5月20日8点男，看事业'));
    const unknown = await runtime.send({ jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { _meta: modernMeta(), name: 'fengshui' } });
    assert.ok(unknown.error, 'an unknown prompt is a protocol error');

    const loaded = await runtime.send({
      jsonrpc: '2.0', id: 4, method: 'tools/call', params: { _meta: modernMeta(), name: 'load_analysis_method', arguments: { id: 'bazi_dayun' } },
    });
    assert.equal(loaded.result.content[0].text, renderMethod('bazi'), 'a tool name loads its system default card');
    const missing = await runtime.send({
      jsonrpc: '2.0', id: 5, method: 'tools/call', params: { _meta: modernMeta(), name: 'load_analysis_method', arguments: { id: '__proto__' } },
    });
    assert.equal(missing.result.isError, true);
    assert.match(missing.result.content[0].text, /未知的分析方法/);
  } finally {
    await runtime.stop();
  }
});

test('stdio core mode lists the tools a reading starts from and reaches the rest through tool_search and tool_call', async () => {
  const runtime = startStdioServer({ TAIBU_MCP_TOOLS: 'core' });
  try {
    const discovered = await runtime.send({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: modernMeta() } });
    assert.match(discovered.result.instructions, /tool_search/);
    const listed = await runtime.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: modernMeta() } });
    const names = listed.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [...listToolDefinitions().map((tool) => tool.name).filter((name) => !DEFERRED_TOOL_NAMES.includes(name)), 'load_analysis_method', 'tool_search', 'tool_call']);

    const searched = await runtime.send({
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { _meta: modernMeta(), name: 'tool_search', arguments: { query: '大运' } },
    });
    const found = searched.result.content[0].text;
    assert.match(found, /^找到 \d+ 个工具/);
    assert.ok(found.indexOf('## bazi_dayun') > 0 && found.includes('"birthYear"'), 'the match carries its input schema');
    const none = await runtime.send({
      jsonrpc: '2.0', id: 4, method: 'tools/call', params: { _meta: modernMeta(), name: 'tool_search', arguments: { query: '完全不存在的东西' } },
    });
    assert.match(none.result.content[0].text, /没有匹配的工具/);

    const dayun = listToolDefinitions().find((tool) => tool.name === 'bazi_dayun');
    const called = await runtime.send({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { _meta: modernMeta(), name: 'tool_call', arguments: { name: 'bazi_dayun', arguments: dayun.inputSchema.examples[0] } },
    });
    assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
    assert.ok(Array.isArray(called.result.structuredContent.大运列表), 'the deferred tool runs as if called directly');
    const listedTool = await runtime.send({
      jsonrpc: '2.0', id: 6, method: 'tools/call', params: { _meta: modernMeta(), name: 'tool_call', arguments: { name: 'bazi', arguments: {} } },
    });
    assert.equal(listedTool.result.isError, true, 'a listed tool is called directly, not through tool_call');
    const invalid = await runtime.send({
      jsonrpc: '2.0', id: 7, method: 'tools/call', params: { _meta: modernMeta(), name: 'tool_call', arguments: { name: 'bazi_dayun', arguments: {} } },
    });
    assert.equal(invalid.result.isError, true, 'the deferred tool still validates its own arguments');
  } finally {
    await runtime.stop();
  }
});

test('stdio runtime refuses an unknown tool list mode at startup', async () => {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: resolve(process.cwd(), 'packages/mcp'),
    env: { ...process.env, NODE_OPTIONS: '', TAIBU_MCP_TOOLS: 'lazy' },
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const code = await new Promise((resolveExit) => child.once('exit', resolveExit));
  assert.notEqual(code, 0);
  assert.match(stderr, /工具列表模式只能是 all 或 core/);
});
