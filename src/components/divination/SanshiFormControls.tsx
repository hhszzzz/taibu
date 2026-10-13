/**
 * 三式（奇门遁甲 / 大六壬）起局表单共用控件
 *
 * 'use client'：受控输入、点击回调与起局前预览的防抖试算都需要浏览器端 hooks。
 * 两个起局页共享设计稿 QimenForm 的样式，只在各自页面里组合不同字段。
 */
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';

export interface TimeFieldsValue {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

export type TimeFieldKey = keyof TimeFieldsValue;

const TIME_FIELDS: ReadonlyArray<{ key: TimeFieldKey; unit: string; min?: number; max?: number }> = [
    { key: 'year', unit: '年' },
    { key: 'month', unit: '月', min: 1, max: 12 },
    { key: 'day', unit: '日', min: 1, max: 31 },
    { key: 'hour', unit: '时', min: 0, max: 23 },
    { key: 'minute', unit: '分', min: 0, max: 59 },
];

const SEGMENT_COLUMNS: Record<number, string> = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
};

const PREVIEW_DEBOUNCE_MS = 250;

const PILLAR_LABELS = ['年', '月', '日', '时'] as const;

/** 文本输入框样式（占问事项等） */
export const SANSHI_INPUT_CLASS = 'h-12 w-full rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3.5 text-base text-foreground placeholder:text-foreground-tertiary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/10';

export function SanshiFormCard({ children, className = '' }: { children: ReactNode; className?: string }) {
    return (
        <section className={`flex min-w-0 flex-col gap-[22px] rounded-2xl border-[0.5px] border-border bg-surface p-5 lg:p-6 ${className}`}>
            {children}
        </section>
    );
}

export function SanshiField({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-2">
            <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">{label}</label>
            {children}
        </div>
    );
}

/**
 * 起盘时间：五个数字框 +「用此刻」，状态由 useSanshiFormTime 提供。
 * isNow 为正时（提交时取当前时刻，「用此刻」呈按下态），任一字段被编辑即切换为活时。
 */
export function SanshiTimeFields({
    label,
    value,
    isNow,
    onFieldChange,
    onUseNow,
}: {
    label: string;
    value: TimeFieldsValue;
    isNow: boolean;
    onFieldChange: (key: TimeFieldKey, next: number) => void;
    onUseNow: () => void;
}) {
    return (
        <div className="flex flex-col gap-2" role="group" aria-label={label}>
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">{label}</span>
                <button
                    type="button"
                    onClick={onUseNow}
                    aria-pressed={isNow}
                    className={`h-[30px] rounded-[7px] px-2.5 text-[13px] transition-colors ${
                        isNow
                            ? 'bg-background-secondary text-foreground'
                            : 'border-[0.5px] border-border-hover text-foreground-secondary hover:bg-background-secondary hover:text-foreground'
                    }`}
                >
                    用此刻
                </button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {TIME_FIELDS.map(field => (
                    <label
                        key={field.key}
                        className="flex h-11 min-w-0 items-center gap-1 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10"
                    >
                        <input
                            type="number"
                            inputMode="numeric"
                            min={field.min}
                            max={field.max}
                            value={value[field.key]}
                            onChange={event => onFieldChange(field.key, Number(event.target.value))}
                            aria-label={field.unit}
                            className="w-full min-w-0 bg-transparent text-[15px] tabular-nums text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <span className="shrink-0 text-[13px] text-foreground-secondary">{field.unit}</span>
                    </label>
                ))}
            </div>
        </div>
    );
}

/** 首次渲染（含服务端渲染与水合）使用的占位时间与时区，挂载后即替换为浏览器本地值 */
const PLACEHOLDER_FORM_TIME: TimeFieldsValue = { year: 2000, month: 1, day: 1, hour: 0, minute: 0 };
const FALLBACK_TIME_ZONE = 'Asia/Shanghai';

/** 把时刻拆成表单字段（按浏览器本地时区，月份从 1 开始） */
export function toSanshiFormTime(date: Date): TimeFieldsValue {
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
    };
}

function readLocalTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;
}

/**
 * 起盘时间表单状态，配合 SanshiTimeFields 使用。
 * 正时显示进入页面时的本地时间，提交时由 resolveTime() 取提交瞬间；编辑任一字段即切换为活时。
 * 渲染期不读取时钟与时区：首次渲染用固定占位值，保证与服务端标记一致，挂载后在首帧绘制前换成本地值。
 */
export function useSanshiFormTime() {
    const [isNow, setIsNow] = useState(true);
    const [value, setValue] = useState<TimeFieldsValue>(PLACEHOLDER_FORM_TIME);
    const [timeZone, setTimeZone] = useState(FALLBACK_TIME_ZONE);

    useLayoutEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 浏览器时间与时区只能在与服务端一致的首次渲染之后读取
        setValue(toSanshiFormTime(new Date()));
        setTimeZone(readLocalTimeZone());
    }, []);

    const setField = useCallback((key: TimeFieldKey, next: number) => {
        setValue(prev => ({ ...prev, [key]: next }));
        setIsNow(false);
    }, []);

    const resetToNow = useCallback(() => {
        setValue(toSanshiFormTime(new Date()));
        setIsNow(true);
    }, []);

    const resolveTime = useCallback(
        (): TimeFieldsValue => (isNow ? toSanshiFormTime(new Date()) : value),
        [isNow, value],
    );

    return { value, isNow, timeZone, setField, resetToNow, resolveTime };
}

export interface SegmentOption<T extends string> {
    value: T;
    label: string;
    disabled?: boolean;
}

export function SanshiSegmented<T extends string>({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: ReadonlyArray<SegmentOption<T>>;
    value: T;
    onChange?: (next: T) => void;
}) {
    return (
        <div role="group" aria-label={label} className={`grid h-10 max-w-[320px] gap-1 rounded-[10px] bg-background-secondary p-1 ${SEGMENT_COLUMNS[options.length] ?? 'grid-cols-2'}`}>
            {options.map(option => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        disabled={option.disabled}
                        onClick={() => onChange?.(option.value)}
                        className={`rounded-[7px] px-2 text-sm transition-colors ${
                            active
                                ? 'bg-surface text-foreground shadow-sm'
                                : option.disabled
                                    ? 'text-foreground-tertiary'
                                    : 'text-foreground-secondary hover:text-foreground'
                        }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

/** 「排盘规则」区：左侧标签、右侧控件 */
export function SanshiRuleGroup({ title, rows }: { title: string; rows: ReadonlyArray<{ label: string; control: ReactNode }> }) {
    return (
        <div className="flex flex-col gap-4 border-t-[0.5px] border-border pt-[18px]">
            <span className="text-sm font-medium text-foreground">{title}</span>
            <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-4 gap-y-3.5 sm:grid-cols-[96px_minmax(0,1fr)]">
                {rows.map(row => (
                    <div key={row.label} className="contents">
                        <span className="text-sm text-foreground-secondary">{row.label}</span>
                        {row.control}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function SanshiSubmitButton({ onClick, loading, label, loadingLabel }: {
    onClick: () => void;
    loading: boolean;
    label: string;
    loadingLabel: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={loading}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-base font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
            {loading ? (
                <>
                    <SoundWaveLoader variant="inline" className="[&_.sound-wave-bar]:bg-on-accent" />
                    <span>{loadingLabel}</span>
                </>
            ) : label}
        </button>
    );
}

export type SanshiPreviewState<T> =
    | { status: 'pending' }
    | { status: 'ready'; value: T }
    | { status: 'unavailable' };

/**
 * 起局前预览的防抖试算。inputKey 变化时重新计算；计算失败（如浏览器时区与历法校验不一致、
 * 日期非法）时返回 unavailable，由卡片显示空状态，绝不展示推测数据。
 */
export function useSanshiPreview<T>(inputKey: string, compute: () => Promise<T>): SanshiPreviewState<T> {
    const computeRef = useRef(compute);
    const [state, setState] = useState<SanshiPreviewState<T>>({ status: 'pending' });

    useEffect(() => {
        computeRef.current = compute;
    });

    useEffect(() => {
        let cancelled = false;
        const timer = window.setTimeout(() => {
            computeRef.current().then(
                value => { if (!cancelled) setState({ status: 'ready', value }); },
                () => { if (!cancelled) setState({ status: 'unavailable' }); },
            );
        }, PREVIEW_DEBOUNCE_MS);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [inputKey]);

    return state;
}

/** 起局前预览卡（设计稿右侧燕麦色面板） */
export function SanshiPreviewCard<T>({
    label,
    state,
    unavailableText,
    children,
    className = '',
}: {
    label: string;
    state: SanshiPreviewState<T>;
    unavailableText: string;
    children: (value: T) => ReactNode;
    className?: string;
}) {
    return (
        <aside aria-label={label} aria-live="polite" className={`flex flex-col gap-4 rounded-2xl border-[0.5px] border-border bg-panel p-5 lg:p-[22px] ${className}`}>
            <span className="text-[13px] text-foreground-secondary">{label}</span>
            {state.status === 'ready' ? children(state.value) : state.status === 'unavailable' ? (
                <p className="text-sm leading-relaxed text-foreground-secondary">{unavailableText}</p>
            ) : (
                <div className="flex flex-col gap-4" aria-hidden>
                    <div className="h-8 w-3/4 animate-pulse rounded-md bg-background-tertiary" />
                    <div className="h-14 animate-pulse rounded-md bg-background-secondary" />
                    <div className="h-16 w-2/3 animate-pulse rounded-md bg-background-secondary" />
                </div>
            )}
        </aside>
    );
}

export function SanshiPreviewHeadline({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
        <div className="font-display text-2xl leading-[1.3] text-foreground">
            {title}
            {subtitle && <span className="block text-base text-foreground-secondary">{subtitle}</span>}
        </div>
    );
}

export function SanshiPreviewPillars({ pillars }: { pillars: readonly string[] }) {
    return (
        <div className="grid grid-cols-4 border-y-[0.5px] border-border py-3 text-center font-display text-xl leading-[1.2]">
            {pillars.slice(0, 4).map((pillar, index) => (
                <span key={PILLAR_LABELS[index]}>
                    <span className="mb-1 block font-sans text-[11px] text-foreground-secondary">{PILLAR_LABELS[index]}</span>
                    {pillar}
                </span>
            ))}
        </div>
    );
}

export function SanshiPreviewFacts({ rows }: { rows: ReadonlyArray<{ label: string; value: string }> }) {
    return (
        <dl className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
            {rows.map(row => (
                <div key={row.label} className="contents">
                    <dt className="text-foreground-secondary">{row.label}</dt>
                    <dd className="min-w-0 text-foreground">{row.value}</dd>
                </div>
            ))}
        </dl>
    );
}
