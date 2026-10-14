import { Lunar, Solar } from 'lunar-javascript';
import type { CalendarType, EarthlyBranch } from '@/types';

export type CalendarSwitchInput = {
    calendarType: CalendarType;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    isLeapMonth?: boolean;
    birthHour: number;
    birthMinute: number;
};

export type CalendarSwitchResult = {
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    isLeapMonth: boolean;
};

/** Parse a numeric query/form value without treating the valid value 0 as missing. */
export function parseNumberParam(value: string | null, fallback: number): number {
    if (value === null || value.trim() === '') {
        return fallback;
    }

    const parsed = Number(value);
    return Number.isNaN(parsed) ? fallback : parsed;
}

const normalizeNow = (now: Date) => ({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
});

const hasValidDate = (input: CalendarSwitchInput) => (
    input.birthYear > 0 && input.birthMonth > 0 && input.birthDay > 0
);

export function normalizeBirthDateForCalendarSwitch(
    input: CalendarSwitchInput,
    target: CalendarType,
    now: Date = new Date()
): CalendarSwitchResult {
    if (target === 'pillars') {
        return {
            birthYear: 0,
            birthMonth: 0,
            birthDay: 0,
            isLeapMonth: false,
        };
    }

    const safeNow = normalizeNow(now);
    const shouldUseFallback = input.calendarType === 'pillars' || !hasValidDate(input);

    if (target === 'solar') {
        if (input.calendarType === 'lunar' && !shouldUseFallback) {
            const lunar = Lunar.fromYmdHms(
                input.birthYear,
                input.isLeapMonth ? -Math.abs(input.birthMonth) : input.birthMonth,
                input.birthDay,
                input.birthHour,
                input.birthMinute,
                0
            );
            const solar = lunar.getSolar();
            return {
                birthYear: solar.getYear(),
                birthMonth: solar.getMonth(),
                birthDay: solar.getDay(),
                isLeapMonth: false,
            };
        }

        if (input.calendarType === 'solar' && !shouldUseFallback) {
            return {
                birthYear: input.birthYear,
                birthMonth: input.birthMonth,
                birthDay: input.birthDay,
                isLeapMonth: false,
            };
        }

        return {
            birthYear: safeNow.year,
            birthMonth: safeNow.month,
            birthDay: safeNow.day,
            isLeapMonth: false,
        };
    }

    // target === 'lunar'
    const solarBase = (!shouldUseFallback && input.calendarType === 'solar')
        ? {
            year: input.birthYear,
            month: input.birthMonth,
            day: input.birthDay,
            hour: input.birthHour,
            minute: input.birthMinute,
        }
        : safeNow;

    const solar = Solar.fromYmdHms(
        solarBase.year,
        solarBase.month,
        solarBase.day,
        solarBase.hour,
        solarBase.minute,
        0
    );
    const lunar = solar.getLunar();
    return {
        birthYear: lunar.getYear(),
        birthMonth: Math.abs(lunar.getMonth()),
        birthDay: lunar.getDay(),
        isLeapMonth: lunar.getMonth() < 0,
    };
}

const BRANCH_BY_HOUR: { start: number; end: number; branch: EarthlyBranch }[] = [
    { start: 23, end: 23, branch: '子' },
    { start: 0, end: 0, branch: '子' },
    { start: 1, end: 2, branch: '丑' },
    { start: 3, end: 4, branch: '寅' },
    { start: 5, end: 6, branch: '卯' },
    { start: 7, end: 8, branch: '辰' },
    { start: 9, end: 10, branch: '巳' },
    { start: 11, end: 12, branch: '午' },
    { start: 13, end: 14, branch: '未' },
    { start: 15, end: 16, branch: '申' },
    { start: 17, end: 18, branch: '酉' },
    { start: 19, end: 20, branch: '戌' },
    { start: 21, end: 22, branch: '亥' },
];

export function getEarthlyBranchByHour(hour: number): EarthlyBranch {
    const normalized = ((hour % 24) + 24) % 24;
    const match = BRANCH_BY_HOUR.find((item) => normalized >= item.start && normalized <= item.end);
    return match?.branch ?? '子';
}

/**
 * 公历日期对应的农历文本，如「甲子年九月初三」（闰月为「闰四月」）。
 * 日期无效（含不存在的日期）时返回 null，调用方据此省略农历信息。
 */
export function formatLunarDateFromSolar(year: number, month: number, day: number): string | null {
    if (![year, month, day].every(Number.isInteger) || year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) {
        return null;
    }
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
        return null;
    }
    try {
        const lunar = Solar.fromYmd(year, month, day).getLunar();
        return `${lunar.getYearInGanZhi()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
    } catch {
        return null;
    }
}
