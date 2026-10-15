/**
 * 塔罗入口页的牌阵选择网格
 *
 * 每张卡片画出牌阵缩略形状（马蹄形拱起、抉择以竖线分隔、牌多时以 +N 省略），
 * 选中态为陶土色描边。点选只改变选择，抽牌由页面的「开始洗牌」发起。
 */
import type { TarotSpread } from '@/lib/divination/tarot';

/** 卡片上的一句话用途，比牌阵说明更短；未登记的牌阵退回牌阵说明。 */
const SPREAD_TAGLINES: Record<string, string> = {
    single: '当前状况的一句提醒',
    'three-card': '过去 · 现在 · 未来',
    love: '你 · 对方 · 关系 · 建议',
    'celtic-cross': '全面深入的经典牌阵',
    horseshoe: '障碍、环境与可能结果',
    decision: '比较两个选项的走向',
    'mind-body-spirit': '心智 · 身体 · 灵性',
    situation: '理清卡住的地方',
    'yes-no': '一个明确的倾向',
};

/** 缩略图最多直接画出的牌数，超出部分以「+N」表示。 */
const GLYPH_MAX_CARDS = 6;
/** 马蹄形七张牌的抬升高度（px）：两端低、中间高。 */
const HORSESHOE_LIFTS = [0, 8, 14, 18, 14, 8, 0] as const;

function GlyphCard({ compact, selected, lift = 0 }: { compact: boolean; selected: boolean; lift?: number }) {
    return (
        <span
            style={lift ? { marginBottom: lift } : undefined}
            className={`shrink-0 border ${compact ? 'h-5 w-3 rounded-[2px]' : 'h-[30px] w-[18px] rounded-[3px]'} ${
                selected ? 'border-clay bg-surface' : 'border-border-hover bg-sidebar'
            }`}
        />
    );
}

function SpreadGlyph({ spread, selected }: { spread: TarotSpread; selected: boolean }) {
    if (spread.id === 'horseshoe') {
        return (
            <span aria-hidden="true" className="flex h-11 items-end gap-[3px]">
                {HORSESHOE_LIFTS.map((lift, index) => <GlyphCard key={index} compact selected={selected} lift={lift} />)}
            </span>
        );
    }
    if (spread.id === 'decision') {
        // 当前处境 | 两个选项
        return (
            <span aria-hidden="true" className="flex h-11 items-center gap-1">
                <GlyphCard compact={false} selected={selected} />
                <span className={`mx-1 h-[30px] w-px ${selected ? 'bg-clay' : 'bg-border-hover'}`} />
                <GlyphCard compact={false} selected={selected} />
                <GlyphCard compact={false} selected={selected} />
            </span>
        );
    }
    const compact = spread.cardCount > 4;
    const drawn = Math.min(spread.cardCount, GLYPH_MAX_CARDS);
    return (
        <span aria-hidden="true" className={`flex h-11 items-center ${compact ? 'gap-[3px]' : 'gap-1'}`}>
            {Array.from({ length: drawn }, (_, index) => <GlyphCard key={index} compact={compact} selected={selected} />)}
            {spread.cardCount > drawn && <span className="ml-1 text-xs text-foreground-tertiary">+{spread.cardCount - drawn}</span>}
        </span>
    );
}

export function TarotSpreadPicker({ spreads, selectedId, onSelect, labelledBy }: {
    spreads: readonly TarotSpread[];
    selectedId: string;
    onSelect: (spreadId: string) => void;
    /** 区块标题的 id，供按钮组朗读 */
    labelledBy: string;
}) {
    return (
        <div role="group" aria-labelledby={labelledBy} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
            {spreads.map((spread) => {
                const selected = spread.id === selectedId;
                return (
                    <button
                        key={spread.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onSelect(spread.id)}
                        className={`flex min-w-0 flex-col gap-3 rounded-[14px] border-[0.5px] p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:gap-3.5 sm:p-[18px] ${
                            selected
                                ? 'border-accent bg-accent-light ring-1 ring-inset ring-accent'
                                : 'border-border bg-surface hover:border-border-hover hover:bg-background'
                        }`}
                    >
                        <SpreadGlyph spread={spread} selected={selected} />
                        <span className="flex w-full flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                            <span className="text-[15px] font-medium text-foreground">{spread.name}</span>
                            <span className={`text-[13px] ${selected ? 'text-accent-strong' : 'text-foreground-secondary'}`}>{spread.cardCount} 张</span>
                        </span>
                        <span className="text-[13px] leading-relaxed text-foreground-secondary">{SPREAD_TAGLINES[spread.id] ?? spread.description}</span>
                    </button>
                );
            })}
        </div>
    );
}
