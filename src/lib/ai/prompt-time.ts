import { DEFAULT_DIVINATION_TIMEZONE, getTimeZoneOffsetMinutes, getZonedDateTimeParts } from 'taibu-core/timezone-utils';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;
const pad = (value: number) => String(value).padStart(2, '0');

/** The browser's IANA time zone, sent with chat and Agent requests; undefined where the runtime reports none. */
export function browserTimeZone(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
        return undefined;
    }
}

/** The zone a request's messages are dated in: the IANA name the browser sent, else China Standard Time. */
export function resolveUserTimeZone(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 64) return DEFAULT_DIVINATION_TIMEZONE;
    try {
        getZonedDateTimeParts(new Date(0), value);
        return value;
    } catch {
        return DEFAULT_DIVINATION_TIMEZONE;
    }
}

/** `2026-10-24 23:51 星期六，Asia/Shanghai（UTC+08:00）`: the local wall clock the tools take, and the zone it is in. */
export function formatUserTime(at: Date, timeZone: string): string {
    const { year, month, day, hour, minute } = getZonedDateTimeParts(at, timeZone);
    const offset = getTimeZoneOffsetMinutes(timeZone, at);
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    const utc = `UTC${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
    return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)} 星期${weekday}，${timeZone}（${utc}）`;
}

/**
 * The line a user's message opens with in the model's context, so "now", "today" and "this year" are read rather than
 * guessed. It dates the message instead of the system prompt, which then stays the same from minute to minute and
 * keeps its provider cache.
 */
export function sentAtLine(at: Date, timeZone: string): string {
    return `【发送时间：${formatUserTime(at, timeZone)}】`;
}
