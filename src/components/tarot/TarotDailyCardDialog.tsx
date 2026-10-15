/**
 * 塔罗入口页「每日一牌」弹窗
 *
 * 'use client'：弹窗标题 id 需要 useId；开关状态由页面持有。
 * 只展示页面已抽好的今日一牌，加载失败时给出提示，不在弹窗内重新请求。
 */
'use client';

import { useId } from 'react';
import { X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { TarotCardFace } from '@/components/tarot/TarotCardFace';
import { TarotOrientationChip } from '@/components/tarot/TarotSpreadParts';
import type { DrawnCard } from '@/lib/divination/tarot';

export function TarotDailyCardDialog({ open, onClose, dailyCard, unavailable }: {
    open: boolean;
    onClose: () => void;
    dailyCard: DrawnCard | null;
    /** 今日一牌抽取失败 */
    unavailable: boolean;
}) {
    const titleId = useId();
    const reversed = dailyCard?.orientation === 'reversed';

    return (
        <Modal open={open} onClose={onClose} labelledBy={titleId}>
            <div className="flex flex-col gap-4 p-5">
                <div className="flex items-center justify-between gap-3">
                    <h2 id={titleId} className="font-display text-lg font-medium">每日一牌 · 今日指引</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="关闭"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
                {dailyCard ? (
                    <div className="flex items-start gap-4">
                        <div className="relative aspect-[4/7] w-24 shrink-0 overflow-hidden rounded-[10px] border-[0.5px] border-foreground/20 bg-surface shadow-[0_4px_14px_rgba(20,20,19,0.08)]">
                            <TarotCardFace image={dailyCard.card.image} name={dailyCard.card.nameChinese} reversed={reversed} />
                        </div>
                        <div className="flex min-w-0 flex-col gap-2">
                            <p className="flex flex-wrap items-center gap-2 font-display text-xl">
                                {dailyCard.card.nameChinese}
                                <TarotOrientationChip reversed={reversed} />
                            </p>
                            <p className="text-sm leading-relaxed text-foreground">
                                {reversed ? dailyCard.card.reversedMeaning : dailyCard.card.uprightMeaning}
                            </p>
                            <p className="text-xs text-foreground-tertiary">每天自动抽取一张，作为当天的提醒。</p>
                        </div>
                    </div>
                ) : (
                    <p className="py-6 text-center text-sm text-foreground-secondary">
                        {unavailable ? '今日一牌暂时无法抽取，请稍后再试。' : '正在抽取今日一牌…'}
                    </p>
                )}
            </div>
        </Modal>
    );
}
