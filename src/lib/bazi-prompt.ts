import type { CalendarType, Gender } from '@/types';
import { calculateBaziChartBundle, generateBaziChartText } from '@/lib/divination/bazi';
import { formatBaziCaseProfileForAI, type BaziCaseProfile } from '@/lib/bazi-case-profile';
import { resolveChartTextDetailLevel, type ChartTextDetailLevel } from '@/lib/divination/detail-level';
import { resolveBirthTimeOptions, type BirthTimeResolution } from '@/lib/divination/birth-time';

export type BaziPromptInput = BirthTimeResolution & {
    id?: string;
    name?: string;
    gender?: Gender | string;
    birthDate?: string;
    birthTime?: string;
    birthPlace?: string;
    longitude?: number;
    calendarType?: CalendarType;
    isLeapMonth?: boolean;
};

export type ResolvedBaziPromptData = ReturnType<typeof calculateBaziChartBundle>;

function rebuildBaziChart(chart: BaziPromptInput): ResolvedBaziPromptData | null {
    if (!chart.birthDate) return null;

    const [birthYear, birthMonth, birthDay] = chart.birthDate.split('-').map(Number);
    // 没有出生时间的记录只排年、月、日三柱，时分只是占位，不参与排盘
    const [birthHour, birthMinute] = chart.birthTime ? chart.birthTime.split(':').map(Number) : [0, 0];
    if (
        !Number.isFinite(birthYear)
        || !Number.isFinite(birthMonth)
        || !Number.isFinite(birthDay)
        || !Number.isFinite(birthHour)
        || !Number.isFinite(birthMinute)
    ) {
        return null;
    }

    try {
        return calculateBaziChartBundle({
            name: chart.name || '未命名',
            gender: chart.gender === 'female' ? 'female' : 'male',
            birthYear,
            birthMonth,
            birthDay,
            birthHour,
            birthMinute,
            ...(chart.birthTime ? {} : { isUnknownTime: true }),
            birthPlace: chart.birthPlace,
            longitude: chart.longitude,
            calendarType: chart.calendarType === 'lunar' ? 'lunar' : 'solar',
            isLeapMonth: chart.isLeapMonth ?? false,
            ...resolveBirthTimeOptions(chart),
        });
    } catch {
        return null;
    }
}

export function resolveBaziPromptData(chart?: BaziPromptInput): ResolvedBaziPromptData | null {
    if (!chart) return null;
    return rebuildBaziChart(chart);
}

function formatBaziFallback(chart: BaziPromptInput): string {
    return [
        '【八字命盘】',
        `姓名：${chart.name || '未命名'}`,
        `出生日期：${chart.birthDate || ''}${chart.birthTime ? ` ${chart.birthTime}` : ''}`,
        '命盘数据不完整，无法重建标准命盘文本。',
    ].filter(Boolean).join('\n');
}

export function formatBaziPromptText(
    chart: BaziPromptInput,
    profile?: Pick<BaziCaseProfile, 'masterReview' | 'ownerFeedback' | 'events'> | null,
    detailLevel?: ChartTextDetailLevel,
    caseEventLimit?: number,
): string {
    const resolvedLevel = resolveChartTextDetailLevel('bazi', detailLevel);
    const resolvedSource = resolveBaziPromptData(chart);
    const chartText = resolvedSource
        ? generateBaziChartText(resolvedSource.output, {
            name: resolvedSource.meta.name,
            detailLevel: resolvedLevel,
            meta: resolvedSource.meta,
        })
        : formatBaziFallback(chart);
    const caseText = formatBaziCaseProfileForAI(profile, caseEventLimit);
    return caseText ? `${chartText}\n\n${caseText}` : chartText;
}
