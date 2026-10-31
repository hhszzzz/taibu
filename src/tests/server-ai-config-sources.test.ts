import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';
import { sealedGateway } from './helpers/gateway-key';

test('server ai-config orders enabled sources with the active source first and carries only sealed keys', async (t) => {
  const context = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  const serverConfigPath = require.resolve('../lib/server/ai-config');
  delete require.cache[serverConfigPath];
  const originalSystemDb = context.systemDb;

  const models = [{
    id: 'model-1',
    model_key: 'deepseek-v3.2',
    display_name: 'DeepSeek V3.2',
    vendor: 'deepseek',
    usage_type: 'chat',
    is_reasoning_default: false,
    supports_vision: false,
    default_max_tokens: 4000,
    default_reasoning_effort: null,
    thinking_levels: ['max', 'high', 'unknown'],
    context_window: 1_000_000,
    custom_parameters: null,
    required_tier: 'free',
  }];
  const octopus = sealedGateway('gateway-octopus', 'octopus-key');
  const newapi = sealedGateway('gateway-newapi', 'newapi-key');
  const bindings = [
    {
      id: 'binding-2', model_id: 'model-1', model_id_override: 'deepseek-v3.2',
      is_enabled: true, priority: 2,
      gateway_key: 'octopus', display_name: 'Octopus', base_url: 'https://octopus.example/v1',
      gateway_id: octopus.gatewayId, api_key_secret: octopus.apiKeySecret, gateway_enabled: true,
    },
    {
      id: 'binding-1', model_id: 'model-1', model_id_override: 'deepseek-v3.2',
      is_enabled: true, priority: 1,
      gateway_key: 'newapi', display_name: 'NewAPI', base_url: 'https://newapi.example/v1',
      gateway_id: newapi.gatewayId, api_key_secret: newapi.apiKeySecret, gateway_enabled: true,
    },
  ];
  const chain = (rows: () => unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'where', 'orderBy', 'innerJoin']) {
      builder[method] = () => builder;
    }
    builder.execute = async () => rows();
    return builder;
  };
  const tx = {
    selectFrom: (table: string) => chain(() => (table === 'ai_models' ? models : bindings)),
  };

  // The real implementation receives a callback; run it against the query double.
  context.systemDb = (() => createMockScopedDb({
    tx: (work) => work(tx as never),
  })) as unknown as typeof context.systemDb;

  t.after(() => {
    context.systemDb = originalSystemDb;
    delete require.cache[serverConfigPath];
  });

  const serverConfig = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
  serverConfig.clearModelCache();

  const model = await serverConfig.getModelConfigAsync('deepseek-v3.2');
  assert.ok(model, 'model should be resolved');
  assert.equal(model?.sourceKey, 'newapi');
  assert.equal(model?.apiUrl, 'https://newapi.example/v1/chat/completions');
  assert.equal(model?.usageType, 'chat');
  assert.deepEqual(
    model?.sources?.map((source) => source.sourceKey),
    ['newapi', 'octopus'],
  );
  assert.equal(model?.gatewayId, 'gateway-newapi');
  assert.deepEqual(model?.apiKeySecret, newapi.apiKeySecret);
  assert.doesNotMatch(JSON.stringify(model), /newapi-key|octopus-key/u, 'the cached config holds ciphertext only');
  assert.deepEqual([model?.supportsReasoning, model?.thinkingLevels, model?.contextWindow, model?.defaultMaxTokens],
    [true, ['high', 'max'], 1_000_000, 4000]);
});
