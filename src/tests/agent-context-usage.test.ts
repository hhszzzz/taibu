import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import { projectAgentContextUsage } from '../lib/agent/context-usage';
import { resolveKnownModelContextConfig, resolveModelContextConfig, resolveModelWindow } from '../lib/ai/model-context';
import { shouldRequestChatPreview } from '../lib/chat/chat-preview';
import { buildContextSegments } from '../lib/agent/context-segments';
import type { AgentRuntimeInfo } from '../lib/agent/types';

const assistant: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'fixture', model: 'fixture', timestamp: 2, stopReason: 'stop', content: [{ type: 'text', text: 'answer' }], usage: { input: 600, output: 100, cacheRead: 200, cacheWrite: 100, reasoning: 30, totalTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
const user: Message = { role: 'user', content: 'original task', timestamp: 1 };

test('Pi context uses provider totals without double-counting cached or reasoning tokens', () => {
    const result = projectAgentContextUsage([user, assistant], 1);
    assert.equal(result.tokens, 1000);
    assert.equal(result.measuredTokens, 1000);
    assert.equal(result.estimatedTokens, 0);
    assert.equal(result.source, 'usage');
    assert.equal(result.reasoning, 30);
    assert.equal(result.compactions, 1);
});

test('Pi context distinguishes subsequent estimates from measured usage', () => {
    // pi-ai 1.1.0 estimates trailing content at 3.5 chars/token: ceil(8 / 3.5) = 3.
    const result = projectAgentContextUsage([user, assistant, { role: 'toolResult', toolCallId: 'tool', toolName: 'read', isError: false, timestamp: 3, content: [{ type: 'text', text: '12345678' }] }], 0);
    assert.equal(result.tokens, 1003);
    assert.equal(result.estimatedTokens, 3);
    assert.equal(result.source, 'mixed');
});

test('compacted prefixes invalidate old usage and missing/error usage remains explicitly estimated', () => {
    const summary: Message = { role: 'user', content: 'summary', timestamp: 5 };
    const result = projectAgentContextUsage([summary, assistant], 1);
    assert.equal(result.source, 'estimated');
    assert.equal(result.measuredTokens, 0);
    assert.equal(result.input, undefined);
    for (const stopReason of ['error', 'aborted'] as const) assert.equal(projectAgentContextUsage([user, { ...assistant, stopReason }], 0).source, 'estimated');
    assert.equal(projectAgentContextUsage([user, { ...assistant, usage: { ...assistant.usage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } }], 0).source, 'estimated');
});

test('unknown model capacities do not inherit ordinary-chat prompt budgets', () => {
    for (const id of ['custom-gpt', 'fixture', 'default', '__proto__']) assert.equal(resolveKnownModelContextConfig(id), null);
    assert.equal(resolveKnownModelContextConfig('deepseek-v3.2')?.maxContext, 32000);
    assert.equal(resolveKnownModelContextConfig('glm-4.7', true)?.maxContext, 128000);
    assert.equal(resolveModelContextConfig('unknown').maxContext, 32000, 'ordinary chat retains its bounded prompt policy');
    assert.equal(resolveModelWindow({ id: 'custom-gpt' }), null);
});

test('a context window set in the catalog replaces the known limit and reserves the model output limit', () => {
    const configured = resolveModelWindow({ id: 'custom-gpt', contextWindow: 1_000_000, defaultMaxTokens: 32_768 });
    assert.deepEqual([configured?.maxContext, configured?.reserveOutput], [1_000_000, 32_768]);
    // A known model keeps its prompt policy but takes the catalog window.
    const known = resolveModelWindow({ id: 'glm-4.7', contextWindow: 200_000 }, true);
    assert.deepEqual([known?.maxContext, known?.reserveOutput], [200_000, 4000]);
    assert.equal(resolveModelContextConfig({ id: 'custom-gpt', contextWindow: 256_000 }).maxContext, 256_000);
});

test('Agent mode never requests the ordinary-chat prompt preview', () => {
    const idle = { userId: 'user', isLoading: false, isSendingToList: false };
    assert.equal(shouldRequestChatPreview(idle), true);
    assert.equal(shouldRequestChatPreview({ ...idle, agentMode: true }), false);
    assert.equal(shouldRequestChatPreview({ ...idle, userId: null }), false);
    assert.equal(shouldRequestChatPreview({ ...idle, isLoading: true }), false);
    assert.equal(shouldRequestChatPreview({ ...idle, isSendingToList: true }), false);
});

const runtimeWith = (usage: AgentRuntimeInfo['usage'], contextWindow = 200_000): AgentRuntimeInfo => ({ model: { id: 'm', name: 'M', contextWindow, limitSource: 'configured' }, usage });
const seedContext = { tokens: 18_400, measuredTokens: 17_200, estimatedTokens: 1_200, source: 'mixed' as const, compactions: 0 };

test('the measured total is split into messages, tools and a visible system prompt', () => {
  const segments = buildContextSegments(runtimeWith({ models: {}, tools: {}, totalTokens: 0 }), seedContext);
  const tokens = Object.fromEntries(segments.map(segment => [segment.key, segment.tokens]));
  assert.deepEqual(tokens, { messages: 15_088, tools: 2_208, mcp: 0, system: 1_104, skills: 0, memory: 0, buffer: 0, free: 181_600 },
    'messages + tools + system partition the measured context instead of leaving the system prompt at zero');
  assert.equal(tokens.messages + tokens.tools + tokens.system, seedContext.tokens);
});

test('measured tool totals win over the share estimate and never overflow the context', () => {
  const segments = buildContextSegments(runtimeWith({ models: {}, tools: { bazi: { totalTokens: 5_000 } }, totalTokens: 5_000 }), seedContext);
  const tokens = Object.fromEntries(segments.map(segment => [segment.key, segment.tokens]));
  assert.equal(tokens.tools, 5_000);
  assert.equal(tokens.system, 1_104);
  assert.equal(tokens.messages, 18_400 - 5_000 - 1_104);
  const huge = buildContextSegments(runtimeWith({ models: {}, tools: { bazi: { totalTokens: 99_999 } }, totalTokens: 99_999 }), seedContext);
  assert.equal(huge.find(segment => segment.key === 'tools')?.tokens, 18_400 - 1_104, 'a measured tool total is capped by the context itself');
});

test('skills say the method catalog is injected even when no card was read', () => {
  const skills = (cards: number) => ({ cards: Array.from({ length: cards }, (_, index) => ({ id: `c${index}`, title: `方法${index}`, version: '1' })) });
  const meta = (value?: ReturnType<typeof skills>) => buildContextSegments(runtimeWith(undefined), seedContext, value).find(segment => segment.key === 'skills');
  assert.equal(meta(skills(0))?.meta, '技能目录', 'the injected directory is counted under skills even with no card');
  assert.equal(meta(skills(2))?.meta, '2 个方法');
  assert.equal(meta()?.deferred, true, 'without skills data the row stays a placeholder');
  assert.equal(meta()?.meta, undefined);
});

test('compaction buffer shrinks free space only when the model has room', () => {
  const compacted = buildContextSegments(runtimeWith(undefined), { ...seedContext, compactions: 2 });
  assert.equal(compacted.find(segment => segment.key === 'buffer')?.tokens, 13_200);
  assert.equal(compacted.find(segment => segment.key === 'free')?.tokens, 200_000 - 18_400 - 13_200);
  const full = buildContextSegments(runtimeWith(undefined), { ...seedContext, tokens: 200_000, measuredTokens: 200_000, compactions: 2 });
  assert.equal(full.find(segment => segment.key === 'buffer')?.tokens, 0, 'a full window reserves no compaction buffer');
});

test('skill tokens are counted under 技能 and taken out of messages and the system prompt', () => {
  const runtime = { ...runtimeWith(undefined), skillsTokens: 700 };
  const segments = buildContextSegments(runtime, seedContext, { cards: [{ id: 'method:bazi', title: '子平八字', version: '2.1.0', tokens: 300 }] });
  const tokens = Object.fromEntries(segments.map(segment => [segment.key, segment.tokens]));
  assert.equal(tokens.skills, 1_000, 'catalog 700 + loaded card 300');
  assert.equal(tokens.system, 1_104 - 700, 'the catalog leaves the system-prompt share');
  assert.equal(tokens.messages, 18_400 - 2_208 - 404 - 1_000);
  assert.equal(tokens.messages + tokens.tools + tokens.system + tokens.skills, seedContext.tokens);
  assert.deepEqual(segments.find(segment => segment.key === 'skills')?.meta, '1 个方法');
});

test('MCP tool definitions and server instructions share one context row', () => {
  const runtime = { ...runtimeWith(undefined), mcp: { servers: 1, skipped: 1, direct: 1, deferred: 2, codemode: 0, toolsTokens: 900, sectionTokens: 300 } };
  const segments = buildContextSegments(runtime, seedContext);
  const tokens = Object.fromEntries(segments.map(segment => [segment.key, segment.tokens]));
  assert.deepEqual([tokens.mcp, tokens.system, tokens.messages], [1_200, 1_104 - 300, 18_400 - 2_208 - 804 - 1_200]);
  assert.equal(segments.some(segment => segment.key === 'mcp-instructions'), false, 'server instructions do not get a second MCP row');
  assert.equal(tokens.messages + tokens.tools + tokens.mcp + tokens.system, seedContext.tokens);
  const row = (list: typeof segments, key: string) => list.find(segment => segment.key === key)!;
  assert.equal(row(segments, 'mcp').label, 'MCP');
  const missed = buildContextSegments({ ...runtime, mcp: { ...runtime.mcp, servers: 0, direct: 0, deferred: 0, toolsTokens: 0 } }, seedContext);
  assert.equal(row(missed, 'mcp').tokens, 300, 'a task whose servers all failed still counts their instruction section');
  assert.equal(row(missed, 'mcp').deferred, undefined);
});
