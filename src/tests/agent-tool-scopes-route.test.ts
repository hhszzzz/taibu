import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

test('Agent tool scopes GET is administrator-only and returns persisted states', async t => {
  const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  t.mock.method(apiUtils, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }));
  t.mock.method(settings, 'getAgentToolScopes', async () => ({ bazi: true, web: false }));

  const { GET } = await import('../app/api/agent-tool-scopes/route');
  const response = await GET(new NextRequest('http://localhost/api/agent-tool-scopes'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.scopes, { bazi: true, web: false });
});

test('Agent tool scopes POST validates scope ids and persists a valid update', async t => {
  const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  t.mock.method(apiUtils, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }));
  const updates: unknown[] = [];
  t.mock.method(settings, 'setAgentToolScope', async (...args: unknown[]) => {
    updates.push(args);
    return true;
  });

  const { POST } = await import('../app/api/agent-tool-scopes/route');
  const invalid = await POST(new NextRequest('http://localhost/api/agent-tool-scopes', {
    method: 'POST', body: JSON.stringify({ scopeId: 'unknown', disabled: true }),
  }));
  assert.equal(invalid.status, 400);
  assert.equal(updates.length, 0);

  const valid = await POST(new NextRequest('http://localhost/api/agent-tool-scopes', {
    method: 'POST', body: JSON.stringify({ scopeId: 'bazi', disabled: true }),
  }));
  assert.equal(valid.status, 200);
  assert.deepEqual(updates, [['bazi', true]]);
});

test('Agent tool scope reads reject non-admin callers', async t => {
  const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
  t.mock.method(apiUtils, 'requireAdminUser', async () => ({ error: { message: '需要管理员权限', status: 403 } }));

  const { GET } = await import('../app/api/agent-tool-scopes/route');
  const response = await GET(new NextRequest('http://localhost/api/agent-tool-scopes'));
  assert.equal(response.status, 403);
});
