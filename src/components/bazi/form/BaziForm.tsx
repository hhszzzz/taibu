/**
 * 八字表单组件
 *
 * 'use client' 标记说明：
 * - 时间与地点都在表单内直接输入，不再经过模态框
 * - 包含交互式输入和模态框
 */
'use client';

import { Button } from '@/components/ui/Button';import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { LunarYear } from 'lunar-javascript';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import type { BaziFormData, CalendarType, Gender } from '@/types';
import { SegmentedControl, type SegmentedOption } from '@/components/bazi/SegmentedControl';
import { SmartPillarsInput } from '@/components/bazi/form/SmartPillarsInput';
import { SuffixSelect } from '@/components/bazi/form/SuffixSelect';
import { BirthTimeField } from '@/components/bazi/form/BirthTimeField';
import { RegionPicker } from '@/components/bazi/form/RegionPicker';
import { YEAR_OPTIONS, MONTH_OPTIONS, LUNAR_MONTH_NAMES, LUNAR_DAY_NAMES } from '@/components/bazi/form/options';
import { getDayCount } from '@/lib/date-utils';
import { BirthTimeUnknownHint } from '@/components/bazi/form/BirthTimeUnknownHint';

type UpdateField = <K extends keyof BaziFormData>(field: K, value: BaziFormData[K]) => void;

interface BaziFormProps {
    formData: BaziFormData;
    onUpdate: UpdateField;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    isSubmitting: boolean;
}

const GENDER_OPTIONS: readonly SegmentedOption<Gender>[] = [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
];

const CALENDAR_OPTIONS: readonly SegmentedOption<CalendarType>[] = [
    { value: 'solar', label: '公历' },
    { value: 'lunar', label: '农历' },
    { value: 'pillars', label: '四柱反推' },
];

const FIELD_LABEL_CLASS = 'text-sm font-medium text-foreground';
const BOX_CLASS = 'h-11 w-full rounded-xl border-[0.5px] border-border-hover bg-surface text-[15px] text-foreground transition-colors duration-150 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

export function BaziForm({
    formData,
    onUpdate,
    onSubmit,
    isSubmitting,
}: BaziFormProps) {

    const isPillarsMode = formData.calendarType === 'pillars';
    const isLunar = formData.calendarType === 'lunar';

    const dayCount = !isPillarsMode
        ? getDayCount(formData.calendarType, formData.birthYear, formData.birthMonth, formData.isLeapMonth)
        : 31;

    const dayOptions = Array.from({ length: dayCount }, (_, i) => i + 1);

    // 检查是否有闰月
    const leapMonth = isLunar
        ? LunarYear.fromYear(formData.birthYear).getLeapMonth()
        : 0;
    const hasLeapMonth = leapMonth === formData.birthMonth;


    return (
        <>
            <form
                onSubmit={onSubmit}
                className="flex flex-col gap-5 rounded-2xl border-[0.5px] border-border bg-surface p-4 sm:p-6"
            >
                {/* 姓名 + 性别 */}
                <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3 sm:grid-cols-[minmax(0,1fr)_160px] sm:gap-3.5">
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <label htmlFor="bazi-form-name" className={FIELD_LABEL_CLASS}>
                            姓名 <span className="font-normal text-foreground-tertiary">选填</span>
                        </label>
                        <Input
                            id="bazi-form-name"
                            type="text"
                            value={formData.name}
                            onChange={(e) => onUpdate('name', e.target.value)}
                            placeholder="请输入姓名"
                            className={`${BOX_CLASS} px-3.5`}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <span className={FIELD_LABEL_CLASS}>性别</span>
                        <SegmentedControl
                            ariaLabel="性别"
                            options={GENDER_OPTIONS}
                            value={formData.gender}
                            onChange={(gender) => onUpdate('gender', gender)}
                        />
                    </div>
                </div>

                {/* 历法 */}
                <div className="flex flex-col gap-1.5">
                    <span className={FIELD_LABEL_CLASS}>历法</span>
                    <SegmentedControl
                        ariaLabel="历法"
                        options={CALENDAR_OPTIONS}
                        value={formData.calendarType}
                        onChange={(calendarType) => onUpdate('calendarType', calendarType)}
                    />
                </div>

                {/* 条件渲染：出生时间或四柱反推 */}
                {!isPillarsMode ? (
                    <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <span className={FIELD_LABEL_CLASS}>出生时间</span>
                            <BirthTimeUnknownHint formData={formData} />
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                            <SuffixSelect
                                ariaLabel="出生年"
                                suffix="年"
                                value={formData.birthYear}
                                onChange={(year) => onUpdate('birthYear', year)}
                                options={YEAR_OPTIONS.map(year => ({ value: year, label: String(year) }))}
                            />
                            <SuffixSelect
                                ariaLabel="出生月"
                                suffix={isLunar ? undefined : '月'}
                                value={formData.birthMonth}
                                onChange={(month) => onUpdate('birthMonth', month)}
                                options={MONTH_OPTIONS.map(month => ({ value: month, label: String(isLunar ? LUNAR_MONTH_NAMES[month] : month) }))}
                            />
                            <SuffixSelect
                                ariaLabel="出生日"
                                suffix="日"
                                value={formData.birthDay}
                                onChange={(day) => onUpdate('birthDay', day)}
                                options={dayOptions.map(day => ({ value: day, label: isLunar ? LUNAR_DAY_NAMES[day] : String(day) }))}
                            />
                            {/* 出生时间：直接输入或从下拉选择时辰 */}
                            <BirthTimeField
                                hour={formData.birthHour}
                                minute={formData.birthMinute}
                                ariaLabel="出生时间"
                                className="col-span-3 sm:col-span-1"
                                onChange={(hour, minute) => {
                                onUpdate('birthHour', hour);
                                onUpdate('birthMinute', minute);
                            }}
                            />
                        </div>

                        {/* 闰月开关（仅农历） */}
                        {isLunar && hasLeapMonth && (
                            <label className="mt-1 flex w-fit cursor-pointer items-center gap-2 text-[13px] text-foreground-secondary">
                                <Checkbox
                                    checked={formData.isLeapMonth}
                                    onCheckedChange={checked => onUpdate('isLeapMonth', checked)}
                                />
                                闰月
                            </label>
                        )}
                    </div>
                ) : (
                    <div className="rounded-xl bg-panel p-3 sm:p-4">
                        <SmartPillarsInput
                            value={formData.pillars}
                            timeOptions={formData}
                            resolvedDateTime={formData.birthYear > 0 && formData.birthHour >= 0 ? {
                                year: formData.birthYear,
                                month: formData.birthMonth,
                                day: formData.birthDay,
                                hour: formData.birthHour,
                                minute: formData.birthMinute,
                            } : null}
                            onChange={(pillars, dateTime) => {
                                onUpdate('pillars', pillars);
                                // 如果反推出了时间，同时更新日期和时间字段
                                // 如果没有反推出时间（四柱不完整或用户修改了四柱），清空日期字段
                                if (dateTime) {
                                    onUpdate('birthYear', dateTime.year);
                                    onUpdate('birthMonth', dateTime.month);
                                    onUpdate('birthDay', dateTime.day);
                                    onUpdate('birthHour', dateTime.hour);
                                    onUpdate('birthMinute', dateTime.minute);
                                } else {
                                    // 清空日期字段，防止提交时使用旧的/不匹配的日期
                                    onUpdate('birthYear', 0);
                                    onUpdate('birthMonth', 0);
                                    onUpdate('birthDay', 0);
                                }
                            }}
                        />
                    </div>
                )}

                {/* 出生地点：省市县三级，可直接输入也可下拉选择 */}
                <div className="flex flex-col gap-1.5">
                    <span className={FIELD_LABEL_CLASS}>出生地点 <span className="font-normal text-foreground-tertiary">选填</span></span>
                    <RegionPicker
                        value={formData.birthPlace ?? ''}
                        onChange={value => {
                            onUpdate('birthPlace', value);
                            onUpdate('longitude', undefined);
                        }}
                    />
                </div>

                {/* 提交按钮 */}
                <Button unstyled
                    type="submit"
                    disabled={isSubmitting}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-base font-medium text-on-accent
                        transition-colors duration-150 hover:bg-accent-hover
                        disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {isSubmitting ? (
                        <>
                            <SoundWaveLoader variant="inline" />
                            排盘中...
                        </>
                    ) : (
                        '开始排盘'
                    )}
                </Button>

                {/* 免责声明 */}
                <p className="-mt-1 text-center text-xs text-foreground-tertiary">
                    八字排盘仅供参考，不构成任何建议
                </p>
            </form>

        </>
    );
}
