import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfig, main, validateConfig } from '../selfhost.mjs';

test('local config retains credentials while ignoring unused fields from older configs', () => {
  const config = createConfig('taibu-v2');
  const stored = { ...config, obsolete: 'unused' };
  assert.deepEqual(validateConfig(stored), config);
  assert.equal(stored.obsolete, 'unused', 'validation does not rewrite the private file');
  assert.equal(config.APP_ORIGIN, 'http://127.0.0.1:3080');
  assert.ok(!Object.keys(config).some((key) => /DEMO|USER|ADMIN/.test(key)));
});

test('local config rejects missing credentials, unsafe values and mismatched origins', () => {
  const config = createConfig('taibu-v2');
  const missing = { ...config };
  delete missing.DB_PASSWORD;
  assert.throws(() => validateConfig(missing), /配置字段无效/);
  assert.throws(() => validateConfig({ ...config, DB_PASSWORD: 'short' }), /密钥格式无效/);
  assert.throws(() => validateConfig({ ...config, REDIS_PASSWORD: 'unsafe\nvalue' }), /配置值无效/);
  assert.throws(() => validateConfig({ ...config, APP_ORIGIN: 'https://other.example' }), /配置地址无效/);
});

test('retired demo options fail before any Docker or filesystem operation', async () => {
  await assert.rejects(main(['init', '--demo']), /参数无效/);
});
