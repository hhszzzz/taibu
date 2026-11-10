'use client';

/**
 * 新公告提示：桌面是侧栏账户行上方的小卡片，手机是页头下的一条横幅。
 * 点「查看」打开阅读弹窗，点 × 记为已看；两种都只提示还没看过的最新一条。
 */
import { Megaphone, X } from 'lucide-react';
import { getAnnouncementTitle } from '@/lib/announcement';
import { useAnnouncementCenterSafe } from '@/components/providers/AnnouncementPopupHost';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { formatNotificationTime } from '@/lib/notification-view';

export function AnnouncementCard({ variant = 'sidebar' }: { variant?: 'sidebar' | 'banner' }) {
    const { unseenAnnouncement: announcement, openAnnouncement, markAnnouncementSeen } = useAnnouncementCenterSafe();
    if (!announcement) return null;
    const title = getAnnouncementTitle(announcement.content) || '有一条新公告';
    const open = () => openAnnouncement(announcement);
    const dismiss = (
        <IconButton label="关闭公告提示" size="sm" onClick={() => markAnnouncementSeen(announcement)} className="shrink-0 text-foreground-tertiary">
            <X aria-hidden="true" />
        </IconButton>
    );

    if (variant === 'banner') {
        return (
            <div className="px-3 pt-2 lg:hidden">
                <section aria-label="新公告" className="flex items-center gap-2.5 rounded-xl border-[0.5px] border-border bg-surface py-1.5 pr-1.5 pl-3 shadow-[var(--shadow-sm)]">
                    <Megaphone className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                    <Button unstyled onClick={open} className="min-w-0 flex-1 truncate py-1.5 text-left text-sm text-foreground">{title}</Button>
                    <Button variant="ghost" size="sm" onClick={open} className="shrink-0 text-[13px] text-accent">查看</Button>
                    {dismiss}
                </section>
            </div>
        );
    }

    return (
        <section aria-label="新公告" className="mx-2 mb-2 rounded-xl border-[0.5px] border-border bg-surface p-3 pt-2.5 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-1.5">
                <Megaphone className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                <span className="text-xs font-medium text-accent">新公告</span>
                <span className="text-xs text-foreground-tertiary">· {formatNotificationTime(announcement.publishedAt)}</span>
                <span className="-mr-1.5 ml-auto">{dismiss}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-foreground">{title}</p>
            <Button unstyled onClick={open} className="mt-2 self-start text-[13px] text-foreground-secondary transition-colors hover:text-foreground">查看 →</Button>
        </section>
    );
}
