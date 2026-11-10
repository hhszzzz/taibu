'use client';

/**
 * 干支懒加载：lunar-javascript 不进首屏包，页面先出列表，模块到位后补上日期旁的干支。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DatePillars } from '@/lib/divination/calendar';
import { isDateKey, parseDateKey } from '@/lib/records';

export function useDatePillars() {
    const getPillars = useRef<((date: Date) => DatePillars) | null>(null);
    const cache = useRef(new Map<string, DatePillars | null>());
    const [, rerender] = useState(0);

    useEffect(() => {
        let alive = true;
        void import('@/lib/divination/calendar').then(module => {
            if (!alive) return;
            getPillars.current = module.getDatePillars;
            cache.current.clear();
            rerender(value => value + 1);
        });
        return () => { alive = false; };
    }, []);

    return useCallback((key: string | null | undefined): DatePillars | null => {
        if (!isDateKey(key) || !getPillars.current) return null;
        if (!cache.current.has(key)) cache.current.set(key, getPillars.current(parseDateKey(key)));
        return cache.current.get(key) ?? null;
    }, []);
}
