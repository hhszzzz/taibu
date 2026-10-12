/**
 * 塔罗历史记录页面 - 使用 HistoryPageTemplate
 */
'use client'; // HistoryPageTemplate 依赖客户端 hooks，渲染函数需在客户端传入

import { Sparkles, Calendar } from 'lucide-react';
import { HistoryPageTemplate, type CardActions } from '@/components/history/HistoryPageTemplate';
import type { HistorySummaryItem } from '@/lib/history/registry';

function TarotCard({ item, actions }: { item: HistorySummaryItem; actions: CardActions }) {
    return (
        <div
            className="group relative flex cursor-pointer flex-col rounded-2xl border-[0.5px] border-border bg-surface p-5 transition-colors hover:border-accent/40 hover:bg-background-secondary"
            onClick={actions.onView}
        >
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="rounded-md bg-accent-light px-2.5 py-1 font-display text-[13px] text-accent-strong">
                        {item.title}
                    </span>
                    {item.modelName && (
                        <span className="rounded-md border-[0.5px] border-border bg-background px-2 py-0.5 text-[10px] text-foreground-secondary">
                            {item.modelName}
                        </span>
                    )}
                </div>
                <span className="text-xs text-foreground-tertiary font-mono">{actions.formatDate(item.createdAt)}</span>
            </div>
            <div className="mb-3">
                <div className="flex flex-wrap gap-1.5">
                    {(item.badges || []).slice(0, 3).map((badge, i) => (
                        <div key={i} className={`rounded-md px-2 py-1 text-xs ${badge.includes('(逆)') ? 'bg-fire-soft text-fire' : 'bg-wood-soft text-wood'}`}>
                            {badge}
                        </div>
                    ))}
                    {(item.badges || []).length > 3 && (
                        <span className="rounded-md bg-background-secondary px-2 py-1 text-xs text-foreground-secondary">+{(item.badges || []).length - 3}</span>
                    )}
                </div>
            </div>
            <div className="flex-1">
                {item.question && <p className="font-display text-sm leading-relaxed text-foreground line-clamp-2">{item.question}</p>}
            </div>
            <div className="mt-auto flex items-center justify-between border-t-[0.5px] border-border pt-3 text-foreground-secondary transition-colors group-hover:text-foreground">
                <div className="text-xs text-foreground-secondary flex items-center gap-1"><Calendar className="w-3 h-3" />查看详情</div>
                <HistoryCardActions actions={actions} />
            </div>
        </div>
    );
}

function HistoryCardActions({ actions }: { actions: CardActions }) {
    return (
        <div className="flex items-center gap-1">
            {actions.canAddToKnowledgeBase && (
                <button type="button" onClick={e => { e.stopPropagation(); actions.onAddToKb(); }}
                    className="rounded-lg p-1.5 text-foreground-secondary transition-colors hover:bg-wood-soft hover:text-wood" title="加入知识库" aria-label="加入知识库">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                </button>
            )}
            <button type="button" onClick={e => { e.stopPropagation(); actions.onDelete(); }}
                className="rounded-lg p-1.5 text-foreground-secondary transition-colors hover:bg-fire-soft hover:text-danger" title="删除" aria-label="删除">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
        </div>
    );
}

export default function TarotHistoryPage() {
    return (
        <HistoryPageTemplate
            sourceType="tarot"
            title="塔罗占卜历史"
            subtitle="回顾你的心灵指引记录"
            icon={Sparkles}
            iconColor="text-accent"
            searchPlaceholder="搜索问题或牌阵..."
            emptyActionLabel="开始新的占卜"
            deleteMessage="确定要删除这条占卜记录吗？此操作无法撤销。"
            kbSourceType="tarot_reading"
            themeColor="accent"
            invalidateTypes={['tarot_reading']}
            kbTitleFn={item => item.question || `塔罗 - ${item.title}`}
            filterFn={(item, query) => {
                const q = query.toLowerCase();
                return !!(item.question?.toLowerCase().includes(q))
                    || item.title.toLowerCase().includes(q)
                    || (item.badges || []).join(' ').toLowerCase().includes(q);
            }}
            renderCard={(item, actions) => <TarotCard item={item} actions={actions} />}
        />
    );
}
