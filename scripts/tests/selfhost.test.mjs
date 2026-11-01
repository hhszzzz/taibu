import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
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

test('init on a fresh checkout creates the private state directory', async () => {
  // The script only runs as main under its real path, and macOS links the temp dir.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'taibu-selfhost-')));
  try {
    const script = path.join(root, 'scripts', 'selfhost.mjs');
    await mkdir(path.dirname(script));
    await copyFile(new URL('../selfhost.mjs', import.meta.url), script);
    await promisify(execFile)(process.execPath, [script, 'init', '--project', 'taibu-fresh']);
    const mode = async (relative) => (await stat(path.join(root, '.taibu-local', relative))).mode & 0o777;
    assert.equal(await mode('.'), 0o700);
    assert.equal(await mode('taibu-fresh'), 0o700);
    assert.equal(await mode('taibu-fresh/config.json'), 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
