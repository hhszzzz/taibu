import type { ReactNode } from 'react';

export type BoardFact = { label: string; value: ReactNode };

/**
 * 盘面下方的信息卡：标签列按最长标签取宽，一行一项；值为空的项不显示。
 * 奇门、六壬、太乙、梅花、占星的工作区视图共用，避免各自堆叠原始字段。
 */
export function BoardFacts({ label, facts }: { label: string; facts: ReadonlyArray<BoardFact | null | false | undefined | ''> }) {
    const rows = facts.filter((fact): fact is BoardFact => Boolean(fact) && (fact as BoardFact).value !== '' && (fact as BoardFact).value !== null && (fact as BoardFact).value !== undefined);
    if (!rows.length) return null;
    return <dl aria-label={label} className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl border-[0.5px] border-border bg-surface px-3.5 py-3 text-[0.8125rem] leading-relaxed">
        {rows.map(row => <div key={row.label} className="contents">
            <dt className="whitespace-nowrap text-foreground-tertiary">{row.label}</dt>
            <dd className="min-w-0 break-words text-foreground">{row.value}</dd>
        </div>)}
    </dl>;
}

/** 一组短标签（格局、神煞、课体等）；accent 用于需要突出的一组。 */
export function FactChips({ items, tone = 'neutral' }: { items: readonly string[]; tone?: 'neutral' | 'accent' }) {
    return <span className="flex flex-wrap gap-1">{items.map(item => <span key={item}
        className={`rounded-md px-1.5 py-px text-xs ${tone === 'accent' ? 'bg-accent-light text-accent-strong' : 'bg-background-secondary text-foreground-secondary'}`}>{item}</span>)}</span>;
}
