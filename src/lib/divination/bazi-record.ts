import { calculateBazi, type BaziInput, type BaziOutput as CoreBaziOutput } from 'taibu-core/bazi';
import { parseLongitude } from '@/lib/divination/place-resolution';
import { parseBirthTimeString, resolveBirthTimeOptions } from '@/lib/divination/birth-time';

type StoredBaziBase = {
    gender?: string | null;
    birth_date?: string | null;
    birth_time?: string | null;
    birth_place?: string | null;
    longitude?: number | string | null;
    calendar_type?: string | null;
    is_leap_month?: boolean | null;
    timezone?: unknown;
    disambiguation?: unknown;
};

/**
 * Shared birth-input reconstruction; callers decide whether a calculation error is fatal.
 * A record without a birth time casts no hour pillar: no hour is assumed in its place.
 */
export function buildBaziInputFromStoredFields(row: StoredBaziBase): BaziInput {
    if (typeof row.birth_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.birth_date)) {
        throw new Error('出生日期格式无效');
    }
    const [birthYear, birthMonth, birthDay] = row.birth_date.split('-').map(Number);
    const birthTime = row.birth_time?.trim() ?? '';
    const time = birthTime ? parseBirthTimeString(birthTime) : null;
    if (birthTime && !time) throw new Error('出生时辰格式无效');
    if (row.gender != null && row.gender !== 'male' && row.gender !== 'female') throw new Error('性别无效');
    if (row.calendar_type != null && row.calendar_type !== 'lunar' && row.calendar_type !== 'solar') throw new Error('历法无效');
    const longitude = parseLongitude(row.longitude);
    if (row.longitude != null && longitude === undefined) throw new Error('经度无效');
    return {
        gender: row.gender === 'female' ? 'female' : 'male',
        birthYear,
        birthMonth,
        birthDay,
        ...(time ? { birthHour: time.hour, birthMinute: time.minute } : {}),
        birthPlace: row.birth_place || undefined,
        longitude,
        calendarType: row.calendar_type === 'lunar' ? 'lunar' : 'solar',
        isLeapMonth: row.is_leap_month ?? false,
        ...resolveBirthTimeOptions(row),
    };
}

export function calculateBaziOutputFromStoredFields(row: StoredBaziBase): CoreBaziOutput | null {
    try {
        return calculateBazi(buildBaziInputFromStoredFields(row));
    } catch {
        return null;
    }
}
