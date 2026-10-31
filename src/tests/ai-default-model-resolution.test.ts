import { test } from 'node:test';
import assert from 'node:assert/strict';

test('resolveModelAccessAsync should use server-configured chat default when model id is empty', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as any;
  const originalGetModelConfigAsync = serverConfigModule.getModelConfigAsync;
  const originalGetDefaultModelConfigAsync = serverConfigModule.getDefaultModelConfigAsync;

  serverConfigModule.getModelConfigAsync = async () => undefined;
  serverConfigModule.getDefaultModelConfigAsync = async () => ({
    id: 'chat-online-default',
    name: 'Chat Online Default',
    vendor: 'deepseek',
    usageType: 'chat',
    modelId: 'chat-online-default',
    apiUrl: '',
    supportsReasoning: false,
    requiredTier: 'free',
  });

  t.after(() => {
    serverConfigModule.getModelConfigAsync = originalGetModelConfigAsync;
    serverConfigModule.getDefaultModelConfigAsync = originalGetDefaultModelConfigAsync;
  });

  const { resolveModelAccessAsync } = await import('../lib/ai/ai-access');
  const result = await resolveModelAccessAsync(undefined, '', 'free', false);

  assert.equal('error' in result, false);
  if ('error' in result) return;
  assert.equal(result.modelId, 'chat-online-default');
});

test('resolveModelAccessAsync should use server-configured vision default when model id is empty', async (t) => {
  const serverConfigModule = require('../lib/server/ai-config') as any;
  const originalGetModelConfigAsync = serverConfigModule.getModelConfigAsync;
  const originalGetDefaultModelConfigAsync = serverConfigModule.getDefaultModelConfigAsync;

  serverConfigModule.getModelConfigAsync = async () => undefined;
  serverConfigModule.getDefaultModelConfigAsync = async (_usageType: string, options?: { requireVision?: boolean }) => options?.requireVision
    ? {
      id: 'vision-online-default',
      name: 'Vision Online Default',
      vendor: 'qwen-vl',
      usageType: 'chat',
      modelId: 'vision-online-default',
      apiUrl: '',
      supportsReasoning: true,
      supportsVision: true,
      requiredTier: 'plus',
    }
    : null;

  t.after(() => {
    serverConfigModule.getModelConfigAsync = originalGetModelConfigAsync;
    serverConfigModule.getDefaultModelConfigAsync = originalGetDefaultModelConfigAsync;
  });

  const { resolveModelAccessAsync } = await import('../lib/ai/ai-access');
  const result = await resolveModelAccessAsync(undefined, '', 'plus', false, { requireVision: true });

  assert.equal('error' in result, false);
  if ('error' in result) return;
  assert.equal(result.modelId, 'vision-online-default');
});
