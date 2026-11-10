import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import type { VersionInfo } from '../lib/version';

const request = () => new NextRequest('http://localhost/api/admin/system/update', { method: 'POST' });

function version(overrides: Partial<VersionInfo> = {}): VersionInfo {
  return {
    current: '1.2.0', latest: '1.2.1', needsUpdate: true, releaseUrl: 'https://example.test/v1.2.1',
    releaseName: 'v1.2.1', publishedAt: '2026-11-10T00:00:00.000Z', releaseNotes: null, ...overrides,
  };
}

function admin(t: import('node:test').TestContext) {
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  t.mock.method(api, 'requireAdminContext', async () => ({ user: { id: 'admin-1' } }) as unknown as Awaited<ReturnType<typeof api.requireAdminContext>>);
  return require('../lib/version.server') as typeof import('../lib/version.server');
}

test('an update waits for running work but not for paused questions', async (t) => {
  const versions = admin(t);
  t.mock.method(versions, 'getVersionInfo', async () => version());
  const tasks = require('../lib/agent/admin-tasks.server') as typeof import('../lib/agent/admin-tasks.server');
  const counted = t.mock.method(tasks, 'countBlockingAgentRuns', async () => 3);
  const { POST } = await import('../app/api/admin/system/update/route');

  const response = await POST(request());
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { success: false, error: '还有 3 个 Agent 任务正在运行，请等待完成后再更新', runs: 3 });
  assert.equal(counted.mock.callCount(), 1);
});

test('an update without a newer release does not read tasks', async (t) => {
  const versions = admin(t);
  t.mock.method(versions, 'getVersionInfo', async () => version({ latest: null, needsUpdate: false, releaseName: null, releaseUrl: null }));
  const tasks = require('../lib/agent/admin-tasks.server') as typeof import('../lib/agent/admin-tasks.server');
  let counted = 0;
  t.mock.method(tasks, 'countBlockingAgentRuns', async () => { counted += 1; return 1; });
  const { POST } = await import('../app/api/admin/system/update/route');

  const response = await POST(request());
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: '当前已是最新版本' });
  assert.equal(counted, 0);
});

test('non-administrators cannot trigger an update', async (t) => {
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  t.mock.method(api, 'requireAdminContext', async () => ({ error: { message: '无权限操作', status: 403 } }));
  const { POST } = await import('../app/api/admin/system/update/route');

  const response = await POST(request());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { success: false, error: '无权限操作' });
});
