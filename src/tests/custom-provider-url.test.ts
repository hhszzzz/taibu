import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCustomProviderChatCompletionsUrl,
  hasRedundantVersionSuffix,
  maskCustomProviderApiKey,
  normalizeCustomProviderBaseUrl,
  validateCustomProviderInput,
} from '../lib/ai/custom-provider-url';

test('custom provider input validation accepts normalized https endpoints', () => {
  const errors = validateCustomProviderInput({
    apiUrl: 'https://gateway.example.com/chat/completions',
    apiKey: 'sk-test',
    modelId: 'gpt-4.1-mini',
  });

  assert.deepEqual(errors, {});
  assert.equal(
    normalizeCustomProviderBaseUrl('https://gateway.example.com/chat/completions'),
    'https://gateway.example.com/v1',
  );
  assert.equal(
    normalizeCustomProviderBaseUrl('https://gateway.example.com/openai/chat/completions'),
    'https://gateway.example.com/openai/v1',
  );
  assert.equal(
    buildCustomProviderChatCompletionsUrl('https://gateway.example.com/openai/chat/completions'),
    'https://gateway.example.com/openai/v1/chat/completions',
  );
});

test('custom provider input validation rejects malformed or overlong fields', () => {
  const errors = validateCustomProviderInput({
    apiUrl: 'https://',
    apiKey: 'k'.repeat(513),
    modelId: 'm'.repeat(129),
  });

  assert.equal(errors.apiUrl, 'API URL 格式无效');
  assert.equal(errors.apiKey, 'API Key 过长');
  assert.equal(errors.modelId, '实际请求模型过长');
});

test('custom provider base url appends /v1 only when the path has no version segment', () => {
  // 普通域名：补 /v1，用户不需要自己写。
  assert.equal(
    normalizeCustomProviderBaseUrl('https://api.deepseek.com'),
    'https://api.deepseek.com/v1',
  );
  // 网关自带版本段：保持原样，不重复拼接。
  assert.equal(
    normalizeCustomProviderBaseUrl('https://open.bigmodel.cn/api/paas/v4'),
    'https://open.bigmodel.cn/api/paas/v4',
  );
  assert.equal(
    normalizeCustomProviderBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai'),
    'https://generativelanguage.googleapis.com/v1beta/openai',
  );
  // 用户手写了完整路径：回退到版本段本身。
  assert.equal(
    normalizeCustomProviderBaseUrl('https://api.deepseek.com/v1/chat/completions'),
    'https://api.deepseek.com/v1',
  );
  assert.equal(
    buildCustomProviderChatCompletionsUrl('https://api.deepseek.com'),
    'https://api.deepseek.com/v1/chat/completions',
  );
});

test('custom provider input validation rejects query strings and fragments', () => {
  const queryErrors = validateCustomProviderInput({
    apiUrl: 'https://gateway.example.com/v1?foo=1',
    apiKey: 'sk-test',
    modelId: 'gpt-4.1-mini',
  });
  const hashErrors = validateCustomProviderInput({
    apiUrl: 'https://gateway.example.com/v1#frag',
    apiKey: 'sk-test',
    modelId: 'gpt-4.1-mini',
  });

  assert.equal(queryErrors.apiUrl, 'API URL 不应包含查询参数或片段');
  assert.equal(hashErrors.apiUrl, 'API URL 不应包含查询参数或片段');
});

test('custom provider flags only the redundant version suffixes users should skip', () => {
  assert.equal(hasRedundantVersionSuffix('https://api.deepseek.com'), false);
  assert.equal(hasRedundantVersionSuffix('https://api.deepseek.com/v1'), true);
  assert.equal(hasRedundantVersionSuffix('https://api.deepseek.com/v1/'), true);
  assert.equal(hasRedundantVersionSuffix('https://api.deepseek.com/v1/chat/completions'), true);
  assert.equal(hasRedundantVersionSuffix('https://gateway.example.com/openai/chat/completions'), true);
  // 网关自带的必要版本段不是冗余，提示不应出现。
  assert.equal(hasRedundantVersionSuffix('https://open.bigmodel.cn/api/paas/v4'), false);
  assert.equal(hasRedundantVersionSuffix('https://generativelanguage.googleapis.com/v1beta/openai'), false);
  assert.equal(hasRedundantVersionSuffix('not a url'), false);
});

test('custom provider key mask keeps only a recognisable prefix and suffix', () => {  assert.equal(maskCustomProviderApiKey('sk-0123456789abcdef3f9a'), 'sk-••••••••3f9a');
  assert.equal(maskCustomProviderApiKey('  sk-0123456789abcdef3f9a  '), 'sk-••••••••3f9a');
  // 短 Key 露出首尾会泄露大半内容，完全遮住。
  assert.equal(maskCustomProviderApiKey('sk-123456'), '••••••••');
  assert.equal(maskCustomProviderApiKey('sk-1234567'), '••••••••');
  assert.equal(maskCustomProviderApiKey(''), '••••••••');
  assert.equal(maskCustomProviderApiKey(null), '••••••••');
  assert.equal(maskCustomProviderApiKey(undefined), '••••••••');
});
