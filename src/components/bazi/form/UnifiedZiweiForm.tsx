/**
 * 统一紫微斗数表单组件
 *
 * 'use client' 标记说明：
 * - 使用 useState 管理时间 / 地点模态框开关
 * - 包含交互式输入和模态框
 */
'use client';

import { useState, type ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import { LunarYear } from 'lunar-javascript';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import type { BaziFormData, Gender } from '@/types';
import { TimeInputModal } from '@/components/bazi/form/TimeInputModal';
import { PlaceInputModal } from '@/components/bazi/form/PlaceInputModal';
import { YEAR_OPTIONS, MONTH_OPTIONS, LUNAR_MONTH_NAMES } from '@/components/bazi/form/options';
import { getDayCount } from '@/lib/date-utils';
import { getEarthlyBranchByHour } from '@/lib/divination/bazi-form-utils';

type UpdateField = <K extends keyof BaziFormData>(field: K, value: BaziFormData[K]) => void;

interface UnifiedZiweiFormProps {
    formData: BaziFormData;
    onUpdate: UpdateField;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    isSubmitting: boolean;
    onBirthTimeConfirm?: () => void;
}

/** 紫微只支持公历 / 农历（无四柱反推）。 */
type ZiweiCalendarType = 'solar' | 'lunar';

const GENDER_OPTIONS: ReadonlyArray<{ value: Gender; label: string }> = [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
];

const CALENDAR_OPTIONS: ReadonlyArray<{ value: ZiweiCalendarType; label: string }> = [
    { value: 'solar', label: '公历' },
    { value: 'lunar', label: '农历' },
];

const FIELD_LABEL_CLASS = 'text-sm font-medium text-foreground';
const BOX_CLASS = 'h-11 w-full rounded-[10px] border-[0.5px] border-border-hover bg-surface text-[15px] text-foreground transition-colors duration-150 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

/** 两项分段控件：轨道 background-secondary，选中项 surface + 阴影。 */
function Segmented<T extends string>({
    ariaLabel,
    options,
    value,
    onChange,
}: {
    ariaLabel: string;
    options: ReadonlyArray<{ value: T; label: string }>;
    value: T | undefined;
    onChange: (value: T) => void;
}) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className="grid h-11 grid-cols-2 gap-1 rounded-[10px] bg-background-secondary p-1"
        >
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(option.value)}
                        className={`rounded-[7px] text-sm transition-colors duration-150 ${active
                            ? 'bg-surface text-foreground shadow-sm'
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

/** 带右侧单位后缀的原生下拉框（保留原生 select，便于键盘与自动化访问）。 */
function SuffixSelect({
    ariaLabel,
    suffix,
    value,
    onChange,
    children,
}: {
    ariaLabel: string;
    suffix?: string;
    value: number;
    onChange: (value: number) => void;
    children: ReactNode;
}) {
    return (
        <div className="relative min-w-0">
            <select
                aria-label={ariaLabel}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className={`${BOX_CLASS} cursor-pointer appearance-none pl-3 ${suffix ? 'pr-8' : 'pr-3'}`}
            >
                {children}
            </select>
            {suffix && (
                <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-foreground-tertiary">
                    {suffix}
                </span>
            )}
        </div>
    );
}

export function UnifiedZiweiForm({
    formData,
    onUpdate,
    onSubmit,
    isSubmitting,
    onBirthTimeConfirm,
}: UnifiedZiweiFormProps) {
    const [timeModalOpen, setTimeModalOpen] = useState(false);
    const [placeModalOpen, setPlaceModalOpen] = useState(false);

    const isLunar = formData.calendarType === 'lunar';
    const dayCount = getDayCount(formData.calendarType, formData.birthYear, formData.birthMonth, formData.isLeapMonth);
    const dayOptions = Array.from({ length: dayCount }, (_, i) => i + 1);

    // 检查是否有闰月
    const leapMonth = isLunar
        ? LunarYear.fromYear(formData.birthYear).getLeapMonth()
        : 0;
    const hasLeapMonth = leapMonth === formData.birthMonth;
    const timeText = `${String(formData.birthHour).padStart(2, '0')}:${String(formData.birthMinute).padStart(2, '0')}`;
    const hourBranch = getEarthlyBranchByHour(formData.birthHour);
    const placeStatus = formData.birthPlace
        ? formData.longitude != null ? '已启用真太阳时' : '提交时自动解析'
        : null;

    return (
        <>
            <form onSubmit={onSubmit} className="flex flex-col gap-5 rounded-2xl border-[0.5px] border-border bg-surface p-4 sm:p-6">
                {/* 姓名 + 性别 */}
                <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3 sm:grid-cols-[minmax(0,1fr)_160px] sm:gap-3.5">
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <label htmlFor="ziwei-form-name" className={FIELD_LABEL_CLASS}>
                            姓名 <span className="font-normal text-foreground-tertiary">选填</span>
                        </label>
                        <input
                            id="ziwei-form-name"
                            type="text"
                            value={formData.name}
                            onChange={(e) => onUpdate('name', e.target.value)}
                            placeholder="请输入姓名"
                            className={`${BOX_CLASS} px-3.5 placeholder:text-foreground-tertiary`}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <span className={FIELD_LABEL_CLASS}>性别</span>
                        <Segmented
                            ariaLabel="性别"
                            options={GENDER_OPTIONS}
                            value={formData.gender}
                            onChange={(gender) => onUpdate('gender', gender)}
                        />
                    </div>
                </div>

                {/* 历法（仅公历/农历） */}
                <div className="flex flex-col gap-1.5">
                    <span className={FIELD_LABEL_CLASS}>历法</span>
                    <Segmented
                        ariaLabel="历法"
                        options={CALENDAR_OPTIONS}
                        value={formData.calendarType === 'lunar' ? 'lunar' : 'solar'}
                        onChange={(calendarType) => onUpdate('calendarType', calendarType)}
                    />
                </div>

                {/* 出生日期 + 时间 */}
                <div className="flex flex-col gap-1.5">
                    <span className={FIELD_LABEL_CLASS}>出生时间</span>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        <SuffixSelect
                            ariaLabel="出生年"
                            suffix="年"
                            value={formData.birthYear}
                            onChange={(year) => onUpdate('birthYear', year)}
                        >
                            {YEAR_OPTIONS.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </SuffixSelect>
                        <SuffixSelect
                            ariaLabel="出生月"
                            suffix={isLunar ? undefined : '月'}
                            value={formData.birthMonth}
                            onChange={(month) => onUpdate('birthMonth', month)}
                        >
                            {MONTH_OPTIONS.map((month) => (
                                <option key={month} value={month}>
                                    {isLunar ? LUNAR_MONTH_NAMES[month] : month}
                                </option>
                            ))}
                        </SuffixSelect>
                        <SuffixSelect
                            ariaLabel="出生日"
                            suffix="日"
                            value={formData.birthDay}
                            onChange={(day) => onUpdate('birthDay', day)}
                        >
                            {dayOptions.map((day) => (
                                <option key={day} value={day}>{day}</option>
                            ))}
                        </SuffixSelect>
                        {/* 出生时间（点击打开模态框）；紫微必须提供时辰 */}
                        <button
                            type="button"
                            onClick={() => setTimeModalOpen(true)}
                            aria-label={`出生时间 ${timeText}`}
                            className={`${BOX_CLASS} col-span-3 flex items-center justify-between gap-2 px-3 text-left hover:bg-background-secondary sm:col-span-1`}
                        >
                            <span className="tabular-nums">{timeText}</span>
                            <span aria-hidden="true" className="text-[13px] text-foreground-tertiary">{hourBranch}</span>
                        </button>
                    </div>

                    {/* 闰月开关（仅农历） */}
                    {isLunar && hasLeapMonth && (
                        <label className="mt-1 flex w-fit cursor-pointer items-center gap-2 text-[13px] text-foreground-secondary">
                            <input
                                type="checkbox"
                                checked={formData.isLeapMonth}
                                onChange={(e) => onUpdate('isLeapMonth', e.target.checked)}
                                className="m-0 h-4 w-4 cursor-pointer accent-accent"
                            />
                            闰月
                        </label>
                    )}
                </div>

                {/* 出生地点（点击打开模态框） */}
                <div className="flex flex-col gap-1.5">
                    <span className={FIELD_LABEL_CLASS}>出生地点</span>
                    <button
                        type="button"
                        onClick={() => setPlaceModalOpen(true)}
                        className={`${BOX_CLASS} flex items-center gap-2.5 px-3.5 text-left hover:bg-background-secondary`}
                    >
                        <MapPin className="h-4 w-4 shrink-0 text-foreground-secondary" />
                        <span className={`min-w-0 flex-1 truncate ${formData.birthPlace ? '' : 'text-foreground-tertiary'}`}>
                            {formData.birthPlace || '未设置（使用北京时间）'}
                        </span>
                        {placeStatus && (
                            <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${formData.longitude != null ? 'bg-wood-soft text-wood' : 'bg-background-secondary text-foreground-secondary'}`}>
                                {placeStatus}
                            </span>
                        )}
                    </button>
                </div>

                {/* 提交按钮 */}
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex h-12 items-center justify-center gap-2 rounded-xl bg-accent text-base font-medium text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {isSubmitting ? (
                        <>
                            <SoundWaveLoader variant="inline" />
                            排盘中...
                        </>
                    ) : (
                        '开始排盘'
                    )}
                </button>

                {/* 免责声明 */}
                <p className="text-center text-xs text-foreground-tertiary">
                    紫微斗数排盘仅供参考，不构成任何建议
                </p>
            </form>

            {/* 时间输入模态框 */}
            <TimeInputModal
                isOpen={timeModalOpen}
                onClose={() => setTimeModalOpen(false)}
                formData={formData}
                unknownTime={false}
                onToggleUnknownTime={() => {}}
                onUpdate={onUpdate}
                allowUnknownTime={false}
                onConfirm={onBirthTimeConfirm}
            />

            {/* 地点输入模态框 */}
            <PlaceInputModal
                isOpen={placeModalOpen}
                onClose={() => setPlaceModalOpen(false)}
                formData={formData}
                onUpdate={onUpdate}
            />
        </>
    );
}
