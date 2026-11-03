/**
 * 结果页可翻转的单张塔罗牌
 *
 * 纯展示：未翻开显示纯白牌背；翻开后 3D 翻转到牌面（逆位旋转 180°）。
 * 翻牌状态由页面持有并通过 props 传入。尺寸按牌阵区块的 @container 宽度切换。
 */
'use client'; // 由客户端结果页渲染，onClick 回调来自页面状态

import { Button } from '@/components/ui/Button';
import { TarotCardFace } from '@/components/tarot/TarotCardFace';
import { TarotOrientationChip, TarotPositionLabel } from '@/components/tarot/TarotSpreadParts';

const HIDDEN_FACE_STYLE = { backfaceVisibility: 'hidden' } as const;
const BACK_FACE_STYLE = { backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' } as const;

/** 牌框：窄屏 10px 圆角 + 轻阴影，宽屏 14px 圆角 + 更深的投影（设计稿 TarotResult / MobileTarot）。 */
const CARD_FRAME_CLASS = 'absolute inset-0 overflow-hidden rounded-xl border-[0.5px] border-foreground/20 bg-surface shadow-[var(--shadow-md)] @2xl:rounded-2xl @2xl:shadow-[var(--shadow-lg)]';

const FLIP_TRANSITION = 'transform 650ms cubic-bezier(0.22, 0.61, 0.36, 1)';

export function TarotRevealCard({ index, positionName, name, image, reversed, isRevealed, onClick, large = false }: {
    index: number;
    positionName: string;
    name: string;
    image: string;
    reversed: boolean;
    isRevealed: boolean;
    onClick: () => void;
    /** 单牌牌阵放大展示 */
    large?: boolean;
}) {
    const actionLabel = isRevealed ? name : `翻开第 ${index + 1} 张牌（${positionName}）`;

    return (
        <div className="flex w-full min-w-0 flex-col items-center gap-2 @2xl:gap-3.5">
            <TarotPositionLabel index={index} className="@2xl:text-[0.8125rem]">{positionName}</TarotPositionLabel>
            <div className={`w-full ${large ? 'max-w-[140px] @2xl:max-w-[200px]' : 'max-w-[100px] @md:max-w-[140px] @2xl:max-w-[180px]'}`} style={{ perspective: '1000px' }}>
                <Button unstyled
                    type="button"
                    onClick={onClick}
                    aria-label={actionLabel}
                    className="relative block aspect-[4/7] w-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background @2xl:rounded-2xl"
                >
                    <span
                        className="absolute inset-0"
                        style={{ transformStyle: 'preserve-3d', transform: isRevealed ? 'rotateY(0deg)' : 'rotateY(180deg)', transition: FLIP_TRANSITION }}
                    >
                        <span className={`${CARD_FRAME_CLASS} bg-white`} style={BACK_FACE_STYLE} />
                        <span className={CARD_FRAME_CLASS} style={HIDDEN_FACE_STYLE}>
                            <TarotCardFace image={image} name={name} reversed={reversed} />
                        </span>
                    </span>
                </Button>
            </div>
            <div className={`flex flex-col items-center gap-2 text-center transition-opacity delay-300 ${isRevealed ? 'opacity-100' : 'opacity-0'}`} aria-hidden={!isRevealed}>
                <span className="text-[0.8125rem] @2xl:font-display @2xl:text-[0.9375rem]">{name}</span>
                <TarotOrientationChip reversed={reversed} className="@2xl:rounded-full @2xl:px-2.5 @2xl:text-xs" />
            </div>
        </div>
    );
}
