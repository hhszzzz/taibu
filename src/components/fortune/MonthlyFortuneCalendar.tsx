import Link from 'next/link';
import {
    FORTUNE_CARD_CLASS,
    FORTUNE_TONE_BADGE_CLASS,
    FORTUNE_TONE_DOT_CLASS,
    getDailyHref,
    getFortuneTone,
} from '@/components/fortune/fortune-display';
import type { MonthlyFortune } from '@/lib/divination/fortune';
import type { FortuneLevel } from '@/types';

interface MonthlyFortuneCalendarProps {
    year: number;
    month: number;
    /** 每日综合等级，下标 0 为 1 日。 */
    dayLevels: FortuneLevel[];
    /** 关键日（仅个性化），在日期格右上角标点。 */
    keyDates?: MonthlyFortune['keyDates'];
    /** 客户端当前日期，用于标注今天。 */
    today: Date;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const LEGEND = [
    { tone: 'favorable', label: '吉' },
    { tone: 'neutral', label: '平' },
    { tone: 'unfavorable', label: '凶' },
] as const;

/** 每日运程月历：每格显示综合等级，点击进入当日日运。 */
export function MonthlyFortuneCalendar({ year, month, dayLevels, keyDates = [], today }: MonthlyFortuneCalendarProps) {
    const leadingBlanks = new Date(year, month - 1, 1).getDay();
    const keyDateMap = new Map(keyDates.map((item) => [item.date, item]));
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;

    return (
        <section aria-labelledby="monthly-calendar-title" className={`${FORTUNE_CARD_CLASS} flex flex-col gap-3 p-4 lg:p-5`}>
            <div className="flex items-baseline justify-between gap-3">
                <h2 id="monthly-calendar-title" className="font-display text-[1.0625rem] lg:text-lg">每日运程</h2>
                <ul aria-label="图例" className="flex items-center gap-3 text-xs text-foreground-secondary">
                    {LEGEND.map(({ tone, label }) => (
                        <li key={tone} className="flex items-center gap-1.5">
                            <span aria-hidden="true" className={`size-2 rounded-full ${FORTUNE_TONE_DOT_CLASS[tone]}`} />
                            {label}
                        </li>
                    ))}
                    {keyDates.length > 0 && (
                        <li className="flex items-center gap-1.5">
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                            关键日
                        </li>
                    )}
                </ul>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
                {WEEKDAYS.map((label) => (
                    <span key={label} aria-hidden="true" className="py-1 text-[11px] text-foreground-tertiary">{label}</span>
                ))}
                {Array.from({ length: leadingBlanks }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
                {dayLevels.map((level, index) => {
                    const day = index + 1;
                    const keyDate = keyDateMap.get(day);
                    const isToday = isCurrentMonth && today.getDate() === day;
                    return (
                        <Link
                            key={day}
                            href={getDailyHref(year, month, day)}
                            aria-label={`${month}月${day}日 ${level}${keyDate ? ` · ${keyDate.desc}` : ''}${isToday ? ' · 今天' : ''}`}
                            aria-current={isToday ? 'date' : undefined}
                            className={`relative flex flex-col items-center gap-1 rounded-lg py-1.5 transition-colors lg:py-2 ${isToday ? 'bg-accent-light ring-1 ring-accent/40' : 'hover:bg-background-secondary'}`}
                        >
                            <span className={`font-display text-[15px] leading-tight tabular-nums ${isToday ? 'text-accent-strong' : ''}`}>{day}</span>
                            <span className={`rounded px-1 text-[10.5px] leading-4 ${FORTUNE_TONE_BADGE_CLASS[getFortuneTone(level)]}`}>{level}</span>
                            {keyDate && <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-accent" />}
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}
