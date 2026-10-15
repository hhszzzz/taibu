/**
 * 即时排盘预览组件
 *
 * 'use client' 标记说明：
 * - 使用 useState 和 useEffect 管理实时更新
 * - 每分钟更新当前时间的四柱
 */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Solar } from 'lunar-javascript';
import { calculateBazi } from 'taibu-core/bazi';
import type { BaziFormData } from '@/types';
import { getEarthlyBranchByHour } from '@/lib/divination/bazi-form-utils';
import { ganZhiTextClass } from '@/components/bazi/element-classes';
import { LUNAR_DAY_NAMES, LUNAR_MONTH_NAMES } from '@/components/bazi/form/options';

interface InstantBaziPreviewProps {
    onUseInstant: () => void;
}

export function InstantBaziPreview({ onUseInstant }: InstantBaziPreviewProps) {
    const [currentTime, setCurrentTime] = useState<Date | null>(null);

    // 每分钟更新当前时间（八字只在分钟变化时可能改变）
    useEffect(() => {
        const updateTime = () => setCurrentTime(new Date());
        updateTime();
        const interval = setInterval(() => {
            updateTime();
        }, 60000); // 改为每分钟更新

        return () => clearInterval(interval);
    }, []);

    // 计算当前时间的八字（使用 useMemo 优化性能）
    const instantBazi = useMemo(() => {
        if (!currentTime) {
            return null;
        }
        const now = currentTime;
        const formData: BaziFormData = {
            name: '',
            gender: 'male',
            birthYear: now.getFullYear(),
            birthMonth: now.getMonth() + 1,
            birthDay: now.getDate(),
            birthHour: now.getHours(),
            birthMinute: now.getMinutes(),
            calendarType: 'solar',
            isLeapMonth: false,
            birthPlace: '',
        };

        try {
            const result = calculateBazi({
                gender: formData.gender,
                birthYear: formData.birthYear,
                birthMonth: formData.birthMonth,
                birthDay: formData.birthDay,
                birthHour: formData.birthHour,
                birthMinute: formData.birthMinute,
                calendarType: 'solar',
                isLeapMonth: false,
                birthPlace: formData.birthPlace,
            });
            return result.fourPillars;
        } catch (error) {
            console.error('计算即时八字失败:', error);
            return null;
        }
    }, [currentTime]);

    // 获取农历信息
    const lunarInfo = useMemo(() => {
        if (!currentTime) {
            return null;
        }
        const solar = Solar.fromYmdHms(
            currentTime.getFullYear(),
            currentTime.getMonth() + 1,
            currentTime.getDate(),
            currentTime.getHours(),
            currentTime.getMinutes(),
            0
        );
        const lunar = solar.getLunar();
        return {
            year: lunar.getYear(),
            month: Math.abs(lunar.getMonth()),
            day: lunar.getDay(),
            hourBranch: getEarthlyBranchByHour(currentTime.getHours()),
        };
    }, [currentTime]);

    if (!instantBazi || !lunarInfo || !currentTime) {
        return null;
    }

    const solarText = `${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, '0')}-${String(currentTime.getDate()).padStart(2, '0')} ${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
    const lunarText = `农历${LUNAR_MONTH_NAMES[lunarInfo.month] ?? ''}${LUNAR_DAY_NAMES[lunarInfo.day] ?? ''} ${lunarInfo.hourBranch}时`;
    const pillars = [
        { label: '年柱', pillar: instantBazi.year },
        { label: '月柱', pillar: instantBazi.month },
        { label: '日柱', pillar: instantBazi.day },
        { label: '时柱', pillar: instantBazi.hour },
    ];

    return (
        <section
            aria-label="即时排盘"
            className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border-[0.5px] border-border px-4 py-4 sm:px-6 sm:py-5 animate-fade-in"
        >
            <div className="flex min-w-[180px] flex-1 flex-col gap-1">
                <h2 className="font-display text-lg font-medium text-foreground">此刻的八字</h2>
                <p className="text-[13px] text-foreground-secondary">
                    <span className="whitespace-nowrap">{solarText}</span>
                    <span className="mx-1 text-foreground-tertiary">·</span>
                    <span className="whitespace-nowrap">{lunarText}</span>
                </p>
            </div>
            <div className="flex items-center gap-4 font-display text-[22px] leading-[1.15]">
                {pillars.map(({ label, pillar }) => (
                    <span key={label} className="flex flex-col items-center" aria-label={`${label}${pillar.stem}${pillar.branch}`}>
                        <span className={ganZhiTextClass(pillar.stem)}>{pillar.stem}</span>
                        <span className={ganZhiTextClass(pillar.branch)}>{pillar.branch}</span>
                    </span>
                ))}
            </div>
            <button
                type="button"
                onClick={onUseInstant}
                className="h-10 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-4 text-sm text-foreground
                    transition-colors duration-150 hover:bg-background-secondary active:bg-background-tertiary"
            >
                即时排盘
            </button>
        </section>
    );
}
