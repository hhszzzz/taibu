/**
 * 搜索框里的时间词：`昨天`、`10月`、`2026-10-20` 直接变成日期范围，
 * 剩下的文字才是关键词。范围按本地日历计算，接口按 `YYYY-MM-DD` 收发。
 */

export interface SearchTimeRange {
    /** First day, YYYY-MM-DD. */
    since: string;
    /** Last day, inclusive, YYYY-MM-DD. */
    until: string;
    /** What the chip shows: one day, a whole month, or a range. */
    label: string;
}

export interface ParsedSearchQuery {
    /** Everything except the time token. */
    keyword: string;
    time: SearchTimeRange | null;
}

const pad = (value: number) => String(value).padStart(2, '0');
const ymd = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function dayRange(date: Date): SearchTimeRange {
    const day = ymd(date);
    return { since: day, until: day, label: day };
}

function range(since: Date, until: Date, label: string): SearchTimeRange {
    return { since: ymd(since), until: ymd(until), label };
}

function monthRange(year: number, month: number): SearchTimeRange | null {
    if (month < 1 || month > 12) return null;
    const since = new Date(year, month - 1, 1);
    const until = new Date(year, month, 0);
    return range(since, until, `${year}-${pad(month)}`);
}

function validDay(year: number, month: number, day: number): Date | null {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

const NAMED_DAYS: ReadonlyArray<[RegExp, number]> = [
    [/^今天$/u, 0],
    [/^昨天$/u, -1],
    [/^前天$/u, -2],
];

/** Monday of the week containing `date`. */
function mondayOf(date: Date): Date {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const offset = (result.getDay() + 6) % 7;
    result.setDate(result.getDate() - offset);
    return result;
}

function namedRange(token: string, now: Date): SearchTimeRange | null {
    for (const [pattern, offset] of NAMED_DAYS) {
        if (!pattern.test(token)) continue;
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        return dayRange(date);
    }
    switch (token) {
        case '本周': {
            const since = mondayOf(now);
            const until = new Date(since.getFullYear(), since.getMonth(), since.getDate() + 6);
            return range(since, until, `${ymd(since)} – ${until.getMonth() + 1}月${until.getDate()}日`);
        }
        case '上周': {
            const since = mondayOf(now);
            since.setDate(since.getDate() - 7);
            const until = new Date(since.getFullYear(), since.getMonth(), since.getDate() + 6);
            return range(since, until, `${ymd(since)} – ${until.getMonth() + 1}月${until.getDate()}日`);
        }
        case '本月':
            return monthRange(now.getFullYear(), now.getMonth() + 1);
        case '上个月': {
            const month = now.getMonth() === 0 ? 12 : now.getMonth();
            const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
            return monthRange(year, month);
        }
        case '今年':
            return range(new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 11, 31), `${now.getFullYear()}年`);
        case '去年':
            return range(new Date(now.getFullYear() - 1, 0, 1), new Date(now.getFullYear() - 1, 11, 31), `${now.getFullYear() - 1}年`);
        default:
            return null;
    }
}

const DAY_PATTERN = /(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/u;
const MONTH_PATTERN = /(\d{4})\s*[-/年]\s*(\d{1,2})\s*月?/u;
const MONTH_DAY_PATTERN = /(\d{1,2})\s*月\s*(\d{1,2})\s*日?/u;
const MONTH_ONLY_PATTERN = /(\d{1,2})\s*月/u;
const YEAR_PATTERN = /(\d{4})\s*年/u;

function matchTime(text: string, now: Date): { range: SearchTimeRange; token: string } | null {
    let match = DAY_PATTERN.exec(text);
    if (match) {
        const date = validDay(Number(match[1]), Number(match[2]), Number(match[3]));
        return date ? { range: dayRange(date), token: match[0] } : null;
    }
    match = MONTH_DAY_PATTERN.exec(text);
    if (match) {
        const date = validDay(now.getFullYear(), Number(match[1]), Number(match[2]));
        return date ? { range: dayRange(date), token: match[0] } : null;
    }
    match = MONTH_PATTERN.exec(text);
    if (match) {
        const time = monthRange(Number(match[1]), Number(match[2]));
        return time ? { range: time, token: match[0] } : null;
    }
    match = MONTH_ONLY_PATTERN.exec(text);
    if (match) {
        const time = monthRange(now.getFullYear(), Number(match[1]));
        return time ? { range: time, token: match[0] } : null;
    }
    match = YEAR_PATTERN.exec(text);
    if (match) {
        const year = Number(match[1]);
        return { range: range(new Date(year, 0, 1), new Date(year, 11, 31), `${year}年`), token: match[0] };
    }
    for (const token of ['今天', '昨天', '前天', '本周', '上周', '本月', '上个月', '今年', '去年']) {
        const index = text.indexOf(token);
        if (index < 0) continue;
        const time = namedRange(token, now);
        if (time) return { range: time, token };
    }
    return null;
}

/** Split a palette query into its keyword and an optional date range. */
export function parseSearchTime(raw: string, now: Date = new Date()): ParsedSearchQuery {
    const text = raw.trim();
    if (!text) return { keyword: '', time: null };
    const found = matchTime(text, now);
    if (!found) return { keyword: text, time: null };
    const keyword = text.replace(found.token, ' ').replace(/\s+/gu, ' ').trim();
    return { keyword, time: found.range };
}
