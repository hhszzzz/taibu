'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { LiuQin } from '@/lib/divination/liuyao';

export const YONG_SHEN_TARGET_OPTIONS: Array<{
    label: string;
    value: LiuQin;
    description: string;
}> = [
    { label: '学业与文书', value: '父母', description: '合同文书/证件/学业/房屋车辆/长辈' },
    { label: '工作与压力', value: '官鬼', description: '功名求官/工作事业/规则/压力/风险/疾病；婚恋多见于女问对象或以官为线索时' },
    { label: '钱和资源', value: '妻财', description: '钱财/交易/资源/经营；婚恋多见于男问对象或以财为线索时' },
    { label: '子女后辈 / 医药', value: '子孙', description: '子女后辈/医药' },
    { label: '同辈 / 合作 / 竞争', value: '兄弟', description: '同辈/合作/竞争' },
];

export type YongShenPickerVariant = 'inline-right' | 'block' | 'chips';

interface YongShenTargetPickerProps {
    value: LiuQin[];
    onChange: (targets: LiuQin[]) => void;
    variant?: YongShenPickerVariant;
    className?: string;
}

function isSameTargets(a: LiuQin[], b: LiuQin[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((item, index) => item === b[index]);
}

function renderTargetHint(labels: string[]) {
    return labels.length > 0 ? `已选：${labels.join('、')}` : '可多选';
}

export function YongShenTargetPicker({
    value,
    onChange,
    variant = 'inline-right',
    className = '',
}: YongShenTargetPickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const canUseDOM = typeof document !== 'undefined';
    const selectedLabels = useMemo(
        () => YONG_SHEN_TARGET_OPTIONS.filter((item) => value.includes(item.value)).map((item) => item.label),
        [value]
    );

    const toggleTarget = (target: LiuQin) => {
        const exists = value.includes(target);
        const next = exists
            ? value.filter((item) => item !== target)
            : [...value, target];
        if (!isSameTargets(value, next)) {
            onChange(next);
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        const onKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', onKeydown);
        return () => window.removeEventListener('keydown', onKeydown);
    }, [isOpen]);

    if (variant === 'chips') {
        return (
            <div className={`flex flex-wrap gap-2 ${className}`} role="group" aria-label="分析目标">
                {YONG_SHEN_TARGET_OPTIONS.map((item) => {
                    const checked = value.includes(item.value);
                    return (
                        <button
                            key={item.value}
                            type="button"
                            aria-pressed={checked}
                            title={item.description}
                            onClick={() => toggleTarget(item.value)}
                            className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm transition-colors ${
                                checked
                                    ? 'border-[1.5px] border-accent bg-accent-light text-accent-strong'
                                    : 'border-[0.5px] border-border-hover bg-surface text-foreground-secondary hover:bg-background-secondary hover:text-foreground'
                            }`}
                        >
                            {checked && <Check className="h-3.5 w-3.5" />}
                            {item.value} · {item.label}
                        </button>
                    );
                })}
            </div>
        );
    }

    if (variant === 'block') {
        return (
            <div className={`rounded-2xl border-[0.5px] border-border bg-surface p-4 ${className}`}>
                <div className="mb-2.5 text-sm font-medium text-foreground">请选择六亲</div>
                <div className="grid gap-2 sm:grid-cols-2">
                    {YONG_SHEN_TARGET_OPTIONS.map((item) => {
                        const checked = value.includes(item.value);
                        return (
                            <button
                                key={item.value}
                                type="button"
                                aria-pressed={checked}
                                onClick={() => toggleTarget(item.value)}
                                className={`rounded-xl px-3 py-2.5 text-left transition-colors ${
                                    checked
                                        ? 'bg-accent-soft text-accent-strong ring-2 ring-inset ring-accent'
                                        : 'border-[0.5px] border-border-hover bg-surface text-foreground-secondary hover:bg-background-secondary hover:text-foreground'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 items-baseline gap-2">
                                        <span className="font-display text-[15px]">{item.value}</span>
                                        <span className="text-xs opacity-90">{item.label}</span>
                                    </div>
                                    {checked && <Check className="h-4 w-4" />}
                                </div>
                                <div className="mt-1 text-xs opacity-75">{item.description}</div>
                            </button>
                        );
                    })}
                </div>
                <div className="mt-2.5 text-xs text-foreground-tertiary">
                    {renderTargetHint(selectedLabels)}
                </div>
            </div>
        );
    }

    return (
        <div className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-xs transition-colors ${
                    selectedLabels.length > 0
                        ? 'border border-accent bg-accent-light text-accent-strong'
                        : 'border-[0.5px] border-border-hover bg-surface text-foreground-secondary hover:text-foreground'
                }`}
            >
                <span className="max-w-[120px] truncate text-sm">
                    {selectedLabels.length > 0 ? `分析目标 ${selectedLabels.length} 项` : '选择分析目标'}
                </span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && canUseDOM && createPortal(
                <>
                    <button
                        type="button"
                        aria-label="关闭分析目标弹窗"
                        onClick={() => setIsOpen(false)}
                        className="fixed inset-0 z-[70] bg-foreground/30 backdrop-blur-[1px]"
                    />
                    <div className="fixed inset-0 z-[71] flex items-center justify-center p-4 pointer-events-none">
                        <div
                            role="dialog"
                            aria-modal="true"
                            className="pointer-events-auto w-full max-w-[460px] overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface shadow-[var(--shadow-lg)]"
                        >
                            <div className="flex items-center justify-between border-b-[0.5px] border-border px-4 py-3">
                                <div>
                                    <div className="text-sm font-semibold text-foreground">选择六亲</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsOpen(false)}
                                    aria-label="关闭"
                                    className="rounded-lg p-1 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="max-h-[52vh] overflow-y-auto p-3">
                                <div className="space-y-2">
                                    {YONG_SHEN_TARGET_OPTIONS.map((item) => {
                                        const checked = value.includes(item.value);
                                        return (
                                            <button
                                                key={item.value}
                                                type="button"
                                                onClick={() => toggleTarget(item.value)}
                                                aria-pressed={checked}
                                                className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                                                    checked
                                                        ? 'bg-accent-soft text-accent-strong ring-2 ring-inset ring-accent'
                                                        : 'border-[0.5px] border-border-hover bg-surface text-foreground-secondary hover:bg-background-secondary hover:text-foreground'
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex min-w-0 items-baseline gap-2">
                                                        <span className="font-display text-base">{item.value}</span>
                                                        <span className="text-sm opacity-90">{item.label}</span>
                                                    </div>
                                                    {checked && <Check className="h-4 w-4" />}
                                                </div>
                                                <div className="mt-1 text-xs opacity-70">{item.description}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 border-t-[0.5px] border-border px-4 py-3">
                                <div className="text-xs text-foreground-tertiary">
                                    {renderTargetHint(selectedLabels)}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onChange([])}
                                        className="h-8 rounded-lg border-[0.5px] border-border-hover bg-surface px-3 text-xs text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"
                                    >
                                        清空
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsOpen(false)}
                                        className="h-8 rounded-lg bg-accent px-3 text-xs font-medium text-on-accent transition-colors hover:bg-accent-hover"
                                    >
                                        确认
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>,
                document.body
            )}
        </div>
    );
}
