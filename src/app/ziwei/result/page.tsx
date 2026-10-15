/**
 * 紫微斗数结果页面
 *
 * 'use client'：依赖 URL 参数、会话与本地交互状态（保存、复制、视图切换、时辰微调）。
 */
'use client';

import { useMemo, useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SettingsCenterLink } from '@/components/settings/SettingsCenterLink';
import { Share2, Edit3, Save, Check, Copy, Eye, EyeOff, Plus, Minus, RotateCcw } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import {
    buildZiweiCanonicalJSON,
    calculateZiweiChartBundle,
    calculateZiweiPalaceFlights,
    generateZiweiChartText,
    getZiweiCurrentPeriods,
    resolveZiweiFlightOverlay,
    shiftZiweiBirthHour,
    type ZiweiFormData,
    type ZiweiPalaceFlights,
} from '@/lib/divination/ziwei';
import type { Gender, CalendarType } from '@/types';
import { ZiweiChartGrid } from '@/components/ziwei/ZiweiChartGrid';
import { ZiweiHoroscopePanel, type HoroscopeInfo, type HoroscopeHighlight } from '@/components/ziwei/ZiweiHoroscopePanel';
import { ZiweiFlyingStarPanel } from '@/components/ziwei/ZiweiFlyingStarPanel';
import { ZiweiResultHeader, ZIWEI_MODE_PANEL_ID, ziweiModeTabId, type ZiweiChartMode } from '@/components/ziwei/ZiweiResultHeader';
import { ResultMobileActions } from '@/components/bazi/result/ResultHeader';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { AuthModal } from '@/components/auth/AuthModal';
import { useToast } from '@/components/ui/Toast';
import { useHeaderMenu, useHeaderTitle, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { createSavedChart, loadSavedChart, updateSavedChart } from '@/lib/user/charts-client';
import { useChartMutation } from '@/lib/hooks/useUserCharts';
import { parseBirthTimeString, readBirthTimeOptions, resolveBirthTimeOptions, writeBirthTimeOptions, type BirthTimeResolution } from '@/lib/divination/birth-time';
import { parseLongitude } from '@/lib/divination/place-resolution';
import { useAdminJsonCopy } from '@/lib/admin/useAdminJsonCopy';
import { CopyTextModal } from '@/components/divination/CopyTextModal';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';

const PRIMARY_BUTTON_CLASS = 'inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover';
const HINT_BUTTON_CLASS = 'inline-flex h-10 items-center rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3.5 text-sm text-foreground transition-colors hover:bg-background-secondary aria-pressed:border-accent/40 aria-pressed:bg-accent-light aria-pressed:text-accent-strong';
const MENU_ICON_CLASS = 'w-4 h-4';
const EMPTY_HIGHLIGHT: HoroscopeHighlight = Object.freeze({});

type SavedZiweiChartRow = BirthTimeResolution & {
    name: string;
    gender: Gender;
    birth_date: string;
    birth_time: string;
    birth_place: string | null;
    longitude?: number | null;
    calendar_type: CalendarType | null;
    is_leap_month: boolean | null;
};

/** 某一排盘输入的宫干飞化结果；input 用于判断结果是否仍对应当前命盘。 */
interface FlightState {
    input: ZiweiFormData;
    palaces: ZiweiPalaceFlights[] | null;
    failed: boolean;
}

const formatClock = (hour: number, minute: number) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

function ZiweiResultContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const chartId = searchParams.get('chart');
    const hasFormParams = useMemo(() => {
        const params = ['name', 'gender', 'year', 'month', 'day', 'hour', 'calendar', 'leap', 'place'];
        return params.some((key) => searchParams.has(key));
    }, [searchParams]);
    const { user, loading: sessionLoading } = useSessionSafe();
    const userId = user?.id ?? null;
    const { pending: saving, run: runSave } = useChartMutation(userId);
    const [loadedForUserId, setLoadedForUserId] = useState<string | null | undefined>(undefined);
    const [savedState, setSaved] = useState(false);
    const saved = savedState && !searchParams.has('timezone') && !searchParams.has('disambiguation');
    const [loading, setLoading] = useState(() => Boolean(chartId) && !hasFormParams);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [chartFromDb, setChartFromDb] = useState<ZiweiFormData | null>(null);
    const [mode, setMode] = useState<ZiweiChartMode>('natal');
    // 焦点宫（宫位索引）：undefined 表示默认命宫，null 表示取消选中
    const [selectedPalace, setSelectedPalace] = useState<number | null | undefined>(undefined);
    const [showPalaceDetail, setShowPalaceDetail] = useState(false);
    const [showAdjStars, setShowAdjStars] = useState(true);
    const [horoscopeHighlight, setHoroscopeHighlight] = useState<HoroscopeHighlight>({});
    const [horoscopeInfo, setHoroscopeInfo] = useState<HoroscopeInfo | undefined>(undefined);
    const [hourOffset, setHourOffset] = useState(0); // 时辰调整偏移（小时）
    const [flights, setFlights] = useState<FlightState | null>(null);
    const [copyDetailLevel, setCopyDetailLevel] = useState<ChartTextDetailLevel>('default');
    const [copied, setCopied] = useState(false);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const { showToast } = useToast();

    // 编辑模式
    useEffect(() => {
        if (hasFormParams) {
            setChartFromDb(null);
            setSaved(false);
            setNotFound(false);
            setLoadError(null);
            setLoading(false);
        }
    }, [hasFormParams]);

    useEffect(() => {
        setSaved(false);
        setChartFromDb(null);
    }, [userId]);

    // 加载已保存命盘
    useEffect(() => {
        if (sessionLoading || !chartId || hasFormParams) return;

        let cancelled = false;
        const controller = new AbortController();

        const loadChart = async () => {
            setLoading(true);
            setNotFound(false);
            setLoadError(null);

            try {
                const row = await loadSavedChart('ziwei', chartId, { expectedUserId: userId ?? undefined, signal: controller.signal });
                if (cancelled) return;

                const data = row as SavedZiweiChartRow | null;
                if (!data) {
                    setNotFound(true);
                    return;
                }

                const parsedBirthTime = parseBirthTimeString(data.birth_time);
                if (!parsedBirthTime) {
                    setLoadError('该紫微命盘缺少有效出生时辰，无法加载');
                    return;
                }
                const [year, month, day] = data.birth_date.split('-').map(Number);
                setChartFromDb({
                    name: data.name,
                    gender: data.gender || 'male',
                    birthYear: year,
                    birthMonth: month,
                    birthDay: day,
                    birthHour: parsedBirthTime.hour,
                    birthMinute: parsedBirthTime.minute,
                    calendarType: data.calendar_type || 'solar',
                    isLeapMonth: data.is_leap_month ?? false,
                    birthPlace: data.birth_place || '',
                    longitude: parseLongitude(data.longitude),
                    ...resolveBirthTimeOptions(data),
                });
                setSaved(true);
            } catch (error) {
                if (!cancelled) {
                    setLoadError(error instanceof Error ? error.message : '加载命盘失败');
                }
            } finally {
                if (!cancelled) {
                    setLoadedForUserId(userId);
                    setLoading(false);
                }
            }
        };

        void loadChart();
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [chartId, hasFormParams, sessionLoading, userId]);

    // 从 URL 参数获取表单数据
    const formData: ZiweiFormData | null = useMemo(() => {
        const hourParam = searchParams.get('hour');
        const minuteParam = searchParams.get('minute') || '0';
        if (!hourParam || hourParam === '-1') {
            return null;
        }

        const birthHour = Number(hourParam);
        const birthMinute = Number(minuteParam);
        if (
            !Number.isInteger(birthHour)
            || birthHour < 0
            || birthHour > 23
            || !Number.isInteger(birthMinute)
            || birthMinute < 0
            || birthMinute > 59
        ) {
            return null;
        }

        return {
            name: searchParams.get('name') || '命主',
            gender: (searchParams.get('gender') as Gender) || 'male',
            birthYear: Number(searchParams.get('year')) || 1990,
            birthMonth: Number(searchParams.get('month')) || 1,
            birthDay: Number(searchParams.get('day')) || 1,
            birthHour,
            birthMinute,
            calendarType: (searchParams.get('calendar') as CalendarType) || 'solar',
            isLeapMonth: searchParams.get('leap') === '1',
            birthPlace: searchParams.get('place') || '',
            longitude: parseLongitude(searchParams.get('longitude')),
            ...readBirthTimeOptions(searchParams),
        };
    }, [searchParams]);
    const resolvedFormData = useMemo(() => {
        const base = (loadedForUserId === userId ? chartFromDb : null) || formData;
        return base ? { ...base, ...readBirthTimeOptions(searchParams) } : null;
    }, [loadedForUserId, userId, chartFromDb, formData, searchParams]);

    // 计算紫微命盘（含时辰偏移）；input 为实际排盘输入，供飞星计算复用
    const chart = useMemo(() => {
        if (!resolvedFormData) return null;
        try {
            const input = shiftZiweiBirthHour(resolvedFormData, hourOffset);
            const { output, astrolabe } = calculateZiweiChartBundle(input);
            return { input, output, astrolabe, canonical: buildZiweiCanonicalJSON(output) };
        } catch (error) {
            console.error('紫微排盘错误:', error);
            return null;
        }
    }, [resolvedFormData, hourOffset]);
    const output = chart?.output ?? null;
    const canonicalChart = chart?.canonical ?? null;
    const { isAdmin, jsonCopied, copyJson } = useAdminJsonCopy(canonicalChart);
    const currentPeriods = useMemo(() => (chart ? getZiweiCurrentPeriods(chart.output, chart.astrolabe) : null), [chart]);

    // 飞星：仅在飞星视图下按当前排盘输入异步计算宫干飞化；结果带 input 以识别过期数据
    const flightInput = mode === 'flying' ? chart?.input ?? null : null;
    useEffect(() => {
        if (!flightInput) return;
        let cancelled = false;
        calculateZiweiPalaceFlights(flightInput).then(
            (palaces) => {
                if (!cancelled) setFlights({ input: flightInput, palaces, failed: false });
            },
            (error: unknown) => {
                if (cancelled) return;
                console.error('紫微飞星计算错误:', error);
                setFlights({ input: flightInput, palaces: null, failed: true });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [flightInput]);
    const currentFlights = flights && chart && flights.input === chart.input ? flights : null;

    const changeHourOffset = useCallback((next: number) => {
        setHourOffset(next);
        // 时辰变化会改变命宫位置：焦点回到新命盘的命宫
        setSelectedPalace(undefined);
    }, []);

    // 修改命盘
    const handleEdit = useCallback(() => {
        if (!resolvedFormData) return;
        const params = new URLSearchParams({
            name: resolvedFormData.name,
            gender: resolvedFormData.gender,
            year: String(resolvedFormData.birthYear),
            month: String(resolvedFormData.birthMonth),
            day: String(resolvedFormData.birthDay),
            hour: String(resolvedFormData.birthHour),
            minute: String(resolvedFormData.birthMinute || 0),
            calendar: resolvedFormData.calendarType,
        });
        writeBirthTimeOptions(params, resolvedFormData);
        if (resolvedFormData.calendarType === 'lunar' && resolvedFormData.isLeapMonth) params.set('leap', '1');
        if (resolvedFormData.birthPlace) params.set('place', resolvedFormData.birthPlace);
        if (resolvedFormData.longitude != null) params.set('longitude', String(resolvedFormData.longitude));
        if (chartId) params.set('chart', chartId);
        router.push(`/ziwei?${params.toString()}`);
    }, [resolvedFormData, chartId, router]);

    const handleSave = useCallback(async () => {
        if (saving || !output || !resolvedFormData) return;
        if (!userId) { showToast('warning', '请先登录后再保存命盘'); setShowAuthModal(true); return; }
        await runSave(async (scope) => {
            const payload = {
                name: resolvedFormData.name,
                gender: resolvedFormData.gender,
                birth_date: `${resolvedFormData.birthYear}-${String(resolvedFormData.birthMonth).padStart(2, '0')}-${String(resolvedFormData.birthDay).padStart(2, '0')}`,
                birth_time: formatClock(resolvedFormData.birthHour, resolvedFormData.birthMinute || 0),
                calendar_type: resolvedFormData.calendarType,
                is_leap_month: resolvedFormData.isLeapMonth ?? false,
                birth_place: resolvedFormData.birthPlace || null,
                longitude: resolvedFormData.longitude ?? null,
                ...resolveBirthTimeOptions(resolvedFormData),
            };
            if (chartId) {
                await updateSavedChart('ziwei', chartId, payload, scope);
                return chartId;
            }
            return createSavedChart('ziwei', payload, scope);
        }, (savedId) => {
            setSaved(true);
            setChartFromDb(resolvedFormData);
            setLoadedForUserId(userId);
            router.replace(`/ziwei/result?chart=${savedId}`);
        }, (error) => {
            console.error('保存失败:', error);
            showToast('error', '保存失败，请重试');
        });
    }, [saving, output, resolvedFormData, chartId, router, showToast, userId, runSave]);

    // 分享
    const handleShare = useCallback(async () => {
        if (!resolvedFormData) {
            return;
        }
        const url = window.location.href;
        if (navigator.share) {
            try { await navigator.share({ title: `${resolvedFormData.name}的紫微命盘 - 太卜`, text: `查看${resolvedFormData.name}的紫微斗数命盘`, url }); } catch { }
        } else {
            try { await navigator.clipboard.writeText(url); showToast('success', '链接已复制到剪贴板'); } catch { showToast('error', '复制链接失败'); }
        }
    }, [resolvedFormData, showToast]);

    const handleConfirmCopy = useCallback(async (level: ChartTextDetailLevel) => {
        if (!output) return;
        try {
            setCopyDetailLevel(level);
            await navigator.clipboard.writeText(generateZiweiChartText(output, { detailLevel: level }));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            setShowCopyModal(false);
        } catch {
            showToast('error', '复制失败，请手动复制');
        }
    }, [output, showToast]);

    // 命盘操作：移动端由顶栏三点菜单承载（保存走底部操作栏），桌面端由标题区「更多」菜单承载
    const chartActions = useMemo((): HeaderMenuItem[] => [
        { id: 'edit', label: '修改出生信息', icon: <Edit3 className={MENU_ICON_CLASS} />, onClick: handleEdit },
        { id: 'share', label: '分享', icon: <Share2 className={MENU_ICON_CLASS} />, onClick: () => { void handleShare(); } },
        { id: 'copy', label: copied ? '已复制排盘' : '复制排盘', icon: copied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => setShowCopyModal(true), disabled: !output },
        ...(isAdmin && canonicalChart ? [{ id: 'copy-json', label: jsonCopied ? 'JSON 已复制' : '复制 JSON', icon: jsonCopied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => { void copyJson(); } }] : []),
        { id: 'adj-stars', label: showAdjStars ? '隐藏杂曜' : '显示杂曜', icon: showAdjStars ? <EyeOff className={MENU_ICON_CLASS} /> : <Eye className={MENU_ICON_CLASS} />, onClick: () => setShowAdjStars((value) => !value) },
        { id: 'hour-earlier', label: '时辰提前 1 小时', icon: <Minus className={MENU_ICON_CLASS} />, onClick: () => changeHourOffset(hourOffset - 1) },
        { id: 'hour-later', label: '时辰推后 1 小时', icon: <Plus className={MENU_ICON_CLASS} />, onClick: () => changeHourOffset(hourOffset + 1) },
        ...(hourOffset !== 0 ? [{ id: 'hour-reset', label: '恢复原时辰', icon: <RotateCcw className={MENU_ICON_CLASS} />, onClick: () => changeHourOffset(0) }] : []),
    ], [handleEdit, handleShare, copied, output, isAdmin, canonicalChart, jsonCopied, copyJson, showAdjStars, hourOffset, changeHourOffset]);
    const desktopActions = useMemo((): HeaderMenuItem[] => [
        { id: 'save', label: saved ? '已保存' : saving ? '保存中' : '保存命盘', icon: saved ? <Check className={MENU_ICON_CLASS} /> : <Save className={MENU_ICON_CLASS} />, onClick: () => { void handleSave(); }, disabled: saving || saved },
        ...chartActions,
    ], [chartActions, saved, saving, handleSave]);

    useEffect(() => {
        setMenuItems(chartActions);
        return () => clearMenuItems();
    }, [chartActions, setMenuItems, clearMenuItems]);

    const pageTitle = resolvedFormData ? `${resolvedFormData.name}的紫微命盘` : null;
    useHeaderTitle(pageTitle);

    const natalHighlight = useMemo((): HoroscopeHighlight => ({
        decadalIndex: currentPeriods?.decadal?.index,
        yearlyIndex: currentPeriods?.yearly?.index,
        ageIndex: currentPeriods?.age?.index,
    }), [currentPeriods]);

    if (loading || (chartId && !hasFormParams && (sessionLoading || loadedForUserId !== userId))) return <SoundWaveLoader variant="block" text="" />;
    if (notFound) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
                <p className="text-sm text-foreground-secondary mb-6">未找到该命盘，请返回重新选择</p>
                <SettingsCenterLink tab="charts" className={PRIMARY_BUTTON_CLASS}>返回我的命盘</SettingsCenterLink>
            </div>
        );
    }
    if (!resolvedFormData || loadError || !chart || !canonicalChart || !pageTitle) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
                <p className="text-sm text-foreground-secondary mb-6">{loadError || '紫微斗数必须提供出生时辰，请返回重新输入'}</p>
                <Link href="/ziwei" className={PRIMARY_BUTTON_CLASS}>返回重新输入</Link>
            </div>
        );
    }

    const palaces = canonicalChart.十二宫位;
    const palaceNameAt = (index: number | null | undefined) => (index == null ? null : palaces.find((palace) => palace.宫位索引 === index)?.宫位 ?? null);
    const lifePalace = palaces.find((palace) => palace.宫位 === '命宫');
    const bodyPalace = palaces.find((palace) => palace.是否身宫 === '是');
    const lifePalaceIndex = lifePalace?.宫位索引 ?? null;
    const activePalace = selectedPalace === undefined ? lifePalaceIndex : selectedPalace;
    const currentDecadal = currentPeriods?.decadal ?? null;
    const currentDecadalName = palaceNameAt(currentDecadal?.index);
    const summary = [
        canonicalChart.基本信息.五行局,
        lifePalace ? `命宫${lifePalace.干支}` : null,
        bodyPalace ? `身宫在${bodyPalace.宫位}` : null,
        currentDecadalName ? `当前大限 ${currentDecadalName}` : null,
    ].filter(Boolean).join(' · ');
    const desktopSuffix = currentDecadal && currentDecadalName ? `（${currentDecadal.startAge}–${currentDecadal.endAge}）` : undefined;

    const selectedPalaceName = palaceNameAt(activePalace);
    const selectedFlights = currentFlights?.palaces?.find((entry) => entry.palace === selectedPalaceName) ?? null;
    const flightOverlay = mode === 'flying' && selectedFlights ? resolveZiweiFlightOverlay(palaces, selectedFlights) : null;
    const chartHighlight = mode === 'horoscope' ? horoscopeHighlight : mode === 'natal' ? natalHighlight : EMPTY_HIGHLIGHT;

    const hourStatus = hourOffset !== 0 && (
        <span className="text-accent-strong">
            {' · '}时辰已{hourOffset > 0 ? '推后' : '提前'} {Math.abs(hourOffset)} 小时
            <button
                type="button"
                onClick={() => changeHourOffset(0)}
                className="ml-1.5 underline decoration-accent/40 underline-offset-2 transition-colors hover:text-accent"
            >
                复原
            </button>
        </span>
    );

    // 「命宫解读」：在命盘下方展开命宫详情（完整盘默认不显示详情卡），再次点击收起
    const lifePalaceDetailOpen = showPalaceDetail && activePalace === lifePalaceIndex;
    const toggleLifePalaceDetail = () => {
        if (lifePalaceDetailOpen) {
            setShowPalaceDetail(false);
            return;
        }
        setSelectedPalace(lifePalaceIndex);
        setShowPalaceDetail(true);
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex max-w-[1144px] animate-fade-in flex-col gap-[18px] px-4 pt-0.5 pb-28 lg:px-8 lg:pt-8 lg:pb-14">
                <ZiweiResultHeader
                    title={pageTitle}
                    summary={summary}
                    desktopSuffix={desktopSuffix}
                    status={hourStatus}
                    mode={mode}
                    onModeChange={setMode}
                    actions={desktopActions}
                />

                <div role="tabpanel" id={ZIWEI_MODE_PANEL_ID} aria-labelledby={ziweiModeTabId(mode)} className="flex flex-col gap-[18px]">
                    <section aria-label="紫微命盘">
                        <ZiweiChartGrid
                            canonicalChart={canonicalChart}
                            horoscopeHighlight={chartHighlight}
                            horoscopeInfo={mode === 'horoscope' ? horoscopeInfo : undefined}
                            subjectName={resolvedFormData.name}
                            birthTime={formatClock(chart.input.birthHour, chart.input.birthMinute || 0)}
                            birthPlace={resolvedFormData.birthPlace}
                            selectedPalace={activePalace}
                            onSelectedPalaceChange={setSelectedPalace}
                            showAdjStars={showAdjStars}
                            variant={mode === 'flying' ? 'flying' : 'natal'}
                            flightOverlay={flightOverlay}
                            showPalaceDetail={showPalaceDetail}
                        />
                    </section>

                    {mode === 'natal' && (
                        <>
                            <section className="hidden items-center justify-between gap-6 rounded-2xl border-[0.5px] border-border bg-surface px-[22px] py-[18px] lg:flex">
                                <div className="min-w-0">
                                    <p className="font-display text-[17px]">点任意宫位，三方四正连线随之切换</p>
                                    <AIFeatureGate>
                                        <p className="mt-1 text-[13px] text-foreground-secondary">也可以直接问太卜：「我现在这个大限适合创业吗？」</p>
                                    </AIFeatureGate>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                    <button type="button" onClick={toggleLifePalaceDetail} aria-pressed={lifePalaceDetailOpen} className={HINT_BUTTON_CLASS}>
                                        命宫解读
                                    </button>
                                    <button type="button" onClick={() => setMode('horoscope')} className={HINT_BUTTON_CLASS}>
                                        本大限运势
                                    </button>
                                </div>
                            </section>
                            <p className="text-center text-xs text-foreground-secondary lg:hidden">点任意宫位查看详情，三方四正连线随之切换</p>
                        </>
                    )}

                    {mode === 'horoscope' && (
                        <ZiweiHoroscopePanel
                            key={hourOffset}
                            output={chart.output}
                            astrolabe={chart.astrolabe}
                            canonicalChart={canonicalChart}
                            initialSelection={{
                                decadalIndex: currentDecadal?.index ?? null,
                                year: currentDecadal ? new Date().getFullYear() : null,
                            }}
                            onPalaceHighlight={setHoroscopeHighlight}
                            onHoroscopeChange={setHoroscopeInfo}
                        />
                    )}

                    {mode === 'flying' && (
                        <ZiweiFlyingStarPanel
                            palaces={currentFlights?.palaces ?? null}
                            failed={currentFlights?.failed ?? false}
                            selectedPalace={selectedPalaceName}
                            onSelectPalace={(name) => setSelectedPalace(palaces.find((palace) => palace.宫位 === name)?.宫位索引 ?? null)}
                        />
                    )}
                </div>
            </div>

            <ResultMobileActions saving={saving} saved={saved} onSave={() => { void handleSave(); }} />
            <CopyTextModal
                isOpen={showCopyModal}
                value={copyDetailLevel}
                onChange={setCopyDetailLevel}
                onClose={() => setShowCopyModal(false)}
                onConfirm={handleConfirmCopy}
            />
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </div>
    );
}

export default function ZiweiResultPage() {
    return (
        <Suspense fallback={<SoundWaveLoader variant="block" text="正在排盘" />}>
            <ZiweiResultContent />
        </Suspense>
    );
}
