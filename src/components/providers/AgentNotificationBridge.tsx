'use client';
// 需要 useEffect 轮询任务通知，并读写 localStorage 与浏览器通知 API
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { fetchCachedUserSettings } from '@/lib/user/settings';
import { requestBrowserJson } from '@/lib/browser-api';
import {
    collectTaskNoticeBaseline,
    getTaskNoticeToastType,
    markAsRead,
    shouldPollTaskNotifications,
    shouldPopupTaskNotice,
    TASK_NOTIFICATION_POLL_MS,
    TASK_NOTIFICATION_RESUME_COOLDOWN_MS,
    TASK_NOTIFICATION_SETTINGS_STALE_MS,
    type Notification as SiteNotification,
    type TaskNoticeBaseline,
} from '@/lib/notification';

type TaskNotification = SiteNotification & {
    event_key?: string;
    event_data?: { conversationId?: string; kind?: string; status?: string };
};

/** In-app target of a task notice: its own /chat link, else the conversation it belongs to. */
export function taskNoticeHref(notice: Pick<TaskNotification, 'link' | 'event_data'>) {
    if (notice.link?.startsWith('/chat?')) return notice.link;
    const id = notice.event_data?.conversationId;
    return id ? `/chat?id=${encodeURIComponent(id)}` : null;
}

export function AgentNotificationBridge({ userId }: { userId: string | null }) {
    const { showToast } = useToast();
    const queryClient = useQueryClient();
    const router = useRouter();
    useEffect(() => {
        if (!userId) return;
        const controller = new AbortController();
        const tab = crypto.randomUUID(); const presenceKey = `taibu.active-chat:${userId}:${tab}`;
        let busy = false;
        let lastPolledAt = 0;
        // 第一次成功拉取到的通知是历史，只留在通知中心；之后的新通知才弹 Toast。
        let baseline: TaskNoticeBaseline | null = null;
        // 服务端的 popup_claimed_at 负责跨标签页去重；这里再挡住本轮重复响应。
        const popped = new Set<string>();
        const presence = () => {
            try { const url = new URL(window.location.href); localStorage.setItem(presenceKey, JSON.stringify({ id: url.pathname === '/chat' && document.visibilityState === 'visible' && document.hasFocus() ? url.searchParams.get('id') : null, until: Date.now()+12000 })); } catch { /* optional */ }
        };
        const viewing = (conversationId: string | undefined) => {
            if (!conversationId) return false;
            const url = new URL(window.location.href);
            if (url.pathname === '/chat' && url.searchParams.get('id') === conversationId && document.visibilityState === 'visible' && document.hasFocus()) return true;
            try {
            for (let index=0; index<localStorage.length; index++) {
                const key = localStorage.key(index);
                if (!key?.startsWith(`taibu.active-chat:${userId}:`)) continue;
                try { const value = JSON.parse(localStorage.getItem(key) ?? '{}'); if (value.id === conversationId && value.until > Date.now()) return true; } catch { /* expired */ }
            }
            } catch { /* The current page still suppresses duplicate popups without storage. */ }
            return false;
        };
        const poll = async () => {
            presence(); if (busy || controller.signal.aborted) return; busy=true;
            try {
                // 设置很少变化：走 TanStack 缓存，不再每轮重取；关闭通知后也不再拉取列表
                const settings = await fetchCachedUserSettings(queryClient, userId, TASK_NOTIFICATION_SETTINGS_STALE_MS);
                if (controller.signal.aborted || settings.notificationsEnabled === false) return;
                const desktop = settings.chatPreferences.desktopNotifications && 'Notification' in window && window.Notification.permission === 'granted';
                if (!shouldPollTaskNotifications({ visible: document.visibilityState === 'visible', desktopNotifications: desktop })) return;
                const response = await requestBrowserJson<{ notifications: TaskNotification[] }>('/api/notifications?unread=1&limit=40&agent=1', { signal: controller.signal });
                if (controller.signal.aborted) return;
                // 读取失败时不能把空列表当成历史基线，否则下一轮会把旧通知全部补弹。
                if (response.error || !response.data) return;
                const notices = response.data.notifications ?? [];
                // 首轮只建立基线：刷新页面不会把已有未读任务重新弹一遍。
                if (!baseline) { baseline = collectTaskNoticeBaseline(notices); return; }
                for (const notice of notices) {
                    if (!notice.event_key) continue;
                    const conversationId = notice.event_data?.conversationId;
                    if (viewing(conversationId)) { await markAsRead(notice.id); continue; }
                    if (!shouldPopupTaskNotice(notice, { baseline, popped })) continue;
                    // 只有完成/失败弹 Toast；等待回答由对话内的提问面板承接。
                    const toastType = getTaskNoticeToastType(notice.event_data?.status);
                    if (!toastType) continue;
                    const claim = await requestBrowserJson<{ claimed: boolean }>('/api/notifications/popup', { method:'POST', body:JSON.stringify({ id:notice.id }), signal:controller.signal });
                    if (!claim.data?.claimed || controller.signal.aborted) continue;
                    popped.add(notice.id);
                    const href = taskNoticeHref(notice);
                    showToast(toastType, `${notice.title} · ${notice.content ?? '可在通知中心打开对话'}`, { duration: 5000, ...(href ? { action: { label: '打开', onClick: () => router.push(href) } } : {}) });
                    if (desktop) {
                        const native = new window.Notification(notice.title, { body: notice.content ?? '', tag:notice.event_key });
                        native.onclick = () => { window.focus(); if (href) window.location.assign(href); native.close(); };
                    }
                }
            } catch { /* polling retries without generating or billing */ } finally { busy=false; lastPolledAt=Date.now(); }
        };
        // 回到前台立即补拉一轮，隐藏期间跳过的通知不必等下一个间隔
        const resume = () => {
            presence();
            if (document.visibilityState === 'visible' && Date.now() - lastPolledAt >= TASK_NOTIFICATION_RESUME_COOLDOWN_MS) void poll();
        };
        void poll(); const timer=setInterval(() => void poll(), TASK_NOTIFICATION_POLL_MS);
        window.addEventListener('focus',presence); document.addEventListener('visibilitychange',resume);
        return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus',presence); document.removeEventListener('visibilitychange',resume); try { localStorage.removeItem(presenceKey); } catch { /* optional */ } };
    }, [userId,showToast,queryClient,router]);
    return null;
}
