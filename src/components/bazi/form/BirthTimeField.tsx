'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/Input';

const BOX_CLASS = 'h-11 w-full rounded-xl border-[0.5px] border-border-hover bg-surface text-[15px] text-foreground transition-colors duration-150 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

/** 接受 8:30、08:30、0830；只允许 00:00–23:59。 */
const TIME_PATTERN = /^([01]?\d|2[0-3]):?([0-5]\d)$/u;

/** 出生时间：只输入具体时间，后缀「时」与年/月/日保持同样写法，不提供下拉。 */
export function BirthTimeField({
    hour,
    minute,
    onChange,
    ariaLabel,
    className,
}: {
    hour: number;
    minute: number;
    onChange: (hour: number, minute: number) => void;
    ariaLabel: string;
    className?: string;
}) {
    const exact = hour >= 0 ? `${String(hour).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}` : '';
    const [draft, setDraft] = useState(exact);
    const focused = useRef(false);

    useEffect(() => {
        if (!focused.current) setDraft(exact);
    }, [exact]);

    const commit = () => {
        if (!draft.trim()) {
            onChange(-1, 0);
            setDraft('');
            return;
        }
        const match = TIME_PATTERN.exec(draft.trim());
        if (!match) {
            setDraft(exact);
            return;
        }
        const nextHour = Number(match[1]);
        const nextMinute = Number(match[2]);
        onChange(nextHour, nextMinute);
        setDraft(`${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`);
    };

    return (
        <div className={`relative min-w-0 ${className ?? ''}`}>
            <Input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                maxLength={5}
                value={draft}
                aria-label={ariaLabel}
                aria-invalid={draft.trim() !== '' && !TIME_PATTERN.test(draft.trim())}
                onFocus={event => { focused.current = true; event.currentTarget.select(); }}
                onChange={event => {
                    let next = event.target.value.replace(/[^\d:]/gu, '');
                    // 打到第三位就补冒号：13 + 4 → 13:4，而不是等四位齐了才补。
                    if (!next.includes(':')) {
                        const digits = next;
                        if (digits.length > 2) next = `${digits.slice(0, 2)}:${digits.slice(2)}`;
                    } else {
                        const [hourPart, ...rest] = next.split(':');
                        next = `${hourPart.slice(0, 2)}:${rest.join('').slice(0, 2)}`;
                    }
                    next = next.slice(0, 5);
                    setDraft(next);
                    const match = TIME_PATTERN.exec(next.trim());
                    if (match) onChange(Number(match[1]), Number(match[2]));
                }}
                onBlur={() => { focused.current = false; commit(); }}
                onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); commit(); }
                }}
                className={`${BOX_CLASS} px-3 pr-8 tabular-nums`}
            />
            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-foreground-tertiary">
                时
            </span>
        </div>
    );
}
