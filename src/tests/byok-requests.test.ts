import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ByokRequestError } from '../lib/byok/config';
import { generateByokImages } from '../lib/byok/images';
import { byokBrowserFetch, byokContext, collectByokStream, streamByok, type ByokRequestModel } from '../lib/byok/pi-model';
import { listByokModels, probeByokConnection, testByokModel } from '../lib/byok/probe';
import { ByokKeyError, openByokKey, sealByokKey } from '../lib/byok/secrets.server';
import { GENERATED_IMAGE_MAX_BYTES } from '../lib/images/generated';
import { readByokResponse } from '../lib/byok/response';

type Sent = { url: string; method: string; headers: Headers; body: Record<string, unknown> | null };
type Answer = (request: Sent) => Response | Promise<Response>;

/** A provider double: answers each request in turn (the last answer repeats) and records what was sent. */
function provider(...answers: Answer[]) {
  const requests: Sent[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    const sent = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body };
    requests.push(sent);
    return answers[Math.min(requests.length - 1, answers.length - 1)](sent);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const json = (value: unknown, status = 200): Answer => () => Response.json(value, { status });
const text = (value: string, status: number): Answer => () => new Response(value, { status });
const completion = (content: string): Answer => () => new Response([
  `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'x', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
  `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'x', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n`,
  'data: [DONE]\n\n',
].join(''), { headers: { 'content-type': 'text/event-stream' } });
const message = (content: string): Answer => () => new Response([
  ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'x', stop_reason: null, usage: { input_tokens: 3, output_tokens: 0 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }],
  ['message_stop', { type: 'message_stop' }],
].map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });

const OPENAI: ByokRequestModel = { protocol: 'openai', baseUrl: 'https://relay.example', modelId: 'gpt-4.1', supportsVision: false, contextWindow: null, maxOutput: null };
const CLAUDE: ByokRequestModel = { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', modelId: 'claude-sonnet-4-5', supportsVision: false, contextWindow: null, maxOutput: null };

function masterKey(t: TestContext) {
  const previous = process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = previous;
  });
}

test('a stored key opens only for its owner, connection and host, under the master key it was sealed with', (t) => {
  masterKey(t);
  const scope = { userId: 'user-1', connectionId: 'conn-1', host: 'api.deepseek.com' };
  const { secret, hint } = sealByokKey(scope, 'sk-1234567890abcd');
  assert.equal(hint, 'sk-…abcd');
  assert.doesNotMatch(JSON.stringify(secret), /1234567890/u);
  assert.equal(openByokKey(scope, secret), 'sk-1234567890abcd');
  for (const other of [{ ...scope, userId: 'user-2' }, { ...scope, connectionId: 'conn-2' }, { ...scope, host: 'relay.example' }]) {
    assert.throws(() => openByokKey(other, secret), ByokKeyError, JSON.stringify(other));
  }
  assert.throws(() => openByokKey(scope, { not: 'sealed' }), ByokKeyError);
  masterKey(t);
  assert.throws(() => openByokKey(scope, secret), ByokKeyError, 'another master key cannot open it');
});

test('the model list reads OpenAI, Anthropic and bare-array answers, and reports a website or a refusal', async () => {
  const openai = provider(json({ data: [{ id: 'b-model' }, { id: 'a-model', name: 'A Model' }, { id: 'b-model' }, { id: '' }] }));
  const listed = await listByokModels('openai', 'https://api.example.com', 'sk-test', { fetch: openai.fetch, userAgent: 'taibu-test' });
  assert.deepEqual(listed, { ok: true, models: [{ id: 'a-model', name: 'A Model' }, { id: 'b-model' }] }, 'sorted, deduplicated, blanks left out');
  assert.equal(openai.requests[0].url, 'https://api.example.com/v1/models');
  assert.equal(openai.requests[0].headers.get('authorization'), 'Bearer sk-test');
  assert.equal(openai.requests[0].headers.get('user-agent'), 'taibu-test');

  const anthropic = provider(json({ data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }] }));
  assert.deepEqual(await listByokModels('anthropic', 'https://api.anthropic.com', 'sk-ant', { fetch: anthropic.fetch }),
    { ok: true, models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }] });
  assert.equal(anthropic.requests[0].url, 'https://api.anthropic.com/v1/models');
  assert.equal(anthropic.requests[0].headers.get('x-api-key'), 'sk-ant');
  assert.equal(anthropic.requests[0].headers.get('anthropic-version'), '2023-06-01');
  assert.equal(anthropic.requests[0].headers.get('authorization'), null);

  assert.deepEqual(await listByokModels('openai', 'https://api.example.com', 'k', { fetch: provider(json(['m1', 'm2'])).fetch }),
    { ok: true, models: [{ id: 'm1' }, { id: 'm2' }] });
  const website = await listByokModels('openai', 'https://example.com', 'k', { fetch: provider(text('<html>home</html>', 200)).fetch });
  assert.equal(!website.ok && website.failure.status, 404, 'a web page at the address reads as a wrong address');
  const refused = await listByokModels('openai', 'https://api.example.com', 'k', { fetch: provider(text('{"error":"invalid key"}', 401)).fetch });
  assert.deepEqual(refused, { ok: false, failure: { status: 401, text: '{"error":"invalid key"}' } });
  const offline = await listByokModels('openai', 'https://api.example.com', 'k', { fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch });
  assert.equal(!offline.ok && offline.failure.kind, 'network');
});

test('BYOK provider response bodies are bounded before JSON or image decoding', async () => {
  const oversizedList = await listByokModels('openai', 'https://api.example.com', 'k', {
    fetch: provider(() => new Response('x'.repeat(2 * 1024 * 1024 + 1))).fetch,
  });
  assert.equal(!oversizedList.ok && oversizedList.failure.status, 413);

  const base = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-img', prompt: '橘猫', size: '1024x1024', count: 1 };
  const fetch = provider(json({ data: [{ url: 'https://cdn.example/image.png' }] }), () => new Response(new ReadableStream<Uint8Array>({
    start() {},
  }), { headers: { 'content-type': 'image/png', 'content-length': String(GENERATED_IMAGE_MAX_BYTES + 1) } })).fetch;
  await assert.rejects(generateByokImages({ ...base, modelId: 'dall-e-3', fetch }), /超过 10MB/u);

  let utilityCanceled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4])); },
    cancel() { utilityCanceled = true; },
  }));
  await assert.rejects(readByokResponse(response, 3), /size limit/u);
  assert.equal(utilityCanceled, true);
});

test('a connection test offers the address with /v1 toggled when only that one answers', async () => {
  const toggled = provider(text('not found', 404), json({ data: [{ id: 'm' }] }));
  const result = await probeByokConnection('openai', 'https://relay.example', 'k', { fetch: toggled.fetch });
  assert.deepEqual(toggled.requests.map(request => request.url), ['https://relay.example/v1/models', 'https://relay.example/models']);
  assert.deepEqual(result, { ok: false, failure: { status: 404, text: 'not found' }, alternative: { baseUrl: 'https://relay.example/chat/completions', models: [{ id: 'm' }] } });

  const badKey = provider(text('bad key', 401));
  assert.equal((await probeByokConnection('openai', 'https://relay.example', 'k', { fetch: badKey.fetch })).ok, false);
  assert.equal(badKey.requests.length, 1, 'a refused key is not retried at another address');
  const claude = provider(text('not found', 404));
  await probeByokConnection('anthropic', 'https://relay.example', 'k', { fetch: claude.fetch });
  assert.equal(claude.requests.length, 1, 'Anthropic addresses have no /v1 to toggle');
});

test('a model test asks for the default level and, when the model refuses levels, answers without one', async () => {
  const accepted = provider(completion('OK'));
  assert.deepEqual(await testByokModel(OPENAI, 'k', 'high', { fetch: accepted.fetch }), { ok: true, reply: 'OK', effort: 'accepted' });
  assert.equal(accepted.requests[0].body?.reasoning_effort, 'high');

  const rejected = provider(text('{"error":{"message":"Unrecognized request argument supplied: reasoning_effort"}}', 400), completion('OK'));
  assert.deepEqual(await testByokModel(OPENAI, 'k', 'high', { fetch: rejected.fetch }), { ok: true, reply: 'OK', effort: 'rejected' });
  assert.equal(rejected.requests[1].body?.reasoning_effort, undefined);

  assert.deepEqual(await testByokModel(OPENAI, 'k', null, { fetch: provider(completion('OK')).fetch }), { ok: true, reply: 'OK', effort: 'unused' });
  const missing = await testByokModel(OPENAI, 'k', 'high', { fetch: provider(text('{"error":{"message":"model not found"}}', 404)).fetch });
  assert.equal(!missing.ok && missing.failure.status, 404, 'a 404 is not taken for a refused level');
});

test('own-model requests carry each format\'s thinking parameters, no temperature, and usage', async () => {
  const send = async (model: ByokRequestModel, thinking: Parameters<typeof streamByok>[2]['thinking']) => {
    const double = provider(model.protocol === 'anthropic' ? message('OK') : completion('OK'));
    const result = await collectByokStream(streamByok(model, byokContext('系统提示', [{ role: 'user', content: '你好' }]), { apiKey: 'sk-test', thinking, fetch: double.fetch }));
    return { result, request: double.requests[0] };
  };
  const level = await send(OPENAI, { mode: 'level', level: 'high' });
  assert.equal(level.request.url, 'https://relay.example/v1/chat/completions');
  assert.equal(level.request.body?.reasoning_effort, 'high');
  const capped = await send({ ...OPENAI, maxOutput: 4096 }, { mode: 'auto' });
  assert.equal(capped.request.body?.max_completion_tokens ?? capped.request.body?.max_tokens, 4096, 'the configured output cap reaches the provider');
  assert.equal(capped.request.body?.temperature, undefined);
  assert.equal(level.request.body?.temperature, undefined);
  assert.deepEqual(level.request.body?.stream_options, { include_usage: true });
  assert.deepEqual((level.request.body?.messages as Array<{ role: string }>).map(item => item.role), ['system', 'user'], 'a relay gets a plain system message');
  assert.equal(level.request.body?.store, undefined);
  assert.deepEqual(level.result, { content: 'OK', reasoning: '', usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 }, error: null, aborted: false, stopReason: 'stop' });
  assert.equal((await send(OPENAI, { mode: 'auto' })).request.body?.reasoning_effort, undefined, '「模型默认」 sends nothing');

  const claudeAuto = await send(CLAUDE, { mode: 'auto' });
  assert.match(claudeAuto.request.url, /^https:\/\/api\.anthropic\.com\/v1\/messages/u);
  assert.equal(claudeAuto.request.headers.get('x-api-key'), 'sk-test');
  assert.equal(claudeAuto.request.body?.max_tokens, 8192, 'Anthropic needs an output limit');
  assert.equal(claudeAuto.request.body?.thinking, undefined);
  assert.deepEqual((await send(CLAUDE, { mode: 'off' })).request.body?.thinking, { type: 'disabled' });
  const budget = await send(CLAUDE, { mode: 'level', level: 'high' });
  assert.equal((budget.request.body?.thinking as { budget_tokens: number }).budget_tokens, 16384);
  assert.ok((budget.request.body?.max_tokens as number) > 16384, 'the output limit leaves room for the answer');
  const adaptive = await send({ ...CLAUDE, modelId: 'claude-opus-4-6' }, { mode: 'level', level: 'minimal' });
  assert.equal((adaptive.request.body?.thinking as { type: string }).type, 'adaptive');
  assert.deepEqual(adaptive.request.body?.output_config, { effort: 'low' }, 'adaptive Claude has no minimal effort');

  const failed = await collectByokStream(streamByok(OPENAI, byokContext('', [{ role: 'user', content: 'x' }]), {
    apiKey: 'bad', thinking: { mode: 'auto' }, fetch: provider(text('{"error":{"message":"Invalid API key"}}', 401)).fetch,
  }));
  assert.match(failed.error ?? '', /^401\b/u, 'the failure starts with the HTTP status');
});

test('the browser fetch drops SDK headers a provider\'s CORS rules would refuse', async (t) => {
  let headers: Headers | undefined;
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => { headers = new Headers(init?.headers); return new Response('{}'); });
  await byokBrowserFetch('https://api.example.com/v1/models', {
    headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json', 'User-Agent': 'pi-ai', 'X-Stainless-Lang': 'js', 'x-stainless-os': 'MacOS' },
  });
  assert.deepEqual([...headers!.keys()].sort(), ['authorization', 'content-type']);
});

test('own image models make one request per image, read base64 or a link, and keep whatever arrived', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const base = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-img', prompt: '橘猫', size: '1024x1024' };
  const gpt = provider(json({ data: [{ b64_json: png.toString('base64') }] }));
  const images = await generateByokImages({ ...base, modelId: 'gpt-image-1', count: 2, fetch: gpt.fetch, userAgent: 'taibu-test' });
  assert.equal(images.length, 2);
  assert.equal(images[0].mediaType, 'image/png');
  assert.deepEqual(gpt.requests.map(request => request.url), ['https://api.openai.com/v1/images/generations', 'https://api.openai.com/v1/images/generations']);
  assert.deepEqual(gpt.requests[0].body, { model: 'gpt-image-1', prompt: '橘猫', n: 1, size: '1024x1024' }, 'GPT image models always answer in base64');
  assert.equal(gpt.requests[0].headers.get('authorization'), 'Bearer sk-img');

  const linked = provider(json({ data: [{ url: 'https://cdn.example/image.png' }] }), () => new Response(png));
  const [fromLink] = await generateByokImages({ ...base, modelId: 'dall-e-3', count: 1, fetch: linked.fetch });
  assert.equal(fromLink.mediaType, 'image/png');
  assert.equal(linked.requests[0].body?.response_format, 'b64_json');
  assert.equal(linked.requests[1].url, 'https://cdn.example/image.png');

  const partly = provider(json({ data: [{ b64_json: png.toString('base64') }] }), text('busy', 503));
  assert.equal((await generateByokImages({ ...base, modelId: 'flux', count: 2, fetch: partly.fetch })).length, 1, 'one image out of two is still delivered');
  await assert.rejects(generateByokImages({ ...base, modelId: 'flux', count: 1, fetch: provider(text('{"error":"bad key"}', 401)).fetch }),
    (error: unknown) => error instanceof ByokRequestError && error.failure.status === 401 && /HTTP 401/u.test(error.message));
  await assert.rejects(generateByokImages({ ...base, modelId: 'flux', count: 1, fetch: provider(json({ data: [{ b64_json: Buffer.from('GIF89a').toString('base64') }] })).fetch }),
    /不是 PNG、JPEG 或 WebP/u);
});
