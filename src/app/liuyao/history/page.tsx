/**
 * 六爻历史记录页面 - 使用 HistoryPageTemplate
 */
'use client';

import { Dices, Calendar } from 'lucide-react';
import { HistoryPageTemplate, type CardActions } from '@/components/history/HistoryPageTemplate';
import type { HistorySummaryItem } from '@/lib/history/registry';

function LiuyaoCard({ item, actions }: { item: HistorySummaryItem; actions: CardActions }) {
    return (
        <div
            className="group relative flex cursor-pointer flex-col rounded-2xl border-[0.5px] border-border bg-surface p-5 transition-colors duration-200 hover:border-accent/40 hover:bg-background-secondary"
            onClick={actions.onView}
        >
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="rounded-md bg-accent-light px-2.5 py-1 font-display text-[13px] text-accent-strong">
                        {item.title}
                    </span>
                    {item.changedTitle && (
                        <>
                            <span className="text-[10px] text-foreground-tertiary">变</span>
                            <span className="rounded-md bg-background-secondary px-2.5 py-1 font-display text-[13px] text-foreground">
                                {item.changedTitle}
                            </span>
                        </>
                    )}
                </div>
                <span className="text-xs text-foreground-tertiary font-mono">{actions.formatDate(item.createdAt)}</span>
            </div>
            <div className="mb-3">
                {item.metric && <p className="inline-block rounded-md bg-background-secondary px-2 py-1 text-xs text-foreground-secondary">{item.metric}</p>}
                {item.modelName && (
                    <span className="ml-2 inline-block rounded-md border-[0.5px] border-border bg-background px-2 py-0.5 text-[10px] text-foreground-secondary">{item.modelName}</span>
                )}
            </div>
            <div className="flex-1">
                {item.question && <p className="text-xs text-foreground-secondary line-clamp-2">{item.question}</p>}
            </div>
            <div className="mt-4 flex items-center justify-between border-t-[0.5px] border-border pt-3 opacity-60 transition-opacity group-hover:opacity-100">
                <div className="text-xs text-foreground-secondary flex items-center gap-1"><Calendar className="w-3 h-3" />查看详情</div>
                <CardActionButtons actions={actions} />
            </div>
        </div>
    );
}

function CardActionButtons({ actions }: { actions: CardActions }) {
    return (
        <div className="flex items-center gap-1">
            {actions.canAddToKnowledgeBase && (
                <button type="button" onClick={e => { e.stopPropagation(); actions.onAddToKb(); }}
                    className="rounded-lg p-1.5 text-foreground-secondary transition-colors hover:bg-accent-light hover:text-accent" title="加入知识库">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                </button>
            )}
            <button type="button" onClick={e => { e.stopPropagation(); actions.onDelete(); }}
                className="rounded-lg p-1.5 text-foreground-secondary transition-colors hover:bg-fire-soft hover:text-danger" title="删除">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
        </div>
    );
}

export default function LiuyaoHistoryPage() {
    return (
        <HistoryPageTemplate
            sourceType="liuyao"
            title="六爻起卦历史"
            subtitle="易经六十四卦，指引人生方向"
            icon={Dices}
            iconColor="text-accent"
            searchPlaceholder="搜索问题或卦名..."
            emptyActionLabel="开始起卦"
            deleteMessage="确定要删除这条起卦记录吗？此操作无法撤销。"
            kbSourceType="liuyao_divination"
            themeColor="accent"
            invalidateTypes={['liuyao_divination']}
            kbTitleFn={item => item.question || [item.title, item.changedTitle].filter(Boolean).join(' 变 ')}
            filterFn={(item, query) => {
                const q = query.toLowerCase();
                return (item.question || '').toLowerCase().includes(q)
                    || item.title.toLowerCase().includes(q)
                    || (item.changedTitle || '').toLowerCase().includes(q);
            }}
            renderCard={(item, actions) => <LiuyaoCard item={item} actions={actions} />}
        />
    );
}
