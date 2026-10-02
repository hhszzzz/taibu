import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { DirectAnalysisFlowOptions } from '../lib/ai/direct-analysis-client';

type MutableModule = Record<string, unknown>;

function setupAnalysisRunnerMocks(t: TestContext) {
  const directClientModule = require('../lib/ai/direct-analysis-client') as MutableModule;
  const customProviderModule = require('../lib/chat/custom-provider') as MutableModule;

  const originals = {
    runDirectAnalysisFlow: directClientModule.runDirectAnalysisFlow,
    getCustomProvider: customProviderModule.getCustomProvider,
  };

  const runnerPath = require.resolve('../lib/ai/analysis-runner');
  delete require.cache[runnerPath];

  t.after(() => {
    directClientModule.runDirectAnalysisFlow = originals.runDirectAnalysisFlow;
    customProviderModule.getCustomProvider = originals.getCustomProvider;
    delete require.cache[runnerPath];
  });

  return {
    directClientModule,
    customProviderModule,
    loadRunner: () => {
      delete require.cache[runnerPath];
      return require('../lib/ai/analysis-runner') as typeof import('../lib/ai/analysis-runner');
    },
  };
}

test('analysis runner should stream through same-origin endpoint when no custom provider is configured', async (t) => {
  const { customProviderModule, loadRunner } = setupAnalysisRunnerMocks(t);
  customProviderModule.getCustomProvider = () => null;

  const calls: Array<{ url: string; options: RequestInit }> = [];
  const streaming = {
    startStream: async (url: string, options: RequestInit) => {
      calls.push({ url, options });
      return {
        content: 'stream-analysis',
        reasoning: 'stream-reasoning',
      };
    },
    startDirectStream: async () => null,
  };

  const { runSharedAnalysisFlow } = loadRunner();
  const result = await runSharedAnalysisFlow({
    endpoint: '/api/qimen',
    streaming,
    isCreditsError: (error) => error === 'NO_CREDITS',
    streamBody: { action: 'interpret', stream: true },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, '/api/qimen');
  assert.equal(calls[0]?.options.method, 'POST');
  assert.deepEqual(calls[0]?.options.headers, { 'Content-Type': 'application/json' });
  assert.equal(calls[0]?.options.body, JSON.stringify({ action: 'interpret', stream: true }));
  assert.deepEqual(result, {
    content: 'stream-analysis',
    reasoning: 'stream-reasoning',
    conversationId: null,
    error: null,
    requiresCredits: false,
  });
});

test('analysis runner should convert credit errors into requiresCredits on stream path', async (t) => {
  const { customProviderModule, loadRunner } = setupAnalysisRunnerMocks(t);
  customProviderModule.getCustomProvider = () => null;

  const streaming = {
    startStream: async () => ({
      content: '',
      reasoning: null,
      error: 'NO_CREDITS',
    }),
    startDirectStream: async () => null,
  };

  const { runSharedAnalysisFlow } = loadRunner();
  const result = await runSharedAnalysisFlow({
    endpoint: '/api/tarot',
    streaming,
    isCreditsError: (error) => error === 'NO_CREDITS',
    streamBody: { action: 'interpret', stream: true },
  });

  assert.deepEqual(result, {
    content: null,
    reasoning: null,
    conversationId: null,
    error: null,
    requiresCredits: true,
  });
});

test('analysis runner should use direct analysis flow when a custom provider is configured', async (t) => {
  const { directClientModule, customProviderModule, loadRunner } = setupAnalysisRunnerMocks(t);
  customProviderModule.getCustomProvider = () => ({
    apiUrl: 'https://provider.example',
    apiKey: 'secret',
    modelId: 'custom-model',
  });

  const capture: { directCall: DirectAnalysisFlowOptions | null } = { directCall: null };
  directClientModule.runDirectAnalysisFlow = async (options: DirectAnalysisFlowOptions) => {
    capture.directCall = options;
    return {
      content: 'direct-analysis',
      reasoning: 'direct-reasoning',
      conversationId: 'conv-1',
      error: undefined,
    };
  };

  const streaming = {
    startStream: async () => {
      throw new Error('stream path should not run');
    },
    startDirectStream: async () => null,
  };

  const { runSharedAnalysisFlow } = loadRunner();
  const result = await runSharedAnalysisFlow({
    endpoint: '/api/mbti',
    streaming,
    isCreditsError: (error) => error === 'NO_CREDITS',
    direct: {
      prepareBody: { action: 'analyze_prepare', type: 'INTJ' },
      persistBody: { action: 'analyze_persist', type: 'INTJ' },
    },
    streamBody: { action: 'analyze', type: 'INTJ', stream: true },
  });

  assert.ok(capture.directCall, 'runDirectAnalysisFlow should be called');
  assert.equal(capture.directCall.endpoint, '/api/mbti');
  assert.deepEqual(capture.directCall.prepareBody, { action: 'analyze_prepare', type: 'INTJ' });
  assert.deepEqual(capture.directCall.persistBody, { action: 'analyze_persist', type: 'INTJ' });
  assert.deepEqual(result, {
    content: 'direct-analysis',
    reasoning: 'direct-reasoning',
    conversationId: 'conv-1',
    error: null,
    requiresCredits: false,
  });
});
