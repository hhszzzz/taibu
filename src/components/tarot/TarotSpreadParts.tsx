/**
 * 塔罗牌阵的纯展示部件
 *
 * 结果页与对话内牌阵视图（TarotChart）共用：正逆位标签、位置序号、牌义列表与牌义卡片网格。
 * 不含状态与数据请求，只消费已有的抽牌/规范化数据。
 */
import type { ReactNode } from 'react';
import { getTarotElementToneClass, summarizeTarotElements } from './tarot-display';

const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] as const;

export function TarotOrientationChip({ reversed, className = '' }: { reversed: boolean; className?: string }) {
    return (
        <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[0.6875rem] leading-4 ${reversed ? 'bg-fire-soft text-fire' : 'bg-wood-soft text-wood'} ${className}`}>
            {reversed ? '逆位' : '正位'}
        </span>
    );
}

/** “① 过去” 形式的位置标签；超出 10 张时退化为数字序号。 */
export function TarotPositionLabel({ index, children, className = '' }: { index: number; children: ReactNode; className?: string }) {
    return (
        <span className={`inline-flex min-w-0 items-center gap-1 text-xs text-foreground-secondary ${className}`}>
            <span aria-hidden="true" className="shrink-0">{CIRCLED_NUMBERS[index] ?? `${index + 1}.`}</span>
            <span className="min-w-0 line-clamp-2">{children}</span>
        </span>
    );
}

export interface TarotMeaningEntry {
    key: string;
    name: string;
    reversed: boolean;
    keywords: readonly string[];
    element?: string;
    astro?: string;
}

function formatElementLine(entry: TarotMeaningEntry): string {
    return [entry.element ? `${entry.element}元素` : null, entry.astro].filter(Boolean).join(' · ');
}

/** 牌义列表卡（移动端 / 对话视图）：逐张列出关键词，元素按语义色标注，标题右侧给出元素概括。 */
export function TarotMeaningList({ entries, title = '牌义', className = '' }: {
    entries: readonly TarotMeaningEntry[];
    title?: string;
    className?: string;
}) {
    if (entries.length === 0) return null;
    const summary = summarizeTarotElements(entries.map((entry) => entry.element));
    return (
        <section aria-label={title} className={`flex flex-col gap-1 rounded-2xl border-[0.5px] border-border bg-surface p-4 ${className}`}>
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-[17px] font-medium">{title}</h2>
                {summary && <span className="text-xs text-foreground-secondary">{summary}</span>}
            </div>
            <ul className="flex flex-col">
                {entries.map((entry) => {
                    const elementLine = formatElementLine(entry);
                    return (
                        <li key={entry.key} className="flex flex-col gap-1 border-t-[0.5px] border-border py-3 last:pb-0">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                <span className="font-display text-base">{entry.name} · {entry.reversed ? '逆位' : '正位'}</span>
                                {elementLine && <span className={`text-[11px] ${getTarotElementToneClass(entry.element)}`}>{elementLine}</span>}
                            </div>
                            {entry.keywords.length > 0 && (
                                <p className="text-[13px] leading-relaxed text-foreground">{entry.keywords.join('、')}</p>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

/** 牌义卡片网格（结果页宽屏）：每张牌一张卡，宽度允许时三列排布。 */
export function TarotMeaningGrid({ entries, className = '' }: { entries: readonly TarotMeaningEntry[]; className?: string }) {
    if (entries.length === 0) return null;
    return (
        <section aria-label="牌义" className={`grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3 ${className}`}>
            {entries.map((entry) => {
                const elementLine = formatElementLine(entry);
                return (
                    <article key={entry.key} className="flex min-w-0 flex-col gap-2 rounded-[14px] border-[0.5px] border-border bg-surface p-[18px]">
                        <h3 className="font-display text-[17px] font-normal">{entry.name} · {entry.reversed ? '逆位' : '正位'}</h3>
                        {entry.keywords.length > 0 && <p className="text-sm leading-relaxed text-foreground">{entry.keywords.join('、')}</p>}
                        {elementLine && <p className="text-xs text-foreground-secondary">{elementLine}</p>}
                    </article>
                );
            })}
        </section>
    );
}
