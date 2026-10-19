/**
 * 通知服务
 *
 * 浏览器侧 fetcher + 任务通知的纯判定（只弹一次、历史基线、浏览器通知可用性）；
 * 缓存由 TanStack Query 统一管理。
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

export type TaskNoticeToastType = 'success' | 'error';

/**
 * Agent 任务通知只在这两个终态打扰用户；等待回答交给对话里的提问面板，
 * 完成/失败的历史仍保留在通知中心。
 */
export function getTaskNoticeToastType(status: unknown): TaskNoticeToastType | null {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  return null;
}

/**
 * 页面加载后第一次成功拉取到的通知属于历史：只留在通知中心，不补弹。
 * 之后出现的通知才是本轮需要提示的。除记录 ID 外再记下最新时间，
 * 避免未读数超过一页时，旧通知翻页后又被当成新通知。
 */
export interface TaskNoticeBaseline {
  ids: ReadonlySet<string>;
  newestCreatedAt: string | null;
}

export function collectTaskNoticeBaseline(
  notices: ReadonlyArray<{ id: string; created_at?: string | null }>,
): TaskNoticeBaseline {
  let newestCreatedAt: string | null = null;
  for (const notice of notices) {
    if (notice.created_at && (!newestCreatedAt || notice.created_at > newestCreatedAt)) {
      newestCreatedAt = notice.created_at;
    }
  }
  return { ids: new Set(notices.map(notice => notice.id)), newestCreatedAt };
}

/**
 * 同一条通知只弹一次：已读、已被任一标签页领取、属于加载前的历史，
 * 或本轮已经弹过，都不再弹。
 */
export function shouldPopupTaskNotice(
  notice: {
    id: string;
    is_read?: boolean;
    popup_claimed_at?: string | null;
    created_at?: string | null;
  },
  options: { baseline?: TaskNoticeBaseline | null; popped?: ReadonlySet<string> },
): boolean {
  if (notice.is_read) return false;
  if (notice.popup_claimed_at) return false;
  if (options.popped?.has(notice.id)) return false;
  if (options.baseline) {
    if (options.baseline.ids.has(notice.id)) return false;
    if (options.baseline.newestCreatedAt && notice.created_at && notice.created_at <= options.baseline.newestCreatedAt) return false;
  }
  return true;
}

export type BrowserNotificationAvailability = 'unsupported' | 'denied' | 'prompt' | 'granted';

/** 浏览器通知开关的可用性：不支持或已被拒绝时不能开启。 */
export function getBrowserNotificationAvailability(input: {
  supported: boolean;
  permission?: string | null;
}): BrowserNotificationAvailability {
  if (!input.supported) return 'unsupported';
  if (input.permission === 'granted') return 'granted';
  if (input.permission === 'denied') return 'denied';
  return 'prompt';
}

export function canEnableBrowserNotifications(availability: BrowserNotificationAvailability): boolean {
  return availability === 'granted' || availability === 'prompt';
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
