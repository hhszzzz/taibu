/**
 * 兼容性总分环 + 维度条
 *
 * 'use client'：在客户端结果页渲染（数据来自 sessionStorage）
 */
'use client';

import { type CompatibilityDimension, getCompatibilityLevel } from '@/lib/divination/hepan';

interface CompatibilityChartProps {
    dimensions: CompatibilityDimension[];
    overallScore: number;
}

/** 等级文案 → 主题色（替代 lib 返回的硬编码调色板类名） */
const LEVEL_TONE_CLASS: Record<string, { text: string; chip: string }> = {
    极佳: { text: 'text-success', chip: 'bg-success/10 text-success' },
    良好: { text: 'text-water', chip: 'bg-water-soft text-water' },
    一般: { text: 'text-warning', chip: 'bg-warning/10 text-warning' },
    需注意: { text: 'text-danger', chip: 'bg-danger/10 text-danger' },
};
const DEFAULT_TONE = { text: 'text-foreground', chip: 'bg-background-secondary text-foreground-secondary' };

const RING_RADIUS = 70;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function clampScore(score: number): number {
    return Math.min(100, Math.max(0, score));
}

export function CompatibilityChart({ dimensions, overallScore }: CompatibilityChartProps) {
    const { level } = getCompatibilityLevel(overallScore);
    const tone = LEVEL_TONE_CLASS[level] ?? DEFAULT_TONE;
    const progress = (clampScore(overallScore) / 100) * RING_CIRCUMFERENCE;

    return (
        <div className="grid gap-6 rounded-2xl border-[0.5px] border-border bg-surface p-5 sm:p-6 md:grid-cols-[200px_minmax(0,1fr)] md:items-center md:gap-8">
            {/* 总分 */}
            <div className="flex flex-col items-center text-center">
                <div className="relative inline-flex items-center justify-center">
                    <svg className="h-40 w-40 -rotate-90" viewBox="0 0 160 160" aria-hidden="true">
                        <circle
                            cx="80"
                            cy="80"
                            r={RING_RADIUS}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="8"
                            className="text-background-tertiary"
                        />
                        <circle
                            cx="80"
                            cy="80"
                            r={RING_RADIUS}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="8"
                            strokeDasharray={`${progress} ${RING_CIRCUMFERENCE}`}
                            strokeLinecap="round"
                            className="text-clay transition-all duration-1000 ease-out"
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-display text-[44px] leading-none text-foreground">{overallScore}</span>
                        <span className={`mt-2 rounded-md px-2 py-0.5 text-sm ${tone.chip}`}>
                            {level}
                        </span>
                    </div>
                </div>
                <p className="mt-3 text-[13px] text-foreground-secondary">综合契合度</p>
            </div>

            {/* 维度列表 */}
            <div className="flex flex-col gap-5">
                {dimensions.map((dim, index) => {
                    const dimTone = LEVEL_TONE_CLASS[getCompatibilityLevel(dim.score).level] ?? DEFAULT_TONE;
                    return (
                        <div key={index}>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="text-[15px] text-foreground">{dim.name}</span>
                                <span className={`text-sm font-medium tabular-nums ${dimTone.text}`}>{dim.score}分</span>
                            </div>
                            <div
                                className="h-2 overflow-hidden rounded-full bg-background-secondary"
                                role="progressbar"
                                aria-label={dim.name}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={dim.score}
                            >
                                <div
                                    className="h-full rounded-full bg-clay transition-all duration-1000 ease-out"
                                    style={{ width: `${clampScore(dim.score)}%` }}
                                />
                            </div>
                            <p className="mt-1.5 text-xs leading-relaxed text-foreground-secondary">
                                {dim.description}
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
