'use client';

/**
 * 公告行：标题、两行摘要与发布日期，未看过的最新一条带圆点；点开进单条阅读弹窗。
 */
import { getAnnouncementBody, getAnnouncementExcerpt, getAnnouncementPromptIdentity, getAnnouncementTitle, type Announcement } from '@/lib/announcement';
import { formatNotificationTime } from '@/lib/notification-view';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

export function formatAnnouncementDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : DATE_FORMAT.format(date);
}

export function AnnouncementRows({ announcements, unseenKey, compact = false, onOpen }: {
    announcements: Announcement[];
    unseenKey: string | null;
    compact?: boolean;
    onOpen: (announcement: Announcement) => void;
}) {
    return (
        <ul className="flex flex-col">
            {announcements.map(announcement => {
                const isNew = unseenKey !== null && getAnnouncementPromptIdentity(announcement) === unseenKey;
                const excerpt = getAnnouncementExcerpt(getAnnouncementBody(announcement.content));
                return (
                    <li key={announcement.id} className={cn('group relative flex gap-2.5 rounded-xl transition-colors hover:bg-fill-ghost-hover',
                        'before:pointer-events-none before:absolute before:top-0 before:border-t-[0.5px] before:border-border first:before:hidden hover:before:opacity-0 [&:hover+li]:before:opacity-0',
                        compact ? 'px-2.5 py-2.5 before:inset-x-2.5' : 'px-3 py-3.5 before:inset-x-3 md:px-4 md:before:inset-x-4')}>
                        <span className={cn('flex w-2 shrink-0 items-center', compact ? 'h-5' : 'h-6')}>
                            {isNew ? <span className="h-2 w-2 rounded-full bg-accent"><span className="sr-only">新公告</span></span> : null}
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                                <h3 className={cn('min-w-0 font-medium text-foreground', compact ? 'text-sm leading-5' : 'text-[15px] leading-6')}>
                                    <Button unstyled onClick={() => onOpen(announcement)} className={cn('block text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none', compact && 'max-w-full truncate')}>
                                        {getAnnouncementTitle(announcement.content) || '公告'}
                                    </Button>
                                </h3>
                                <time dateTime={announcement.publishedAt} title={formatAnnouncementDate(announcement.publishedAt)} className="shrink-0 text-xs text-foreground-tertiary">
                                    {formatNotificationTime(announcement.publishedAt)}
                                </time>
                            </div>
                            {excerpt ? (
                                <p className={cn('mt-0.5 line-clamp-2 text-foreground-secondary', compact ? 'text-[13px] leading-[1.45]' : 'text-sm leading-relaxed')}>{excerpt}</p>
                            ) : null}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
