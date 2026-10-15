/**
 * 结果页可翻转的单张塔罗牌
 *
 * 纯展示：未翻开显示牌背；翻开后显示真实牌面（逆位旋转 180°），再次点击翻到牌义背面。
 * 翻牌状态由页面持有并通过 props 传入。尺寸按牌阵区块的 @container 宽度切换。
 */
'use client'; // 由客户端结果页渲染，onClick 回调来自页面状态

import { Sparkles } from 'lucide-react';
import { TarotCardFace } from '@/components/tarot/TarotCardFace';
import { TarotOrientationChip, TarotPositionLabel } from '@/components/tarot/TarotSpreadParts';

const FACE_STYLE = { backfaceVisibility: 'hidden' } as const;
const BACK_FACE_STYLE = { backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' } as const;

/** 牌框：窄屏 10px 圆角 + 轻阴影，宽屏 14px 圆角 + 更深的投影（设计稿 TarotResult / MobileTarot）。 */
const CARD_FRAME_CLASS = 'absolute inset-0 overflow-hidden rounded-[10px] border-[0.5px] border-foreground/20 bg-surface shadow-[0_4px_14px_rgba(20,20,19,0.08)] @2xl:rounded-[14px] @2xl:shadow-[0_10px_30px_rgba(20,20,19,0.08)]';

export function TarotRevealCard({ index, positionName, name, image, meaning, reversed, isRevealed, isFlipped, onClick, large = false }: {
    index: number;
    positionName: string;
    name: string;
    image: string;
    meaning: string;
    reversed: boolean;
    isRevealed: boolean;
    isFlipped: boolean;
    onClick: () => void;
    /** 单牌牌阵放大展示 */
    large?: boolean;
}) {
    const actionLabel = !isRevealed
        ? `翻开第 ${index + 1} 张牌（${positionName}）`
        : isFlipped ? `返回牌面：${name}` : `查看牌义：${name}`;

    return (
        <div className="flex w-full min-w-0 flex-col items-center gap-2 @2xl:gap-3.5">
            <TarotPositionLabel index={index} className="@2xl:text-[0.8125rem]">{positionName}</TarotPositionLabel>
            <div className={`w-full ${large ? 'max-w-[140px] @2xl:max-w-[200px]' : 'max-w-[100px] @md:max-w-[140px] @2xl:max-w-[180px]'}`} style={{ perspective: '1000px' }}>
                <button
                    type="button"
                    onClick={onClick}
                    aria-label={actionLabel}
                    className="relative block aspect-[4/7] w-full rounded-[10px] transition-transform duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background @2xl:rounded-[14px]"
                    style={{ transformStyle: 'preserve-3d', transform: isFlipped ? 'rotateY(180deg)' : undefined }}
                >
                    <span className={CARD_FRAME_CLASS} style={FACE_STYLE}>
                        {isRevealed ? (
                            <TarotCardFace image={image} name={name} reversed={reversed} />
                        ) : (
                            <span className="absolute inset-0 flex items-center justify-center bg-accent-light">
                                <span className="absolute inset-1.5 rounded-[6px] border-[0.5px] border-clay/40" />
                                <Sparkles className="h-6 w-6 text-clay" aria-hidden="true" />
                            </span>
                        )}
                    </span>
                    <span className={`${CARD_FRAME_CLASS} flex flex-col p-3 text-left`} style={BACK_FACE_STYLE}>
                        <span className="truncate font-display text-sm">{name}</span>
                        <span className="mt-1.5 flex-1 overflow-y-auto text-[11px] leading-relaxed text-foreground-secondary">
                            {meaning}
                        </span>
                    </span>
                </button>
            </div>
            <div className={`flex flex-col items-center gap-2 text-center transition-opacity ${isRevealed ? 'opacity-100' : 'opacity-0'}`} aria-hidden={!isRevealed}>
                <span className="text-[0.8125rem] @2xl:font-display @2xl:text-[0.9375rem]">{name}</span>
                <TarotOrientationChip reversed={reversed} className="@2xl:rounded-full @2xl:px-2.5 @2xl:text-xs" />
            </div>
        </div>
    );
}
