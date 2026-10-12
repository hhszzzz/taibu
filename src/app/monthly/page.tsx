/**
 * 月运页面
 *
 * 有可用八字命盘时展示个性化月运（流月十神、关键日、运势起伏），否则为通用月运；
 * 每日运程月历可跳转到对应日期的日运。
 * 'use client'：依赖会话、命盘查询与月份切换等交互状态。
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CalendarRange } from 'lucide-react';

import { ChartPickerModal, type ChartItem } from '@/components/common/ChartPickerModal';
import { FortunePeriodNav, PERIOD_NAV_CURRENT_CLASS } from '@/components/fortune/FortunePeriodNav';
import { FortuneTrendChart, type FortuneTrendDataPoint } from '@/components/fortune/FortuneTrendChart';
import { FORTUNE_CARD_CLASS, FORTUNE_SECONDARY_BUTTON_CLASS } from '@/components/fortune/fortune-display';
import { MonthlyFortuneCalendar } from '@/components/fortune/MonthlyFortuneCalendar';
import { MonthlyFortuneSummary } from '@/components/fortune/MonthlyFortuneSummary';
import { FeatureGate } from '@/components/layout/FeatureGate';
import { useHeaderMenu, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { getCalendarAlmanac } from '@/lib/divination/calendar';
import {
    calculateDailyFortune,
    calculateGenericDailyFortune,
    calculateGenericMonthlyFortune,
    calculateMonthlyFortune,
    calculateMonthlyTrend,
} from '@/lib/divination/fortune';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useSelectedBaziChart } from '@/lib/hooks/useUserCharts';

const PAGE_CONTAINER_CLASS = 'mx-auto flex w-full max-w-[1104px] flex-col gap-4 px-4 pt-1 pb-5 lg:gap-7 lg:px-8 lg:pt-10 lg:pb-14';
const SKELETON_BLOCK_CLASS = 'animate-pulse bg-background-secondary';
const MENU_ICON_CLASS = 'size-4';
/** 月份切换范围（与日运日期选择器、历法库可靠区间一致）。 */
const MIN_YEAR = 1901;
const MAX_YEAR = 2099;

function MonthlyPageContent() {
    const { isFeatureEnabled, isLoading: featureToggleLoading } = useFeatureToggles();
    const { user, loading: sessionLoading } = useSessionSafe();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const baziFeatureEnabled = !featureToggleLoading && isFeatureEnabled('bazi');
    const [today] = useState(() => new Date());
    const [{ year, month }, setYearMonth] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() + 1 }));
    const chartsQuery = useSelectedBaziChart(user?.id, { enabled: !sessionLoading && baziFeatureEnabled });
    const baziChart = chartsQuery.chart;
    const loading = sessionLoading || chartsQuery.isLoading;
    const chartLoadError = chartsQuery.error?.message ?? null;
    const [showChartSelector, setShowChartSelector] = useState(false);

    const isPersonalized = !!baziChart;
    const canSwitchChart = baziFeatureEnabled && Boolean(user);
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;

    // 月运：个性化取命盘流月；通用与个性化一致按当月 15 日取流月干支
    const monthly = useMemo(() => {
        if (baziChart) {
            const fortune = calculateMonthlyFortune(baziChart.output, year, month);
            return {
                levels: fortune,
                summary: fortune.summary,
                monthGanZhi: `${fortune.monthStem}${fortune.monthBranch}`,
                tenGod: fortune.tenGod,
                keyDates: fortune.keyDates,
            };
        }
        const fortune = calculateGenericMonthlyFortune(year, month);
        return {
            levels: fortune,
            summary: fortune.summary,
            monthGanZhi: getCalendarAlmanac(new Date(year, month - 1, 15)).ganZhi.month,
            tenGod: undefined,
            keyDates: [],
        };
    }, [baziChart, year, month]);

    // 每日综合等级（月历）
    const dayLevels = useMemo(() => {
        const daysInMonth = new Date(year, month, 0).getDate();
        return Array.from({ length: daysInMonth }, (_, index) => {
            const date = new Date(year, month - 1, index + 1);
            return baziChart ? calculateDailyFortune(baziChart.output, date).overall : calculateGenericDailyFortune(date).overall;
        });
    }, [baziChart, year, month]);

    // 月度趋势（仅个性化）
    const trendData = useMemo((): FortuneTrendDataPoint[] => {
        if (!baziChart) return [];
        return calculateMonthlyTrend(baziChart.output, year, month).map((point) => ({
            date: point.date,
            fullDate: point.fullDate,
            dayOfMonth: point.dayOfMonth,
            scores: point.scores,
            isKeyDate: point.isKeyDate,
            keyDateType: point.keyDateType as FortuneTrendDataPoint['keyDateType'],
            keyDateDesc: point.keyDateDesc,
        }));
    }, [baziChart, year, month]);

    const changeMonth = useCallback((delta: number) => {
        setYearMonth((current) => {
            const next = new Date(current.year, current.month - 1 + delta, 1);
            return { year: next.getFullYear(), month: next.getMonth() + 1 };
        });
    }, []);

    const goToCurrentMonth = useCallback(() => {
        setYearMonth({ year: today.getFullYear(), month: today.getMonth() + 1 });
    }, [today]);

    const openChartSelector = useCallback(() => setShowChartSelector(true), []);

    const handleSelectChart = (chart: ChartItem) => {
        chartsQuery.selectChart(chart.id);
        setShowChartSelector(false);
    };

    // 移动端顶栏三点菜单：切换命盘（桌面端入口在月运卡命主名上）
    const menuItems = useMemo((): HeaderMenuItem[] => (canSwitchChart
        ? [{ id: 'switch-chart', label: '切换命盘', icon: <ArrowLeftRight className={MENU_ICON_CLASS} />, onClick: openChartSelector }]
        : []), [canSwitchChart, openChartSelector]);

    useEffect(() => {
        if (loading) return;
        setMenuItems(menuItems);
        return () => clearMenuItems();
    }, [loading, menuItems, setMenuItems, clearMenuItems]);

    if (loading) {
        return (
            <div className="min-h-screen bg-background">
                <MonthlyPageSkeleton />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className={`${PAGE_CONTAINER_CLASS} animate-fade-in`}>
                {chartLoadError ? (
                    <section role="alert" className="rounded-2xl border-[0.5px] border-danger/30 bg-fire-soft px-4 py-4 lg:px-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                                <h2 className="text-sm font-semibold text-danger">命盘加载失败</h2>
                                <p className="text-sm text-foreground-secondary">
                                    {chartLoadError}。当前不会伪装成个性化月运结果，你可以重试或重新选择命盘。
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => { void chartsQuery.refetch(); }}
                                    className={`${FORTUNE_SECONDARY_BUTTON_CLASS} h-9 px-3 font-medium`}
                                >
                                    重试
                                </button>
                                <button
                                    type="button"
                                    onClick={openChartSelector}
                                    className="h-9 rounded-[10px] bg-accent px-3 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                                >
                                    重新选择命盘
                                </button>
                            </div>
                        </div>
                    </section>
                ) : null}

                <FortunePeriodNav
                    title="月运"
                    prevLabel="上个月"
                    nextLabel="下个月"
                    onPrev={() => changeMonth(-1)}
                    onNext={() => changeMonth(1)}
                    prevDisabled={year <= MIN_YEAR && month <= 1}
                    nextDisabled={year >= MAX_YEAR && month >= 12}
                    reset={isCurrentMonth ? null : { label: '回到本月', shortLabel: '本月', onClick: goToCurrentMonth }}
                    current={(
                        <span aria-live="polite" className={PERIOD_NAV_CURRENT_CLASS}>
                            <CalendarRange aria-hidden="true" className="hidden size-[15px] text-foreground-secondary lg:block" />
                            {year} 年 {month} 月
                        </span>
                    )}
                />

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-4">
                    <MonthlyFortuneSummary
                        year={year}
                        month={month}
                        levels={monthly.levels}
                        summary={monthly.summary}
                        monthGanZhi={monthly.monthGanZhi}
                        isPersonalized={isPersonalized}
                        chartName={baziChart?.name}
                        tenGod={monthly.tenGod}
                        keyDates={monthly.keyDates}
                        onChartSelect={canSwitchChart ? openChartSelector : undefined}
                        personalizeHref={baziFeatureEnabled ? '/bazi' : null}
                    />
                    <MonthlyFortuneCalendar
                        year={year}
                        month={month}
                        dayLevels={dayLevels}
                        keyDates={monthly.keyDates}
                        today={today}
                    />
                </div>

                {trendData.length > 0 && (
                    <section aria-label="运势起伏" className={`${FORTUNE_CARD_CLASS} p-4 lg:p-6`}>
                        <FortuneTrendChart
                            data={trendData}
                            height={260}
                            simplifiedMode
                            hideKeyDateLegend
                            defaultOverallOnly
                            title={<span className="font-display text-[1.0625rem] lg:text-lg">运势起伏</span>}
                        />
                    </section>
                )}
            </div>

            {canSwitchChart && user && (
                <ChartPickerModal
                    isOpen={showChartSelector}
                    onClose={() => setShowChartSelector(false)}
                    onSelect={handleSelectChart}
                    userId={user.id}
                    title="选择八字命盘"
                    filterType="bazi"
                />
            )}
        </div>
    );
}

/** 月运页骨架：与正式布局同构（页头 → 月运卡 | 月历 → 趋势），避免加载完成时跳动。 */
function MonthlyPageSkeleton() {
    return (
        <div className={PAGE_CONTAINER_CLASS} aria-hidden="true">
            <div className="flex items-center justify-center lg:justify-between">
                <div className={`${SKELETON_BLOCK_CLASS} hidden h-10 w-24 rounded-lg lg:block`} />
                <div className={`${SKELETON_BLOCK_CLASS} h-9 w-48 rounded-lg lg:h-10 lg:w-56`} />
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-4">
                <div className={`${SKELETON_BLOCK_CLASS} h-64 rounded-2xl lg:h-[380px]`} />
                <div className={`${SKELETON_BLOCK_CLASS} h-80 rounded-2xl lg:h-[380px]`} />
            </div>
            <div className={`${SKELETON_BLOCK_CLASS} h-72 rounded-2xl`} />
        </div>
    );
}

export default function MonthlyPage() {
    return (
        <FeatureGate featureId="monthly">
            <MonthlyPageContent />
        </FeatureGate>
    );
}
