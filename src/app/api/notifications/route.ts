import { type NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { getNotificationRetentionCutoffIso } from '@/lib/notification-server';
import { requireFeatureUserContext } from '@/lib/feature-gate-utils';

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export async function GET(request: NextRequest) {
  const auth = await requireFeatureUserContext(request, 'notifications', '通知功能当前未启用');
  if ('response' in auth) return auth.response;

  const unreadOnly = request.nextUrl.searchParams.get('unread') === '1';
  // 任务完成/失败的通知只用来弹右下角 Toast；通知中心默认不列，只有通知桥自己带 agent=1 才读。
  const includeAgent = request.nextUrl.searchParams.get('agent') === '1';
  const countOnly = request.nextUrl.searchParams.get('count') === '1';
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 20), 1), 100);
  const offset = Math.max(Number(request.nextUrl.searchParams.get('offset') || 0), 0);
  const cutoffIso = getNotificationRetentionCutoffIso();

  if (countOnly) {
    const result = await auth.db.tx(async (trx) => {
      let query = trx
        .selectFrom('notifications')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('user_id', '=', auth.user.id)
        .where('created_at', '>=', cutoffIso);
      if (!includeAgent) {
        query = query.where((eb) => eb.or([eb('event_key', 'is', null), eb('event_key', 'not like', 'agent:%')]));
      }
      if (unreadOnly) {
        query = query.where('is_read', '=', false);
      }
      return await query.executeTakeFirstOrThrow();
    }).catch((error) => {
      console.error('[notifications][GET][count] query failed:', error);
      return null;
    });
    if (result === null) return jsonError('获取通知失败', 500);

    return jsonOk({ count: result.count ?? 0 });
  }

  const rows = await auth.db.tx(async (trx) => {
    let query = trx
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', auth.user.id)
      .where('created_at', '>=', cutoffIso);
    if (!includeAgent) {
      query = query.where((eb) => eb.or([eb('event_key', 'is', null), eb('event_key', 'not like', 'agent:%')]));
    }
    if (unreadOnly) {
      query = query.where('is_read', '=', false);
    }
    return await query
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit + 1)
      .execute();
  }).catch((error) => {
    console.error('[notifications][GET][list] query failed:', error);
    return null;
  });
  if (rows === null) return jsonError('获取通知失败', 500);

  const notifications = rows.slice(0, limit);
  const hasMore = rows.length > limit;

  return jsonOk({
    notifications,
    pagination: {
      hasMore,
      nextOffset: hasMore ? offset + notifications.length : null,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureUserContext(request, 'notifications', '通知功能当前未启用');
  if ('response' in auth) return auth.response;

  let body: { action?: unknown; id?: unknown; ids?: unknown };
  try {
    body = await request.json() as { action?: unknown; id?: unknown; ids?: unknown };
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }

  const action = typeof body.action === 'string' ? body.action : '';
  if (action === 'mark-one' && typeof body.id === 'string') {
    const ok = await auth.db.tx((trx) => trx
      .updateTable('notifications')
      .set({ is_read: true })
      .where('id', '=', body.id as string)
      .where('user_id', '=', auth.user.id)
      .execute()).then(() => true).catch(() => false);
    if (!ok) return jsonError('标记已读失败', 500);
    return jsonOk({ success: true });
  }

  if (action === 'mark-all') {
    const cutoffIso = getNotificationRetentionCutoffIso();
    const ok = await auth.db.tx((trx) => trx
      .updateTable('notifications')
      .set({ is_read: true })
      .where('user_id', '=', auth.user.id)
      .where('created_at', '>=', cutoffIso)
      .where('is_read', '=', false)
      .execute()).then(() => true).catch(() => false);
    if (!ok) return jsonError('标记全部已读失败', 500);
    return jsonOk({ success: true });
  }

  if (action === 'mark-selected') {
    const ids = parseIds(body.ids);
    if (ids.length === 0) return jsonOk({ success: true });
    const ok = await auth.db.tx((trx) => trx
      .updateTable('notifications')
      .set({ is_read: true })
      .where('id', 'in', ids)
      .where('user_id', '=', auth.user.id)
      .execute()).then(() => true).catch(() => false);
    if (!ok) return jsonError('批量标记已读失败', 500);
    return jsonOk({ success: true });
  }

  return jsonError('无效的通知更新操作', 400);
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeatureUserContext(request, 'notifications', '通知功能当前未启用');
  if ('response' in auth) return auth.response;

  let ids = parseIds(request.nextUrl.searchParams.getAll('id'));
  if (ids.length === 0) {
    try {
      const body = await request.json() as { id?: unknown; ids?: unknown };
      if (typeof body.id === 'string') {
        ids = [body.id];
      } else {
        ids = parseIds(body.ids);
      }
    } catch {
      ids = [];
    }
  }

  if (ids.length === 0) {
    return jsonError('缺少通知 ID', 400);
  }

  const ok = await auth.db.tx((trx) => trx
    .deleteFrom('notifications')
    .where('id', 'in', ids)
    .where('user_id', '=', auth.user.id)
    .execute()).then(() => true).catch(() => false);

  if (!ok) {
    return jsonError('删除通知失败', 500);
  }

  return jsonOk({ success: true });
}
