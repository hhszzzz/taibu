import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';


test('announcements GET should return history ordered by published_at desc', async (t) => {
  const contextModule = require('../lib/db/context.server') as any;
  const originalSystemDb = contextModule.systemDb;

  contextModule.systemDb = () => createMockScopedDb({
    tx: async () => [
      {
        id: 'announcement-2',
        content: '较新的公告',
        published_at: '2026-03-28T10:00:00.000Z',
        created_at: '2026-03-28T10:00:00.000Z',
        updated_at: '2026-03-28T10:00:00.000Z',
      },
      {
        id: 'announcement-1',
        content: '较早的公告',
        published_at: '2026-03-27T10:00:00.000Z',
        created_at: '2026-03-27T10:00:00.000Z',
        updated_at: '2026-03-27T10:00:00.000Z',
      },
      {
        id: 'announcement-0',
        content: '下一页公告',
        published_at: '2026-03-26T10:00:00.000Z',
        created_at: '2026-03-26T10:00:00.000Z',
        updated_at: '2026-03-26T10:00:00.000Z',
      },
    ],
  });

  t.after(() => {
    contextModule.systemDb = originalSystemDb;
  });

  const { GET } = await import('../app/api/announcements/route');
  const response = await GET(new NextRequest('http://localhost/api/announcements?limit=2'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    payload.announcements.map((item: { id: string }) => item.id),
    ['announcement-2', 'announcement-1'],
  );
  assert.deepEqual(payload.pagination, {
    hasMore: true,
    nextOffset: 2,
  });
});

test('announcements GET latest should return the newest announcement only', async (t) => {
  const contextModule = require('../lib/db/context.server') as any;
  const originalSystemDb = contextModule.systemDb;

  contextModule.systemDb = () => createMockScopedDb({
    tx: async () => ({
      id: 'announcement-2',
      content: '最新公告',
      published_at: '2026-03-28T10:00:00.000Z',
      created_at: '2026-03-28T10:00:00.000Z',
      updated_at: '2026-03-28T10:00:00.000Z',
    }),
  });

  t.after(() => {
    contextModule.systemDb = originalSystemDb;
  });

  const { GET } = await import('../app/api/announcements/route');
  const response = await GET(new NextRequest('http://localhost/api/announcements?latest=1'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.announcement.id, 'announcement-2');
});

test('announcements GET count should return total announcement count', async (t) => {
  const contextModule = require('../lib/db/context.server') as any;
  const originalSystemDb = contextModule.systemDb;

  contextModule.systemDb = () => createMockScopedDb({
    tx: async () => Array.from({ length: 4 }, (_, index) => ({ id: `announcement-${index}` })),
  });
  // 共享缓存沿用前两个用例的内存值；本用例需要从新 stub 重新加载。
  await (await import('../lib/announcements.server')).invalidateAnnouncementCache();

  t.after(() => {
    contextModule.systemDb = originalSystemDb;
  });

  const { GET } = await import('../app/api/announcements/route');
  const response = await GET(new NextRequest('http://localhost/api/announcements?count=1'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.count, 4);
});
