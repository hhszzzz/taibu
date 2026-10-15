/**
 * 十三时辰吉凶条（含早子 / 晚子）。
 *
 * 'use client'：需要 useState 记录点选的时辰、在客户端读取当前时间定位「此刻」，
 * 并在窄屏横向滚动条中把选中时辰滚到可视区域。
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import type { DailyHourFortune } from '@/components/daily/useDailyAlmanacDetail';

interface DailyHourStripProps {
    /** 时辰列表；为 null 表示细项仍在计算或不可用。 */
    hours: DailyHourFortune[] | null;
    /** 所选日期是否为今天（仅今天标注「此刻」）。 */
    isToday: boolean;
}

const SKELETON_SLOTS = Array.from({ length: 13 }, (_, index) => index);

/** "01:00"~"02:59" → "01–03"。 */
function formatHourRange(start?: string, end?: string): string {
    if (!start || !end) return '';
    const endHour = Number(end.slice(0, 2));
    return `${start.slice(0, 2)}–${Number.isFinite(endHour) ? String(endHour + 1).padStart(2, '0') : end.slice(0, 2)}`;
}

/** 当前钟点所在时辰；任何日期都按同一钟点默认选中，便于对照。 */
function findClockHourIndex(hours: DailyHourFortune[], now: Date): number {
    const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return hours.findIndex((hour) => Boolean(hour.startTime && hour.endTime && clock >= hour.startTime && clock <= hour.endTime));
}

/** lunar-javascript 冲煞描述用半角括号（"(乙巳)蛇"），展示统一为全角。 */
function formatChong(value: string): string {
    return value.replace(/\(/gu, '（').replace(/\)/gu, '）');
}

const isAuspicious = (hour: DailyHourFortune) => hour.tianShenLuck === '吉';

export function DailyHourStrip({ hours, isToday }: DailyHourStripProps) {
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    // 细项只在客户端计算（hours 首屏为 null），此处读取钟点不会造成水合差异
    const clockIndex = hours ? findClockHourIndex(hours, new Date()) : -1;
    const currentIndex = isToday ? clockIndex : -1;
    const activeIndex = selectedIndex ?? Math.max(clockIndex, 0);
    const activeHour = hours?.[activeIndex];
    const scrollerRef = useRef<HTMLDivElement>(null);

    // 窄屏为横向滚动：拿到数据后把默认时辰滚到中间（只改容器 scrollLeft，不触发页面滚动）
    const hasHours = Boolean(hours && hours.length > 0);
    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller || !hasHours || scroller.scrollWidth <= scroller.clientWidth) return;
        const target = scroller.querySelectorAll<HTMLElement>('[data-hour-slot]')[Math.max(clockIndex, 0)];
        if (!target) return;
        scroller.scrollLeft = target.offsetLeft - (scroller.clientWidth - target.offsetWidth) / 2;
    }, [hasHours, clockIndex]);

    return (
        <section aria-labelledby="daily-hour-strip-title" className="flex flex-col gap-2.5 lg:gap-3">
            <div className="flex items-baseline justify-between gap-3">
                <h2 id="daily-hour-strip-title" className="font-display text-[1.0625rem] lg:text-[1.375rem]">时辰吉凶</h2>
                <span className="text-xs text-foreground-secondary lg:text-[13px]">
                    <span className="hidden lg:inline">点时辰查看宜忌与冲煞</span>
                    <span className="lg:hidden">左右滑动</span>
                </span>
            </div>

            {hours && hours.length > 0 ? (
                <div ref={scrollerRef} className="-mx-4 overflow-x-auto px-4 scrollbar-hide lg:mx-0 lg:overflow-visible lg:px-0">
                    <div className="flex gap-1.5 lg:grid lg:grid-cols-13 lg:gap-0 lg:overflow-hidden lg:rounded-[14px] lg:border-[0.5px] lg:border-border lg:bg-surface">
                        {hours.map((hour, index) => {
                            const isActive = index === activeIndex;
                            const isCurrent = index === currentIndex;
                            const auspicious = isAuspicious(hour);
                            const range = formatHourRange(hour.startTime, hour.endTime);
                            return (
                                <button
                                    key={`${hour.ganZhi}-${index}`}
                                    type="button"
                                    data-hour-slot
                                    aria-pressed={isActive}
                                    aria-label={`${hour.ganZhi}时 ${range} ${hour.tianShen}${hour.tianShenLuck}${isCurrent ? ' 此刻' : ''}`}
                                    onClick={() => setSelectedIndex(index)}
                                    className={`flex w-16 shrink-0 flex-col items-center gap-0.5 rounded-xl border-[0.5px] py-2 text-center transition-colors lg:w-auto lg:gap-[3px] lg:rounded-none lg:border-0 lg:border-l-[0.5px] lg:border-border lg:py-3 lg:first:border-l-0 ${isActive
                                        ? 'border-foreground bg-foreground text-background'
                                        : 'border-border bg-surface text-foreground hover:bg-background-secondary'}`}
                                >
                                    {/* 移动端：时段在上；桌面端：干支在上 */}
                                    <span className={`order-1 text-[10.5px] tabular-nums lg:order-2 lg:text-[0.6875rem] ${isActive ? 'text-background/75' : 'text-foreground-tertiary lg:text-foreground-secondary'}`}>
                                        {range}
                                        {isCurrent && <span className={isActive ? '' : 'text-accent'}> 此刻</span>}
                                    </span>
                                    <span className="order-2 font-display text-base leading-snug lg:order-1 lg:leading-tight">{hour.ganZhi}</span>
                                    {/* 移动端：天神与吉凶同行着色 */}
                                    <span className={`order-3 text-[0.6875rem] lg:hidden ${isActive ? 'text-background/80' : auspicious ? 'text-wood' : 'text-fire'}`}>
                                        {hour.tianShen} {hour.tianShenLuck}
                                    </span>
                                    <span className="order-3 hidden text-xs lg:block">{hour.tianShen}</span>
                                    <span className={`order-4 hidden rounded px-1.5 text-[11px] leading-4 lg:block ${isActive
                                        ? auspicious ? 'bg-success text-surface' : 'bg-background/20 text-background'
                                        : auspicious ? 'bg-wood-soft text-wood' : 'bg-background-secondary text-foreground-secondary'}`}
                                    >
                                        {hour.tianShenLuck || '—'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div aria-hidden="true" className="flex gap-1.5 overflow-hidden lg:grid lg:grid-cols-13">
                    {SKELETON_SLOTS.map((slot) => (
                        <div key={slot} className="h-[72px] w-16 shrink-0 animate-pulse rounded-xl bg-background-secondary lg:h-[100px] lg:w-auto" />
                    ))}
                </div>
            )}

            {activeHour && (
                <div
                    aria-live="polite"
                    className="flex flex-col rounded-xl border-[0.5px] border-border bg-surface px-3.5 py-3 text-[0.8125rem] leading-[1.6] lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-6 lg:gap-y-2 lg:px-[18px] lg:py-3.5 lg:text-sm lg:leading-normal"
                >
                    <span className="font-medium lg:font-display lg:font-normal">
                        {activeHour.ganZhi}时 · {activeHour.tianShen} {activeHour.tianShenType}
                    </span>
                    <span className="flex flex-wrap gap-x-2 gap-y-1 text-foreground-secondary lg:contents">
                        {(activeHour.chong || activeHour.sha) && (
                            <span>
                                {activeHour.chong && `冲${formatChong(activeHour.chong)}`}
                                {activeHour.chong && activeHour.sha && ' · '}
                                {activeHour.sha && `煞${activeHour.sha}`}
                            </span>
                        )}
                        {activeHour.suitable.length > 0 ? (
                            <span className="text-foreground"><span className="text-wood">宜</span> {activeHour.suitable.join(' ')}</span>
                        ) : (
                            <span className="text-danger">诸事不宜</span>
                        )}
                        {activeHour.avoid.length > 0 && (
                            <span className="text-foreground"><span className="text-fire">忌</span> {activeHour.avoid.join(' ')}</span>
                        )}
                    </span>
                </div>
            )}
        </section>
    );
}
