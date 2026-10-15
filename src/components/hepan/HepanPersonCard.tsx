/**
 * 合盘单方出生信息卡片
 *
 * - 从已保存命盘选择后显示摘要（头像 + 姓名 · 性别 + 生日 / 四柱），可点「修改」回到表单
 * - 否则显示可编辑表单：称呼、性别、出生日期（年/月/日）、出生时辰
 *
 * 'use client'：计算摘要四柱使用 useMemo，且包含受控表单交互
 */
'use client';

import { useMemo, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { calculateBaZi, type BirthInfo } from '@/lib/divination/hepan';
import { getEarthlyBranchByHour } from '@/lib/divination/bazi-form-utils';
import { YEAR_OPTIONS, MONTH_OPTIONS, DAY_OPTIONS } from '@/components/bazi/form/options';
import { HEPAN_HOUR_OPTIONS } from '@/components/hepan/hepan-display';

type Gender = NonNullable<BirthInfo['gender']>;

const GENDER_CHOICES: readonly { value: Gender; label: string }[] = [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
];

const FIELD_LABEL_CLASS = 'text-[13px] font-medium text-foreground sm:font-normal sm:text-foreground-secondary';
const CONTROL_CLASS = 'h-11 w-full rounded-[10px] border-[0.5px] border-border-hover bg-surface text-[0.9375rem] transition-colors duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 sm:h-[42px] sm:text-sm';

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

/** 带下拉箭头的原生 select；未选择时文字为辅助色 */
function SelectField({
    id,
    ariaLabel,
    value,
    placeholder,
    onChange,
    children,
}: {
    id?: string;
    ariaLabel?: string;
    value: number | undefined;
    placeholder: string;
    onChange: (value: number | undefined) => void;
    children: ReactNode;
}) {
    return (
        <div className="relative min-w-0">
            <select
                id={id}
                aria-label={ariaLabel}
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
                className={`${CONTROL_CLASS} cursor-pointer appearance-none pl-3 pr-8 ${value === undefined ? 'text-foreground-tertiary' : 'text-foreground'}`}
            >
                <option value="">{placeholder}</option>
                {children}
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" />
        </div>
    );
}

/** 已选命盘摘要 */
function PersonSummary({ value, onEdit }: { value: Partial<BirthInfo>; onEdit: () => void }) {
    const pillarsText = useMemo(() => {
        if (!value.year || !value.month || !value.day) return '';
        try {
            const bazi = calculateBaZi(value as BirthInfo);
            const pillars = [
                `${bazi.yearGan}${bazi.yearZhi}`,
                `${bazi.monthGan}${bazi.monthZhi}`,
                `${bazi.dayGan}${bazi.dayZhi}`,
            ];
            if (value.hour !== undefined) pillars.push(`${bazi.hourGan}${bazi.hourZhi}`);
            return pillars.join(' ');
        } catch {
            // 出生时间规则无效时只展示日期，提交时由 analyzeCompatibility 给出明确错误
            return '';
        }
    }, [value]);

    const name = value.name || '未命名';
    const genderText = value.gender === 'male' ? ' · 男' : value.gender === 'female' ? ' · 女' : '';
    const dateText = value.year && value.month && value.day
        ? `${value.calendarType === 'lunar' ? `农历${value.isLeapMonth ? '闰' : ''} ` : ''}${value.year}-${pad2(value.month)}-${pad2(value.day)}`
        : '';
    const hourText = value.hour !== undefined ? `${getEarthlyBranchByHour(value.hour)}时` : '时辰未知';
    const detail = [dateText && `${dateText} ${hourText}`, pillarsText].filter(Boolean).join(' · ');

    return (
        <div className="flex items-center gap-3 sm:rounded-xl sm:bg-accent-soft sm:p-3">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-sm text-background sm:h-9 sm:w-9">
                {name.charAt(0)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-medium text-foreground">{name}{genderText}</span>
                {detail && <span className="text-xs text-foreground-secondary">{detail}</span>}
            </span>
            <button
                type="button"
                onClick={onEdit}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"
            >
                修改
            </button>
        </div>
    );
}

export function HepanPersonCard({
    idPrefix,
    label,
    value,
    onChange,
    onPick,
    showSummary,
    onEdit,
}: {
    /** 表单控件 id 前缀，保证两张卡片的 label 关联唯一 */
    idPrefix: string;
    label: string;
    value: Partial<BirthInfo>;
    onChange: (value: Partial<BirthInfo>) => void;
    /** 提供时显示「从命盘选择」 */
    onPick?: () => void;
    /** 是否以摘要形式展示（从命盘选择后） */
    showSummary: boolean;
    /** 从摘要切回表单 */
    onEdit: () => void;
}) {
    const calendarLabel = value.calendarType === 'lunar' ? `${value.isLeapMonth ? '闰月' : ''}农历` : '公历';

    return (
        <section
            aria-label={label}
            className="flex flex-col gap-3.5 rounded-2xl border-[0.5px] border-border bg-surface p-4 sm:p-[22px]"
        >
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-xs text-foreground-secondary sm:font-display sm:text-[19px] sm:text-foreground">{label}</h2>
                {onPick && (
                    <button
                        type="button"
                        onClick={onPick}
                        className="text-[0.8125rem] text-accent transition-colors hover:text-accent-strong sm:h-[30px] sm:rounded-[7px] sm:bg-background-secondary sm:px-2.5 sm:text-xs sm:text-foreground sm:hover:bg-background-tertiary sm:hover:text-foreground"
                    >
                        从命盘选择
                    </button>
                )}
            </div>

            {showSummary ? (
                <PersonSummary value={value} onEdit={onEdit} />
            ) : (
                <div className="flex flex-col gap-3.5">
                    {/* 称呼 + 性别 */}
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[minmax(0,1fr)_112px] sm:gap-2.5">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <label htmlFor={`${idPrefix}-name`} className={FIELD_LABEL_CLASS}>称呼</label>
                            <input
                                id={`${idPrefix}-name`}
                                type="text"
                                value={value.name || ''}
                                onChange={(e) => onChange({ ...value, name: e.target.value })}
                                placeholder={`${label}的称呼`}
                                className={`${CONTROL_CLASS} px-3 text-foreground placeholder:text-foreground-tertiary`}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className={FIELD_LABEL_CLASS}>性别</span>
                            <div role="group" aria-label="性别" className="grid grid-cols-2 gap-2 sm:h-[42px] sm:gap-1 sm:rounded-[10px] sm:bg-background-secondary sm:p-1">
                                {GENDER_CHOICES.map((choice) => {
                                    const active = value.gender === choice.value;
                                    return (
                                        <button
                                            key={choice.value}
                                            type="button"
                                            aria-pressed={active}
                                            // 再次点击已选项可清空（性别为选填）
                                            onClick={() => onChange({ ...value, gender: active ? undefined : choice.value })}
                                            className={`h-11 rounded-[10px] text-[0.9375rem] transition-colors duration-150 sm:h-auto sm:rounded-[7px] sm:text-[13px] ${active
                                                ? 'bg-accent-light text-accent-strong ring-[1.5px] ring-inset ring-accent sm:bg-surface sm:text-foreground sm:shadow-sm sm:ring-0'
                                                : 'border-[0.5px] border-border-hover bg-surface text-foreground hover:bg-background-secondary sm:border-0 sm:bg-transparent sm:text-foreground-secondary sm:hover:bg-transparent sm:hover:text-foreground'
                                                }`}
                                        >
                                            {choice.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* 出生日期 */}
                    <div className="flex flex-col gap-1.5">
                        <span className={FIELD_LABEL_CLASS}>
                            出生日期<span className="ml-1 text-xs font-normal text-foreground-tertiary">（{calendarLabel}）</span>
                        </span>
                        <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-2 sm:grid-cols-3">
                            <SelectField
                                ariaLabel={`${label}出生年`}
                                value={value.year}
                                placeholder="年"
                                onChange={(year) => onChange({ ...value, year })}
                            >
                                {YEAR_OPTIONS.map((year) => <option key={year} value={year}>{year}</option>)}
                            </SelectField>
                            <SelectField
                                ariaLabel={`${label}出生月`}
                                value={value.month}
                                placeholder="月"
                                onChange={(month) => onChange({ ...value, month })}
                            >
                                {MONTH_OPTIONS.map((month) => <option key={month} value={month}>{month}月</option>)}
                            </SelectField>
                            <SelectField
                                ariaLabel={`${label}出生日`}
                                value={value.day}
                                placeholder="日"
                                onChange={(day) => onChange({ ...value, day })}
                            >
                                {DAY_OPTIONS.map((day) => <option key={day} value={day}>{day}日</option>)}
                            </SelectField>
                        </div>
                    </div>

                    {/* 出生时辰 */}
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor={`${idPrefix}-hour`} className={FIELD_LABEL_CLASS}>出生时辰</label>
                        <SelectField
                            id={`${idPrefix}-hour`}
                            value={value.hour}
                            placeholder="请选择时辰（不清楚可不填）"
                            onChange={(hour) => onChange({ ...value, hour, minute: 0 })}
                        >
                            {value.hour !== undefined && value.hour % 2 !== 0 && (
                                <option value={value.hour}>已导入 {pad2(value.hour)}:{pad2(value.minute ?? 0)}</option>
                            )}
                            {HEPAN_HOUR_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </SelectField>
                    </div>
                </div>
            )}
        </section>
    );
}
