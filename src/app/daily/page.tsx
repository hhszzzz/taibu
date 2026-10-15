/**
 * 日运 · 黄历页面
 *
 * 黄历细项与时辰吉凶对所有人可见；有可用八字命盘时展示个性化日运，否则为通用日运。
 * 'use client'：依赖 URL 日期参数、会话、命盘查询与本地交互状态。
 */
'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeftRight, Share2, X } from 'lucide-react';

import { AuthModal } from '@/components/auth/AuthModal';
import { ChartPickerModal, type ChartItem } from '@/components/common/ChartPickerModal';
import { CalendarAlmanac } from '@/components/daily/CalendarAlmanac';
import { DailyAIChat } from '@/components/daily/DailyAIChat';
import { DailyFortuneCard, DailyFortuneInsights } from '@/components/daily/DailyFortuneCard';
import { toLocalDateKey } from '@/components/daily/useDailyAlmanacDetail';
import type { FortuneTrendDataPoint } from '@/components/fortune/FortuneTrendChart';
import type { InterpretationMode } from '@/components/fortune/InterpretationModeToggle';
import { FORTUNE_SECONDARY_BUTTON_CLASS } from '@/components/fortune/fortune-display';
import { ShareCard } from '@/components/fortune/ShareCard';
import { FeatureGate } from '@/components/layout/FeatureGate';
import { useHeaderMenu, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { getCalendarAlmanac } from '@/lib/divination/calendar';
import { calculateDailyFortune, calculateGenericDailyFortune, calculateWeeklyTrend, type DailyFortune } from '@/lib/divination/fortune';
import { generateFortuneInterpretation, getDailyHeadline } from '@/lib/divination/fortune-interpretations';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useSelectedBaziChart } from '@/lib/hooks/useUserCharts';

const PAGE_CONTAINER_CLASS = 'mx-auto flex w-full max-w-[1104px] flex-col gap-4 px-4 pt-1 pb-5 lg:gap-7 lg:px-8 lg:pt-10 lg:pb-14';
/** 移动端问答输入框固定在底部导航之上，页尾需让出其高度。 */
const PAGE_ASSISTANT_PADDING_CLASS = 'max-lg:pb-24';
const SKELETON_BLOCK_CLASS = 'animate-pulse bg-background-secondary';
const MENU_ICON_CLASS = 'size-4';

// 解析日期字符串
function parseDateParam(dateStr: string | null): Date {
    if (!dateStr) return new Date();

    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const day = parseInt(parts[2]);
        if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
            return new Date(year, month, day);
        }
    }
    return new Date();
}

function DailyPageContent() {
    const searchParams = useSearchParams();
    const { isFeatureEnabled, loaded: featureTogglesLoaded, isLoading: featureToggleLoading } = useFeatureToggles();
    const { user, loading: sessionLoading } = useSessionSafe();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const baziFeatureEnabled = !featureToggleLoading && isFeatureEnabled('bazi');
    // 与 AIFeatureGate 一致的 fail-closed 判断：开关未加载或关闭时不渲染问答
    const aiEnabled = featureTogglesLoaded && isFeatureEnabled('chat');
    const dateParam = searchParams.get('date');
    const [dateSelection, setDateSelection] = useState(() => ({ param: dateParam, date: parseDateParam(dateParam) }));
    if (dateSelection.param !== dateParam) setDateSelection({ param: dateParam, date: parseDateParam(dateParam) });
    const selectedDate = dateSelection.date;
    const chartsQuery = useSelectedBaziChart(user?.id, { enabled: !sessionLoading && baziFeatureEnabled });
    const baziChart = chartsQuery.chart;
    const loading = sessionLoading || chartsQuery.isLoading;
    const chartLoadError = chartsQuery.error?.message ?? null;
    const [showChartSelector, setShowChartSelector] = useState(false);
    const [showShareCard, setShowShareCard] = useState(false);
    const [interpretationMode, setInterpretationMode] = useState<InterpretationMode>('colloquial');

    const [showAuthModal, setShowAuthModal] = useState(false);

    // 计算运势
    const fortune = useMemo(() => {
        if (baziChart) {
            return calculateDailyFortune(baziChart.output, selectedDate);
        }
        const generic = calculateGenericDailyFortune(selectedDate);
        return {
            ...generic,
            date: toLocalDateKey(selectedDate),
            dayStem: undefined as unknown,
            dayBranch: '',
            tenGod: '',
            luckyColor: '',
            luckyDirection: '',
        } as DailyFortune;
    }, [baziChart, selectedDate]);

    const changeDate = useCallback((days: number) => {
        setDateSelection((current) => {
            const next = new Date(current.date);
            next.setDate(next.getDate() + days);
            return { param: current.param, date: next };
        });
    }, []);

    const pickDate = useCallback((date: Date) => {
        setDateSelection((current) => ({ param: current.param, date }));
    }, []);

    const goToToday = useCallback(() => {
        setDateSelection((current) => ({ param: current.param, date: new Date() }));
    }, []);

    const handleSelectChart = (chart: ChartItem) => {
        chartsQuery.selectChart(chart.id);
        setShowChartSelector(false);
    };

    const openShareCard = useCallback(() => setShowShareCard(true), []);
    const openChartSelector = useCallback(() => setShowChartSelector(true), []);
    const openAuthModal = useCallback(() => setShowAuthModal(true), []);

    const isToday = selectedDate.toDateString() === new Date().toDateString();
    const isPersonalized = !!baziChart;
    const canSwitchChart = baziFeatureEnabled && Boolean(user);

    // 计算周趋势数据（用于趋势图）
    const trendData = useMemo((): FortuneTrendDataPoint[] => {
        if (!baziChart) return [];
        const weekData = calculateWeeklyTrend(baziChart.output, selectedDate);
        return weekData.map(d => ({
            date: d.date,
            fullDate: d.fullDate,
            dayOfMonth: d.dayOfMonth,
            scores: d.scores,
        }));
    }, [baziChart, selectedDate]);

    // 根据解读模式生成建议
    const interpretedAdvice = useMemo(() => {
        if (!baziChart || !fortune.tenGod) return fortune.advice;
        return generateFortuneInterpretation(
            fortune.tenGod,
            {
                overall: fortune.overall,
                career: fortune.career,
                love: fortune.love,
                wealth: fortune.wealth,
                health: fortune.health,
                social: fortune.social,
            },
            interpretationMode
        );
    }, [baziChart, fortune, interpretationMode]);

    // 黄历：日运卡的流日干支与分享卡片的宜忌
    const almanac = useMemo(() => getCalendarAlmanac(selectedDate), [selectedDate]);
    // 个性化：流日十神基调；通用：首条建议
    const headline = getDailyHeadline(fortune.tenGod) ?? fortune.advice[0] ?? '';
    // 问答上下文：有命盘时附带当日个性化运势（仅十神与等级）
    const personalFortune = useMemo(
        () => (baziChart ? { chartName: baziChart.name, fortune } : null),
        [baziChart, fortune],
    );

    // 移动端顶栏三点菜单：分享与切换命盘（桌面端入口在运势卡与运势详解中）
    const menuItems = useMemo((): HeaderMenuItem[] => [
        { id: 'share', label: '分享运势', icon: <Share2 className={MENU_ICON_CLASS} />, onClick: openShareCard },
        ...(canSwitchChart
            ? [{ id: 'switch-chart', label: '切换命盘', icon: <ArrowLeftRight className={MENU_ICON_CLASS} />, onClick: openChartSelector }]
            : []),
    ], [canSwitchChart, openShareCard, openChartSelector]);

    useEffect(() => {
        if (loading) return;
        setMenuItems(menuItems);
        return () => clearMenuItems();
    }, [loading, menuItems, setMenuItems, clearMenuItems]);

    if (loading) {
        return (
            <div className="min-h-screen bg-background">
                <DailyPageSkeleton />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className={`${PAGE_CONTAINER_CLASS} ${aiEnabled ? PAGE_ASSISTANT_PADDING_CLASS : ''} animate-fade-in`}>
                {chartLoadError ? (
                    <section role="alert" className="rounded-2xl border-[0.5px] border-danger/30 bg-fire-soft px-4 py-4 lg:px-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                                <h2 className="text-sm font-semibold text-danger">命盘加载失败</h2>
                                <p className="text-sm text-foreground-secondary">
                                    {chartLoadError}。当前不会伪装成个性化结果，你可以重试或重新选择命盘。
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

                {/* 分享卡片弹窗（遮罩与 .app-modal::backdrop 一致，深浅色通用） */}
                {showShareCard && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0006] p-4 backdrop-blur-[3px]">
                        <div role="dialog" aria-modal="true" aria-labelledby="daily-share-title" className="w-full max-w-md rounded-2xl border-[0.5px] border-border bg-surface p-5 shadow-md">
                            <div className="mb-5 flex items-center justify-between">
                                <h2 id="daily-share-title" className="flex items-center gap-2 font-display text-lg">
                                    <Share2 className="h-4 w-4 text-accent" />
                                    分享运势
                                </h2>
                                <button
                                    type="button"
                                    aria-label="关闭"
                                    onClick={() => setShowShareCard(false)}
                                    className="rounded-lg p-1.5 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <ShareCard
                                fortune={fortune}
                                date={selectedDate}
                                userName={baziChart?.name}
                                isPersonalized={isPersonalized}
                                almanac={almanac}
                            />
                        </div>
                    </div>
                )}

                <CalendarAlmanac
                    date={selectedDate}
                    isToday={isToday}
                    onDateChange={changeDate}
                    onDatePick={pickDate}
                    onGoToday={goToToday}
                    fortune={(
                        <DailyFortuneCard
                            fortune={fortune}
                            isPersonalized={isPersonalized}
                            chartName={baziChart?.name}
                            dayGanZhi={almanac.ganZhi.day}
                            headline={headline}
                            onChartSelect={canSwitchChart ? openChartSelector : undefined}
                            personalizeHref={baziFeatureEnabled ? '/bazi' : null}
                        />
                    )}
                    assistant={aiEnabled
                        ? <DailyAIChat date={selectedDate} userId={user?.id ?? null} onRequireLogin={openAuthModal} personalFortune={personalFortune} />
                        : null}
                    insights={(
                        <DailyFortuneInsights
                            fortune={fortune}
                            isPersonalized={isPersonalized}
                            advice={interpretedAdvice}
                            interpretationMode={interpretationMode}
                            onInterpretationModeChange={setInterpretationMode}
                            trendData={trendData}
                            onShare={openShareCard}
                        />
                    )}
                />
            </div>

            <AuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
            />
        </div>
    );
}

/** 日运页骨架：与正式布局同构（桌面黄历主卡 / 移动端日期摘要 + 宜忌），避免加载完成时跳动。 */
function DailyPageSkeleton() {
    return (
        <div className={PAGE_CONTAINER_CLASS} aria-hidden="true">
            <div className="flex items-center justify-center lg:justify-between">
                <div className={`${SKELETON_BLOCK_CLASS} hidden h-10 w-44 rounded-lg lg:block`} />
                <div className={`${SKELETON_BLOCK_CLASS} h-9 w-48 rounded-lg lg:h-10 lg:w-60`} />
            </div>
            <div className="hidden h-[550px] overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface lg:flex">
                <div className="flex w-[280px] shrink-0 flex-col gap-4 border-r-[0.5px] border-border bg-panel p-7">
                    <div className={`${SKELETON_BLOCK_CLASS} h-4 w-36 rounded`} />
                    <div className={`${SKELETON_BLOCK_CLASS} h-20 w-24 rounded-lg`} />
                    <div className={`${SKELETON_BLOCK_CLASS} h-6 w-28 rounded`} />
                    <div className={`${SKELETON_BLOCK_CLASS} h-56 w-full rounded-lg`} />
                </div>
                <div className="flex flex-1 flex-col gap-6 p-7">
                    <div className="grid grid-cols-2 gap-8">
                        <div className={`${SKELETON_BLOCK_CLASS} h-24 rounded-lg`} />
                        <div className={`${SKELETON_BLOCK_CLASS} h-24 rounded-lg`} />
                    </div>
                    <div className={`${SKELETON_BLOCK_CLASS} h-56 w-full rounded-lg`} />
                </div>
            </div>
            <div className="flex flex-col gap-3 lg:hidden">
                <div className={`${SKELETON_BLOCK_CLASS} h-[110px] rounded-2xl`} />
                <div className="grid grid-cols-2 gap-2.5">
                    <div className={`${SKELETON_BLOCK_CLASS} h-32 rounded-2xl`} />
                    <div className={`${SKELETON_BLOCK_CLASS} h-32 rounded-2xl`} />
                </div>
            </div>
            <div className={`${SKELETON_BLOCK_CLASS} h-[72px] rounded-xl lg:h-[100px] lg:rounded-[14px]`} />
            <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.48fr)_minmax(0,1fr)] lg:gap-[18px]">
                <div className={`${SKELETON_BLOCK_CLASS} h-60 rounded-2xl`} />
                <div className={`${SKELETON_BLOCK_CLASS} hidden h-60 rounded-2xl lg:block`} />
            </div>
        </div>
    );
}

export default function DailyPage() {
    return (
        <FeatureGate featureId="daily">
            <Suspense fallback={
                <div className="min-h-screen bg-background">
                    <DailyPageSkeleton />
                </div>
            }>
                <DailyPageContent />
            </Suspense>
        </FeatureGate>
    );
}
