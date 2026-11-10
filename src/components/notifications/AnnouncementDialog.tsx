'use client';

/**
 * 单条公告的阅读弹窗：「公告 · 日期」、标题、Markdown 正文；底部「查看往期」「知道了」。手机上从底边升起。
 */
import { useId } from 'react';
import { Megaphone, X } from 'lucide-react';
import { getAnnouncementBody, getAnnouncementTitle, type Announcement } from '@/lib/announcement';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { formatAnnouncementDate } from './AnnouncementList';

export function AnnouncementDialog({ announcement, onClose, onShowAll }: {
    announcement: Announcement | null;
    onClose: () => void;
    onShowAll?: () => void;
}) {
    const id = useId();
    const title = announcement ? getAnnouncementTitle(announcement.content) : '';
    const body = announcement ? getAnnouncementBody(announcement.content) : '';
    return (
        <Dialog bare open={!!announcement} onClose={onClose} labelledBy={`${id}-title`}
            className="dialog-lg dialog-sheet flex max-h-[min(88dvh,46rem)] flex-col overflow-hidden">
            {announcement ? (
                <>
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-2 sm:px-7 sm:pt-6">
                        <div className="flex items-center justify-between gap-3">
                            <p className="inline-flex items-center gap-1.5 text-[13px] text-foreground-tertiary">
                                <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />公告 · {formatAnnouncementDate(announcement.publishedAt)}
                            </p>
                            <IconButton label="关闭" onClick={onClose} className="-mr-2 text-foreground-tertiary">
                                <X className="h-[18px] w-[18px]" aria-hidden="true" />
                            </IconButton>
                        </div>
                        <h2 id={`${id}-title`} className="mt-2 font-display text-[1.5rem] leading-snug text-foreground">{title || '公告'}</h2>
                        {body ? <MarkdownContent content={body} className="mt-4 text-[15px] leading-7" /> : null}
                    </div>
                    <div className="flex justify-end gap-2 px-6 pt-3 pb-5 sm:px-7 sm:pb-6">
                        {onShowAll ? <Button variant="ghost" size="lg" onClick={onShowAll}>查看往期</Button> : null}
                        <Button size="lg" onClick={onClose}>知道了</Button>
                    </div>
                </>
            ) : null}
        </Dialog>
    );
}
