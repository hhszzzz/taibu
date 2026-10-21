import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';

process.env.NEWAPI_API_KEY = process.env.NEWAPI_API_KEY || 'newapi-key';

function authorize(t: TestContext, db: ReturnType<typeof createMockScopedDb>) {
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const contextModule = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  t.mock.method(apiUtilsModule, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }));
  t.mock.method(contextModule, 'systemDb', () => db as unknown as ReturnType<typeof contextModule.systemDb>);
}

test('admin ai gateways GET should expose managed gateways with env key presence', async (t) => {
  const tables: string[] = [];
  const scoped = createMockScopedDb({
    tx: async (work) => work({
      selectFrom: (table: string) => {
        tables.push(table);
        const query = {
          select: () => query,
          orderBy: () => query,
          execute: async () => [
            {
              id: 'gateway-1', gateway_key: 'newapi', display_name: 'NewAPI', base_url: 'https://newapi.example/v1',
              api_key_env_var: 'NEWAPI_API_KEY', transport: 'openai_compatible', is_enabled: true, notes: null,
            },
            {
              id: 'gateway-2', gateway_key: 'octopus', display_name: 'Octopus', base_url: 'https://octopus.example/v1',
              api_key_env_var: 'OCTOPUS_API_KEY', transport: 'openai_compatible', is_enabled: false, notes: 'backup',
            },
          ],
        };
        return query;
      },
    } as never),
  });
  authorize(t, scoped);

  const { GET } = await import('../app/api/admin/ai-gateways/route');
  const response = await GET(new NextRequest('http://localhost/api/admin/ai-gateways'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(tables, ['ai_gateways']);
  assert.deepEqual(
    body.gateways.map((gateway: { gatewayKey: string; hasApiKey: boolean }) => ({
      gatewayKey: gateway.gatewayKey,
      hasApiKey: gateway.hasApiKey,
    })),
    [
      { gatewayKey: 'newapi', hasApiKey: true },
      { gatewayKey: 'octopus', hasApiKey: false },
    ],
  );
});

test('admin ai gateways PATCH should update managed gateway settings', async (t) => {
  let updatedPayload: Record<string, unknown> | null = null;
  const scoped = createMockScopedDb({
    tx: async (work) => work({
      updateTable: (table: string) => {
        assert.equal(table, 'ai_gateways');
        return {
          set: (payload: Record<string, unknown>) => {
            updatedPayload = payload;
            return {
              where: (column: string, _operator: string, value: unknown) => {
                assert.equal(column, 'id');
                assert.equal(value, 'gateway-1');
                return { returningAll: () => ({ executeTakeFirst: async () => ({ id: 'gateway-1' }) }) };
              },
            };
          },
        };
      },
    } as never),
  });
  authorize(t, scoped);

  const serverConfigModule = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
  let cacheCleared = false;
  t.mock.method(serverConfigModule, 'clearModelCache', () => { cacheCleared = true; });

  const { PATCH } = await import('../app/api/admin/ai-gateways/[id]/route');
  const request = new NextRequest('http://localhost/api/admin/ai-gateways/gateway-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'NewAPI Gateway',
      baseUrl: 'https://gateway.example/v1',
      apiKeyEnvVar: 'NEWAPI_API_KEY',
      isEnabled: true,
      notes: 'primary',
    }),
  });

  const response = await PATCH(request, { params: Promise.resolve({ id: 'gateway-1' }) });

  assert.equal(response.status, 200);
  assert.deepEqual(updatedPayload, {
    display_name: 'NewAPI Gateway',
    base_url: 'https://gateway.example/v1',
    api_key_env_var: 'NEWAPI_API_KEY',
    is_enabled: true,
    notes: 'primary',
  });
  assert.equal(cacheCleared, true);
});
