/**
 * 塔罗展示层常量与纯函数
 *
 * 只把抽牌 / canonical 数据映射为文案与样式 token，不参与抽牌。
 * 结果页、牌阵部件与对话内牌阵视图共用。
 */

/** 牌数的中文量词写法（二用「两」），牌阵最多十张。 */
const CHINESE_COUNTS = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'] as const;

/** 塔罗四元素 → 设计体系中的五行语义色（风无直接对应，取金的中性色）。 */
const ELEMENT_TONE_CLASS: Record<string, string> = {
    火: 'text-fire',
    水: 'text-water',
    土: 'text-earth',
    风: 'text-metal',
};

/**
 * 牌阵网格列数。父容器需带 `@container`，以便在对话侧栏（约 480px）等窄容器中按容器宽度而非视口折行。
 */
export function getTarotSpreadGridClass(count: number): string {
    if (count <= 1) return 'grid-cols-1';
    if (count === 2) return 'grid-cols-2';
    if (count === 3) return 'grid-cols-3';
    if (count === 4) return 'grid-cols-2 @xl:grid-cols-4';
    return 'grid-cols-3 @2xl:grid-cols-5';
}

export function getTarotElementToneClass(element?: string): string {
    return (element && ELEMENT_TONE_CLASS[element]) || 'text-foreground-secondary';
}

/** 3 →「三张」，2 →「两张」；超出十张时用阿拉伯数字。 */
export function formatTarotCardCount(count: number): string {
    return `${CHINESE_COUNTS[count] ?? count}张`;
}

/** 两张及以上且全部同一元素时返回该元素，否则返回 null。 */
export function getUniformTarotElement(elements: ReadonlyArray<string | undefined>): string | null {
    const [first] = elements;
    if (elements.length < 2 || !first) return null;
    return elements.every((element) => element === first) ? first : null;
}

/** 汇总多张牌的元素：全部同元素时给出一句概括（「三张牌都是火元素」），否则按出现次数列出；单张或无元素数据时不汇总。 */
export function summarizeTarotElements(elements: ReadonlyArray<string | undefined>): string | null {
    const uniform = getUniformTarotElement(elements);
    if (uniform) return `${formatTarotCardCount(elements.length)}牌都是${uniform}元素`;
    if (elements.length < 2) return null;
    const counts = new Map<string, number>();
    for (const element of elements) {
        if (element) counts.set(element, (counts.get(element) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) return null;
    return ranked.map(([element, count]) => `${element} ${count}`).join(' · ');
}

/**
 * 解读入口卡的标题与说明。全部翻开且同元素时以元素概括为标题（设计稿「三张牌都是火元素」），
 * 未翻完时不透露元素，避免剧透尚未翻开的牌。
 */
export function getTarotInterpretCopy({ elements, allRevealed, hasQuestion }: {
    elements: ReadonlyArray<string | undefined>;
    allRevealed: boolean;
    hasQuestion: boolean;
}): { title: string; description: string } {
    const count = elements.length;
    const lead = hasQuestion ? '结合你的问题，' : '';
    const summary = allRevealed && getUniformTarotElement(elements) ? summarizeTarotElements(elements) : null;
    if (count <= 1) {
        return { title: summary ?? '听听这张牌的提醒', description: `让太卜${lead}说说这张牌想提醒你什么` };
    }
    const cards = formatTarotCardCount(count);
    return { title: summary ?? `把这${cards}牌串起来`, description: `让太卜${lead}把${cards}牌串成一个完整的故事` };
}
