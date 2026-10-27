import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';


import { createMockScopedDb } from './helpers/db-mock';

function mockUserContext(t: { after: (fn: () => void) => void }, scoped: ReturnType<typeof createMockScopedDb>) {
  const apiUtils = require('../lib/api-utils') as any;
  const original = apiUtils.requireUserContext;
  apiUtils.requireUserContext = async () => ({ user: { id: 'user-1' }, db: scoped });
  t.after(() => {
    apiUtils.requireUserContext = original;
  });
}

test('notifications GET should use a count query for unread badge requests', async (t) => {
  const whereCalls: Array<{ column: string; value: unknown }> = [];
  const query = {
    where(column: string, _operator: string, value: unknown) {
      whereCalls.push({ column, value });
      return query;
    },
    orderBy() {
      throw new Error('count query should not sort notifications');
    },
    limit() {
      throw new Error('count query should not apply list limit');
    },
    executeTakeFirstOrThrow: async () => ({ count: 5 }),
  };
  mockUserContext(t, createMockScopedDb({
    tx: async (work) => work({
      selectFrom: () => ({ select: () => query }),
    } as never),
  }));

  const { GET } = await import('../app/api/notifications/route');
  const response = await GET(new NextRequest('http://localhost/api/notifications?count=1&unread=1'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.count, 5);
  // 任务完成/失败的通知不进通知中心：默认按 event_key 排除 agent:*（第三个 where 是那个回调）。
  assert.deepEqual(whereCalls.map((item) => typeof item.column === 'function' ? 'agent-filter' : item.column), ['user_id', 'created_at', 'agent-filter', 'is_read']);
  assert.equal(whereCalls[0]?.value, 'user-1');
  assert.equal(whereCalls[3]?.value, false);
  assert.equal(typeof whereCalls[1]?.value, 'string');
});

test('notifications GET should not prune expired rows for unread badge requests', async (t) => {
  const notificationServer = require('../lib/notification-server') as {
    pruneExpiredNotifications: typeof import('../lib/notification-server').pruneExpiredNotifications;
  };
  const originalPruneExpiredNotifications = notificationServer.pruneExpiredNotifications;

  let pruneCalled = false;
  notificationServer.pruneExpiredNotifications = (async () => {
    pruneCalled = true;
    return 0;
  }) as typeof notificationServer.pruneExpiredNotifications;
  t.after(() => {
    notificationServer.pruneExpiredNotifications = originalPruneExpiredNotifications;
  });

  const query = {
    where() { return query; },
    executeTakeFirstOrThrow: async () => ({ count: 2 }),
  };
  mockUserContext(t, createMockScopedDb({
    tx: async (work) => work({ selectFrom: () => ({ select: () => query }) } as never),
  }));

  const { GET } = await import('../app/api/notifications/route');
  const response = await GET(new NextRequest('http://localhost/api/notifications?count=1&unread=1'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.count, 2);
  assert.equal(pruneCalled, false);
});

test('notifications GET list should filter notifications to the most recent 3 days', async (t) => {
  const whereCalls: Array<{ column: string; value: unknown }> = [];
  const query = {
    where(column: string, _operator: string, value: unknown) {
      whereCalls.push({ column, value });
      return query;
    },
    orderBy() { return query; },
    offset() { return query; },
    limit() { return query; },
    execute: async () => [
      {
        id: 'notification-1',
        user_id: 'user-1',
        type: 'system',
        title: '标题',
        content: '内容',
        is_read: false,
        link: null,
        created_at: '2026-03-28T00:00:00.000Z',
      },
      {
        id: 'notification-2',
        user_id: 'user-1',
        type: 'system',
        title: '标题2',
        content: '内容2',
        is_read: true,
        link: null,
        created_at: '2026-03-27T00:00:00.000Z',
      },
      {
        id: 'notification-3',
        user_id: 'user-1',
        type: 'system',
        title: '标题3',
        content: '内容3',
        is_read: true,
        link: null,
        created_at: '2026-03-26T00:00:00.000Z',
      },
    ],
  };
  mockUserContext(t, createMockScopedDb({
    tx: async (work) => work({ selectFrom: () => ({ selectAll: () => query }) } as never),
  }));

  const { GET } = await import('../app/api/notifications/route');
  const response = await GET(new NextRequest('http://localhost/api/notifications?limit=2'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.notifications.map((item: { id: string }) => item.id), ['notification-1', 'notification-2']);
  assert.deepEqual(payload.pagination, {
    hasMore: true,
    nextOffset: 2,
  });
  const cutoff = whereCalls.find((item) => item.column === 'created_at');
  assert.ok(cutoff);
  assert.equal(typeof cutoff.value, 'string');
  const cutoffMs = Date.parse(cutoff.value as string);
  assert.ok(Math.abs(Date.now() - cutoffMs - 3 * 24 * 60 * 60 * 1000) < 60_000);
});

test('notifications PATCH should not prune before mark-one updates', async (t) => {
  const notificationServer = require('../lib/notification-server') as {
    pruneExpiredNotifications: typeof import('../lib/notification-server').pruneExpiredNotifications;
  };
  const originalPruneExpiredNotifications = notificationServer.pruneExpiredNotifications;

  let pruneCalled = false;
  let updatedId: string | null = null;
  let updatedPayload: Record<string, unknown> | null = null;
  notificationServer.pruneExpiredNotifications = (async () => {
    pruneCalled = true;
    return 0;
  }) as typeof notificationServer.pruneExpiredNotifications;
  t.after(() => {
    notificationServer.pruneExpiredNotifications = originalPruneExpiredNotifications;
  });

  mockUserContext(t, createMockScopedDb({
    tx: async (work) => work({
      updateTable: () => ({
        set: (payload: Record<string, unknown>) => {
          updatedPayload = payload;
          const query = {
            where: (column: string, _operator: string, value: unknown) => {
              if (column === 'id') updatedId = value as string;
              return query;
            },
            execute: async () => undefined,
          };
          return query;
        },
      }),
    } as never),
  }));

  const { PATCH } = await import('../app/api/notifications/route');
  const response = await PATCH(new NextRequest('http://localhost/api/notifications', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'mark-one', id: 'notification-1' }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { success: true });
  assert.deepEqual(updatedPayload, { is_read: true });
  assert.equal(updatedId, 'notification-1');
  assert.equal(pruneCalled, false);
});

test('notifications DELETE should not prune before deleting selected ids', async (t) => {
  const notificationServer = require('../lib/notification-server') as {
    pruneExpiredNotifications: typeof import('../lib/notification-server').pruneExpiredNotifications;
  };
  const originalPruneExpiredNotifications = notificationServer.pruneExpiredNotifications;

  let pruneCalled = false;
  let deletedIds: string[] | null = null;
  notificationServer.pruneExpiredNotifications = (async () => {
    pruneCalled = true;
    return 0;
  }) as typeof notificationServer.pruneExpiredNotifications;
  t.after(() => {
    notificationServer.pruneExpiredNotifications = originalPruneExpiredNotifications;
  });

  mockUserContext(t, createMockScopedDb({
    tx: async (work) => work({
      deleteFrom: () => ({
        where: (column: string, _operator: string, value: unknown) => {
          if (column === 'id') deletedIds = value as string[];
          const query = { where: () => query, execute: async () => undefined };
          return query;
        },
      }),
    } as never),
  }));

  const { DELETE } = await import('../app/api/notifications/route');
  const response = await DELETE(new NextRequest('http://localhost/api/notifications?id=notification-1&id=notification-2', {
    method: 'DELETE',
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { success: true });
  assert.deepEqual(deletedIds, ['notification-1', 'notification-2']);
  assert.equal(pruneCalled, false);
});

test('getUnreadCount should read count from top-level response', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ count: 7 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }) as Response;

  try {
    const { getUnreadCount } = await import('../lib/notification');
    const count = await getUnreadCount();
    assert.equal(count, 7);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getUnreadCount should throw when unread count request fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: '获取通知失败' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  }) as Response;

  try {
    const { getUnreadCount } = await import('../lib/notification');
    await assert.rejects(
      () => getUnreadCount(),
      /获取通知失败/u,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('unread query should not rely on a cold bootstrap zero as fresh initial data', async () => {
  const originalFetch = global.fetch;
  let fetchCount = 0;

  global.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ count: 3 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }) as Response;
  };

  try {
    const { getUnreadCount } = await import('../lib/notification');
    const count = await getUnreadCount();
    assert.equal(count, 3);
    assert.equal(fetchCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getNotificationsPage should throw when notifications request fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: '获取通知列表失败' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  }) as Response;

  try {
    const { getNotificationsPage } = await import('../lib/notification');
    await assert.rejects(
      () => getNotificationsPage({ limit: 20, offset: 0 }),
      /获取通知列表失败/u,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
