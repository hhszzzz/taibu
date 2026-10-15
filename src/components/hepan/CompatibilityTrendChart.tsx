/**
 * 合盘兼容性趋势图组件
 *
 * 显示半年/一年的兼容性走势曲线
 *
 * 'use client'：recharts 依赖浏览器测量与交互
 */
'use client';

import {
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
    Area,
    AreaChart,
} from 'recharts';
import { TrendingUp, CalendarDays } from 'lucide-react';
import { SegmentedControl, type SegmentedOption } from '@/components/bazi/SegmentedControl';

export interface CompatibilityTrendPoint {
    month: string;           // 月份标签 (e.g., "1月", "2月")
    fullMonth: string;       // 完整日期 (e.g., "2024-01")
    score: number;           // 兼容性分数 (0-100)
    dimension?: {
        wuxing: number;      // 五行配合
        communication: number; // 沟通契合
        emotion: number;     // 情感共鸣
    };
    event?: string;          // 特殊事件提示
}

/** 图表配色：主序列陶土色，网格线三级文字色（均随主题切换） */
const CHART_COLORS = {
    primary: 'var(--clay)',
    grid: 'var(--foreground-tertiary)',
    tick: 'var(--foreground-secondary)',
    dotFill: 'var(--surface)',
} as const;

const PERIOD_OPTIONS: readonly SegmentedOption<'6' | '12'>[] = [
    { value: '6', label: '半年' },
    { value: '12', label: '一年' },
];

type CompatibilityTooltipProps = {
    active?: boolean;
    payload?: { payload: CompatibilityTrendPoint }[];
};

function CompatibilityTrendTooltip({ active, payload }: CompatibilityTooltipProps) {
    if (!active || !payload || !payload.length) return null;

    const point = payload[0].payload;
    return (
        <div className="rounded-xl border-[0.5px] border-border bg-surface p-3.5 shadow-md">
            <div className="mb-2 flex items-center gap-2 border-b-[0.5px] border-border pb-2">
                <CalendarDays className="w-4 h-4 text-foreground-secondary" />
                <span className="text-sm font-medium text-foreground">{point.fullMonth}</span>
            </div>

            <div className="flex items-baseline gap-2 mb-3">
                <span className="font-display text-2xl text-accent-strong">{point.score}</span>
                <span className="text-sm text-foreground-secondary">分</span>
            </div>

            {point.dimension && (
                <div className="space-y-1.5 text-xs text-foreground-secondary">
                    <div className="flex justify-between gap-4">
                        <span>五行配合</span>
                        <span className="font-medium text-foreground">{point.dimension.wuxing}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span>沟通契合</span>
                        <span className="font-medium text-foreground">{point.dimension.communication}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span>情感共鸣</span>
                        <span className="font-medium text-foreground">{point.dimension.emotion}</span>
                    </div>
                </div>
            )}
            {point.event && (
                <div className="mt-3 flex items-start gap-1 border-t-[0.5px] border-border pt-2 text-xs font-medium text-warning">
                    <span>⚡</span>
                    {point.event}
                </div>
            )}
        </div>
    );
}

interface CompatibilityTrendChartProps {
    data: CompatibilityTrendPoint[];
    period: 6 | 12;
    onPeriodChange?: (period: 6 | 12) => void;
    height?: number;
}

export function CompatibilityTrendChart({
    data,
    period,
    onPeriodChange,
    height = 320,
}: CompatibilityTrendChartProps) {
    // 计算平均分
    const averageScore = Math.round(
        data.reduce((sum, d) => sum + d.score, 0) / data.length
    );

    // 找出最高和最低点
    const maxPoint = data.reduce((max, d) => (d.score > max.score ? d : max), data[0]);
    const minPoint = data.reduce((min, d) => (d.score < min.score ? d : min), data[0]);

    // 计算趋势（正向、负向、平稳）
    const firstHalf = data.slice(0, Math.floor(data.length / 2));
    const secondHalf = data.slice(Math.floor(data.length / 2));
    const firstAvg = firstHalf.reduce((sum, d) => sum + d.score, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, d) => sum + d.score, 0) / secondHalf.length;
    const trend = secondAvg - firstAvg > 3 ? 'up' : secondAvg - firstAvg < -3 ? 'down' : 'stable';

    const trendText = trend === 'up' ? '整体呈上升趋势' : trend === 'down' ? '整体呈下降趋势' : '整体较为平稳';
    const trendColor = trend === 'up' ? 'text-success' : trend === 'down' ? 'text-danger' : 'text-warning';

    return (
        <div className="rounded-2xl border-[0.5px] border-border bg-surface p-5 sm:p-6">
            {/* 标题和时间选择 */}
            <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                    <h3 className="flex items-center gap-2 font-display text-lg text-foreground sm:text-xl">
                        <TrendingUp className="h-[18px] w-[18px] text-clay" />
                        兼容性走势
                    </h3>
                    <p className="mt-1 text-[13px] text-foreground-secondary">
                        未来{period}个月的感情能量波动预测
                    </p>
                </div>

                {onPeriodChange && (
                    <SegmentedControl
                        ariaLabel="走势周期"
                        size="sm"
                        options={PERIOD_OPTIONS}
                        value={String(period) as '6' | '12'}
                        onChange={(value) => onPeriodChange(value === '12' ? 12 : 6)}
                        className="w-full sm:w-[180px]"
                    />
                )}
            </div>

            {/* 趋势概要 */}
            <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
                <div className="flex flex-col items-center justify-center rounded-xl bg-panel p-3 text-center sm:p-4">
                    <span className="mb-1 text-xs text-foreground-secondary">平均分</span>
                    <span className="font-display text-2xl text-accent-strong">{averageScore}</span>
                </div>
                <div className="flex flex-col items-center justify-center rounded-xl bg-panel p-3 text-center sm:p-4">
                    <span className="mb-1 text-xs text-foreground-secondary">最高点</span>
                    <span className="font-display text-2xl text-success">{maxPoint?.score}</span>
                    <span className="mt-1 text-[11px] text-foreground-tertiary">{maxPoint?.month}</span>
                </div>
                <div className="flex flex-col items-center justify-center rounded-xl bg-panel p-3 text-center sm:p-4">
                    <span className="mb-1 text-xs text-foreground-secondary">最低点</span>
                    <span className="font-display text-2xl text-danger">{minPoint?.score}</span>
                    <span className="mt-1 text-[11px] text-foreground-tertiary">{minPoint?.month}</span>
                </div>
            </div>

            {/* 图表 */}
            <div className="w-full" style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={data}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                        <defs>
                            <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.28} />
                                <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke={CHART_COLORS.grid}
                            strokeOpacity={0.3}
                        />
                        <XAxis
                            dataKey="month"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 12, fill: CHART_COLORS.tick }}
                            interval={period === 12 ? 1 : 0}
                            dy={10}
                        />
                        <YAxis
                            domain={[30, 100]}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 12, fill: CHART_COLORS.tick }}
                            ticks={[40, 60, 80, 100]}
                        />
                        <Tooltip
                            content={<CompatibilityTrendTooltip />}
                            cursor={{ stroke: CHART_COLORS.grid, strokeOpacity: 0.5, strokeWidth: 1, strokeDasharray: '5 5' }}
                        />
                        <ReferenceLine
                            y={averageScore}
                            stroke={CHART_COLORS.primary}
                            strokeDasharray="3 3"
                            strokeOpacity={0.5}
                            label={{
                                value: '平均线',
                                // 右侧外边距很窄，标签放在绘图区内，避免被裁切
                                position: 'insideTopRight',
                                fill: CHART_COLORS.tick,
                                fontSize: 10,
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="score"
                            stroke={CHART_COLORS.primary}
                            strokeWidth={2.5}
                            fill="url(#colorScore)"
                            activeDot={{
                                r: 5,
                                stroke: CHART_COLORS.primary,
                                strokeWidth: 3,
                                fill: CHART_COLORS.dotFill,
                            }}
                            animationDuration={1500}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* 底部说明 */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t-[0.5px] border-border pt-4 text-xs text-foreground-secondary">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                        <div className="h-2.5 w-2.5 rounded-full bg-success" />
                        <span>波峰</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="h-2.5 w-2.5 rounded-full bg-danger" />
                        <span>波谷</span>
                    </div>
                </div>
                <div className="font-medium">
                    趋势预测：<span className={trendColor}>{trendText}</span>
                </div>
            </div>
        </div>
    );
}
