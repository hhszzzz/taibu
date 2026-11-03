'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { HOUR_OPTIONS } from '@/components/bazi/form/options';
import { useToast } from '@/components/ui/Toast';
import { getEarthlyBranchByHour } from '@/lib/divination/bazi-form-utils';

const BOX_CLASS = 'h-11 w-full rounded-xl border-[0.5px] border-border-hover bg-surface text-[15px] text-foreground transition-colors duration-150 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

/** 接受 8:30、08:30、0830；只允许 00:00–23:59。 */
const TIME_PATTERN = /^([01]?\d|2[0-3]):?([0-5]\d)$/u;
const FULL_WIDTH_DIGITS = /[０-９]/gu;

const pad = (value: number) => String(value).padStart(2, '0');
const exactText = (hour: number, minute: number) => (
    hour >= 0 ? `${pad(hour)}:${pad(minute || 0)}` : ''
);

/** 出生时间：可直接输入具体时间，也可从下拉里选子丑寅卯等时辰。 */
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
    const exact = exactText(hour, minute);
    /** 从下拉选中的地支；只在该时辰仍是当前值时显示单字，手输时间后清空。 */
    const [branch, setBranch] = useState<string | null>(null);
    const [invalid, setInvalid] = useState(false);
    const [open, setOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const focused = useRef(false);
    const composing = useRef(false);
    const lastHourError = useRef<number | null>(null);
    const lastMinuteError = useRef<number | null>(null);
    const { showToast } = useToast();

    const currentBranch = hour >= 0 ? getEarthlyBranchByHour(hour) : '';
    const display = branch && branch === currentBranch ? branch : exact;

    /** 输入框保持非受控：输入法组合期间 React 重渲染不会覆写 DOM 里的组合文字。 */
    const applyValue = (value: string) => {
        if (inputRef.current) inputRef.current.value = value;
        setInvalid(value.trim() !== '' && !TIME_PATTERN.test(value.trim()) && !HOUR_OPTIONS.some(option => option.branch === value.trim() || option.name === value.trim()));
    };

    useEffect(() => {
        if (focused.current || composing.current) return;
        applyValue(display);
    }, [display]);

    const selectBranch = (option: (typeof HOUR_OPTIONS)[number]) => {
        setBranch(option.branch);
        applyValue(option.branch);
        onChange(option.value, 0);
        setOpen(false);
        // 选完回到输入框，方便继续改写；不要因此再次弹出面板。
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    /** 前半段和后半段分开校验，越界时各提示一次。 */
    const validateParts = (text: string) => {
        const [hourPart = '', minutePart = ''] = text.split(':');
        if (hourPart.length === 2) {
            const hourValue = Number(hourPart);
            if (hourValue > 23) {
                if (lastHourError.current !== hourValue) {
                    lastHourError.current = hourValue;
                    showToast('warning', '小时应在 00–23 之间');
                }
            } else {
                lastHourError.current = null;
            }
        } else {
            lastHourError.current = null;
        }
        if (minutePart.length === 2) {
            const minuteValue = Number(minutePart);
            if (minuteValue > 59) {
                if (lastMinuteError.current !== minuteValue) {
                    lastMinuteError.current = minuteValue;
                    showToast('warning', '分钟应在 00–59 之间');
                }
            } else {
                lastMinuteError.current = null;
            }
        } else {
            lastMinuteError.current = null;
        }
    };

    /** 处理一次完整的输入值（IME 组合结束后也会走这里）。 */
    const handleValue = (raw: string) => {
        const text = raw.replace(FULL_WIDTH_DIGITS, (digit) => (
            String.fromCharCode(digit.charCodeAt(0) - 0xFEE0)
        ));

        const picked = HOUR_OPTIONS.find(option => text.trim() === option.branch || text.trim() === option.name);
        if (picked) {
            setBranch(picked.branch);
            applyValue(picked.branch);
            onChange(picked.value, 0);
            return;
        }

        let next = text.replace(/[^\d:]/gu, '');
        // 打到第三位就补冒号：13 + 4 → 13:4，而不是等四位齐了才补。
        if (!next.includes(':')) {
            if (next.length > 2) next = `${next.slice(0, 2)}:${next.slice(2)}`;
        } else {
            const [hourPart, ...rest] = next.split(':');
            next = `${hourPart.slice(0, 2)}:${rest.join('').slice(0, 2)}`;
        }
        next = next.slice(0, 5);
        setBranch(null);
        validateParts(next);
        applyValue(next);
        const match = TIME_PATTERN.exec(next.trim());
        if (match) onChange(Number(match[1]), Number(match[2]));
    };

    const commit = () => {
        const text = inputRef.current?.value.trim() ?? '';
        if (!text) {
            setBranch(null);
            applyValue('');
            onChange(-1, 0);
            return;
        }
        const picked = HOUR_OPTIONS.find(option => text === option.branch || text === option.name);
        if (picked) {
            setBranch(picked.branch);
            applyValue(picked.branch);
            onChange(picked.value, 0);
            return;
        }
        const match = TIME_PATTERN.exec(text);
        if (!match) {
            applyValue(display);
            return;
        }
        const nextHour = Number(match[1]);
        const nextMinute = Number(match[2]);
        setBranch(null);
        onChange(nextHour, nextMinute);
        applyValue(exactText(nextHour, nextMinute));
    };

    return (
        <div className={`relative min-w-0 ${className ?? ''}`}>
            <Input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                enterKeyHint="done"
                spellCheck={false}
                maxLength={5}
                defaultValue={display}
                placeholder="08:30"
                aria-label={ariaLabel}
                aria-invalid={invalid}
                onFocus={event => { focused.current = true; event.currentTarget.select(); }}
                onBlur={() => { focused.current = false; commit(); }}
                onClick={() => setOpen(true)}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={event => {
                    composing.current = false;
                    handleValue(event.currentTarget.value);
                }}
                onChange={event => {
                    // 中文输入法组合期间不要解析或改写，否则组合串会被打断。
                    if (composing.current || (event.nativeEvent as Event & { isComposing?: boolean }).isComposing) return;
                    handleValue(event.target.value);
                }}
                onKeyDown={event => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        if (!(event.nativeEvent as Event & { isComposing?: boolean }).isComposing) commit();
                    }
                }}
                className={`${BOX_CLASS} px-3 pr-12 tabular-nums`}
            />
            <span aria-hidden="true" className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-[13px] text-foreground-tertiary">
                时
            </span>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    aria-label="选择时辰"
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-foreground-tertiary transition-colors hover:text-foreground"
                >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </PopoverTrigger>
                <PopoverContent align="end" sideOffset={10} initialFocus={false} className="w-[15rem] p-1">
                    <div className="grid grid-cols-3 gap-1">
                        {HOUR_OPTIONS.map(option => {
                            const selected = hour >= 0 && getEarthlyBranchByHour(hour) === option.branch;
                            return (
                                <Button
                                    key={option.value}
                                    unstyled
                                    type="button"
                                    aria-label={`${option.name} ${option.time}`}
                                    aria-pressed={selected}
                                    onClick={() => selectBranch(option)}
                                    className={`flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-sm transition-colors duration-150 ${
                                        selected
                                            ? 'bg-accent-soft text-accent-strong ring-1 ring-inset ring-accent'
                                            : 'text-foreground hover:bg-background-secondary'
                                    }`}
                                >
                                    <span className="font-display text-[15px]">{option.branch}</span>
                                    <span className={`text-[10px] ${selected ? 'text-accent-strong/80' : 'text-foreground-tertiary'}`}>
                                        {option.time}
                                    </span>
                                </Button>
                            );
                        })}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
