import { DEFAULT_DIVINATION_TIMEZONE, getZonedDateTimeParts, zonedTimeToUtc } from 'taibu-core/timezone-utils';

/** Zones every browser can format, offered first so common picks sit above the full IANA list. */
const COMMON_TIME_ZONES = [
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Taipei',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Singapore',
    'Asia/Bangkok',
    'Asia/Kolkata',
    'Asia/Dubai',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Australia/Sydney',
    'Pacific/Auckland',
    'UTC',
] as const;

export function isValidTimeZone(value: unknown): value is string {
    if (typeof value !== 'string' || !value.trim() || value.length > 100) return false;
    try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

/** The browser's own zone, or the product default when it cannot be read. */
export function browserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_DIVINATION_TIMEZONE;
    } catch {
        return DEFAULT_DIVINATION_TIMEZONE;
    }
}

/** The platform list is canonical, so it is read once instead of validating 400 zones on every render. */
const SUPPORTED_TIME_ZONES: readonly string[] = (() => {
    try {
        return Intl.supportedValuesOf?.('timeZone') ?? [];
    } catch {
        return [];
    }
})();

/**
 * Values for a time-zone picker: the current value first, then the product default, common zones and the full
 * IANA list. The current value is kept even when it is not a valid zone so an old record can be corrected.
 */
export function timeZoneOptions(current?: string | null): string[] {
    const zones = new Set<string>();
    const add = (value: string | null | undefined) => {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (trimmed) zones.add(trimmed);
    };

    add(current);
    add(DEFAULT_DIVINATION_TIMEZONE);
    for (const zone of COMMON_TIME_ZONES) add(zone);
    for (const zone of SUPPORTED_TIME_ZONES) zones.add(zone);
    return [...zones];
}

export interface LocalTimeCheck {
    /** `nonexistent`: the clock skipped it; `ambiguous`: it happened twice. */
    issue: 'nonexistent' | 'ambiguous' | null;
    /** For a skipped time, the wall clock the compatible policy lands on. */
    adjusted?: string;
}

const sameWallClock = (date: Date, parts: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string) => {
    const actual = getZonedDateTimeParts(date, timeZone);
    return actual.year === parts.year && actual.month === parts.month && actual.day === parts.day
        && actual.hour === parts.hour && actual.minute === parts.minute;
};

/**
 * Whether a birth wall clock lands in a daylight-saving gap or fold. Only shown when it actually happens;
 * the calculation itself always resolves it with the compatible policy.
 */
export function checkLocalTime(
    parts: { year: number; month: number; day: number; hour: number; minute: number },
    timeZone: string,
): LocalTimeCheck {
    if (!parts.year) return { issue: null };
    try {
        const earlier = zonedTimeToUtc(parts, timeZone, 'earlier');
        const later = zonedTimeToUtc(parts, timeZone, 'later');
        if (earlier.getTime() === later.getTime()) return { issue: null };
        if (sameWallClock(earlier, parts, timeZone) || sameWallClock(later, parts, timeZone)) return { issue: 'ambiguous' };
        const adjusted = getZonedDateTimeParts(later, timeZone);
        return { issue: 'nonexistent', adjusted: `${String(adjusted.hour).padStart(2, '0')}:${String(adjusted.minute).padStart(2, '0')}` };
    } catch {
        return { issue: null };
    }
}
