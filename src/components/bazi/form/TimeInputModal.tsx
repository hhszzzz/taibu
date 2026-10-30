/**
 * 时间输入模态框组件
 *
 * 'use client' 标记说明：
 * - 使用 useState 管理模态框状态
 * - 包含交互式时间选择
 */
'use client';

import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useId, useState } from 'react';
import { Clock, X } from 'lucide-react';
import type { BaziFormData } from '@/types';
import { HOUR_OPTIONS } from '@/components/bazi/form/options';
import { useToast } from '@/components/ui/Toast';
import { resolveBirthTimeOptions } from '@/lib/divination/birth-time';
import { Dialog } from '@/components/ui/Dialog';
import { DEFAULT_DIVINATION_TIMEZONE } from 'taibu-core/timezone-utils';

interface TimeInputModalProps {
    isOpen: boolean;
    onClose: () => void;
    formData: BaziFormData;
    unknownTime: boolean;
    onToggleUnknownTime: () => void;
    onUpdate: <K extends keyof BaziFormData>(field: K, value: BaziFormData[K]) => void;
    allowUnknownTime?: boolean;
    onConfirm?: () => void;
}

export function TimeInputModal({
    isOpen,
    onClose,
    formData,
    unknownTime,
    onToggleUnknownTime,
    onUpdate,
    allowUnknownTime = true,
    onConfirm,
}: TimeInputModalProps) {
    const titleId = useId();
    const [localHour, setLocalHour] = useState(formData.birthHour);
    const [localMinute, setLocalMinute] = useState(formData.birthMinute);
    const [localUnknownTime, setLocalUnknownTime] = useState(unknownTime);
    const [localTimezone, setLocalTimezone] = useState(formData.timezone ?? DEFAULT_DIVINATION_TIMEZONE);
    const [localDisambiguation, setLocalDisambiguation] = useState<string>(formData.disambiguation ?? 'reject');
    const { showToast } = useToast();

    // 当模态框打开时，同步外部值到本地状态
    const [lastIsOpen, setLastIsOpen] = useState(isOpen);
    if (isOpen && !lastIsOpen) {
        setLocalHour(formData.birthHour);
        setLocalMinute(formData.birthMinute);
        setLocalTimezone(formData.timezone ?? DEFAULT_DIVINATION_TIMEZONE);
        setLocalDisambiguation(formData.disambiguation ?? 'reject');
        // 打开时保持当前状态：未知就还是未知，选了时间才算知道。
        setLocalUnknownTime(unknownTime);
    }
    if (isOpen !== lastIsOpen) {
        setLastIsOpen(isOpen);
    }

    const handleConfirm = () => {
        let options;
        try {
            options = resolveBirthTimeOptions({ timezone: localTimezone, disambiguation: localDisambiguation });
        } catch (error) {
            showToast('warning', error instanceof Error ? error.message : '时间规则无效');
            return;
        }
        onUpdate('timezone', options.timezone);
        onUpdate('disambiguation', options.disambiguation);
        onUpdate('birthHour', localHour);
        onUpdate('birthMinute', localMinute);
        if (allowUnknownTime && localUnknownTime !== unknownTime) {
            onToggleUnknownTime();
        }
        onConfirm?.();
        onClose();
    };

    const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const timeValue = e.target.value;
        if (timeValue) {
            const [hours, minutes] = timeValue.split(':').map(Number);
            setLocalHour(hours);
            setLocalMinute(minutes);
            // 选了时间就是知道了。
            setLocalUnknownTime(false);
        }
    };

    const formatTimeValue = () => {
        const hour = String(localHour).padStart(2, '0');
        const minute = String(localMinute || 0).padStart(2, '0');
        return `${hour}:${minute}`;
    };

    if (!isOpen) return null;

    // knowTime 表示"知道时辰"，是 localUnknownTime（不知时辰）的反义
    const knowTime = allowUnknownTime ? !localUnknownTime : true;

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
                    {/* 不知时辰开关 */}
                    {allowUnknownTime && (
                        <label className="group flex cursor-pointer items-center justify-between">
                            <span className="text-sm font-medium text-foreground">
                                {knowTime ? '已知时辰' : '不知时辰'}
                            </span>
                            <div
                                onClick={() => setLocalUnknownTime(!localUnknownTime)}
                                className={`
                                    relative flex h-6 w-11 items-center rounded-full transition-colors duration-150 ease-out
                                    ${knowTime ? 'bg-accent' : 'bg-background-tertiary'}
                                `}
                            >
                                <div
                                    className={`
                                        absolute h-5 w-5 rounded-full bg-surface shadow-sm
                                        transition-transform duration-150
                                        ${knowTime ? 'translate-x-[22px]' : 'translate-x-0.5'}
                                    `}
                                />
                            </div>
                        </label>
                    )}

                    {/* 具体时间输入 - 仅当知道时辰时显示 */}
                    {knowTime && (
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

                            {/* 时辰快捷选择 */}
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
                                                    setLocalUnknownTime(false);
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
                    )}
                    <div className="space-y-4 border-t-[0.5px] border-border pt-5">
                        <label className="block text-[13px] font-medium text-foreground">
                            出生地时区（IANA）
                            <Input
                                type="text"
                                value={localTimezone}
                                onChange={event => setLocalTimezone(event.target.value)}
                                placeholder="Asia/Shanghai"
                                maxLength={100}
                                className="mt-2 h-11 border-border-hover"
                            />
                        </label>
                        <label className="block text-[13px] font-medium text-foreground">
                            夏令时重复／缺失时间
                            <Select
                                value={localDisambiguation}
                                onChange={setLocalDisambiguation}
                                ariaLabel="夏令时重复／缺失时间"
                                options={[
                                    { value: 'reject', label: '遇到歧义时提示错误（默认）' },
                                    { value: 'earlier', label: '选择较早的瞬间' },
                                    { value: 'later', label: '选择较晚的瞬间' },
                                    { value: 'compatible', label: '兼容模式：重复取早，缺失取晚' },
                                ]}
                                className="mt-2 h-11 text-sm font-normal"
                            />
                        </label>
                        <p className="text-xs leading-relaxed text-foreground-tertiary">输入出生地当时的民用钟表时间。时区规则包含历史夏令时；只有确知取舍时才调整默认策略。</p>
                    </div>
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
