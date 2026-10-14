/**
 * 八字排盘输入页面
 * 
 * 'use client' 标记说明：
 * - 页面包含表单交互，需要在客户端运行
 * - 使用 useState 管理表单状态
 */
'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lunar, Solar, LunarYear } from 'lunar-javascript';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import type { BaziFormData, Gender, CalendarType } from '@/types';
import { BaziForm } from '@/components/bazi/form/BaziForm';
import { InstantBaziPreview } from '@/components/bazi/InstantBaziPreview';
import { DEFAULT_BAZI_FORM_DATA } from '@/components/bazi/form/options';
import { resolvePlaceWithAmap } from '@/lib/divination/amap-client';
import { normalizeBirthDateForCalendarSwitch, parseNumberParam } from '@/lib/divination/bazi-form-utils';
import { buildPlaceResolutionFallbackMessage, parseLongitude } from '@/lib/divination/place-resolution';
import { useToast } from '@/components/ui/Toast';
import { clampDay } from '@/lib/date-utils';
import { readBirthTimeOptions, writeBirthTimeOptions } from '@/lib/divination/birth-time';

const getInitialFormData = (searchParams: { get: (key: string) => string | null }): BaziFormData => {
    const name = searchParams.get('name');
    const gender = searchParams.get('gender') as Gender | null;
    const year = searchParams.get('year');
    const month = searchParams.get('month');
    const day = searchParams.get('day');
    const hour = searchParams.get('hour');
    const minute = searchParams.get('minute');
    const calendar = searchParams.get('calendar') as CalendarType | null;
    const place = searchParams.get('place');
    const leap = searchParams.get('leap');
    const longitude = searchParams.get('longitude');

    if (!name && !year) {
        return { ...DEFAULT_BAZI_FORM_DATA, ...readBirthTimeOptions(searchParams) };
    }

    const isUnknownTime = hour === '-1';
    const birthYear = parseNumberParam(year, DEFAULT_BAZI_FORM_DATA.birthYear);
    const birthMonth = parseNumberParam(month, DEFAULT_BAZI_FORM_DATA.birthMonth);
    const isLeapRequested = calendar === 'lunar' && leap === '1';
    const leapMonthOfYear = calendar === 'lunar'
        ? LunarYear.fromYear(birthYear).getLeapMonth()
        : 0;

    return {
        name: name || '',
        gender: gender === 'female' ? 'female' : 'male',
        birthYear,
        birthMonth,
        birthDay: parseNumberParam(day, DEFAULT_BAZI_FORM_DATA.birthDay),
        birthHour: isUnknownTime ? DEFAULT_BAZI_FORM_DATA.birthHour : parseNumberParam(hour, DEFAULT_BAZI_FORM_DATA.birthHour),
        birthMinute: parseNumberParam(minute, DEFAULT_BAZI_FORM_DATA.birthMinute),
        calendarType: calendar === 'pillars' ? 'pillars' : (calendar === 'lunar' ? 'lunar' : 'solar'),
        isLeapMonth: isLeapRequested && leapMonthOfYear === birthMonth,
        birthPlace: place || '',
        longitude: parseLongitude(longitude),
        ...readBirthTimeOptions(searchParams),
    };
};

function BaziPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [unknownTime, setUnknownTime] = useState(() => {
        const hourParam = searchParams.get('hour');
        return hourParam === null || hourParam === '-1';
    });



    // 表单状态 - 初始从 URL 参数读取（用于修改已有命盘）
    const [formData, setFormData] = useState<BaziFormData>(() => getInitialFormData(searchParams));

    // 更新表单字段（含历法切换与日期校准）
    const updateField = <K extends keyof BaziFormData>(field: K, value: BaziFormData[K]) => {
        if (field === 'calendarType') {
            setFormData(prev => {
                if (value === prev.calendarType) return prev;

                // 切换到四柱模式
                if (value === 'pillars') {
                    return {
                        ...prev,
                        calendarType: 'pillars',
                        // 清空日期字段，等待四柱反推后填充
                        birthYear: 0,
                        birthMonth: 0,
                        birthDay: 0,
                        pillars: {
                            year: { stem: '', branch: '' },
                            month: { stem: '', branch: '' },
                            day: { stem: '', branch: '' },
                            hour: { stem: '', branch: '' },
                        },
                    };
                }

                // 从四柱模式切换出来
                if (prev.calendarType === 'pillars') {
                    const normalized = normalizeBirthDateForCalendarSwitch(
                        {
                            calendarType: prev.calendarType,
                            birthYear: prev.birthYear,
                            birthMonth: prev.birthMonth,
                            birthDay: prev.birthDay,
                            isLeapMonth: prev.isLeapMonth,
                            birthHour: prev.birthHour,
                            birthMinute: prev.birthMinute,
                        },
                        value as CalendarType,
                        new Date()
                    );
                    return {
                        ...prev,
                        calendarType: value as 'solar' | 'lunar',
                        birthYear: normalized.birthYear,
                        birthMonth: normalized.birthMonth,
                        birthDay: normalized.birthDay,
                        isLeapMonth: normalized.isLeapMonth,
                        pillars: undefined,
                    };
                }

                if (value === 'lunar') {
                    const solar = Solar.fromYmdHms(
                        prev.birthYear,
                        prev.birthMonth,
                        prev.birthDay,
                        prev.birthHour,
                        prev.birthMinute,
                        0
                    );
                    const lunar = solar.getLunar();
                    const lunarMonth = Math.abs(lunar.getMonth());
                    const isLeapMonth = lunar.getMonth() < 0;
                    const lunarDay = clampDay('lunar', lunar.getYear(), lunarMonth, lunar.getDay(), isLeapMonth);
                    return {
                        ...prev,
                        calendarType: 'lunar',
                        birthYear: lunar.getYear(),
                        birthMonth: lunarMonth,
                        birthDay: lunarDay,
                        isLeapMonth,
                    };
                }

                const lunar = Lunar.fromYmdHms(
                    prev.birthYear,
                    prev.isLeapMonth ? -Math.abs(prev.birthMonth) : prev.birthMonth,
                    clampDay('lunar', prev.birthYear, prev.birthMonth, prev.birthDay, prev.isLeapMonth),
                    prev.birthHour,
                    prev.birthMinute,
                    0
                );
                const solar = lunar.getSolar();
                return {
                    ...prev,
                    calendarType: 'solar',
                    birthYear: solar.getYear(),
                    birthMonth: solar.getMonth(),
                    birthDay: clampDay('solar', solar.getYear(), solar.getMonth(), solar.getDay()),
                    isLeapMonth: false,
                };
            });
            return;
        }

        setFormData(prev => {
            const next = { ...prev, [field]: value };

            if (field === 'birthPlace') {
                next.longitude = undefined;
            }

            if ((field === 'birthYear' || field === 'birthMonth' || field === 'isLeapMonth') && prev.calendarType) {
                next.birthDay = clampDay(
                    prev.calendarType,
                    field === 'birthYear' ? (value as number) : next.birthYear,
                    field === 'birthMonth' ? (value as number) : next.birthMonth,
                    next.birthDay,
                    field === 'isLeapMonth' ? (value as boolean) : next.isLeapMonth
                );
            }

            if (next.calendarType === 'lunar') {
                const leapMonth = LunarYear.fromYear(next.birthYear).getLeapMonth();
                if (next.isLeapMonth && leapMonth !== next.birthMonth) {
                    next.isLeapMonth = false;
                }
            } else {
                next.isLeapMonth = false;
            }

            return next;
        });
    };

    // 提交表单
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // 四柱模式下必须已反推出日期才能提交
        if (formData.calendarType === 'pillars') {
            if (!formData.birthYear || !formData.birthMonth || !formData.birthDay) {
                showToast('warning', '请先选择完整的四柱并确认出生时间');
                return;
            }
        }

        setIsSubmitting(true);

        try {
            let resolvedLongitude = formData.longitude;
            if (formData.birthPlace && resolvedLongitude == null) {
                const { resolution, errorMessage } = await resolvePlaceWithAmap(formData.birthPlace);
                if (resolution.resolved) {
                    resolvedLongitude = resolution.longitude;
                } else {
                    showToast('info', errorMessage || buildPlaceResolutionFallbackMessage(resolution.reason));
                }
            }

            const params = new URLSearchParams();
            writeBirthTimeOptions(params, formData);
            const chartId = searchParams.get('chart');

            // 四柱模式
            if (formData.calendarType === 'pillars' && formData.pillars) {
                params.set('mode', 'pillars');
                params.set('name', formData.name || '');
                params.set('gender', formData.gender || 'male');
                params.set('year_stem', formData.pillars.year.stem);
                params.set('year_branch', formData.pillars.year.branch);
                params.set('month_stem', formData.pillars.month.stem);
                params.set('month_branch', formData.pillars.month.branch);
                params.set('day_stem', formData.pillars.day.stem);
                params.set('day_branch', formData.pillars.day.branch);
                params.set('hour_stem', formData.pillars.hour.stem);
                params.set('hour_branch', formData.pillars.hour.branch);
                // 四柱模式下也传递日期参数（如果已反推出时间）
                if (formData.birthYear && formData.birthMonth && formData.birthDay) {
                    params.set('year', String(formData.birthYear));
                    params.set('month', String(formData.birthMonth));
                    params.set('day', String(formData.birthDay));
                    params.set('hour', String(formData.birthHour));
                    params.set('minute', String(formData.birthMinute || 0));
                    params.set('calendar', 'solar');
                }
                // 四柱模式下也保留出生地点
                params.set('place', formData.birthPlace || '');
                if (resolvedLongitude != null) {
                    params.set('longitude', String(resolvedLongitude));
                }
            } else {
                // 日期模式
                params.set('name', formData.name || '');
                params.set('gender', formData.gender || 'male');
                params.set('year', String(formData.birthYear));
                params.set('month', String(formData.birthMonth));
                params.set('day', String(formData.birthDay));
                params.set('hour', unknownTime ? '-1' : String(formData.birthHour));
                params.set('minute', unknownTime ? '0' : String(formData.birthMinute || 0));
                params.set('calendar', formData.calendarType || 'solar');
                if (formData.calendarType === 'lunar') {
                    params.set('leap', formData.isLeapMonth ? '1' : '0');
                }
                params.set('place', formData.birthPlace || '');
                if (resolvedLongitude != null) {
                    params.set('longitude', String(resolvedLongitude));
                }
            }

            if (chartId) {
                params.set('chart', chartId);
            }

            router.push(`/bazi/result?${params.toString()}`);
        } catch (error) {
            console.error('提交失败:', error);
            showToast('error', error instanceof Error ? error.message : '提交失败');
            setIsSubmitting(false);
        }
    };

    // 使用即时排盘
    const handleUseInstant = () => {
        const now = new Date();
        setFormData(prev => ({
            ...prev,
            birthYear: now.getFullYear(),
            birthMonth: now.getMonth() + 1,
            birthDay: now.getDate(),
            birthHour: now.getHours(),
            birthMinute: now.getMinutes(),
            calendarType: 'solar',
        }));
        setUnknownTime(false);
        // 自动提交
        setTimeout(() => {
            const form = document.querySelector('form');
            if (form) {
                form.requestSubmit();
            }
        }, 100);
    };

    return (
        <div className="min-h-screen bg-background">
            <div className="mx-auto flex w-full max-w-[608px] flex-col gap-5 px-4 pb-10 pt-4 sm:gap-7 sm:px-6 lg:pb-16 lg:pt-14 animate-fade-in">
                {/* 页面标题 - 移动端顶栏已显示标题，仅保留说明 */}
                <header className="flex flex-col gap-2 text-center lg:text-left">
                    <h1 className="hidden font-display text-[34px] font-normal leading-tight text-foreground lg:block">八字排盘</h1>
                    <p className="text-[0.8125rem] leading-relaxed text-foreground-secondary sm:text-[15px]">
                        填写出生信息，生成四柱命盘与大运流年。
                    </p>
                </header>

                <BaziForm
                    formData={formData}
                    onUpdate={updateField}
                    unknownTime={unknownTime}
                    onToggleUnknownTime={() => setUnknownTime((prev) => !prev)}
                    onSubmit={handleSubmit}
                    isSubmitting={isSubmitting}
                />

                <InstantBaziPreview onUseInstant={handleUseInstant} />
            </div>
        </div>
    );
}

// 主导出组件 - 使用 Suspense 包装
export default function BaziPage() {
    return (
        <Suspense fallback={
            <SoundWaveLoader variant="block" text="" />
        }>
            <BaziPageContent />
        </Suspense>
    );
}
