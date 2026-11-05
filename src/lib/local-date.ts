/**
 * 本地日期/时间格式化：不做时区换算，也不依赖业务数据，便于客户端与服务端共用。
 */

/** 本地日期 `YYYY-MM-DD`，月/日补零。 */
export function formatDateParts(year: number, month: number, day: number): string {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 本地钟点 `HH:mm`，补零。 */
export function formatClockTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 本地日期 `YYYY-MM`，月份补零。 */
export function formatYearMonth(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
}

/** 按浏览器本地时区输出 `YYYY-MM-DD`，不做时区换算。 */
export function formatLocalDate(date: Date): string {
    return formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** 按浏览器本地时区输出 `YYYY-MM-DD HH:mm`，不做时区换算。 */
export function formatLocalDateTime(date: Date): string {
    return `${formatLocalDate(date)} ${formatClockTime(date.getHours(), date.getMinutes())}`;
}
