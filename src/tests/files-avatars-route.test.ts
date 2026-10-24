import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';


import { createMockScopedDb } from './helpers/db-mock';
import { createLocalObjectStore } from '../lib/storage/local-fs.server';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function scopedFor(options: {
  avatarUrl?: string | null;
  onUpdate?: (payload: Record<string, unknown>) => void;
} = {}) {
  return createMockScopedDb({
    tx: async (work) => work({
      selectFrom() {
        const query = {
          select() { return query; },
          where() { return query; },
          async executeTakeFirst() {
            return { avatar_url: options.avatarUrl ?? null };
          },
        };
        return query;
      },
      updateTable() {
        return {
          set(payload: Record<string, unknown>) {
            options.onUpdate?.(payload);
            return {
              where() {
                return {
                  returning() {
                    return { async executeTakeFirst() { return { id: 'user-1' }; } };
                  },
                };
              },
            };
          },
        };
      },
      insertInto() {
        return {
          values() {
            return { onConflict: () => ({ execute: async () => undefined }) };
          },
        };
      },
    } as never),
  });
}

async function setup(t: import('node:test').TestContext, scoped = scopedFor()) {
  const root = await mkdtemp(path.join(tmpdir(), 'taibu-avatars-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  process.env.FILE_STORAGE_DRIVER = 'local';
  process.env.FILE_STORAGE_ROOT = root;

  const apiUtilsModule = require('../lib/api-utils') as any;
  const user = { id: 'user-1', user_metadata: {} };
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  apiUtilsModule.requireUserContext = async () => ({ user, accessToken: null, authError: null, db: scoped });
  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
  });

  const route = require('../app/api/files/avatars/route') as typeof import('../app/api/files/avatars/route');
  const keyRoute = require('../app/api/files/avatars/[key]/route') as typeof import('../app/api/files/avatars/[key]/route');
  return { root, route, keyRoute, store: createLocalObjectStore(root), user };
}

function uploadRequest(file: File | Blob | null): NextRequest {
  const body = new FormData();
  if (file) body.set('file', file);
  return new NextRequest('http://localhost/api/files/avatars', { method: 'POST', body });
}

test('avatar upload stores a magic-checked image, updates the row and removes the previous file', async (t) => {
  const previousKey = 'user-1-1.png';
  const updates: Array<Record<string, unknown>> = [];
  const scoped = scopedFor({
    avatarUrl: `/api/files/avatars/${previousKey}`,
    onUpdate: (payload) => { updates.push(payload); },
  });
  const { root, route } = await setup(t, scoped);
  await mkdir(path.join(root, 'avatars'), { recursive: true });
  await writeFile(path.join(root, 'avatars', previousKey), new Uint8Array([1, 2, 3]));

  const file = new File([Buffer.from(PNG_BASE64, 'base64')], 'avatar.png', { type: 'image/png' });
  const response = await route.POST(uploadRequest(file));
  const payload = await response.json();

  assert.equal(response.status, 200);
  const publicUrl = payload.data.publicUrl as string;
  assert.match(publicUrl, /^\/api\/files\/avatars\/user-1-\d+\.png$/u);
  const key = publicUrl.slice('/api/files/avatars/'.length);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.avatar_url, publicUrl);
  assert.equal(typeof updates[0]?.updated_at, 'string');

  const saved = await stat(path.join(root, 'avatars', key));
  assert.equal(saved.isFile(), true);
  await assert.rejects(stat(path.join(root, 'avatars', previousKey)));
});

test('avatar upload never deletes another user’s file referenced by an editable profile URL', async (t) => {
  const previousKey = 'user-2-1.png';
  const { root, route } = await setup(t, scopedFor({ avatarUrl: `/api/files/avatars/${previousKey}` }));
  await mkdir(path.join(root, 'avatars'), { recursive: true });
  await writeFile(path.join(root, 'avatars', previousKey), new Uint8Array([1, 2, 3]));
  const response = await route.POST(uploadRequest(
    new File([Buffer.from(PNG_BASE64, 'base64')], 'avatar.png', { type: 'image/png' }),
  ));
  assert.equal(response.status, 200);
  assert.equal((await stat(path.join(root, 'avatars', previousKey))).isFile(), true);
});

test('avatar upload rejects anonymous callers', async (t) => {
  const { route } = await setup(t);
  const apiUtilsModule = require('../lib/api-utils') as any;
  apiUtilsModule.requireUserContext = async () => ({ error: { message: '请先登录', status: 401 } });

  const unauthorized = await route.POST(uploadRequest(
    new File([Buffer.from(PNG_BASE64, 'base64')], 'a.png', { type: 'image/png' }),
  ));
  assert.equal(unauthorized.status, 401);
});

test('avatar upload enforces size and magic-number checks', async (t) => {
  const { route } = await setup(t);
  const oversized = await route.POST(uploadRequest(
    new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
  ));
  assert.equal(oversized.status, 413);

  const svg = await route.POST(uploadRequest(
    new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'avatar.svg', { type: 'image/svg+xml' }),
  ));
  assert.equal(svg.status, 415);
  assert.match((await svg.json()).error, /PNG/u);

  const fakePng = await route.POST(uploadRequest(
    new File(['not really a png'], 'fake.png', { type: 'image/png' }),
  ));
  assert.equal(fakePng.status, 415);
});

test('avatar files are served with immutable cache headers and reject traversal keys', async (t) => {
  const { keyRoute, store } = await setup(t);
  const bytes = Buffer.from(PNG_BASE64, 'base64');
  await store.put('avatars', 'user-1-42.png', new Uint8Array(bytes));

  const response = await keyRoute.GET(
    new NextRequest('http://localhost/api/files/avatars/user-1-42.png'),
    { params: Promise.resolve({ key: 'user-1-42.png' }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('content-length'), String(bytes.byteLength));
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(bytes));

  const missing = await keyRoute.GET(
    new NextRequest('http://localhost/api/files/avatars/missing.png'),
    { params: Promise.resolve({ key: 'missing.png' }) },
  );
  assert.equal(missing.status, 404);

  for (const key of ['..', 'a/b', '%2e%2e']) {
    const rejected = await keyRoute.GET(
      new NextRequest('http://localhost/api/files/avatars/x'),
      { params: Promise.resolve({ key }) },
    );
    assert.equal(rejected.status, 404, `expected ${key} to be rejected`);
  }
});
