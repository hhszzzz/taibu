import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AIModelConfig } from '../types';
import { AGENT_MEMBER_DENIED_TOOLS, getAgentToolFamily, getAgentToolScope } from '../lib/agent/tool-catalog';
import { createAgentTools } from '../lib/agent/tools.server';
import { MemoryStore, row } from './helpers/agent-runtime-fixture';

const imageModel: AIModelConfig = {
  id: 'image-fixture', name: '生图夹具', vendor: 'openai', modelId: 'gpt-image-1', apiUrl: 'https://gateway.example/v1',
  supportsReasoning: false, requiredTier: 'free', creditCost: 2,
  sources: [{ sourceKey: 'gw', sourceName: 'gw', gatewayId: 'gateway', apiUrl: 'https://gateway.example/v1', isEnabled: true }],
};

function modules() {
  return {
    credits: require('../lib/user/credits') as typeof import('../lib/user/credits'),
    settings: require('../lib/app-settings') as typeof import('../lib/app-settings'),
    images: require('../lib/ai/image-generation.server') as typeof import('../lib/ai/image-generation.server'),
  };
}

beforeEach((t) => {
  assert.ok('mock' in t);
  const { credits, settings } = modules();
  t.mock.method(credits, 'getUserCreditInfo', async () => ({ membership: 'plus', credits: 10, expiresAt: null }));
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
  assert.equal(getAgentToolScope('generate_image'), 'image');
  assert.equal(getAgentToolFamily('generate_image'), 'image');
  assert.equal(AGENT_MEMBER_DENIED_TOOLS.has('generate_image'), true);
  assert.equal(resolve.mock.callCount() > 0, true);

  const generated = t.mock.method(images, 'generateImages', async () => ({
    images: [{ id: '11111111-1111-4111-8111-111111111111', size: '1024x1024', mimeType: 'image/png', url: '/api/images/11111111-1111-4111-8111-111111111111' }],
    remaining: 5,
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
  const generated = t.mock.method(images, 'generateImages', async () => ({ images: [], remaining: null }));
  const run = row();
  const tools = await createAgentTools(new MemoryStore(), run, run.checkpoint);
  const tool = tools.find(item => item.name === 'generate_image')!;
  await assert.rejects(() => tool.execute('1:call', { prompt: '画一只橘猫' }), /Agent 工具范围已关闭：生图/u);
  assert.equal(generated.mock.callCount(), 0);
});
