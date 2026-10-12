import Link from 'next/link';
import { FortuneChartOwner } from '@/components/fortune/FortuneChartOwner';
import { FortuneLevelBars } from '@/components/fortune/FortuneLevelBars';
import { FORTUNE_CARD_CLASS, getDailyHref } from '@/components/fortune/fortune-display';
import type { FortuneLevels, MonthlyFortune } from '@/lib/divination/fortune';

type MonthlyKeyDate = MonthlyFortune['keyDates'][number];

interface MonthlyFortuneSummaryProps {
    year: number;
    month: number;
    levels: FortuneLevels;
    /** 月运批语。 */
    summary: string;
    /** 流月干支（如「戊戌」）。 */
    monthGanZhi: string;
    isPersonalized: boolean;
    chartName?: string;
    /** 流月天干对命主日干的十神（仅个性化）。 */
    tenGod?: string;
    /** 本月关键日（仅个性化）。 */
    keyDates?: MonthlyKeyDate[];
    /** 切换命盘；缺省时命主姓名只读。 */
    onChartSelect?: () => void;
    /** 未个性化时的引导链接；null 表示不引导（如八字功能关闭）。 */
    personalizeHref?: string | null;
}

const KEY_DATE_TONE_CLASS: Record<NonNullable<MonthlyKeyDate['type']>, string> = {
    lucky: 'bg-wood-soft text-wood',
    turning: 'bg-accent-light text-accent-strong',
    warning: 'bg-fire-soft text-fire',
};

/** 月运卡：批语 + 综合等级 + 五维等级条 + 本月关键日（跳转对应日运）。 */
export function MonthlyFortuneSummary({
    year,
    month,
    levels,
    summary,
    monthGanZhi,
    isPersonalized,
    chartName,
    tenGod,
    keyDates = [],
    onChartSelect,
    personalizeHref = null,
}: MonthlyFortuneSummaryProps) {
    const sortedKeyDates = [...keyDates].sort((left, right) => left.date - right.date);

    return (
        <section aria-labelledby="monthly-fortune-title" className={`${FORTUNE_CARD_CLASS} flex h-full flex-col gap-3 p-4 lg:gap-4 lg:p-6`}>
            <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5 lg:gap-1">
                    <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-foreground-secondary lg:text-[0.8125rem]">
                        <span>{isPersonalized ? '个性化月运' : '通用月运'}</span>
                        {isPersonalized && chartName && <FortuneChartOwner chartName={chartName} onChartSelect={onChartSelect} />}
                        {monthGanZhi && <><span aria-hidden="true">·</span><span>流月{monthGanZhi}</span></>}
                        {tenGod && <><span aria-hidden="true">·</span><span>十神{tenGod}</span></>}
                    </p>
                    <h2 id="monthly-fortune-title" className="font-display text-base leading-relaxed lg:text-lg">{summary}</h2>
                </div>
                <p className="shrink-0 text-right">
                    <span className="sr-only">综合运势</span>
                    <span className="font-display text-[2.25rem] leading-none text-accent-strong lg:text-[2.5rem] lg:text-accent">{levels.overall}</span>
                </p>
            </div>

            <FortuneLevelBars levels={levels} />

            {/* 卡片与月历同高：关键日 / 排盘引导贴底 */}
            {sortedKeyDates.length > 0 && (
                <div className="mt-auto flex flex-col gap-2 border-t-[0.5px] border-border pt-3.5">
                    <h3 className="text-xs text-foreground-secondary">本月关键日</h3>
                    <ul className="flex flex-wrap gap-1.5">
                        {sortedKeyDates.map((item) => (
                            <li key={item.date}>
                                <Link
                                    href={getDailyHref(year, month, item.date)}
                                    className={`inline-flex items-center gap-1 rounded-md px-2 py-[3px] text-[13px] transition-opacity hover:opacity-80 ${item.type ? KEY_DATE_TONE_CLASS[item.type] : 'bg-background-secondary text-foreground-secondary'}`}
                                >
                                    <span className="tabular-nums">{item.date} 日</span>
                                    <span>{item.desc}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {!isPersonalized && personalizeHref && (
                <div className="mt-auto flex flex-col items-start gap-1.5 rounded-xl bg-panel px-4 py-3.5 text-[13px]">
                    <p className="text-foreground-secondary">通用月运按流月干支推算；排一张八字命盘，可查看流月十神、本月关键日与运势起伏。</p>
                    <Link href={personalizeHref} className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline">
                        排一张八字命盘，查看个性化月运
                        <span aria-hidden="true">→</span>
                    </Link>
                </div>
            )}
        </section>
    );
}
