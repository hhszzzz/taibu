import test from 'node:test';
import assert from 'node:assert/strict';
import type { AIModelConfig } from '../types';
import { estimateTokens, tokenFamily } from '../lib/agent/token-estimate';
import { countModelTokens, resetTokenCountCache } from '../lib/agent/token-count.server';

test('models fall into the tokenizer families new-api tokenkit uses', () => {
  const cases: Array<[string, ReturnType<typeof tokenFamily>]> = [
    ['claude-3-5-sonnet-20240620', 'claude'], ['claude-sonnet-4-5-20250929', 'claude'], ['claude-haiku-4-5', 'claude'],
    ['claude-opus-4-7', 'claude4.7'], ['us.anthropic.claude-opus-4-7-v1:0', 'claude4.7'], ['claude-sonnet-5', 'claude4.7'],
    ['Claude-Opus-5-5', 'claude4.7'], ['claude-mythos-preview', 'claude4.7'],
    ['gemini-3.7-flash', 'gemini'], ['gpt-5.6-sol', 'openai'], ['o3-mini', 'openai'], ['deepseek-v3.2', 'unknown'],
  ];
  for (const [model, family] of cases) assert.equal(tokenFamily(model), family, model);
});

test('estimates match new-api tokenkit for the same text and model', () => {
  // Expected values come from tokenkit.Estimate (Go) on the same strings.
  const code = 'func main() {\n\tfmt.Println("统计 token", 42)\n}\nSee https://example.com/a?b=1';
  const mixed = '大语言模型按 token 计费；Large language models bill by token. 🙂';
  assert.deepEqual(['deepseek-v3.2', 'gpt-5.6-sol', 'claude-haiku-4-5', 'claude-opus-4-7', 'gemini-3.7-flash'].map(model => [estimateTokens(model, code), estimateTokens(model, mixed)]),
    [[31, 21], [30, 18], [37, 25], [49, 28], [37, 17]]);
  assert.equal(estimateTokens('claude-sonnet-5', ''), 0);
});

const model = (overrides: Partial<AIModelConfig> = {}): AIModelConfig => ({
  id: 'deepseek-v3.2', name: 'DeepSeek V3.2', vendor: 'deepseek', modelId: 'deepseek-v3.2',
  apiUrl: 'http://gateway.test/v1/', apiKeyEnvVar: 'TOKEN_COUNT_TEST_KEY', supportsReasoning: false, ...overrides,
});

function gateway(respond: (text: string) => Response) {
  const calls: Array<{ url: string; text: string; auth: string | null }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> };
    calls.push({ url: String(url), text: body.messages[0].content, auth: new Headers(init?.headers).get('authorization') });
    return respond(body.messages[0].content);
  }) as typeof fetch;
  return { calls, fetcher };
}

test('skill text is counted by the gateway, minus the message framing, and the count is reused', async () => {
  resetTokenCountCache();
  process.env.TOKEN_COUNT_TEST_KEY = 'sk-test';
  const { calls, fetcher } = gateway(text => Response.json({ input_tokens: text === '.' ? 8 : 8 + 120 }));
  assert.equal(await countModelTokens(model(), '方法目录正文', { fetch: fetcher }), 121, 'framing (8 − the dot itself) comes off');
  assert.deepEqual(calls.map(call => [call.url, call.text, call.auth]), [
    ['http://gateway.test/v1/messages/count_tokens', '.', 'Bearer sk-test'],
    ['http://gateway.test/v1/messages/count_tokens', '方法目录正文', 'Bearer sk-test'],
  ]);
  assert.equal(await countModelTokens(model(), '方法目录正文', { fetch: fetcher }), 121);
  assert.equal(calls.length, 2, 'the same text on the same model is asked once');
});

test('without a count endpoint, a bring-your-own model or a key, the tokenkit estimate stands in', async () => {
  resetTokenCountCache();
  process.env.TOKEN_COUNT_TEST_KEY = 'sk-test';
  const text = '子平八字：先看月令，再看透干。';
  const missing = gateway(() => new Response('not found', { status: 404 }));
  assert.equal(await countModelTokens(model(), text, { fetch: missing.fetcher }), estimateTokens('deepseek-v3.2', text));
  assert.equal(await countModelTokens(model(), `${text}！`, { fetch: missing.fetcher }), estimateTokens('deepseek-v3.2', `${text}！`));
  assert.equal(missing.calls.length, 1, 'a gateway without the endpoint is not asked again for a while');

  const failing = gateway(() => new Response('upstream error', { status: 502 }));
  resetTokenCountCache();
  assert.equal(await countModelTokens(model(), text, { fetch: failing.fetcher }), estimateTokens('deepseek-v3.2', text));
  await countModelTokens(model(), text, { fetch: failing.fetcher });
  assert.equal(failing.calls.length, 2, 'a transient failure is not remembered');

  const untouched = gateway(() => Response.json({ input_tokens: 1 }));
  assert.equal(await countModelTokens(model(), text, { apiKey: 'sk-user', fetch: untouched.fetcher }), estimateTokens('deepseek-v3.2', text));
  delete process.env.TOKEN_COUNT_TEST_KEY;
  assert.equal(await countModelTokens(model(), text, { fetch: untouched.fetcher }), estimateTokens('deepseek-v3.2', text));
  assert.equal(untouched.calls.length, 0, 'no request on behalf of a user’s own provider or without a configured key');
});
