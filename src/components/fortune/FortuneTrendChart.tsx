/**
 * 运势趋势图组件
 *
 * 使用 Recharts 展示运势趋势变化
 * 'use client'：Recharts 依赖浏览器渲染，且有维度切换交互状态。
 */
'use client';

import { useState, useMemo } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceDot,
    Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { FortuneChartScores } from '@/lib/divination/fortune';

// 运势维度类型
export type FortuneDimension = 'overall' | 'career' | 'love' | 'wealth' | 'health' | 'social';

// 单日趋势数据
export interface FortuneTrendDataPoint {
    date: string;          // 'MM-DD' 格式
    fullDate: string;      // 'YYYY-MM-DD' 格式
    dayOfMonth: number;
    scores: FortuneChartScores;
    isKeyDate?: boolean;   // 是否为关键日期
    keyDateType?: 'lucky' | 'warning' | 'turning' | 'peak' | 'valley';
    keyDateDesc?: string;  // 关键日期描述
}

interface FortuneTrendChartProps {
    /** 趋势数据数组 */
    data: FortuneTrendDataPoint[];
    /** 当前选中的日期（用于高亮） */
    selectedDate?: string;
    /** 点击日期的回调 */
    onDateClick?: (date: string) => void;
    /** 图表高度 */
    height?: number;
    /** 是否显示图例 */
    showLegend?: boolean;
    /** 是否显示多维度 */
    multiDimension?: boolean;
    /** 简化模式：只标记高峰/低谷日（不影响维度切换） */
    simplifiedMode?: boolean;
    /** 默认只显示综合运势（但保留维度切换功能） */
    defaultOverallOnly?: boolean;
    /** 隐藏底部关键日期图例 */
    hideKeyDateLegend?: boolean;
    /** 自定义标题组件 */
    title?: React.ReactNode;
}

// 维度配置：颜色取主题 token（CSS 变量），深浅色主题自动切换
const DIMENSION_CONFIG: Record<FortuneDimension, { label: string; color: string }> = {
    overall: { label: '综合', color: 'var(--color-accent)' },
    career: { label: '事业', color: 'var(--color-water)' },
    love: { label: '感情', color: 'var(--color-hua-quan)' },
    wealth: { label: '财运', color: 'var(--color-wood)' },
    health: { label: '健康', color: 'var(--color-fire)' },
    social: { label: '人际', color: 'var(--color-earth)' },
};

// 关键日期颜色
const KEY_DATE_COLORS: Record<string, string> = {
    lucky: 'var(--color-success)',
    warning: 'var(--color-danger)',
    turning: 'var(--color-warning)',
    peak: 'var(--color-water)',
    valley: 'var(--color-foreground-tertiary)',
};

/** 关键日期点按综合分着色：吉 / 平 / 凶。 */
function getScoreDotColor(score: number): string {
    if (score >= 80) return 'var(--color-success)';
    if (score >= 60) return 'var(--color-foreground-tertiary)';
    return 'var(--color-danger)';
}

type TrendChartPoint = {
    date: string;
    fullDate: string;
    dayOfMonth: number;
    overall: number;
    career: number;
    love: number;
    wealth: number;
    health: number;
    social: number;
    isKeyDate?: boolean;
    keyDateType?: FortuneTrendDataPoint['keyDateType'];
    keyDateDesc?: string;
};

type TooltipPayload = { dataKey: FortuneDimension; value: number };

function FortuneTrendTooltip({
    active,
    payload,
    label,
    chartData,
}: {
    active?: boolean;
    payload?: TooltipPayload[];
    label?: string;
    chartData: TrendChartPoint[];
}) {
    if (!active || !payload || payload.length === 0) return null;

    const dataPoint = chartData.find((d) => d.date === label);

    return (
        <div className="rounded-xl border-[0.5px] border-border bg-surface p-3 shadow-md">
            <div className="text-sm font-medium mb-2">{dataPoint?.fullDate}</div>
            {payload.map((entry) => (
                <div
                    key={entry.dataKey}
                    className="flex items-center gap-2 text-sm"
                >
                    <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: DIMENSION_CONFIG[entry.dataKey].color }}
                    />
                    <span className="text-foreground-secondary">
                        {DIMENSION_CONFIG[entry.dataKey].label}:
                    </span>
                    <span className="font-medium">{entry.value}</span>
                </div>
            ))}
            {dataPoint?.isKeyDate && (
                <div className="mt-2 pt-2 border-t border-border text-xs">
                    <span
                        className="px-2 py-0.5 rounded-full text-surface"
                        style={{ backgroundColor: KEY_DATE_COLORS[dataPoint.keyDateType || 'lucky'] }}
                    >
                        {dataPoint.keyDateDesc}
                    </span>
                </div>
            )}
        </div>
    );
}

export function FortuneTrendChart({
    data,
    selectedDate,
    onDateClick,
    height = 250,
    showLegend = false,
    multiDimension = false,
    simplifiedMode = false,
    hideKeyDateLegend = false,
    defaultOverallOnly = false,
    title,
}: FortuneTrendChartProps) {
    const [activeDimensions, setActiveDimensions] = useState<FortuneDimension[]>(
        defaultOverallOnly ? ['overall'] : (multiDimension ? ['overall', 'career', 'wealth'] : ['overall'])
    );

    // 转换数据为 Recharts 格式
    const chartData = useMemo<TrendChartPoint[]>(() => {
        return data.map((point) => ({
            date: point.date,
            fullDate: point.fullDate,
            dayOfMonth: point.dayOfMonth,
            overall: point.scores.overall,
            career: point.scores.career,
            love: point.scores.love,
            wealth: point.scores.wealth,
            health: point.scores.health,
            social: point.scores.social,
            isKeyDate: point.isKeyDate,
            keyDateType: point.keyDateType,
            keyDateDesc: point.keyDateDesc,
        }));
    }, [data]);

    // 识别关键日期点 - 简化模式下只保留 peak 和 valley
    const keyDatePoints = useMemo(() => {
        const points = chartData.filter((d) => d.isKeyDate);
        if (simplifiedMode) {
            return points.filter((d) => d.keyDateType === 'peak' || d.keyDateType === 'valley');
        }
        return points;
    }, [chartData, simplifiedMode]);

    // 计算趋势（比较首尾）
    const trend = useMemo(() => {
        if (chartData.length < 2) return 'neutral';
        const first = chartData[0].overall;
        const last = chartData[chartData.length - 1].overall;
        const diff = last - first;
        if (diff > 5) return 'up';
        if (diff < -5) return 'down';
        return 'neutral';
    }, [chartData]);

    // 切换维度（支持多选）
    const toggleDimension = (dim: FortuneDimension) => {
        setActiveDimensions((prev) => {
            if (prev.includes(dim)) {
                if (prev.length === 1) return prev; // 至少保留一个
                return prev.filter((d) => d !== dim);
            }
            return [...prev, dim];
        });
    };

    const selectedPoint = useMemo(() => {
        if (!selectedDate) return null;
        return chartData.find((point) => point.fullDate === selectedDate) || null;
    }, [chartData, selectedDate]);

    return (
        <div className="space-y-4">
            {/* 趋势指示器和维度选择 */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-4">
                    {/* 标题 */}
                    {title && (
                        <div className="text-foreground">
                            {title}
                        </div>
                    )}

                    {/* 趋势指示 */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground-secondary">趋势:</span>
                        {trend === 'up' && (
                            <span className="flex items-center gap-1 text-success text-sm">
                                <TrendingUp className="w-4 h-4" />
                                上升
                            </span>
                        )}
                        {trend === 'down' && (
                            <span className="flex items-center gap-1 text-danger text-sm">
                                <TrendingDown className="w-4 h-4" />
                                下降
                            </span>
                        )}
                        {trend === 'neutral' && (
                            <span className="flex items-center gap-1 text-foreground-secondary text-sm">
                                <Minus className="w-4 h-4" />
                                平稳
                            </span>
                        )}
                    </div>
                </div>

                {/* 维度选择器 - defaultOverallOnly 模式下也显示，允许用户切换 */}
                <div className="flex items-center gap-2 flex-wrap">
                    {(Object.keys(DIMENSION_CONFIG) as FortuneDimension[]).map((dim) => (
                        <button
                            key={dim}
                            type="button"
                            aria-pressed={activeDimensions.includes(dim)}
                            onClick={() => toggleDimension(dim)}
                            className={`px-2.5 py-1 text-xs rounded-md transition-colors duration-200 ${activeDimensions.includes(dim)
                                ? 'text-surface'
                                : 'bg-background-secondary text-foreground-secondary hover:bg-background-tertiary hover:text-foreground'
                                }`}
                            style={{
                                backgroundColor: activeDimensions.includes(dim)
                                    ? DIMENSION_CONFIG[dim].color
                                    : undefined,
                            }}
                        >
                            {DIMENSION_CONFIG[dim].label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 图表 */}
            <div className="rounded-xl bg-background p-3 sm:p-4">
                <ResponsiveContainer width="100%" height={height}>
                    <LineChart
                        data={chartData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        onClick={(e) => {
                            // Recharts onClick provides activePayload at runtime
                            const payload = (e as { activePayload?: Array<{ payload?: { fullDate?: string } }> })?.activePayload?.[0]?.payload;
                            if (payload?.fullDate && onDateClick) {
                                onDateClick(payload.fullDate);
                            }
                        }}
                    >
                        <CartesianGrid
                            strokeDasharray="2 2"
                            stroke="var(--color-border)"
                            opacity={0.6}
                            vertical={false}
                        />
                        <XAxis
                            dataKey="date"
                            tick={{ fontSize: 10, fill: 'var(--color-foreground-secondary)' }}
                            tickLine={false}
                            axisLine={false}
                            dy={10}
                            minTickGap={15}
                        />
                        <YAxis
                            domain={[40, 100]}
                            tick={{ fontSize: 10, fill: 'var(--color-foreground-secondary)' }}
                            tickLine={false}
                            axisLine={false}
                            tickCount={4}
                        />
                        <Tooltip content={<FortuneTrendTooltip chartData={chartData} />} />
                        {showLegend && <Legend />}

                        {/* 绘制活跃的维度线 */}
                        {activeDimensions.map((dim) => (
                            <Line
                                key={dim}
                                type="monotone"
                                dataKey={dim}
                                stroke={DIMENSION_CONFIG[dim].color}
                                strokeWidth={dim === 'overall' ? 2.5 : 1.75}
                                dot={chartData.length < 15 ? { r: 3, fill: DIMENSION_CONFIG[dim].color, stroke: 'var(--color-background)', strokeWidth: 1.5 } : false}
                                activeDot={{
                                    r: 6,
                                    fill: DIMENSION_CONFIG[dim].color,
                                    stroke: 'var(--color-background)',
                                    strokeWidth: 3,
                                }}
                            />
                        ))}

                        {/* 标记关键日期点 - 使用运势评分颜色 */}
                        {keyDatePoints.map((point, idx) => {
                            // 根据运势分数决定颜色：吉 / 平 / 凶
                            const dotColor = getScoreDotColor(point.overall);

                            return (
                                <ReferenceDot
                                    key={idx}
                                    x={point.date}
                                    y={point.overall}
                                    r={5}
                                    fill={dotColor}
                                    stroke="var(--color-background)"
                                    strokeWidth={2}
                                    style={{ filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.1))' }}
                                />
                            );
                        })}
                        {selectedPoint && (
                            <ReferenceDot
                                x={selectedPoint.date}
                                y={selectedPoint.overall}
                                r={8}
                                fill={DIMENSION_CONFIG.overall.color}
                                stroke="var(--color-background)"
                                strokeWidth={3}
                                style={{ filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.1))' }}
                            />
                        )}
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* 关键日期图例 - 可通过 hideKeyDateLegend 隐藏 */}
            {!hideKeyDateLegend && keyDatePoints.length > 0 && (
                <div className="flex items-center gap-4 flex-wrap text-xs">
                    <span className="text-foreground-secondary">关键日期:</span>
                    {keyDatePoints.map((point, idx) => (
                        <div
                            key={idx}
                            className="flex items-center gap-1.5 text-xs text-foreground-secondary bg-background-secondary px-2 py-1 rounded-md"
                        >
                            <div
                                className="w-2.5 h-2.5 rounded-full ring-2 ring-surface"
                                style={{ backgroundColor: KEY_DATE_COLORS[point.keyDateType || 'lucky'] }}
                            />
                            <span>
                                {point.dayOfMonth}日 - {point.keyDateDesc}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
