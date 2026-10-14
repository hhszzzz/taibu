/**
 * 塔罗历史记录页面 - 使用 HistoryPageTemplate
 */
'use client'; // HistoryPageTemplate 依赖客户端 hooks，渲染函数需在客户端传入

import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';
import type { HistorySummaryItem } from '@/lib/history/registry';

const VISIBLE_CARD_COUNT = 3;

/** 牌名按正逆位着色，超出部分折叠为 +N。 */
function TarotCardsDetail({ item }: { item: HistorySummaryItem }) {
    const cards = item.badges ?? [];
    if (cards.length === 0) return null;
    return (
        <span className="flex flex-wrap gap-1.5">
            {cards.slice(0, VISIBLE_CARD_COUNT).map((card, index) => (
                <span key={`${index}-${card}`} className={`rounded-md px-2 py-0.5 text-xs ${card.includes('(逆)') ? 'bg-fire-soft text-fire' : 'bg-wood-soft text-wood'}`}>
                    {card}
                </span>
            ))}
            {cards.length > VISIBLE_CARD_COUNT ? (
                <span className="rounded-md bg-background-secondary px-2 py-0.5 text-xs text-foreground-secondary">+{cards.length - VISIBLE_CARD_COUNT}</span>
            ) : null}
        </span>
    );
}

export default function TarotHistoryPage() {
    return (
        <HistoryPageTemplate
            sourceType="tarot"
            title="塔罗占卜历史"
            subtitle="回顾你的心灵指引记录"
            searchPlaceholder="搜索问题、牌阵或牌名"
            actionLabel="开始新的占卜"
            deleteMessage="确定要删除这条占卜记录吗？此操作无法撤销。"
            kbSourceType="tarot_reading"
            invalidateTypes={['tarot_reading']}
            kbTitleFn={item => item.question || `塔罗 - ${item.title}`}
            renderDetail={item => <TarotCardsDetail item={item} />}
        />
    );
}
