/**
 * 通知服务
 *
 * 浏览器侧仅保留纯 fetcher；缓存由 TanStack Query 统一管理。
 */

import { requestBrowserPayloadOrThrow, requestBrowserJson } from '@/lib/browser-api';

export interface Notification {
  id: string;
  user_id: string;
  type: 'feature_launch' | 'system' | 'promotion';
  title: string;
  content: string | null;
  is_read: boolean;
  link: string | null;
  created_at: string;
  popup_claimed_at?: string | null;
}

interface NotificationPagination {
  hasMore: boolean;
  nextOffset: number | null;
}

/** 任务通知（Agent 后台任务完成等）的轮询间隔 */
export const TASK_NOTIFICATION_POLL_MS = 10_000;
/** 轮询复用用户设置的时长；设置写入会经 mutationEffects.userSettings 立即失效 */
export const TASK_NOTIFICATION_SETTINGS_STALE_MS = 60_000;
/** 回到前台时补拉一次，但距上一轮至少间隔此时长，避免来回切换标签页时连发 */
export const TASK_NOTIFICATION_RESUME_COOLDOWN_MS = 3_000;

/**
 * 是否拉取任务通知：可见页面照常轮询；隐藏页面只有能弹出系统通知时才继续，
 * 否则 Toast 无人可见，等回到前台时补拉即可。
 */
export function shouldPollTaskNotifications(state: { visible: boolean; desktopNotifications: boolean }): boolean {
  return state.visible || state.desktopNotifications;
}

interface NotificationPageResult {
  notifications: Notification[];
  pagination: NotificationPagination;
}

export async function getUnreadCount(): Promise<number> {
  const result = await requestBrowserPayloadOrThrow<{ count?: number }>(
    '/api/notifications?count=1&unread=1',
    { method: 'GET' },
    '获取未读数量失败',
  );

  return result.count ?? result.data?.count ?? 0;
}

export async function getNotificationsPage(
  options: {
    limit?: number;
    offset?: number;
  } = {},
): Promise<NotificationPageResult> {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  const result = await requestBrowserPayloadOrThrow<{
    notifications?: Notification[];
    pagination?: NotificationPagination;
  }>(
    `/api/notifications?limit=${limit}&offset=${offset}`,
    { method: 'GET' },
    '获取通知列表失败',
  );

  return {
    notifications: result.data?.notifications ?? [],
    pagination: result.data?.pagination ?? {
      hasMore: false,
      nextOffset: null,
    },
  };
}

export async function markAsRead(notificationId: string): Promise<boolean> {
  const result = await requestBrowserJson<{ success?: boolean }>('/api/notifications', {
    method: 'PATCH',
    body: JSON.stringify({
      action: 'mark-one',
      id: notificationId,
    }),
  });

  if (result.error) {
    console.error('标记已读失败:', result.error.message);
    return false;
  }

  return true;
}

export async function markAllAsRead(): Promise<boolean> {
  const result = await requestBrowserJson<{ success?: boolean }>('/api/notifications', {
    method: 'PATCH',
    body: JSON.stringify({
      action: 'mark-all',
    }),
  });

  if (result.error) {
    console.error('标记全部已读失败:', result.error.message);
    return false;
  }

  return true;
}

export async function markSelectedAsRead(notificationIds: string[]): Promise<boolean> {
  if (notificationIds.length === 0) return true;

  const result = await requestBrowserJson<{ success?: boolean }>('/api/notifications', {
    method: 'PATCH',
    body: JSON.stringify({
      action: 'mark-selected',
      ids: notificationIds,
    }),
  });

  if (result.error) {
    console.error('批量标记已读失败:', result.error.message);
    return false;
  }

  return true;
}

export async function deleteNotification(notificationId: string): Promise<boolean> {
  const result = await requestBrowserJson<{ success?: boolean }>(`/api/notifications?id=${notificationId}`, {
    method: 'DELETE',
  });

  if (result.error) {
    console.error('删除通知失败:', result.error.message);
    return false;
  }

  return true;
}

export async function deleteNotifications(notificationIds: string[]): Promise<boolean> {
  if (notificationIds.length === 0) return true;

  const query = new URLSearchParams();
  for (const id of notificationIds) {
    query.append('id', id);
  }

  const result = await requestBrowserJson<{ success?: boolean }>(`/api/notifications?${query.toString()}`, {
    method: 'DELETE',
  });

  if (result.error) {
    console.error('批量删除通知失败:', result.error.message);
    return false;
  }

  return true;
}
