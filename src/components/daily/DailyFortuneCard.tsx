import Link from 'next/link';
import { ChevronDown, Share2 } from 'lucide-react';
import { FortuneTrendChart, type FortuneTrendDataPoint } from '@/components/fortune/FortuneTrendChart';
import { InterpretationModeToggle, type InterpretationMode } from '@/components/fortune/InterpretationModeToggle';
import { FORTUNE_CARD_CLASS, FORTUNE_SECONDARY_BUTTON_CLASS, getFortuneTone } from '@/components/fortune/fortune-display';
import { FORTUNE_DIMENSIONS, fortuneLevelToChartValue, type DailyFortune } from '@/lib/divination/fortune';

interface DailyFortuneCardProps {
    fortune: DailyFortune;
    isPersonalized: boolean;
    chartName?: string;
    /** 当日干支（个性化与通用模式均显示）。 */
    dayGanZhi: string;
    /** 卡片标题：个性化为流日十神基调，通用为首条建议。 */
    headline: string;
    /** 切换命盘；缺省时命主姓名只读。 */
    onChartSelect?: () => void;
    /** 未个性化时的引导链接；null 表示不引导（如八字功能关闭）。 */
    personalizeHref?: string | null;
}

/**
 * 日运卡：基调标题 + 综合等级 + 五维等级条。
 * 运势只以等级呈现（fortune.ts 约定不对用户展示数值分），条形长度仅为等级的视觉映射。
 */
export function DailyFortuneCard({
    fortune,
    isPersonalized,
    chartName,
    dayGanZhi,
    headline,
    onChartSelect,
    personalizeHref = null,
}: DailyFortuneCardProps) {
    return (
        <section aria-labelledby="daily-fortune-title" className={`${FORTUNE_CARD_CLASS} flex h-full flex-col gap-3 p-4 lg:gap-4 lg:p-6`}>
            <div className="flex items-center justify-between gap-4 lg:items-start">
                <div className="flex min-w-0 flex-col gap-0.5 lg:gap-1">
                    <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-foreground-secondary lg:text-[0.8125rem]">
                        <span>{isPersonalized ? '个性化日运' : '通用日运'}</span>
                        {/* 命主与切换入口仅桌面端显示；移动端由顶栏菜单「切换命盘」承担 */}
                        {isPersonalized && chartName && (
                            <span className="hidden items-center gap-x-1 lg:inline-flex">
                                <span aria-hidden="true">·</span>
                                {onChartSelect ? (
                                    <button
                                        type="button"
                                        onClick={onChartSelect}
                                        aria-label={`切换命盘，当前 ${chartName}`}
                                        className="inline-flex max-w-[9rem] items-center gap-0.5 rounded transition-colors hover:text-foreground"
                                    >
                                        <span className="truncate">{chartName}</span>
                                        <ChevronDown className="size-3 shrink-0" />
                                    </button>
                                ) : (
                                    <span className="max-w-[9rem] truncate">{chartName}</span>
                                )}
                            </span>
                        )}
                        {dayGanZhi && <><span aria-hidden="true">·</span><span>流日{dayGanZhi}</span></>}
                    </p>
                    <h2 id="daily-fortune-title" className="font-display text-base leading-snug lg:text-xl lg:font-medium">{headline}</h2>
                </div>
                <p className="shrink-0 text-right">
                    <span className="sr-only">综合运势</span>
                    <span className="font-display text-[2.25rem] leading-none text-accent-strong lg:text-[2.5rem] lg:text-accent">{fortune.overall}</span>
                </p>
            </div>

            {/* 卡片被右侧问答卡撑高时，等级条均匀铺满剩余高度 */}
            <ul className="flex flex-1 flex-col justify-between gap-3 lg:gap-2.5">
                {FORTUNE_DIMENSIONS.map((item) => {
                    const level = fortune[item.key];
                    return (
                        <li key={item.key} className="grid grid-cols-[56px_minmax(0,1fr)_28px] items-center gap-2 text-[0.8125rem] lg:gap-3 lg:text-sm">
                            <span className="text-foreground-secondary lg:text-foreground">{item.label}</span>
                            <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-background-secondary">
                                <span
                                    className="block h-full rounded-full bg-clay transition-[width] duration-700 ease-out"
                                    style={{ width: `${fortuneLevelToChartValue(level)}%` }}
                                />
                            </span>
                            <span className={`text-right ${getFortuneTone(level) === 'unfavorable' ? 'text-danger' : 'text-foreground lg:text-foreground-secondary'}`}>{level}</span>
                        </li>
                    );
                })}
            </ul>

            {!isPersonalized && personalizeHref && (
                <Link
                    href={personalizeHref}
                    className="mt-auto inline-flex items-center gap-1 self-start text-[13px] text-accent underline-offset-2 hover:underline"
                >
                    排一张八字命盘，查看个性化日运
                    <span aria-hidden="true">→</span>
                </Link>
            )}
        </section>
    );
}

interface DailyFortuneInsightsProps {
    fortune: DailyFortune;
    isPersonalized: boolean;
    /** 已按解读模式生成的建议（个性化）或通用建议。 */
    advice: string[];
    interpretationMode: InterpretationMode;
    onInterpretationModeChange: (mode: InterpretationMode) => void;
    /** 7 日趋势（仅个性化模式有数据）。 */
    trendData: FortuneTrendDataPoint[];
    onShare: () => void;
}

/** 运势详解：7 日趋势、幸运色 / 吉方位与运势指引（三种解读口吻），附分享入口。 */
export function DailyFortuneInsights({
    fortune,
    isPersonalized,
    advice,
    interpretationMode,
    onInterpretationModeChange,
    trendData,
    onShare,
}: DailyFortuneInsightsProps) {
    const hasTrend = isPersonalized && trendData.length > 0;
    const hasLucky = isPersonalized && Boolean(fortune.luckyColor);

    return (
        <section aria-labelledby="daily-insights-title" className={`${FORTUNE_CARD_CLASS} flex flex-col gap-5 p-[18px] lg:p-6`}>
            <div className="flex items-center justify-between gap-3">
                <h2 id="daily-insights-title" className="font-display text-[1.0625rem] lg:text-lg">运势详解</h2>
                <button type="button" onClick={onShare} className={`${FORTUNE_SECONDARY_BUTTON_CLASS} h-8 px-2.5 text-xs`}>
                    <Share2 className="size-3.5" />
                    分享运势
                </button>
            </div>

            <div className={`grid gap-6 ${hasTrend ? 'lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-8' : ''}`}>
                {hasTrend && (
                    <FortuneTrendChart
                        data={trendData}
                        selectedDate={fortune.date}
                        height={200}
                        multiDimension={false}
                        title={<span className="font-display text-base font-normal">7 日运势趋势</span>}
                    />
                )}

                <div className="flex min-w-0 flex-col gap-5">
                    {hasLucky && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1 rounded-xl bg-panel px-3.5 py-3">
                                <span className="text-xs text-foreground-secondary">幸运色</span>
                                <span className="text-sm font-medium">{fortune.luckyColor}</span>
                            </div>
                            <div className="flex flex-col gap-1 rounded-xl bg-panel px-3.5 py-3">
                                <span className="text-xs text-foreground-secondary">吉方位</span>
                                <span className="text-sm font-medium">{fortune.luckyDirection}</span>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-display text-base">运势指引</h3>
                            {isPersonalized && (
                                <InterpretationModeToggle
                                    mode={interpretationMode}
                                    onModeChange={onInterpretationModeChange}
                                    compact
                                />
                            )}
                        </div>
                        <ol className="flex flex-col gap-2.5">
                            {advice.map((item, index) => (
                                <li key={index} className="flex gap-3 text-sm leading-relaxed">
                                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-background-secondary text-[11px] font-medium text-foreground-secondary">
                                        {index + 1}
                                    </span>
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ol>
                    </div>
                </div>
            </div>
        </section>
    );
}
