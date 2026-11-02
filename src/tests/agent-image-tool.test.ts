import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AIModelConfig } from '../types';
import type { ResolvedByokModel } from '../lib/byok/store.server';
import { AGENT_MEMBER_DENIED_TOOLS, getAgentToolFamily, getAgentToolScope } from '../lib/agent/tool-catalog';
import { createAgentTools } from '../lib/agent/tools.server';
import { MemoryStore, row } from './helpers/agent-runtime-fixture';

const imageModel: AIModelConfig = {
  id: 'image-fixture', name: '生图夹具', vendor: 'openai', modelId: 'gpt-image-1', apiUrl: 'https://gateway.example/v1',
  supportsReasoning: false, usageType: 'image', pricing: { input: null, output: null, cacheRead: null, cacheWrite: null, image: 0.04 },
  sources: [{ sourceKey: 'gw', sourceName: 'gw', gatewayId: 'gateway', apiUrl: 'https://gateway.example/v1', isEnabled: true }],
};

const ownImageModel: ResolvedByokModel = {
  id: '00000000-0000-4000-8000-0000000000b2', ref: 'byok:00000000-0000-4000-8000-0000000000b2', modelId: 'gpt-image-1', displayName: '我的生图',
  usage: 'image', supportsVision: false, thinkingLevels: [], defaultEffort: 'auto', contextWindow: null, maxOutput: null,
  connection: { id: '00000000-0000-4000-8000-0000000000c1', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', keyHint: null, updatedAt: '2026-11-02T00:00:00Z' },
  serverKey: false, openKey: () => null,
};

function modules() {
  return {
    settings: require('../lib/app-settings') as typeof import('../lib/app-settings'),
    images: require('../lib/ai/image-generation.server') as typeof import('../lib/ai/image-generation.server'),
  };
}

beforeEach((t) => {
  assert.ok('mock' in t);
  const { settings } = modules();
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' as const }));
});

test('the image tool is offered only with an available image model and cannot go to members', async (t) => {
  const { images } = modules();
  const resolve = t.mock.method(images, 'resolveImageModel', async () => null);
  const run = row();
  const without = await createAgentTools(new MemoryStore(), run, run.checkpoint);
  assert.equal(without.some(tool => tool.name === 'generate_image'), false);

  resolve.mock.mockImplementation(async () => imageModel);
  const store = new MemoryStore();
  const tools = await createAgentTools(store, run, run.checkpoint);
  const tool = tools.find(item => item.name === 'generate_image');
  assert.ok(tool, 'a configured model registers the tool');
  assert.match(tool.description, /每张 \$0\.04，从用户余额扣除/u);
  assert.equal(getAgentToolScope('generate_image'), 'image');
  assert.equal(getAgentToolFamily('generate_image'), 'image');
  assert.equal(AGENT_MEMBER_DENIED_TOOLS.has('generate_image'), true);
  assert.equal(resolve.mock.callCount() > 0, true);

  const generated = t.mock.method(images, 'generateImages', async () => ({
    images: [{ id: '11111111-1111-4111-8111-111111111111', size: '1024x1024', mimeType: 'image/png', url: '/api/images/11111111-1111-4111-8111-111111111111' }],
    costMicros: 40_000,
  }));
  const result = await tool!.execute('1:call', { prompt: '画一只橘猫', size: '1024x1024', n: 2 });
  assert.match(result.content[0]!.type === 'text' ? result.content[0]!.text : '', /已生成 1 张图片/u);
  assert.deepEqual(result.details, {
    prompt: '画一只橘猫', size: '1024x1024', n: 1, model: { id: 'image-fixture', name: '生图夹具' },
    images: [{ id: '11111111-1111-4111-8111-111111111111', size: '1024x1024', mimeType: 'image/png' }],
  });
  const call = generated.mock.calls[0]!.arguments[0] as Record<string, unknown>;
  assert.equal(call.userId, run.user_id);
  assert.equal(call.runId, run.id);
  assert.equal(call.conversationId, run.conversation_id);
  assert.equal(call.messageId, run.public_message.id);
  assert.equal(call.count, 2);

  await assert.rejects(() => tool!.execute('1:member', { prompt: '画一只橘猫' }, undefined, { member: true }), /协作成员不能生成图片/u);
  assert.equal(generated.mock.callCount(), 1);
});

test('a disabled 生图 scope blocks the call at execution time', async (t) => {
  const { settings, images } = modules();
  t.mock.method(images, 'resolveImageModel', async () => imageModel);
  t.mock.method(settings, 'readFeatureModuleStateFresh', async (id: string) => id === 'agent-tool:image'
    ? { status: 'disabled' as const }
    : { status: 'enabled' as const });
  const generated = t.mock.method(images, 'generateImages', async () => ({ images: [], costMicros: 0 }));
  const run = row();
  const tools = await createAgentTools(new MemoryStore(), run, run.checkpoint);
  const tool = tools.find(item => item.name === 'generate_image')!;
  await assert.rejects(() => tool.execute('1:call', { prompt: '画一只橘猫' }), /Agent 工具范围已关闭：生图/u);
  assert.equal(generated.mock.callCount(), 0);
});

test('a task with the member\'s own image model uses it with the task\'s key, unbilled, and skips the platform model', async (t) => {
  const { images } = modules();
  const resolve = t.mock.method(images, 'resolveImageModel', async () => imageModel);
  const platform = t.mock.method(images, 'generateImages', async () => { throw new Error('the platform model must not run'); });
  const own = t.mock.method(images, 'generateByokImageSet', async () => ({
    images: [{ id: '22222222-2222-4222-8222-222222222222', size: '1536x1024', mimeType: 'image/png', url: '/api/images/22222222-2222-4222-8222-222222222222' }],
    costMicros: 0,
  }));
  const run = row();
  const ownImage = { model: ownImageModel, key: 'member-key' };
  const tools = await createAgentTools(new MemoryStore(), run, run.checkpoint, { imageModel: { own: ownImage } });
  const tool = tools.find(item => item.name === 'generate_image')!;
  assert.match(tool.description, /使用用户自己的生图模型，不计费/u);
  assert.equal(resolve.mock.callCount(), 0, 'no platform model is looked up');

  const result = await tool.execute('1:call', { prompt: '画一只橘猫', size: '1536x1024' });
  assert.deepEqual(result.details, {
    prompt: '画一只橘猫', size: '1536x1024', n: 1, model: { id: ownImageModel.ref, name: '我的生图' },
    images: [{ id: '22222222-2222-4222-8222-222222222222', size: '1536x1024', mimeType: 'image/png' }],
  });
  const [request, deps] = own.mock.calls[0]!.arguments as [Record<string, unknown>, { fetch: unknown; userAgent?: string }];
  assert.equal(request.model, ownImageModel);
  assert.equal(request.key, 'member-key');
  assert.deepEqual([request.userId, request.runId, request.conversationId, request.count], [run.user_id, run.id, run.conversation_id, 1]);
  assert.equal(typeof deps.fetch, 'function', 'the caller supplies the public-address fetch');
  assert.ok(deps.userAgent, 'the provider sees the site, not a library default');
  assert.equal(platform.mock.callCount(), 0);
  await assert.rejects(() => tool.execute('1:member', { prompt: '画一只橘猫' }, undefined, { member: true }), /协作成员不能生成图片/u);

  const evaluation = await createAgentTools(new MemoryStore(), run, run.checkpoint, { imageModel: { own: ownImage }, images: false });
  assert.equal(evaluation.some(item => item.name === 'generate_image'), false, 'evaluation runs never generate images');
});

test('a picked platform image model is the one looked up, at every call', async (t) => {
  const { images } = modules();
  let available = true;
  const resolve = t.mock.method(images, 'resolveImageModel', async (id?: string | null) => available && id === 'image-fixture' ? imageModel : null);
  t.mock.method(images, 'generateImages', async () => ({ images: [], costMicros: 0 }));
  const run = row();
  const tools = await createAgentTools(new MemoryStore(), run, run.checkpoint, { imageModel: { platform: 'image-fixture' } });
  const tool = tools.find(item => item.name === 'generate_image')!;
  assert.deepEqual(resolve.mock.calls.map(call => call.arguments[0]), ['image-fixture']);
  available = false;
  await assert.rejects(() => tool.execute('1:call', { prompt: '画一只橘猫' }), /所选的生图模型当前不可用/u);
});
