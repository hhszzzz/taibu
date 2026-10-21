import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';

type AnnouncementRow = {
  id: string;
  content: string;
  published_at: string;
  created_at: string;
  updated_at: string;
};

type InsertedAnnouncementPayload = { content: string; published_at: string };
type UpdatedAnnouncementPayload = { content: string };

type AnnouncementStore = {
  list?: () => AnnouncementRow[];
  select?: (id: string) => AnnouncementRow | undefined;
  insert?: (values: InsertedAnnouncementPayload) => AnnouncementRow;
  update?: (set: UpdatedAnnouncementPayload, id: string) => AnnouncementRow | undefined;
  remove?: (id: string) => void;
};

const row = (overrides: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id: 'announcement-1',
  content: '旧内容',
  published_at: '2026-03-28T10:00:00.000Z',
  created_at: '2026-03-28T10:00:00.000Z',
  updated_at: '2026-03-28T10:00:00.000Z',
  ...overrides,
});

/** Kysely double with only the chains the announcements routes use; every predicate is asserted. */
function announcementDb(store: AnnouncementStore) {
  const state: { id?: string; values?: unknown; set?: unknown } = {};
  const selectQuery = {
    selectAll: () => selectQuery,
    where: (column: string, operator: string, value: unknown) => {
      assert.equal(column, 'id');
      assert.equal(operator, '=');
      state.id = value as string;
      return selectQuery;
    },
    orderBy: () => selectQuery,
    execute: async () => store.list?.() ?? [],
    executeTakeFirst: async () => store.select?.(state.id!),
  };
  return createMockScopedDb({
    tx: async (work) => work({
      selectFrom: (table: string) => {
        assert.equal(table, 'announcements');
        return selectQuery;
      },
      insertInto: (table: string) => {
        assert.equal(table, 'announcements');
        return {
          values: (values: unknown) => {
            state.values = values;
            return {
              returningAll: () => ({ executeTakeFirstOrThrow: async () => {
                assert.ok(store.insert, 'insert must not run in this test');
                return store.insert!(state.values as InsertedAnnouncementPayload);
              } }),
            };
          },
        };
      },
      updateTable: (table: string) => {
        assert.equal(table, 'announcements');
        return {
          set: (set: unknown) => {
            state.set = set;
            return {
              where: (column: string, _operator: string, value: unknown) => {
                assert.equal(column, 'id');
                state.id = value as string;
                return {
                  returningAll: () => ({ executeTakeFirst: async () => store.update?.(state.set as UpdatedAnnouncementPayload, state.id!) }),
                };
              },
            };
          },
        };
      },
      deleteFrom: (table: string) => {
        assert.equal(table, 'announcements');
        return {
          where: (column: string, _operator: string, value: unknown) => {
            assert.equal(column, 'id');
            state.id = value as string;
            return { execute: async () => { store.remove?.(state.id!); } };
          },
        };
      },
    } as never),
  });
}

function authorize(t: TestContext, db: ReturnType<typeof announcementDb>) {
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const contextModule = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  t.mock.method(apiUtilsModule, 'requireAdminContext', async () => ({ user: { id: 'admin-1' } }));
  t.mock.method(contextModule, 'systemDb', () => db as unknown as ReturnType<typeof contextModule.systemDb>);
}

test('admin announcements POST should create a published announcement with content only', async (t) => {
  let insertedPayload: InsertedAnnouncementPayload | null = null;
  const db = announcementDb({
    insert: (values) => { insertedPayload = values; return row({ id: 'announcement-1', ...values }); },
  });
  authorize(t, db);

  const { POST } = await import('../app/api/admin/announcements/route');
  const request = new NextRequest('http://localhost/api/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '今晚 23:00 到 23:30 进行短时维护' }),
  });

  const response = await POST(request);
  const payload = await response.json();

  assert.equal(response.status, 200);
  if (!insertedPayload) throw new Error('expected insertedPayload to be captured');
  const createdPayload: InsertedAnnouncementPayload = insertedPayload;
  assert.equal(createdPayload.content, '今晚 23:00 到 23:30 进行短时维护');
  assert.equal(typeof createdPayload.published_at, 'string');
  assert.equal(payload.announcement.id, 'announcement-1');
});

test('admin announcements POST should reject empty content', async (t) => {
  const db = announcementDb({});
  authorize(t, db);

  const { POST } = await import('../app/api/admin/announcements/route');
  const request = new NextRequest('http://localhost/api/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '   ' }),
  });

  const response = await POST(request);
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, '公告内容不能为空');
});

test('admin announcements PATCH should update content without changing published_at', async (t) => {
  let updatedPayload: UpdatedAnnouncementPayload | null = null;
  const db = announcementDb({
    select: () => row(),
    update: (set) => { updatedPayload = set; return row({ content: set.content, updated_at: '2026-03-28T12:00:00.000Z' }); },
  });
  authorize(t, db);

  const { PATCH } = await import('../app/api/admin/announcements/[id]/route');
  const request = new NextRequest('http://localhost/api/admin/announcements/announcement-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '更新后的公告内容' }),
  });

  const response = await PATCH(request, { params: Promise.resolve({ id: 'announcement-1' }) });
  const payload = await response.json();

  assert.equal(response.status, 200);
  if (!updatedPayload) throw new Error('expected updatedPayload to be captured');
  const patchedPayload: UpdatedAnnouncementPayload = updatedPayload;
  assert.equal(patchedPayload.content, '更新后的公告内容');
  assert.equal(payload.announcement.publishedAt, '2026-03-28T10:00:00.000Z');
});

test('admin announcements PATCH should return 404 when announcement does not exist', async (t) => {
  const db = announcementDb({ select: () => undefined });
  authorize(t, db);

  const { PATCH } = await import('../app/api/admin/announcements/[id]/route');
  const response = await PATCH(new NextRequest('http://localhost/api/admin/announcements/missing', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '新内容' }),
  }), { params: Promise.resolve({ id: 'missing' }) });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error, '公告不存在');
});

test('admin announcements DELETE should delete the target announcement', async (t) => {
  let deletedId: string | null = null;
  const db = announcementDb({ select: () => row(), remove: (id) => { deletedId = id; } });
  authorize(t, db);

  const { DELETE } = await import('../app/api/admin/announcements/[id]/route');
  const response = await DELETE(
    new NextRequest('http://localhost/api/admin/announcements/announcement-1', { method: 'DELETE' }),
    { params: Promise.resolve({ id: 'announcement-1' }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(deletedId, 'announcement-1');
});

test('admin announcements DELETE should return 404 when announcement does not exist', async (t) => {
  const db = announcementDb({ select: () => undefined });
  authorize(t, db);

  const { DELETE } = await import('../app/api/admin/announcements/[id]/route');
  const response = await DELETE(
    new NextRequest('http://localhost/api/admin/announcements/missing', { method: 'DELETE' }),
    { params: Promise.resolve({ id: 'missing' }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error, '公告不存在');
});
