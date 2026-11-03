/**
 * 时间输入模态框组件
 *
 * 'use client' 标记说明：
 * - 使用 useState 管理模态框状态
 * - 包含交互式时间选择
 */
'use client';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useId, useMemo, useState } from 'react';
import { Clock, X } from 'lucide-react';
import type { BaziFormData } from '@/types';
import { HOUR_OPTIONS } from '@/components/bazi/form/options';
import { useToast } from '@/components/ui/Toast';
import { resolveBirthTimeOptions } from '@/lib/divination/birth-time';
import { checkLocalTime } from '@/lib/timezones';
import { Dialog } from '@/components/ui/Dialog';
import { DEFAULT_DIVINATION_TIMEZONE } from 'taibu-core/timezone-utils';

interface TimeInputModalProps {
    isOpen: boolean;
    onClose: () => void;
    formData: BaziFormData;
    onUpdate: <K extends keyof BaziFormData>(field: K, value: BaziFormData[K]) => void;
    onConfirm?: () => void;
}

export function TimeInputModal({
    isOpen,
    onClose,
    formData,
    onUpdate,
    onConfirm,
}: TimeInputModalProps) {
    const titleId = useId();
    const [localHour, setLocalHour] = useState(formData.birthHour);
    const [localMinute, setLocalMinute] = useState(formData.birthMinute);
    const localTimezone = formData.timezone ?? DEFAULT_DIVINATION_TIMEZONE;
    const { showToast } = useToast();

    // 当模态框打开时，同步外部值到本地状态
    const [lastIsOpen, setLastIsOpen] = useState(isOpen);
    if (isOpen && !lastIsOpen) {
        setLocalHour(formData.birthHour);
        setLocalMinute(formData.birthMinute);
    }
    if (isOpen !== lastIsOpen) {
        setLastIsOpen(isOpen);
    }

    // 只有钟表时间真的落在夏令时跳时/回拨里才提示；平时不出现任何专业选项。
    const timeCheck = useMemo(() => checkLocalTime({
        year: formData.birthYear, month: formData.birthMonth, day: formData.birthDay,
        hour: localHour, minute: localMinute,
    }, localTimezone), [formData.birthYear, formData.birthMonth, formData.birthDay, localHour, localMinute, localTimezone]);

    const handleConfirm = () => {
        let options;
        try {
            const disambiguation = formData.disambiguation && formData.disambiguation !== 'reject' ? formData.disambiguation : 'compatible';
            options = resolveBirthTimeOptions({ timezone: localTimezone, disambiguation });
        } catch (error) {
            showToast('warning', error instanceof Error ? error.message : '时间规则无效');
            return;
        }
        onUpdate('timezone', options.timezone);
        onUpdate('disambiguation', options.disambiguation);
        onUpdate('birthHour', localHour);
        onUpdate('birthMinute', localMinute);
        onConfirm?.();
        onClose();
    };

    const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const timeValue = e.target.value;
        if (timeValue) {
            const [hours, minutes] = timeValue.split(':').map(Number);
            setLocalHour(hours);
            setLocalMinute(minutes);
        }
    };

    const formatTimeValue = () => {
        const hour = String(localHour).padStart(2, '0');
        const minute = String(localMinute || 0).padStart(2, '0');
        return `${hour}:${minute}`;
    };

    if (!isOpen) return null;

    return (
        <Dialog bare open={isOpen} onClose={onClose} labelledBy={titleId} className="dialog-plain dialog-lg dialog-sheet">
            {/* 模态框内容 */}
            <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border-[0.5px] border-border bg-surface text-foreground shadow-lg sm:rounded-2xl">
                {/* 头部 */}
                <div className="flex items-center justify-between border-b-[0.5px] border-border px-5 py-4 sm:px-6">
                    <h2 id={titleId} className="flex items-center gap-2 font-display text-lg">
                        <Clock className="h-[18px] w-[18px] text-clay" />
                        出生时辰
                    </h2>
                    <Button unstyled
                        type="button"
                        onClick={onClose}
                        aria-label="关闭"
                        className="rounded-lg p-1.5 text-foreground-secondary transition-colors duration-150 hover:bg-background-secondary hover:text-foreground"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                {/* 内容 */}
                <div className="flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
                    <div className="space-y-6 animate-fade-in">
                        {/* 精确时间输入框 */}
                        <div className="flex items-center gap-4 rounded-xl bg-panel p-3 sm:p-4">
                            <label className="whitespace-nowrap text-[13px] text-foreground-secondary">
                                精确时间
                            </label>
                            <Input
                                type="time"
                                value={formatTimeValue()}
                                onChange={handleTimeChange}
                                className="h-11 flex-1 rounded-xl border-[0.5px] border-border-hover bg-surface px-4 text-center font-mono text-lg text-foreground
                                    transition-colors duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                            />
                        </div>

                        {/* 快捷选择时辰：保留子丑寅卯，统一显示为「子时」 */}
                        <div>
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <label className="text-[13px] font-medium text-foreground">
                                    快捷选择时辰
                                </label>
                                <span className="text-xs text-foreground-tertiary">
                                    点击选择将自动修正时间
                                </span>
                            </div>

                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                                {HOUR_OPTIONS.map(({ value, name, time }) => {
                                    const isSelected = localHour === value && (localMinute || 0) === 0;
                                    return (
                                        <Button unstyled
                                            key={value}
                                            type="button"
                                            aria-pressed={isSelected}
                                            onClick={() => {
                                                setLocalHour(value);
                                                setLocalMinute(0);
                                            }}
                                            className={`
                                                flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-sm transition-colors duration-150
                                                ${isSelected
                                                    ? 'bg-accent-soft text-accent-strong ring-2 ring-inset ring-accent'
                                                    : 'border-[0.5px] border-border bg-surface text-foreground hover:bg-background-secondary'
                                                }
                                            `}
                                        >
                                            <span className="font-display text-[15px]">
                                                {name}
                                            </span>
                                            <span className={`text-[11px] ${isSelected ? 'text-accent-strong/80' : 'text-foreground-tertiary'}`}>
                                                {time}
                                            </span>
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    {timeCheck.issue && (
                        <p className="text-xs leading-relaxed text-foreground-tertiary">
                            {timeCheck.issue === 'nonexistent'
                                ? `当地这天 ${formatTimeValue()} 因夏令时拨快而不存在，将按 ${timeCheck.adjusted} 计算。`
                                : `当地这天 ${formatTimeValue()} 因夏令时回拨出现两次，将按第一次计算。`}
                        </p>
                    )}
                </div>

                {/* 底部按钮 */}
                <div className="flex gap-3 border-t-[0.5px] border-border bg-surface px-5 py-4 pb-[calc(1rem+var(--sab))] sm:px-6 sm:pb-4">
                    <Button unstyled
                        type="button"
                        onClick={onClose}
                        className="h-11 flex-1 rounded-xl border-[0.5px] border-border-hover bg-surface text-sm font-medium text-foreground
                            transition-colors duration-150 hover:bg-background-secondary active:bg-background-tertiary"
                    >
                        取消
                    </Button>
                    <Button unstyled
                        type="button"
                        onClick={handleConfirm}
                        className="h-11 flex-1 rounded-xl bg-accent text-sm font-medium text-on-accent
                            transition-colors duration-150 hover:bg-accent-hover"
                    >
                        确定
                    </Button>
                </div>
            </div>
        </Dialog>
    );
}
