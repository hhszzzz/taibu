/**
 * 八字结果页面 - 专业排盘版
 * 支持：URL 参数传入 / 从数据库加载已保存命盘
 */
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useMemo, useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { Edit3, Save, Share2, Copy, Check } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import {
    calculateBaziChartBundle,
    calculateProfessionalData,
    calculateLiuYue,
    calculateLiuRi,
    buildBaziCanonicalJSON,
    generateBaziChartText,
    getDayMasterDescription,
} from '@/lib/divination/bazi';
import type { BaziFormData, CalendarType, Gender } from '@/types';
import { ResultHeader, ResultMobileActions } from '@/components/bazi/result/ResultHeader';
import { ProfileSummaryCard } from '@/components/bazi/result/ProfileSummaryCard';
import { ResultTabs, type ResultTab } from '@/components/bazi/result/ResultTabs';
import { BasicInfoSection } from '@/components/bazi/result/BasicInfoSection';
import { ProfessionalSection } from '@/components/bazi/result/ProfessionalSection';
import { ResultFooterLinks } from '@/components/bazi/result/ResultFooterLinks';
import { AuthModal } from '@/components/auth/AuthModal';
import { useToast } from '@/components/ui/Toast';
import { useHeaderMenu } from '@/components/layout/HeaderMenuContext';
import { CaseNotesSection } from '@/components/bazi/result/CaseNotesSection';
import { loadLatestConversationAnalysisSnapshot } from '@/lib/chat/conversation-analysis';
import { createSavedChart, loadSavedChart, updateSavedChart } from '@/lib/user/charts-client';
import { useChartMutation } from '@/lib/hooks/useUserCharts';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import { parseBirthTimeString, readBirthTimeOptions, resolveBirthTimeOptions, writeBirthTimeOptions, type BirthTimeResolution } from '@/lib/divination/birth-time';
import { parseNumberParam } from '@/lib/divination/bazi-form-utils';
import { parseLongitude } from '@/lib/divination/place-resolution';
import { useAdminJsonCopy } from '@/lib/admin/useAdminJsonCopy';
import { CopyTextModal } from '@/components/divination/CopyTextModal';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';

// 结果内容组件
function BaziResultContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const chartId = searchParams.get('chart');
    const hasFormParams = useMemo(() => {
        const params = ['name', 'gender', 'year', 'month', 'day', 'hour', 'minute', 'calendar', 'leap', 'place'];
        return params.some((key) => searchParams.has(key));
    }, [searchParams]);
    const [activeTab, setActiveTab] = useState<ResultTab>('professional');
    const [savedState, setSaved] = useState(false);
    const saved = savedState && !searchParams.has('timezone') && !searchParams.has('disambiguation');
    const [loading, setLoading] = useState(() => Boolean(chartId) && !hasFormParams);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [chartFromDb, setChartFromDb] = useState<BaziFormData | null>(null);
    const [savedWuxingAnalysis, setSavedWuxingAnalysis] = useState<string | null>(null);
    const [savedWuxingReasoning, setSavedWuxingReasoning] = useState<string | null>(null);
    const [savedWuxingModelId, setSavedWuxingModelId] = useState<string | null>(null);
    const [savedPersonalityAnalysis, setSavedPersonalityAnalysis] = useState<string | null>(null);
    const [savedPersonalityReasoning, setSavedPersonalityReasoning] = useState<string | null>(null);
    const [savedPersonalityModelId, setSavedPersonalityModelId] = useState<string | null>(null);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copyDetailLevel, setCopyDetailLevel] = useState<ChartTextDetailLevel>('default');
    const [showCopyModal, setShowCopyModal] = useState(false);
    const { showToast } = useToast();
    const { session, userId, sessionLoading, membershipInfo, membershipResolved } = useSessionMembership();
    const { pending: saving, run: runSave } = useChartMutation(userId);
    const [loadedForUserId, setLoadedForUserId] = useState<string | null | undefined>(undefined);
    const credits = membershipResolved ? (membershipInfo?.aiChatCount ?? null) : null;

    type SavedBaziChartRow = BirthTimeResolution & {
        name: string;
        gender: Gender;
        birth_date: string;
        birth_time: string | null;
        birth_place: string | null;
        longitude?: number | null;
        calendar_type: CalendarType | null;
        is_leap_month: boolean | null;
    };

    const now = new Date();
    const currentYear = now.getFullYear();

    // 大运流年状态
    const [selectedDaYunIndex, setSelectedDaYunIndex] = useState<number>(0);
    const [selectedLiuNianYear, setSelectedLiuNianYear] = useState<number>(currentYear);
    const [selectedLiuYueMonth, setSelectedLiuYueMonth] = useState<number>(-1);
    const [selectedLiuRiDate, setSelectedLiuRiDate] = useState<string>('');
    const [hasMountedNotes, setHasMountedNotes] = useState(false);

    // 编辑模式：优先使用 URL 参数，避免覆盖为数据库旧数据
    useEffect(() => {
        if (hasFormParams) {
            setChartFromDb(null);
            setSaved(false);
            setNotFound(false);
            setLoadError(null);
            setLoading(false);
            setSavedWuxingAnalysis(null);
            setSavedWuxingReasoning(null);
            setSavedWuxingModelId(null);
            setSavedPersonalityAnalysis(null);
            setSavedPersonalityReasoning(null);
            setSavedPersonalityModelId(null);
        }
    }, [hasFormParams]);

    useEffect(() => {
        setSaved(false);
        setChartFromDb(null);
    }, [userId]);

    // 从数据库加载命盘（仅查看已保存命盘时）
    useEffect(() => {
        if (sessionLoading || !chartId || hasFormParams) {
            return;
        }

        let cancelled = false;
        const controller = new AbortController();

        const loadChart = async () => {
            setLoading(true);
            setNotFound(false);
            setLoadError(null);

            try {
                const [chartData, wuxingAnalysis, personalityAnalysis] = await Promise.all([
                    loadSavedChart('bazi', chartId, { expectedUserId: userId ?? undefined, signal: controller.signal }),
                    loadLatestConversationAnalysisSnapshot({
                        sourceType: 'bazi_wuxing',
                        chartId,
                    }),
                    loadLatestConversationAnalysisSnapshot({
                        sourceType: 'bazi_personality',
                        chartId,
                    }),
                ]);

                if (cancelled) {
                    return;
                }

                const data = chartData as SavedBaziChartRow | null;
                if (!data) {
                    setNotFound(true);
                    return;
                }

                const [year, month, day] = data.birth_date.split('-').map(Number);
                const hasTime = Boolean(data.birth_time);
                const parsedBirthTime = hasTime ? parseBirthTimeString(data.birth_time as string) : null;
                if (hasTime && !parsedBirthTime) {
                    setLoadError('该八字命盘缺少有效出生时辰，无法加载');
                    return;
                }

                setChartFromDb({
                    name: data.name,
                    gender: data.gender as Gender,
                    birthYear: year,
                    birthMonth: month,
                    birthDay: day,
                    birthHour: parsedBirthTime?.hour ?? 12,
                    birthMinute: parsedBirthTime?.minute ?? 0,
                    isUnknownTime: !hasTime,
                    calendarType: (data.calendar_type as CalendarType) || 'solar',
                    isLeapMonth: data.is_leap_month || false,
                    birthPlace: data.birth_place || undefined,
                    longitude: parseLongitude(data.longitude),
                    ...resolveBirthTimeOptions(data),
                });

                setSavedWuxingAnalysis(wuxingAnalysis?.analysis ?? null);
                setSavedWuxingReasoning(wuxingAnalysis?.reasoning ?? null);
                setSavedWuxingModelId(wuxingAnalysis?.modelId ?? null);

                setSavedPersonalityAnalysis(personalityAnalysis?.analysis ?? null);
                setSavedPersonalityReasoning(personalityAnalysis?.reasoning ?? null);
                setSavedPersonalityModelId(personalityAnalysis?.modelId ?? null);
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

    // 表单数据
    const formData: BaziFormData = useMemo(() => {
        if (chartFromDb && loadedForUserId === userId) return { ...chartFromDb, ...readBirthTimeOptions(searchParams) };

        const hourParam = searchParams.get('hour');
        const isUnknownTime = hourParam === '-1';

        return {
            name: searchParams.get('name') || '命主',
            gender: (searchParams.get('gender') as Gender) || 'male',
            birthYear: Number(searchParams.get('year')) || 1990,
            birthMonth: Number(searchParams.get('month')) || 1,
            birthDay: Number(searchParams.get('day')) || 1,
            birthHour: isUnknownTime ? 12 : parseNumberParam(hourParam, 12), // 未知时默认用午时计算
            birthMinute: parseNumberParam(searchParams.get('minute'), 0),
            calendarType: (searchParams.get('calendar') as CalendarType) || 'solar',
            isLeapMonth: searchParams.get('leap') === '1',
            birthPlace: searchParams.get('place') || undefined,
            longitude: parseLongitude(searchParams.get('longitude')),
            ...readBirthTimeOptions(searchParams),
            isUnknownTime,
        };
    }, [searchParams, chartFromDb, loadedForUserId, userId]);

    // 是否不确定时辰
    const isUnknownTime = formData.isUnknownTime ?? false;

    // 计算八字
    const baziBundle = useMemo(() => {
        try {
            return calculateBaziChartBundle(formData);
        } catch (error) {
            console.error('八字计算错误:', error);
            return null;
        }
    }, [formData]);
    const baziOutput = baziBundle?.output ?? null;
    const baziMeta = baziBundle?.meta ?? null;

    // 计算专业数据
    const proData = useMemo(() => {
        try {
            return calculateProfessionalData(formData, currentYear);
        } catch (error) {
            console.error('专业数据计算错误:', error);
            return null;
        }
    }, [formData, currentYear]);
    const canonicalBazi = useMemo(() => {
        if (!baziOutput) return null;
        return buildBaziCanonicalJSON(baziOutput);
    }, [baziOutput]);
    const { isAdmin, jsonCopied, copyJson } = useAdminJsonCopy(canonicalBazi);

    // 初始化选中的大运和流年
    useEffect(() => {
        if (proData) {
            setSelectedDaYunIndex(proData.currentDaYunIndex);
            setSelectedLiuNianYear(currentYear);
        }
    }, [proData, currentYear]);

    useEffect(() => {
        if (activeTab === 'notes' && !hasMountedNotes) {
            setHasMountedNotes(true);
        }
    }, [activeTab, hasMountedNotes]);

    // 当前选中大运的流年列表
    const currentLiuNian = useMemo(() => {
        if (!proData || selectedDaYunIndex < 0 || selectedDaYunIndex >= proData.daYun.length) {
            return [];
        }
        return proData.daYun[selectedDaYunIndex].liuNian;
    }, [proData, selectedDaYunIndex]);

    // 计算流月
    const liuYue = useMemo(() => {
        if (selectedLiuNianYear <= 0) return [];
        try {
            return calculateLiuYue(selectedLiuNianYear, formData);
        } catch (error) {
            console.error('流月计算错误:', error);
            return [];
        }
    }, [formData, selectedLiuNianYear]);

    useEffect(() => {
        if (liuYue.length === 0) {
            setSelectedLiuYueMonth(-1);
            return;
        }
        // 不再自动选择流月，保持未选中状态
    }, [liuYue]);

    const activeLiuYue = useMemo(
        () => liuYue.find((item) => item.month === selectedLiuYueMonth) || null,
        [liuYue, selectedLiuYueMonth]
    );

    const liuRi = useMemo(() => {
        if (!activeLiuYue) return [];
        try {
            return calculateLiuRi(activeLiuYue.startDate, activeLiuYue.endDate, formData);
        } catch (error) {
            console.error('流日计算错误:', error);
            return [];
        }
    }, [activeLiuYue, formData]);

    useEffect(() => {
        if (!activeLiuYue) {
            setSelectedLiuRiDate('');
            return;
        }
        // 不再自动选择流日，保持未选中状态
    }, [activeLiuYue]);

    // 保存命盘
    const handleSave = async () => {
        if (saving) return;
        if (!baziOutput) {
            showToast('error', '命盘计算失败，无法保存');
            return;
        }
        if (isUnknownTime) {
            showToast('warning', '未知时辰的八字命盘仅支持查看，补全出生时辰后才能保存');
            return;
        }

        if (!session?.user) {
            showToast('warning', '请先登录后再保存命盘');
            setShowAuthModal(true);
            return;
        }

        await runSave(async (scope) => {
            const payload = {
                name: formData.name,
                gender: formData.gender,
                birth_date: `${formData.birthYear}-${String(formData.birthMonth).padStart(2, '0')}-${String(formData.birthDay).padStart(2, '0')}`,
                birth_time: `${String(formData.birthHour).padStart(2, '0')}:${String(formData.birthMinute).padStart(2, '0')}`,
                birth_place: formData.birthPlace || null,
                longitude: formData.longitude ?? null,
                ...resolveBirthTimeOptions(formData),
                calendar_type: formData.calendarType,
                is_leap_month: formData.isLeapMonth || false,
            };
            if (chartId) {
                await updateSavedChart('bazi', chartId, payload, scope);
                return chartId;
            }
            return createSavedChart('bazi', payload, scope);
        }, (savedId) => {
            setSaved(true);
            setChartFromDb(formData);
            setLoadedForUserId(userId);
            router.replace(`/bazi/result?chart=${savedId}`);
        }, (error) => {
            console.error('保存失败:', error);
            showToast('error', '保存失败，请重试');
        });
    };

    // 分享
    const handleShare = async () => {
        const url = window.location.href;
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `${formData.name}的八字命盘 - 太卜`,
                    text: `查看${formData.name}的八字命盘分析`,
                    url,
                });
            } catch {
                // 用户取消
            }
        } else {
            await navigator.clipboard.writeText(url);
            showToast('success', '链接已复制到剪贴板');
        }
    };

    const handleCopy = async () => {
        setShowCopyModal(true);
    };

    const handleConfirmCopy = async (level: ChartTextDetailLevel) => {
        if (!baziOutput || !baziMeta) return;
        try {
            setCopyDetailLevel(level);
            await navigator.clipboard.writeText(generateBaziChartText(baziOutput, {
                name: formData.name,
                detailLevel: level,
                meta: baziMeta,
            }));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            showToast('success', '命盘已复制到剪贴板');
            setShowCopyModal(false);
        } catch {
            showToast('error', '复制失败，请手动复制');
        }
    };

    // 修改命盘
    const handleEdit = () => {
        const params = new URLSearchParams({
            name: formData.name,
            gender: formData.gender,
            year: String(formData.birthYear),
            month: String(formData.birthMonth),
            day: String(formData.birthDay),
            hour: formData.isUnknownTime ? '-1' : String(formData.birthHour),
            minute: formData.isUnknownTime ? '0' : String(formData.birthMinute),
            calendar: formData.calendarType,
        });
        writeBirthTimeOptions(params, formData);
        if (formData.isLeapMonth) {
            params.set('leap', '1');
        }
        if (formData.birthPlace) {
            params.set('place', formData.birthPlace);
        }
        if (formData.longitude != null) {
            params.set('longitude', String(formData.longitude));
        }
        if (chartId) {
            params.set('chart', chartId);
        }
        router.push(`/bazi?${params.toString()}`);
    };

    // 设置移动端 Header 菜单项
    useEffect(() => {
        const items = [
            {
                id: 'edit',
                label: '修改',
                icon: <Edit3 className="w-4 h-4" />,
                onClick: handleEdit,
            },
            {
                id: 'save',
                label: saved ? '已保存' : (isUnknownTime ? '需时辰' : '保存'),
                icon: <Save className="w-4 h-4" />,
                onClick: handleSave,
                disabled: saving || saved || isUnknownTime,
            },
            {
                id: 'copy',
                label: copied ? '已复制' : '复制',
                icon: copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />,
                onClick: handleCopy,
            },
            ...(isAdmin && canonicalBazi ? [{
                id: 'copy-json',
                label: jsonCopied ? 'JSON 已复制' : '复制 JSON',
                icon: jsonCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />,
                onClick: () => { void copyJson(); },
            }] : []),
            {
                id: 'share',
                label: '分享',
                icon: <Share2 className="w-4 h-4" />,
                onClick: handleShare,
            },
        ];
        setMenuItems(items);
        return () => clearMenuItems();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saving, saved, copied, isAdmin, canonicalBazi, jsonCopied, copyJson, setMenuItems, clearMenuItems, isUnknownTime]);

    // 选择大运 - 同时更新流年到该大运第一年
    const handleSelectDaYun = (index: number) => {
        if (selectedDaYunIndex === index) {
            // 取消选择，级联取消
            setSelectedDaYunIndex(-1);
            setSelectedLiuNianYear(-1);
            setSelectedLiuYueMonth(-1);
            setSelectedLiuRiDate('');
        } else {
            setSelectedDaYunIndex(index);
            // 切换大运时，不自动选择流年，但清除已选的流年/流月/流日
            setSelectedLiuNianYear(-1);
            setSelectedLiuYueMonth(-1);
            setSelectedLiuRiDate('');
        }
    };

    // 选择流年
    const handleSelectLiuNian = (year: number) => {
        if (selectedLiuNianYear === year) {
            setSelectedLiuNianYear(-1);
            setSelectedLiuYueMonth(-1);
            setSelectedLiuRiDate('');
        } else {
            setSelectedLiuNianYear(year);
            // 切换流年时，清除已选的流月/流日
            setSelectedLiuYueMonth(-1);
            setSelectedLiuRiDate('');
        }
    };

    // 选择流月/流日
    const handleSelectLiuYue = (month: number) => {
        if (selectedLiuYueMonth === month) {
            setSelectedLiuYueMonth(-1);
            setSelectedLiuRiDate('');
        } else {
            setSelectedLiuYueMonth(month);
            // 切换流月，清除已选流日
            setSelectedLiuRiDate('');
        }
    };

    const handleSelectLiuRi = (date: string) => {
        if (selectedLiuRiDate === date) {
            setSelectedLiuRiDate('');
        } else {
            setSelectedLiuRiDate(date);
        }
    };

    if (loading || (chartId && !hasFormParams && (sessionLoading || loadedForUserId !== userId))) {
        return <SoundWaveLoader variant="block" text="" />;
    }

    if (notFound) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
                <p className="text-sm text-foreground-secondary mb-6">未找到对应八字命盘</p>
                <Link href="/bazi" className="inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover">
                    返回重新输入
                </Link>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
                <p className="text-sm text-foreground-secondary mb-6">{loadError}</p>
                <Link href="/bazi" className="inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover">
                    返回重新输入
                </Link>
            </div>
        );
    }

    if (!baziOutput || !baziMeta || !proData || !canonicalBazi) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
                <p className="text-sm text-foreground-secondary mb-6">八字计算出错，请返回重新输入</p>
                <Link href="/bazi" className="inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover">
                    返回重新输入
                </Link>
            </div>
        );
    }

    const dayMasterDescription = getDayMasterDescription(canonicalBazi.基本信息.日主 as Parameters<typeof getDayMasterDescription>[0]);

    return (
        <div className="min-h-screen bg-background">
            <div className="mx-auto flex w-full max-w-[1104px] flex-col gap-5 px-4 pb-24 pt-4 sm:gap-6 sm:px-6 lg:px-8 lg:pb-0 lg:pt-7 animate-fade-in">
                <ResultHeader
                    chartId={chartId}
                    saving={saving}
                    saved={saved}
                    saveDisabled={isUnknownTime}
                    saveLabel={isUnknownTime ? '需时辰' : '保存'}
                    copied={copied}
                    jsonCopied={jsonCopied}
                    showJsonCopy={isAdmin && !!canonicalBazi}
                    onEdit={handleEdit}
                    onSave={handleSave}
                    onCopy={handleCopy}
                    onCopyJson={() => { void copyJson(); }}
                    onShare={handleShare}
                >
                    <ProfileSummaryCard
                        meta={baziMeta}
                        canonicalChart={canonicalBazi}
                    />
                </ResultHeader>

                <ResultTabs activeTab={activeTab} onChange={setActiveTab} />

                {/* 基本信息 */}
                {activeTab === 'basic' && (
                    <div className="animate-fade-in">
                        <BasicInfoSection
                            canonicalChart={canonicalBazi}
                            dayMasterDescription={dayMasterDescription}
                            chartId={chartId}
                            userId={userId}
                            credits={credits}
                            savedWuxingAnalysis={savedWuxingAnalysis}
                            savedWuxingReasoning={savedWuxingReasoning}
                            savedWuxingModelId={savedWuxingModelId}
                            savedPersonalityAnalysis={savedPersonalityAnalysis}
                            savedPersonalityReasoning={savedPersonalityReasoning}
                            savedPersonalityModelId={savedPersonalityModelId}
                            hasKnownBirthTime={!isUnknownTime}
                            onSaveWuxingAnalysis={setSavedWuxingAnalysis}
                            onSavePersonalityAnalysis={setSavedPersonalityAnalysis}
                            onLoginRequired={() => setShowAuthModal(true)}
                        />
                    </div>
                )}

                {/* 专业排盘 */}
                {activeTab === 'professional' && (
                    <div className="animate-fade-in">
                        <ProfessionalSection
                            canonicalChart={canonicalBazi}
                            proData={proData}
                            isUnknownTime={isUnknownTime}
                            selectedDaYunIndex={selectedDaYunIndex}
                            onSelectDaYun={handleSelectDaYun}
                            currentLiuNian={currentLiuNian}
                            selectedLiuNianYear={selectedLiuNianYear}
                            onSelectLiuNian={handleSelectLiuNian}
                            liuYue={liuYue}
                            selectedLiuYueMonth={selectedLiuYueMonth}
                            onSelectLiuYue={handleSelectLiuYue}
                            liuRi={liuRi}
                            selectedLiuRiDate={selectedLiuRiDate}
                            onSelectLiuRi={handleSelectLiuRi}
                            activeLiuYue={activeLiuYue}
                        />
                    </div>
                )}

                {(hasMountedNotes || activeTab === 'notes') && (
                    <div className={activeTab === 'notes' ? 'animate-fade-in rounded-2xl border-[0.5px] border-border bg-surface p-4 pt-1 sm:p-6 sm:pt-2' : 'hidden'}>
                        <CaseNotesSection chartId={chartId} />
                    </div>
                )}

                <div className="mt-6 border-t-[0.5px] border-border pb-4 pt-6 lg:mt-10 lg:pb-16">
                    <ResultFooterLinks />
                </div>

                <ResultMobileActions
                    saving={saving}
                    saved={saved}
                    saveDisabled={isUnknownTime}
                    saveLabel={isUnknownTime ? '需时辰' : '保存'}
                    onSave={handleSave}
                />
            </div>

            <CopyTextModal
                isOpen={showCopyModal}
                value={copyDetailLevel}
                onChange={setCopyDetailLevel}
                onClose={() => setShowCopyModal(false)}
                onConfirm={handleConfirmCopy}
            />
            <AuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
            />
        </div>
    );
}

export default function BaziResultPage() {
    return (
        <Suspense fallback={
            <SoundWaveLoader variant="block" text="正在计算八字命盘" />
        }>
            <BaziResultContent />
        </Suspense>
    );
}
