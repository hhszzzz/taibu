/**
 * 紫微运势面板组件
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useReducer, useMemo, useEffect, useCallback)
 * - 有大限/流年选择交互功能
 */
'use client';

import { useReducer, useMemo, useEffect, useCallback, type ReactNode } from 'react';
import type { ZiweiCanonicalJSON, ZiweiOutput as CoreZiweiOutput } from 'taibu-core/ziwei';
import type { ZiweiHoroscopeCanonicalJSON } from 'taibu-core/ziwei-horoscope';
import type { Astrolabe, DecadalInfo } from '@/lib/divination/ziwei';
import { buildZiweiHoroscopeCanonicalJSON, getZiweiLunarBirthYear } from '@/lib/divination/ziwei';
import { getGanZhiCharClass } from '@/components/ziwei/ziwei-display';

export interface HoroscopeInfo {
    decadal?: DecadalInfo;
    yearly?: { heavenlyStem: string; earthlyBranch: string; palaceIndex: number };
    /** 选中流年时对应的小限宫（来自同一流年运限计算的「小限」层）。 */
    age?: { heavenlyStem: string; earthlyBranch: string; palaceIndex: number };
    monthly?: { heavenlyStem: string; earthlyBranch: string; palaceIndex: number };
    daily?: { heavenlyStem: string; earthlyBranch: string; palaceIndex: number };
}

export interface HoroscopeHighlight {
    decadalIndex?: number;
    yearlyIndex?: number;
    /** 选中流年时的小限宫索引。 */
    ageIndex?: number;
    monthlyIndex?: number;
    dailyIndex?: number;
}

/** 面板挂载时预选的大限（宫位索引）与流年（公历年）。 */
export interface HoroscopeInitialSelection {
    decadalIndex: number | null;
    year: number | null;
}

interface ZiweiHoroscopePanelProps {
    output: CoreZiweiOutput;
    astrolabe: Astrolabe;
    canonicalChart: ZiweiCanonicalJSON;
    /** 仅在挂载时读取；之后的选择完全由用户操作决定。 */
    initialSelection?: HoroscopeInitialSelection;
    onPalaceHighlight?: (highlights: HoroscopeHighlight) => void;
    onHoroscopeChange?: (info: HoroscopeInfo) => void;
}

// Fix 2: useReducer 统一管理选择状态
interface SelectionState {
    selectedDecadalIndex: number | null;
    selectedYear: number | null;
    selectedMonth: number | null;
    selectedDay: number | null;
}

type SelectionAction =
    | { type: 'SELECT_DECADAL'; index: number | null }
    | { type: 'SELECT_YEAR'; year: number | null; decadalIndex?: number }
    | { type: 'SELECT_MONTH'; month: number | null; year?: number }
    | { type: 'SELECT_DAY'; day: number | null; year?: number; month?: number }
    | { type: 'DESELECT_YEAR' }
    | { type: 'DESELECT_MONTH' }
    | { type: 'DESELECT_DAY' };

const initialSelectionState: SelectionState = {
    selectedDecadalIndex: null,
    selectedYear: null,
    selectedMonth: null,
    selectedDay: null,
};

function createSelectionState(initial: HoroscopeInitialSelection | undefined): SelectionState {
    if (!initial || initial.decadalIndex === null) return initialSelectionState;
    return { ...initialSelectionState, selectedDecadalIndex: initial.decadalIndex, selectedYear: initial.year };
}

function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
    switch (action.type) {
        case 'SELECT_DECADAL': {
            const nextIndex = state.selectedDecadalIndex === action.index ? null : action.index;
            return { ...initialSelectionState, selectedDecadalIndex: nextIndex };
        }
        case 'SELECT_YEAR':
            return {
                ...state,
                selectedDecadalIndex: action.decadalIndex ?? state.selectedDecadalIndex,
                selectedYear: action.year,
                selectedMonth: null,
                selectedDay: null,
            };
        case 'DESELECT_YEAR':
            return { ...state, selectedYear: null, selectedMonth: null, selectedDay: null };
        case 'SELECT_MONTH':
            return {
                ...state,
                selectedYear: action.year ?? state.selectedYear,
                selectedMonth: action.month,
                selectedDay: null,
            };
        case 'DESELECT_MONTH':
            return { ...state, selectedMonth: null, selectedDay: null };
        case 'SELECT_DAY':
            return {
                ...state,
                selectedYear: action.year ?? state.selectedYear,
                selectedMonth: action.month ?? state.selectedMonth,
                selectedDay: action.day,
            };
        case 'DESELECT_DAY':
            return { ...state, selectedDay: null };
        default:
            return state;
    }
}

/** 运限命宫落入的本命宫（core canonical 字段）；无法确定时 core 给出 '-'，此时不显示 */
function getLandingPalaceNote(period: ZiweiHoroscopeCanonicalJSON['运限叠宫'][number]): string {
    return period.落入本命宫位 === '-' ? '' : period.落入本命宫位;
}

// Fix 1: 模块级缓存，避免重复排盘计算
const canonicalHoroscopeCacheMap = new WeakMap<object, Map<string, ReturnType<typeof buildZiweiHoroscopeCanonicalJSON>>>();

function getCachedHoroscopeCanonical(output: CoreZiweiOutput, astrolabe: Astrolabe, date: Date) {
    const cacheKey = astrolabe;
    let dateCache = canonicalHoroscopeCacheMap.get(cacheKey);
    if (!dateCache) {
        dateCache = new Map();
        canonicalHoroscopeCacheMap.set(cacheKey, dateCache);
    }
    const dateKey = date.toISOString().split('T')[0];
    if (dateCache.has(dateKey)) {
        return dateCache.get(dateKey)!;
    }
    const result = buildZiweiHoroscopeCanonicalJSON(output, astrolabe, date);
    dateCache.set(dateKey, result);
    return result;
}

export function ZiweiHoroscopePanel({ output, astrolabe, canonicalChart, initialSelection, onPalaceHighlight, onHoroscopeChange }: ZiweiHoroscopePanelProps) {
    const [state, dispatch] = useReducer(selectionReducer, initialSelection, createSelectionState);
    const { selectedDecadalIndex, selectedYear, selectedMonth, selectedDay } = state;

    // 派生布尔值，无需存储在 state 中
    const decadalSelected = selectedDecadalIndex !== null;
    const yearlySelected = selectedYear !== null;
    const monthlySelected = selectedMonth !== null;
    const dailySelected = selectedDay !== null;

    // 获取大限列表
    const decadalList = useMemo(() => (
        canonicalChart.十二宫位
            .map((palace) => {
                if (typeof palace.宫位索引 !== 'number' || !palace.大限) return null;
                const match = palace.大限.match(/^(\d+)~(\d+)$/u);
                if (!match) return null;
                return {
                    index: palace.宫位索引,
                    startAge: Number(match[1]),
                    endAge: Number(match[2]),
                    palace: {
                        index: palace.宫位索引,
                        name: palace.宫位,
                        heavenlyStem: palace.干支.charAt(0),
                        earthlyBranch: palace.干支.charAt(1),
                    },
                    heavenlyStem: palace.干支.charAt(0),
                };
            })
            .filter((item): item is DecadalInfo => Boolean(item))
            .sort((a, b) => a.startAge - b.startAge)
    ), [canonicalChart.十二宫位]);

    // 虚岁起算年（出生农历年）：虚岁 N 的流年为 nominalBaseYear + N − 1；无法换算时退回阳历出生年
    const nominalBaseYear = useMemo(
        () => getZiweiLunarBirthYear(output) ?? parseInt(canonicalChart.基本信息.阳历.split('-')[0], 10),
        [output, canonicalChart.基本信息.阳历],
    );

    // Fix 4: 去掉 useMemo，直接在 render 中获取当前日期
    const today = new Date();
    const viewYear = selectedYear ?? today.getFullYear();
    const viewMonth = selectedMonth ?? (today.getMonth() + 1);

    const yearlyHoroscope = useMemo<ZiweiHoroscopeCanonicalJSON | null>(() => {
        if (!selectedYear) return null;
        return getCachedHoroscopeCanonical(output, astrolabe, new Date(selectedYear, 5, 15));
    }, [output, astrolabe, selectedYear]);

    const monthlyHoroscope = useMemo<ZiweiHoroscopeCanonicalJSON | null>(() => {
        if (!selectedYear || !selectedMonth) return null;
        return getCachedHoroscopeCanonical(output, astrolabe, new Date(selectedYear, selectedMonth - 1, 15));
    }, [output, astrolabe, selectedYear, selectedMonth]);

    const dailyHoroscope = useMemo<ZiweiHoroscopeCanonicalJSON | null>(() => {
        if (!selectedYear || !selectedMonth || !selectedDay) return null;
        return getCachedHoroscopeCanonical(output, astrolabe, new Date(selectedYear, selectedMonth - 1, selectedDay));
    }, [output, astrolabe, selectedYear, selectedMonth, selectedDay]);

    const yearlyPeriod = yearlyHoroscope?.运限叠宫.find((period) => period.层次 === '流年');
    const agePeriod = yearlyHoroscope?.运限叠宫.find((period) => period.层次 === '小限');
    const monthlyPeriod = monthlyHoroscope?.运限叠宫.find((period) => period.层次 === '流月');
    const dailyPeriod = dailyHoroscope?.运限叠宫.find((period) => period.层次 === '流日');

    // 获取选中的大限
    const selectedDecadal = useMemo(() =>
        decadalList.find(d => d.index === selectedDecadalIndex) ?? null,
        [decadalList, selectedDecadalIndex]);
    const displayDecadal = selectedDecadal ?? decadalList[0] ?? null;

    // 更新高亮宫位和运限信息
    const updateHighlight = useCallback(() => {
        const highlights: HoroscopeHighlight = {};
        const info: HoroscopeInfo = {};

        if (decadalSelected && selectedDecadal) {
            highlights.decadalIndex = selectedDecadal.palace.index;
            info.decadal = selectedDecadal;
        }

        if (yearlySelected && yearlyPeriod) {
            highlights.yearlyIndex = yearlyPeriod.宫位索引;
            info.yearly = {
                heavenlyStem: yearlyPeriod.干支.charAt(0),
                earthlyBranch: yearlyPeriod.干支.charAt(1),
                palaceIndex: yearlyPeriod.宫位索引,
            };
        }
        if (yearlySelected && agePeriod) {
            highlights.ageIndex = agePeriod.宫位索引;
            info.age = {
                heavenlyStem: agePeriod.干支.charAt(0),
                earthlyBranch: agePeriod.干支.charAt(1),
                palaceIndex: agePeriod.宫位索引,
            };
        }
        if (monthlySelected && monthlyPeriod) {
            highlights.monthlyIndex = monthlyPeriod.宫位索引;
            info.monthly = {
                heavenlyStem: monthlyPeriod.干支.charAt(0),
                earthlyBranch: monthlyPeriod.干支.charAt(1),
                palaceIndex: monthlyPeriod.宫位索引,
            };
        }
        if (dailySelected && dailyPeriod) {
            highlights.dailyIndex = dailyPeriod.宫位索引;
            info.daily = {
                heavenlyStem: dailyPeriod.干支.charAt(0),
                earthlyBranch: dailyPeriod.干支.charAt(1),
                palaceIndex: dailyPeriod.宫位索引,
            };
        }

        onPalaceHighlight?.(highlights);
        onHoroscopeChange?.(info);
    }, [
        onPalaceHighlight,
        onHoroscopeChange,
        selectedDecadal,
        yearlyPeriod,
        agePeriod,
        monthlyPeriod,
        dailyPeriod,
        decadalSelected,
        yearlySelected,
        monthlySelected,
        dailySelected,
    ]);

    // 状态变化时更新高亮
    useEffect(() => {
        updateHighlight();
    }, [updateHighlight]);

    // 计算当前大限内的流年列表
    const yearlyList = useMemo(() => {
        if (!displayDecadal) return [];
        const startYear = nominalBaseYear + displayDecadal.startAge - 1;
        const endYear = nominalBaseYear + displayDecadal.endAge - 1;
        const years: { year: number; stem: string; branch: string; palace: string }[] = [];

        for (let year = startYear; year <= endYear; year++) {
            const yearDate = new Date(year, 5, 15);
            const yearHoroscope = getCachedHoroscopeCanonical(output, astrolabe, yearDate);
            const yearly = yearHoroscope?.运限叠宫.find((period) => period.层次 === '流年');
            if (yearly) {
                years.push({
                    year,
                    stem: yearly.干支.charAt(0),
                    branch: yearly.干支.charAt(1),
                    palace: getLandingPalaceNote(yearly),
                });
            }
        }
        return years;
    }, [output, astrolabe, displayDecadal, nominalBaseYear]);

    // 计算当前选中年份的12个月（仅在选中流年后才计算）
    const monthlyList = useMemo(() => {
        if (!selectedYear) return [];
        const months: { month: number; stem: string; branch: string; palace: string }[] = [];
        for (let m = 1; m <= 12; m++) {
            const monthDate = new Date(viewYear, m - 1, 15);
            const monthHoroscope = getCachedHoroscopeCanonical(output, astrolabe, monthDate);
            const monthly = monthHoroscope?.运限叠宫.find((period) => period.层次 === '流月');
            if (monthly) {
                months.push({
                    month: m,
                    stem: monthly.干支.charAt(0),
                    branch: monthly.干支.charAt(1),
                    palace: getLandingPalaceNote(monthly),
                });
            }
        }
        return months;
    }, [output, astrolabe, viewYear, selectedYear]);

    // 计算当前选中月份的日期列表（仅在选中流月后才计算）
    const dailyList = useMemo(() => {
        if (!selectedMonth) return [];
        const year = viewYear;
        const month = viewMonth - 1;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const days: { day: number; stem: string; branch: string; palace: string }[] = [];

        for (let d = 1; d <= daysInMonth; d++) {
            const dayDate = new Date(year, month, d);
            const dayHoroscope = getCachedHoroscopeCanonical(output, astrolabe, dayDate);
            const daily = dayHoroscope?.运限叠宫.find((period) => period.层次 === '流日');
            if (daily) {
                days.push({
                    day: d,
                    stem: daily.干支.charAt(0),
                    branch: daily.干支.charAt(1),
                    palace: getLandingPalaceNote(daily),
                });
            }
        }
        return days;
    }, [output, astrolabe, viewYear, viewMonth, selectedMonth]);

    // 大限选择 - 支持取消，切换大限时清除流年/流月/流日
    const handleDecadalSelect = (d: DecadalInfo) => {
        dispatch({ type: 'SELECT_DECADAL', index: d.index });
    };


    return (
        <div className="space-y-3 md:space-y-4">
            {/* 大限 */}
            <PeriodSection title="大限" hint="每运 10 年 · 点选后在命盘上标注">
                {decadalList.map(d => (
                    <PeriodChip
                        key={d.index}
                        selected={decadalSelected && selectedDecadalIndex === d.index}
                        onClick={() => handleDecadalSelect(d)}
                        top={d.palace.name}
                        stem={d.heavenlyStem}
                        branch={d.palace.earthlyBranch}
                        bottom={`${d.startAge}岁`}
                    />
                ))}
            </PeriodSection>

            {/* 流年 */}
            {displayDecadal && yearlyList.length > 0 && (
                <PeriodSection title="流年" hint={`${displayDecadal.palace.name}大限 · ${displayDecadal.startAge}–${displayDecadal.endAge}岁`}>
                    {yearlyList.map(yearInfo => {
                        const isSelected = yearlySelected && selectedYear === yearInfo.year;
                        return (
                            <PeriodChip
                                key={yearInfo.year}
                                selected={isSelected}
                                onClick={() => {
                                    if (isSelected) {
                                        dispatch({ type: 'DESELECT_YEAR' });
                                        return;
                                    }
                                    dispatch({
                                        type: 'SELECT_YEAR',
                                        year: yearInfo.year,
                                        decadalIndex: displayDecadal?.index,
                                    });
                                }}
                                top={String(yearInfo.year)}
                                stem={yearInfo.stem}
                                branch={yearInfo.branch}
                                bottom={`${yearInfo.year - nominalBaseYear + 1}岁`}
                                note={yearInfo.palace}
                            />
                        );
                    })}
                </PeriodSection>
            )}

            {/* 流月 */}
            {selectedYear && monthlyList.length > 0 && (
                <PeriodSection title={`${viewYear}年流月`} hint="点击流月可查看对应的流日">
                    {monthlyList.map(monthInfo => {
                        const isSelected = monthlySelected && selectedMonth === monthInfo.month && selectedYear === viewYear;
                        return (
                            <PeriodChip
                                key={monthInfo.month}
                                selected={isSelected}
                                onClick={() => {
                                    if (isSelected) {
                                        dispatch({ type: 'DESELECT_MONTH' });
                                        return;
                                    }
                                    dispatch({
                                        type: 'SELECT_MONTH',
                                        month: monthInfo.month,
                                        year: selectedYear === null ? viewYear : undefined,
                                    });
                                }}
                                top={`${monthInfo.month}月`}
                                stem={monthInfo.stem}
                                branch={monthInfo.branch}
                                note={monthInfo.palace}
                            />
                        );
                    })}
                </PeriodSection>
            )}

            {/* 流日 */}
            {selectedMonth && dailyList.length > 0 && (
                <PeriodSection title={`${viewYear}年${viewMonth}月流日`}>
                    {dailyList.map(dayInfo => {
                        const isSelected = dailySelected && selectedDay === dayInfo.day && selectedMonth === viewMonth && selectedYear === viewYear;
                        return (
                            <PeriodChip
                                key={dayInfo.day}
                                selected={isSelected}
                                onClick={() => {
                                    if (isSelected) {
                                        dispatch({ type: 'DESELECT_DAY' });
                                        return;
                                    }
                                    dispatch({
                                        type: 'SELECT_DAY',
                                        day: dayInfo.day,
                                        year: selectedYear === null ? viewYear : undefined,
                                        month: selectedMonth === null ? viewMonth : undefined,
                                    });
                                }}
                                top={`${dayInfo.day}日`}
                                stem={dayInfo.stem}
                                branch={dayInfo.branch}
                                compact
                            />
                        );
                    })}
                </PeriodSection>
            )}
        </div>
    );
}

function PeriodSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
    return (
        <section className="rounded-2xl border-[0.5px] border-border bg-surface p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="font-display text-lg">{title}</h2>
                {hint && <span className="text-xs text-foreground-secondary">{hint}</span>}
            </div>
            <div className="-mx-4 overflow-x-auto px-4 scrollbar-hide md:-mx-5 md:px-5">
                <div className="flex min-w-max gap-1.5 pb-0.5">{children}</div>
            </div>
        </section>
    );
}

interface PeriodChipProps {
    selected: boolean;
    onClick: () => void;
    top: string;
    stem: string;
    branch: string;
    bottom?: string;
    note?: string;
    compact?: boolean;
}

function PeriodChip({ selected, onClick, top, stem, branch, bottom, note, compact = false }: PeriodChipProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={selected}
            className={`flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-center transition-colors ${compact ? 'w-11' : 'w-14'} ${selected
                ? 'bg-accent-soft ring-2 ring-inset ring-accent'
                : 'bg-background hover:bg-background-secondary'
                }`}
        >
            <span className={`text-[11px] ${selected ? 'text-accent-strong' : 'text-foreground-secondary'}`}>{top}</span>
            <span className={`flex flex-col font-display leading-tight ${compact ? 'text-sm' : 'text-base'}`}>
                <span className={getGanZhiCharClass(stem)}>{stem}</span>
                <span className={getGanZhiCharClass(branch)}>{branch}</span>
            </span>
            {bottom && <span className="text-[11px] text-foreground-secondary">{bottom}</span>}
            {note && <span className="text-[10px] text-foreground-tertiary">{note}</span>}
        </button>
    );
}
