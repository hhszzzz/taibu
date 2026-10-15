/**
 * 历史记录卡片：网格卡片、列表行、操作按钮与骨架屏
 *
 * 只负责展示，数据加载、删除与恢复都在 HistoryPageTemplate。
 * 查看是一个真正的按钮（键盘可达），加入知识库 / 删除按钮始终可见，不依赖悬停。
 */

import type { ReactNode } from 'react';
import { BookOpenText, Trash2 } from 'lucide-react';
import type { HistorySummaryItem } from '@/lib/history/registry';
import { getDefaultHistoryDetail } from '@/lib/history/summary-display';

export interface CardActions {
    onView: () => void;
    onDelete: () => void;
    onAddToKb: () => void;
    canAddToKnowledgeBase: boolean;
    formatDate: (dateStr: string) => string;
}

/** 覆盖卡片里「补充信息」一行；返回 null 表示不显示。 */
export type HistoryDetailRenderer = (item: HistorySummaryItem) => ReactNode;

function resolveDetail(item: HistorySummaryItem, renderDetail?: HistoryDetailRenderer): ReactNode {
    return renderDetail ? renderDetail(item) : getDefaultHistoryDetail(item) || null;
}

function HistoryMeta({ item, formatDate, className = '' }: { item: HistorySummaryItem; formatDate: CardActions['formatDate']; className?: string }) {
    const date = formatDate(item.createdAt);
    if (!date && !item.modelName) return null;
    return (
        <span className={`flex min-w-0 items-center gap-2.5 text-xs text-foreground-tertiary ${className}`}>
            {date ? <time dateTime={item.createdAt} className="shrink-0">{date}</time> : null}
            {item.modelName ? <span className="truncate">{item.modelName}</span> : null}
        </span>
    );
}

const ACTION_BUTTON_CLASS = 'flex h-10 w-10 items-center justify-center rounded-lg text-foreground-tertiary transition-colors md:h-8 md:w-8';

export function HistoryCardActionButtons({ actions }: { actions: CardActions }) {
    return (
        <span className="flex shrink-0 gap-0.5">
            {actions.canAddToKnowledgeBase ? (
                <button
                    type="button"
                    onClick={actions.onAddToKb}
                    aria-label="加入知识库"
                    title="加入知识库"
                    className={`${ACTION_BUTTON_CLASS} hover:bg-background-secondary hover:text-foreground`}
                >
                    <BookOpenText className="h-[17px] w-[17px]" aria-hidden="true" />
                </button>
            ) : null}
            <button
                type="button"
                onClick={actions.onDelete}
                aria-label="删除记录"
                title="删除"
                className={`${ACTION_BUTTON_CLASS} hover:bg-danger/10 hover:text-danger`}
            >
                <Trash2 className="h-[17px] w-[17px]" aria-hidden="true" />
            </button>
        </span>
    );
}

type HistoryCardProps = {
    item: HistorySummaryItem;
    actions: CardActions;
    /** 正在读取这条记录准备跳转。 */
    viewing: boolean;
    renderDetail?: HistoryDetailRenderer;
};

/** 网格卡片：卦名 / 牌阵标签、问题、补充信息，底部是时间、模型和操作。 */
export function HistoryGridCard({ item, actions, viewing, renderDetail }: HistoryCardProps) {
    const detail = resolveDetail(item, renderDetail);
    return (
        <article className="flex h-full flex-col rounded-[14px] border-[0.5px] border-border bg-surface transition-colors hover:border-border-hover">
            <button
                type="button"
                onClick={actions.onView}
                aria-busy={viewing || undefined}
                className={`flex flex-1 flex-col items-start gap-3 rounded-t-[14px] px-5 pt-5 pb-4 text-left transition-opacity ${viewing ? 'opacity-60' : ''}`}
            >
                <span className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-accent-soft px-2.5 py-0.5 font-display text-sm text-accent-strong">{item.title}</span>
                    {item.changedTitle ? (
                        <>
                            <span className="text-xs text-foreground-tertiary">变</span>
                            <span className="rounded-lg bg-background-secondary px-2.5 py-0.5 font-display text-sm text-foreground">{item.changedTitle}</span>
                        </>
                    ) : null}
                </span>
                {item.question ? (
                    <span className="line-clamp-2 text-[15px] leading-relaxed text-foreground">{item.question}</span>
                ) : null}
                {detail ? <span className="text-[13px] text-foreground-secondary">{detail}</span> : null}
            </button>
            <div className="flex items-center justify-between gap-2 border-t-[0.5px] border-border py-1 pr-1 pl-5 md:py-2 md:pr-2">
                <HistoryMeta item={item} formatDate={actions.formatDate} />
                <HistoryCardActionButtons actions={actions} />
            </div>
        </article>
    );
}

/** 列表行：类型标签、标题，右侧时间与模型，随后是操作。 */
export function HistoryListRow({ item, actions, viewing, renderDetail }: HistoryCardProps) {
    const detail = resolveDetail(item, renderDetail);
    // 有问题时标题作为标签，问题作为正文；没有问题时直接显示标题。
    const label = item.question ? item.title : null;
    const text = item.question || item.title;
    return (
        <div className="flex items-center gap-2 py-1.5 pr-1 pl-4 md:gap-4 md:py-2 md:pr-2 md:pl-5">
            <button
                type="button"
                onClick={actions.onView}
                aria-busy={viewing || undefined}
                className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg py-1.5 text-left transition-opacity focus-visible:outline-offset-[-2px] ${viewing ? 'opacity-60' : ''}`}
            >
                {label ? (
                    <span className="shrink-0 rounded-full bg-background-secondary px-2 py-0.5 text-xs text-foreground-secondary">{label}</span>
                ) : null}
                <span className="min-w-0 text-[15px] text-foreground">{text}</span>
                {detail ? <span className="line-clamp-2 min-w-0 text-[13px] text-foreground-secondary">{detail}</span> : null}
                <HistoryMeta item={item} formatDate={actions.formatDate} className="basis-full md:ml-auto md:basis-auto md:justify-end" />
            </button>
            <HistoryCardActionButtons actions={actions} />
        </div>
    );
}

const SKELETON_BLOCK = 'animate-pulse rounded bg-foreground/5';

export function HistoryGridSkeleton({ count }: { count: number }) {
    return (
        <div aria-hidden="true" className="grid grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-4">
            {Array.from({ length: count }, (_, index) => (
                <div key={index} className="flex flex-col rounded-[14px] border-[0.5px] border-border bg-surface">
                    <div className="flex flex-col gap-3 px-5 pt-5 pb-4">
                        <div className={`${SKELETON_BLOCK} h-6 w-20 rounded-lg bg-foreground/10`} />
                        <div className={`${SKELETON_BLOCK} h-4 w-full`} />
                        <div className={`${SKELETON_BLOCK} h-4 w-2/3`} />
                    </div>
                    <div className="flex items-center justify-between border-t-[0.5px] border-border py-2 pr-2 pl-5">
                        <div className={`${SKELETON_BLOCK} h-3 w-28`} />
                        <div className="flex gap-0.5">
                            <div className={`${SKELETON_BLOCK} h-8 w-8 rounded-lg`} />
                            <div className={`${SKELETON_BLOCK} h-8 w-8 rounded-lg`} />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export function HistoryListSkeleton({ count }: { count: number }) {
    return (
        <div aria-hidden="true" className="divide-y-[0.5px] divide-border overflow-hidden rounded-[14px] border-[0.5px] border-border bg-surface">
            {Array.from({ length: count }, (_, index) => (
                <div key={index} className="flex items-center gap-4 py-3 pr-2 pl-5">
                    <div className={`${SKELETON_BLOCK} h-5 w-16 rounded-full bg-foreground/10`} />
                    <div className={`${SKELETON_BLOCK} h-4 w-40`} />
                    <div className={`${SKELETON_BLOCK} ml-auto hidden h-3 w-32 md:block`} />
                    <div className="flex gap-0.5">
                        <div className={`${SKELETON_BLOCK} h-8 w-8 rounded-lg`} />
                        <div className={`${SKELETON_BLOCK} h-8 w-8 rounded-lg`} />
                    </div>
                </div>
            ))}
        </div>
    );
}
