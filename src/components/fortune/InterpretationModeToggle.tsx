/**
 * 解读模式切换组件
 *
 * 支持白话/专业/术语三种解读模式
 * 'use client'：按钮点击回调（onModeChange）需在客户端运行。
 */
'use client';

import { BookOpen, GraduationCap, ScrollText } from 'lucide-react';

export type InterpretationMode = 'colloquial' | 'professional' | 'technical';

interface InterpretationModeToggleProps {
    /** 当前模式 */
    mode: InterpretationMode;
    /** 模式变化回调 */
    onModeChange: (mode: InterpretationMode) => void;
    /** 是否紧凑模式 */
    compact?: boolean;
}

const MODE_CONFIG: Record<InterpretationMode, {
    label: string;
    shortLabel: string;
    description: string;
    icon: typeof BookOpen;
}> = {
    colloquial: {
        label: '白话模式',
        shortLabel: '白话',
        description: '简单易懂的日常语言',
        icon: BookOpen,
    },
    professional: {
        label: '专业模式',
        shortLabel: '专业',
        description: '稍微专业但可理解',
        icon: GraduationCap,
    },
    technical: {
        label: '术语模式',
        shortLabel: '术语',
        description: '命理专业术语',
        icon: ScrollText,
    },
};

export function InterpretationModeToggle({
    mode,
    onModeChange,
    compact = false,
}: InterpretationModeToggleProps) {
    const modes: InterpretationMode[] = ['colloquial', 'professional', 'technical'];

    if (compact) {
        return (
            <div role="group" aria-label="解读模式" className="flex items-center gap-0.5 rounded-[10px] bg-background-secondary p-1">
                {modes.map((m) => {
                    const config = MODE_CONFIG[m];
                    const isActive = mode === m;
                    const Icon = config.icon;

                    return (
                        <button
                            key={m}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => onModeChange(m)}
                            className={`flex items-center gap-1 rounded-[7px] px-2 py-1 text-xs transition-colors ${
                                isActive
                                    ? 'bg-surface text-foreground shadow-sm'
                                    : 'text-foreground-secondary hover:text-foreground'
                            }`}
                            title={config.description}
                        >
                            <Icon className="w-3 h-3" />
                            <span>{config.shortLabel}</span>
                        </button>
                    );
                })}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <div className="text-sm text-foreground-secondary">解读模式</div>
            <div className="flex items-center gap-2 flex-wrap">
                {modes.map((m) => {
                    const config = MODE_CONFIG[m];
                    const isActive = mode === m;
                    const Icon = config.icon;

                    return (
                        <button
                            key={m}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => onModeChange(m)}
                            className={`flex items-center gap-2 rounded-xl px-3 py-2 transition-colors ${
                                isActive
                                    ? 'bg-accent-soft text-accent-strong ring-1 ring-inset ring-accent/40'
                                    : 'bg-background-secondary text-foreground-secondary hover:bg-background-tertiary hover:text-foreground'
                            }`}
                        >
                            <Icon className="w-4 h-4" />
                            <div className="text-left">
                                <div className="text-sm font-medium">{config.label}</div>
                                <div className={`text-xs ${isActive ? 'text-accent-strong/80' : 'text-foreground-secondary'}`}>
                                    {config.description}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
