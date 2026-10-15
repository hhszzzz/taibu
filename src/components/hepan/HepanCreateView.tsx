/**
 * 合盘输入视图（/hepan 入口与 /hepan/create 共用）
 *
 * 输入双方生日信息，支持从已保存命盘选择；关系类型通过查询参数 `type` 切换。
 *
 * 'use client'：表单状态、会话读取与命盘选择弹窗需要客户端 hooks
 */
'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, X, AlertCircle } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { type HepanType, type BirthInfo, analyzeCompatibility } from '@/lib/divination/hepan';
import { ChartPickerModal, type ChartItem } from '@/components/common/ChartPickerModal';
import { SegmentedControl } from '@/components/bazi/SegmentedControl';
import { HepanPersonCard } from '@/components/hepan/HepanPersonCard';
import { HepanPrinciples } from '@/components/hepan/HepanPrinciples';
import { HEPAN_PERSON_LABELS, HEPAN_TYPE_OPTIONS } from '@/components/hepan/hepan-display';
import { supabase } from '@/lib/auth';
import { writeSessionJSON } from '@/lib/cache/session-storage';
import { saveDivinationAction } from '@/lib/divination/save-client';

export function HepanCreateView() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const type = (searchParams.get('type') || 'love') as HepanType;

    const [person1, setPerson1] = useState<Partial<BirthInfo>>({ name: '' });
    const [person2, setPerson2] = useState<Partial<BirthInfo>>({ name: '' });
    const [loading, setLoading] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [pickerOpen, setPickerOpen] = useState<1 | 2 | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    // 从命盘选择后以摘要展示，点击「修改」回到表单
    const [summaryMode, setSummaryMode] = useState<Record<1 | 2, boolean>>({ 1: false, 2: false });

    // 获取用户 ID
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUserId(session.user.id);
            }
        });
    }, []);

    const labels = HEPAN_PERSON_LABELS;

    // 切换关系类型：保留已填写信息，仅替换查询参数
    const handleTypeChange = (nextType: HepanType) => {
        if (nextType === type) return;
        router.replace(`${pathname}?type=${nextType}`, { scroll: false });
    };

    const handleChartSelect = (chart: ChartItem) => {
        const birthInfo: Partial<BirthInfo> = {
            name: chart.name,
            year: chart.birth_year,
            month: chart.birth_month,
            day: chart.birth_day,
            hour: chart.birth_hour,
            minute: chart.birth_minute,
            calendarType: chart.calendar_type === 'lunar' ? 'lunar' : 'solar',
            isLeapMonth: chart.is_leap_month ?? false,
            longitude: chart.longitude ?? undefined,
            timezone: chart.timezone,
            disambiguation: chart.disambiguation,
            gender: chart.gender || undefined,
        };

        if (pickerOpen === 1) {
            setPerson1(birthInfo);
        } else if (pickerOpen === 2) {
            setPerson2(birthInfo);
        }
        if (pickerOpen) {
            const picked = pickerOpen;
            setSummaryMode(prev => ({ ...prev, [picked]: true }));
        }
        setPickerOpen(null);
    };

    const handleSubmit = async () => {
        // 验证必填字段
        if (!person1.name || !person1.year || !person1.month || !person1.day) {
            setValidationError('请填写完整的第一人信息');
            return;
        }
        if (!person2.name || !person2.year || !person2.month || !person2.day) {
            setValidationError('请填写完整的第二人信息');
            return;
        }

        setLoading(true);

        // 计算合盘；时间规则错误不能留下无限 loading 或静默改用另一时区。
        let result;
        try {
            result = analyzeCompatibility(person1 as BirthInfo, person2 as BirthInfo, type);
        } catch (error) {
            setValidationError(error instanceof Error ? error.message : '出生信息无效');
            setLoading(false);
            return;
        }

        // 保存合盘记录到数据库
        let chartId: string | null = null;
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                const saveResult = await saveDivinationAction({
                    endpoint: '/api/hepan',
                    body: { result },
                    idKey: 'chartId',
                    fallbackMessage: '保存合盘记录失败',
                });
                if (!saveResult.ok) {
                    throw new Error(saveResult.error.message || '保存合盘记录失败');
                }
                if (saveResult.id) {
                    chartId = saveResult.id;
                }
            }
        } catch (error) {
            console.error('保存合盘记录失败:', error);
        }

        // 存储结果（包含 chartId）
        writeSessionJSON('hepan_result', { ...result, chartId });

        // 跳转结果页
        setTimeout(() => {
            router.push('/hepan/result');
        }, 500);
    };

    return (
        <div className="min-h-screen bg-background">
            <div className="mx-auto flex w-full max-w-[984px] flex-col gap-4 px-4 pb-24 pt-3 sm:gap-7 sm:px-6 lg:px-8 lg:pb-16 lg:pt-12 animate-fade-in">
                {/* 标题 - 移动端顶栏已显示标题，仅保留说明 */}
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div className="flex w-full flex-col gap-2 text-center sm:w-auto lg:text-left">
                        <h1 className="hidden font-display text-[34px] font-normal leading-tight text-foreground lg:block">八字合盘</h1>
                        <p className="text-[0.8125rem] leading-relaxed text-foreground-secondary sm:text-[15px]">输入双方的出生信息，看彼此的缘分与相处之道。</p>
                    </div>
                    <Link
                        href="/hepan/history"
                        className="hidden items-center gap-1 text-sm text-accent transition-colors hover:text-accent-strong lg:inline-flex"
                    >
                        合盘历史
                        <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                </header>

                {/* 关系类型 */}
                <div className="flex flex-col gap-2">
                    <span className="hidden text-sm font-medium text-foreground sm:block">关系类型</span>
                    <SegmentedControl
                        ariaLabel="关系类型"
                        options={HEPAN_TYPE_OPTIONS}
                        value={type}
                        onChange={handleTypeChange}
                        className="w-full sm:max-w-[420px]"
                    />
                </div>

                {/* 输入表单 */}
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)] lg:items-center lg:gap-0">
                    <HepanPersonCard
                        idPrefix="hepan-person-1"
                        label={labels[type].p1}
                        value={person1}
                        onChange={setPerson1}
                        onPick={userId ? () => setPickerOpen(1) : undefined}
                        showSummary={summaryMode[1]}
                        onEdit={() => setSummaryMode(prev => ({ ...prev, 1: false }))}
                    />
                    <span aria-hidden="true" className="hidden h-10 w-10 items-center justify-center justify-self-center rounded-full border-[0.5px] border-border-hover bg-surface text-accent lg:flex">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <circle cx="9" cy="12" r="5.5" />
                            <circle cx="15" cy="12" r="5.5" />
                        </svg>
                    </span>
                    <HepanPersonCard
                        idPrefix="hepan-person-2"
                        label={labels[type].p2}
                        value={person2}
                        onChange={setPerson2}
                        onPick={userId ? () => setPickerOpen(2) : undefined}
                        showSummary={summaryMode[2]}
                        onEdit={() => setSummaryMode(prev => ({ ...prev, 2: false }))}
                    />
                </div>

                {/* 提交按钮：桌面端居中，移动端固定在底部导航上方 */}
                <div className="fixed inset-x-0 bottom-[calc(4rem+var(--sab))] z-30 border-t-[0.5px] border-border bg-background px-4 py-3 sm:px-6 lg:static lg:flex lg:justify-center lg:border-0 lg:bg-transparent lg:p-0">
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={loading}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-base font-medium text-on-accent
                            transition-colors duration-150 hover:bg-accent-hover
                            disabled:cursor-not-allowed disabled:opacity-50 lg:w-[320px]"
                    >
                        {loading ? (
                            <>
                                <SoundWaveLoader variant="inline" />
                                正在深度分析...
                            </>
                        ) : (
                            '开始分析'
                        )}
                    </button>
                </div>

                <HepanPrinciples />
            </div>

            {/* 命盘选择器弹窗 */}
            {userId && pickerOpen && (
                <ChartPickerModal
                    isOpen={true}
                    onClose={() => setPickerOpen(null)}
                    onSelect={handleChartSelect}
                    userId={userId}
                    title={`选择${pickerOpen === 1 ? labels[type].p1 : labels[type].p2}的命盘`}
                />
            )}

            {/* 验证错误弹窗 */}
            {validationError && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]"
                        onClick={() => setValidationError(null)}
                    />
                    <div role="alertdialog" aria-labelledby="hepan-validation-title" className="relative w-full max-w-sm rounded-2xl border-[0.5px] border-border bg-surface p-6 shadow-lg animate-zoom-in">
                        <button
                            onClick={() => setValidationError(null)}
                            aria-label="关闭"
                            className="absolute top-4 right-4 p-1 rounded-lg hover:bg-background-secondary transition-colors"
                        >
                            <X className="w-5 h-5 text-foreground-secondary" />
                        </button>
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="rounded-full bg-warning/10 p-3 text-warning">
                                <AlertCircle className="w-8 h-8" />
                            </div>
                            <div>
                                <h3 id="hepan-validation-title" className="mb-1 font-display text-lg text-foreground">请检查输入</h3>
                                <p className="text-foreground-secondary">{validationError}</p>
                            </div>
                            <button
                                onClick={() => setValidationError(null)}
                                className="h-11 w-full rounded-xl bg-background-secondary font-medium text-foreground transition-colors hover:bg-background-tertiary"
                            >
                                知道了
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
