'use client';

/**
 * 通知行：铃铛面板（紧凑）与通知页共用。整行点击即标为已读并打开链接；
 * 未读有圆点、标题加粗；通知页可在 actions 里放悬停操作。
 */
import type { ReactNode } from 'react';
import { Gift, Megaphone, Sparkles, type LucideIcon } from 'lucide-react';
import type { Notification } from '@/lib/notification';
import { formatNotificationTime } from '@/lib/notification-view';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export const NOTIFICATION_TYPES: Record<Notification['type'], { icon: LucideIcon; label: string }> = {
    feature_launch: { icon: Sparkles, label: '功能上线' },
    system: { icon: Megaphone, label: '系统通知' },
    promotion: { icon: Gift, label: '活动推广' },
};

export function NotificationRow({ notification, compact = false, busy = false, onOpen, actions }: {
    notification: Notification;
    compact?: boolean;
    busy?: boolean;
    onOpen: () => void;
    actions?: ReactNode;
}) {
    const type = NOTIFICATION_TYPES[notification.type] ?? NOTIFICATION_TYPES.system;
    const Icon = type.icon;
    const unread = !notification.is_read;
    const time = formatNotificationTime(notification.created_at);
    return (
        <li className={cn('group relative flex gap-2.5 rounded-xl transition-colors hover:bg-fill-ghost-hover',
            'before:pointer-events-none before:absolute before:top-0 before:border-t-[0.5px] before:border-border first:before:hidden hover:before:opacity-0 [&:hover+li]:before:opacity-0',
            compact ? 'px-2.5 py-2.5 before:inset-x-2.5' : 'px-3 py-3.5 before:inset-x-3 md:px-4 md:before:inset-x-4')}>
            <span className={cn('flex w-2 shrink-0 items-center', compact ? 'h-5' : 'h-6')}>
                {unread ? <span className="h-2 w-2 rounded-full bg-accent"><span className="sr-only">未读</span></span> : null}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                    <h3 className={cn('min-w-0', compact ? 'text-sm leading-5' : 'text-[15px] leading-6',
                        unread ? 'font-medium text-foreground' : 'text-foreground-secondary')}>
                        <Button unstyled onClick={onOpen} disabled={busy} className={cn('block text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none', compact && 'max-w-full truncate')}>
                            {notification.title}
                        </Button>
                    </h3>
                    {time ? <time dateTime={notification.created_at} className="shrink-0 text-xs text-foreground-tertiary">{busy ? '处理中' : time}</time> : null}
                </div>
                {notification.content ? (
                    <p className={cn('mt-0.5 text-foreground-secondary', compact ? 'line-clamp-2 text-[13px] leading-[1.45]' : 'line-clamp-2 text-sm leading-relaxed')}>
                        {notification.content}
                    </p>
                ) : null}
                {compact ? null : (
                    <div className="mt-1.5 flex min-h-9 items-center gap-3 md:min-h-7">
                        <span className="inline-flex items-center gap-1 text-xs text-foreground-tertiary">
                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />{type.label}
                        </span>
                        {actions ? <span className="relative z-10 ml-auto flex gap-0.5 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">{actions}</span> : null}
                    </div>
                )}
            </div>
        </li>
    );
}
