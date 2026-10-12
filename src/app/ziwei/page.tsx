/**
 * 紫微斗数排盘输入页面
 *
 * 'use client' 标记说明：
 * - 页面包含表单交互，需要在客户端运行
 * - 使用 useState 管理表单状态
 */
'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LunarYear, Lunar, Solar } from 'lunar-javascript';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import type { BaziFormData } from '@/types';
import { UnifiedZiweiForm } from '@/components/bazi/form/UnifiedZiweiForm';
import { resolvePlaceWithAmap } from '@/lib/divination/amap-client';
import { buildPlaceResolutionFallbackMessage } from '@/lib/divination/place-resolution';
import { useToast } from '@/components/ui/Toast';
import { clampDay } from '@/lib/date-utils';
import { writeBirthTimeOptions } from '@/lib/divination/birth-time';
import { buildInitialZiweiFormState, ZIWEI_BIRTH_TIME_REQUIRED_MESSAGE } from '@/lib/divination/ziwei-form';

function ZiweiPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const initialState = buildInitialZiweiFormState(searchParams);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState<BaziFormData>(initialState.formData);
    const [requiresBirthTimeConfirmation, setRequiresBirthTimeConfirmation] = useState(initialState.requiresBirthTimeConfirmation);

    useEffect(() => {
        if (requiresBirthTimeConfirmation) {
            showToast('warning', ZIWEI_BIRTH_TIME_REQUIRED_MESSAGE);
        }
    }, [requiresBirthTimeConfirmation, showToast]);

    // 使用共享的 getDayCount 和 clampDay（Fix 13）

    // 更新表单字段（含历法切换与日期校准）
    const updateField = <K extends keyof BaziFormData>(field: K, value: BaziFormData[K]) => {
        if (field === 'calendarType') {
            setFormData(prev => {
                if (value === prev.calendarType) return prev;

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
        if (requiresBirthTimeConfirmation) {
            showToast('warning', ZIWEI_BIRTH_TIME_REQUIRED_MESSAGE);
            return;
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

            params.set('name', formData.name || '命主');
            params.set('gender', formData.gender || 'male');
            params.set('year', String(formData.birthYear));
            params.set('month', String(formData.birthMonth));
            params.set('day', String(formData.birthDay));
            params.set('hour', String(formData.birthHour));
            params.set('minute', String(formData.birthMinute || 0));
            params.set('calendar', formData.calendarType || 'solar');
            if (formData.calendarType === 'lunar') {
                params.set('leap', formData.isLeapMonth ? '1' : '0');
            }
            params.set('place', formData.birthPlace || '');
            if (resolvedLongitude != null) {
                params.set('longitude', String(resolvedLongitude));
            }

            if (chartId) {
                params.set('chart', chartId);
            }

            router.push(`/ziwei/result?${params.toString()}`);
        } catch (error) {
            console.error('提交失败:', error);
            showToast('error', error instanceof Error ? error.message : '提交失败');
        } finally {
            // Fix 11: 确保 isSubmitting 在 finally 中重置
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[608px] flex-col gap-6 px-4 py-6 animate-fade-in sm:gap-7 sm:px-6 lg:py-14">
                <div className="flex flex-col gap-2">
                    <h1 className="font-display text-[1.625rem] font-normal leading-tight lg:text-[34px]">紫微斗数排盘</h1>
                    <p className="text-sm leading-relaxed text-foreground-secondary lg:text-[15px]">
                        填写出生信息，生成十二宫命盘与大限流年。
                    </p>
                </div>

                <UnifiedZiweiForm
                    formData={formData}
                    onUpdate={updateField}
                    onSubmit={handleSubmit}
                    isSubmitting={isSubmitting}
                    onBirthTimeConfirm={() => setRequiresBirthTimeConfirmation(false)}
                />

                {requiresBirthTimeConfirmation && (
                    <div role="status" className="rounded-xl border-[0.5px] border-warning/30 bg-earth-soft px-4 py-3 text-sm text-warning">
                        检测到旧链接或非法参数未提供有效出生时辰。其他信息已恢复，请先明确选择出生时辰后再排盘。
                    </div>
                )}

                {/* 提示信息 */}
                <p className="text-center text-xs text-foreground-secondary">
                    紫微斗数必须提供出生时辰，请尽量填写准确时间以获得可靠命盘
                </p>
            </div>
        </div>
    );
}

// 主导出组件 - 使用 Suspense 包装
export default function ZiweiPage() {
    return (
        <Suspense fallback={
            <SoundWaveLoader variant="block" text="" />
        }>
            <ZiweiPageContent />
        </Suspense>
    );
}
