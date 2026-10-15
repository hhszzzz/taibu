/**
 * 补充黄历细项（建除、彭祖百忌、黄道/黑道、阴贵方位、十三时辰吉凶）。
 *
 * 这些字段不在 `getCalendarAlmanac` 的结果中；这里只调用 taibu-core 的公开黄历引擎
 * `calculateDailyAlmanac`，不在 Web 端重复实现任何历法计算。仅在客户端计算，
 * 因此首屏 SSR 不会因时区或"当前时辰"不同而出现水合差异。
 */
import { useEffect, useState } from 'react';
import { calculateDailyAlmanac, type AlmanacOutput } from 'taibu-core/almanac';

export type DailyAlmanacDetail = AlmanacOutput['almanac'];
export type DailyHourFortune = DailyAlmanacDetail['hourlyFortune'][number];

/** 本地日期 → YYYY-MM-DD（与页面 `date` 参数一致，按用户本地日历日计算）。 */
export function toLocalDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 返回所选日期的黄历细项；计算中或失败时返回 null（界面以 "—" / 骨架占位）。 */
export function useDailyAlmanacDetail(date: Date): DailyAlmanacDetail | null {
    const dateKey = toLocalDateKey(date);
    const [state, setState] = useState<{ key: string; detail: DailyAlmanacDetail | null } | null>(null);

    useEffect(() => {
        let cancelled = false;
        calculateDailyAlmanac({ date: dateKey })
            .then((result) => {
                if (!cancelled) setState({ key: dateKey, detail: result.almanac });
            })
            .catch((error: unknown) => {
                console.error('黄历细项计算失败:', error);
                if (!cancelled) setState({ key: dateKey, detail: null });
            });
        return () => {
            cancelled = true;
        };
    }, [dateKey]);

    return state?.key === dateKey ? state.detail : null;
}
