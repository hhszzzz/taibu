/**
 * 紫微命盘网格组件
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState / useMemo)
 * - 有宫位选择、杂曜显示切换等交互
 */
'use client';

import { useMemo, useState } from 'react';
import type { ZiweiCanonicalJSON } from 'taibu-core/ziwei';
import { getBranchIndex, getTriangleSquare, type ZiweiFlightOverlay } from '@/lib/divination/ziwei';
import { PalaceCard, type PalaceFlightTag } from '@/components/ziwei/PalaceCard';
import { ZiweiChartCenter, ZiweiChartLegend } from '@/components/ziwei/ZiweiChartCenter';
import { ZiweiPalaceDetail } from '@/components/ziwei/ZiweiPalaceDetail';
import { MUTAGEN_BADGE_CLASS, MUTAGEN_STROKE_CLASS, ZIWEI_CONTAINER_CLASS } from '@/components/ziwei/ziwei-display';
import type { HoroscopeInfo, HoroscopeHighlight } from '@/components/ziwei/ZiweiHoroscopePanel';
import { Eye, EyeOff } from 'lucide-react';

interface ZiweiChartProps {
    canonicalChart: ZiweiCanonicalJSON;
    horoscopeHighlight?: HoroscopeHighlight;
    horoscopeInfo?: HoroscopeInfo;
    /** 命主姓名（可选）：中宫标题显示「姓名 · 乾/坤造」；对话嵌入等无姓名场景省略。 */
    subjectName?: string;
    /** 出生钟表时间（HH:mm），显示在中宫阳历一行。 */
    birthTime?: string;
    /** 出生地（可选），与真太阳时同列显示。 */
    birthPlace?: string;
    /** 受控焦点宫（宫位索引，null 为不选）；省略时组件自管并默认选中命宫。 */
    selectedPalace?: number | null;
    onSelectedPalaceChange?: (index: number | null) => void;
    /** 受控杂曜显隐；提供时由外部（如结果页菜单）切换，不再渲染内置工具栏。 */
    showAdjStars?: boolean;
    /** natal：三方四正连线；flying：以焦点宫为飞出宫，绘制宫干四化飞线。 */
    variant?: 'natal' | 'flying';
    /** flying 模式下焦点宫的飞化（null 表示尚未就绪或未选宫）。 */
    flightOverlay?: ZiweiFlightOverlay | null;
    /** 完整盘也在命盘下方显示焦点宫详情（紧凑盘始终显示）。 */
    showPalaceDetail?: boolean;
    interaction?: {
        palaceIndices: number[];
        stars: Array<{ palaceIndex: number; group: '主星及四化' | '辅星' | '杂曜'; starIndex: number }>;
        includeRelated: boolean;
        onPalaceSelect: (index: number) => void;
        onStarSelect: (palaceIndex: number, group: '主星及四化' | '辅星' | '杂曜', starIndex: number) => void;
    };
}

interface GridSlot {
    branch: number;
    row: number;
    col: number;
}

/** 标准 4×4 排布（地支序 子=0）：上行 巳午未申，左列 辰卯，右列 酉戌，下行 寅丑子亥。 */
const GRID_SLOTS: readonly GridSlot[] = [
    { branch: 5, row: 0, col: 0 }, { branch: 6, row: 0, col: 1 }, { branch: 7, row: 0, col: 2 }, { branch: 8, row: 0, col: 3 },
    { branch: 4, row: 1, col: 0 }, { branch: 9, row: 1, col: 3 },
    { branch: 3, row: 2, col: 0 }, { branch: 10, row: 2, col: 3 },
    { branch: 2, row: 3, col: 0 }, { branch: 1, row: 3, col: 1 }, { branch: 0, row: 3, col: 2 }, { branch: 11, row: 3, col: 3 },
];
const SLOT_BY_BRANCH = new Map(GRID_SLOTS.map((slot) => [slot.branch, slot]));
const ROW_START_CLASS = ['row-start-1', 'row-start-2', 'row-start-3', 'row-start-4'] as const;
const COL_START_CLASS = ['col-start-1', 'col-start-2', 'col-start-3', 'col-start-4'] as const;

/** 连线坐标系：viewBox 0 0 400 400，每宫 100 单位。 */
const CELL_UNITS = 100;
/** 同一落宫的多条飞线沿法向错开的间距（viewBox 单位），避免完全重叠。 */
const FLIGHT_LINE_SPACING = 3.5;
/** 飞线弯向中宫的程度：二次曲线控制点自线段中点向命盘中心移动的比例。 */
const FLIGHT_CURVE_PULL = 0.3;
const CHART_CENTER_UNITS = 2 * CELL_UNITS;

type LineKind = 'triangle' | 'opposite' | 'flight';

/** 0–400 坐标 → 百分比，用于以 HTML 圆点标注连线端点（避免 SVG 非等比缩放把圆压成椭圆）。 */
const toPercent = (value: number) => `${value / 4}%`;

interface Point {
    x: number;
    y: number;
}

interface ChartLine {
    key: string;
    kind: LineKind;
    from: Point;
    to: Point;
    /** 飞线的四化（决定颜色）。 */
    mutagen?: string;
}

/** 锚点取宫位朝向中宫的一侧：角宫取内角，边宫取内侧边中点。 */
function getAnchorPoint({ row, col }: GridSlot): Point {
    const isTop = row === 0;
    const isBottom = row === 3;
    const isLeft = col === 0;
    const isRight = col === 3;
    const centerX = (col + 0.5) * CELL_UNITS;
    const centerY = (row + 0.5) * CELL_UNITS;
    const innerX = isLeft ? CELL_UNITS : isRight ? 3 * CELL_UNITS : centerX;
    const innerY = isTop ? CELL_UNITS : isBottom ? 3 * CELL_UNITS : centerY;
    if ((isTop || isBottom) && (isLeft || isRight)) return { x: innerX, y: innerY };
    if (isTop || isBottom) return { x: centerX, y: innerY };
    return { x: innerX, y: centerY };
}

/**
 * 飞线路径：弯向中宫的二次曲线，与三方四正的直线区分，
 * 也避免同侧相邻宫位之间的飞线与宫格边框重合。
 */
function getFlightPath(from: Point, to: Point): string {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const controlX = midX + (CHART_CENTER_UNITS - midX) * FLIGHT_CURVE_PULL;
    const controlY = midY + (CHART_CENTER_UNITS - midY) * FLIGHT_CURVE_PULL;
    return `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;
}

/** 把线段沿法向平移 offset（viewBox 单位）。 */
function offsetSegment(from: Point, to: Point, offset: number): { from: Point; to: Point } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * offset;
    const ny = (dx / length) * offset;
    return { from: { x: from.x + nx, y: from.y + ny }, to: { x: to.x + nx, y: to.y + ny } };
}

const TOOLBAR_BUTTON_CLASS = 'inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground';

/**
 * 紫微斗数命盘 12 宫位图
 */
export function ZiweiChartGrid({
    canonicalChart: inputChart,
    horoscopeHighlight = {},
    horoscopeInfo,
    subjectName,
    birthTime,
    birthPlace,
    selectedPalace: controlledSelectedPalace,
    onSelectedPalaceChange,
    showAdjStars: controlledShowAdjStars,
    variant = 'natal',
    flightOverlay = null,
    showPalaceDetail = false,
    interaction,
}: ZiweiChartProps) {
    // Slim persisted tool results omit the optional index. Place their returned
    // palaces by branch; iztro's index starts at 寅. No chart is recalculated.
    const canonicalChart = useMemo(() => ({ ...inputChart, 十二宫位: inputChart.十二宫位.map(palace => ({ ...palace,
        宫位索引: palace.宫位索引 ?? (getBranchIndex(palace.干支.slice(-1)) + 10) % 12,
    })) }), [inputChart]);
    const lifePalaceIndex = canonicalChart.十二宫位.find(p => p.宫位 === '命宫')?.宫位索引 ?? null;
    // 默认选中命宫，显示三方四正
    const [uncontrolledSelectedPalace, setUncontrolledSelectedPalace] = useState<number | null | undefined>(undefined);
    const [uncontrolledShowAdjStars, setUncontrolledShowAdjStars] = useState(true); // 默认显示杂曜
    const showAdjStars = controlledShowAdjStars ?? uncontrolledShowAdjStars;
    const isFlying = variant === 'flying';

    const defaultSelectedPalace = typeof lifePalaceIndex === 'number' && lifePalaceIndex >= 0 ? lifePalaceIndex : null;
    const ownSelectedPalace = controlledSelectedPalace !== undefined
        ? controlledSelectedPalace
        : uncontrolledSelectedPalace === undefined ? defaultSelectedPalace : uncontrolledSelectedPalace;
    const activeSelectedPalace = interaction ? interaction.palaceIndices[0] ?? null : ownSelectedPalace;

    const selectPalace = (palaceIndex: number) => {
        if (interaction) {
            interaction.onPalaceSelect(palaceIndex);
            return;
        }
        const next = activeSelectedPalace === palaceIndex ? null : palaceIndex;
        if (controlledSelectedPalace === undefined) setUncontrolledSelectedPalace(next);
        onSelectedPalaceChange?.(next);
    };

    // 计算三方四正高亮（飞星模式改为飞线，不标三合/对宫）
    const showRelated = !isFlying && (!interaction || interaction.includeRelated);
    const relatedPalaces = useMemo(() => {
        if (activeSelectedPalace === null || !showRelated) return null;
        const { opposite, triangle } = getTriangleSquare(activeSelectedPalace);
        return { opposite, triangle: triangle.filter((index) => index !== activeSelectedPalace) };
    }, [activeSelectedPalace, showRelated]);

    const getRelation = (palaceIndex: number): '三合' | '对宫' | undefined => {
        if (!relatedPalaces || palaceIndex === activeSelectedPalace) return undefined;
        if (relatedPalaces.opposite === palaceIndex) return '对宫';
        return relatedPalaces.triangle.includes(palaceIndex) ? '三合' : undefined;
    };

    // 飞星：仅当飞化数据对应当前焦点宫时生效（避免异步计算期间错位）
    const activeFlights = isFlying && flightOverlay && flightOverlay.sourceIndex === activeSelectedPalace ? flightOverlay : null;
    const flightTagsByPalace = useMemo(() => {
        const tags = new Map<number, PalaceFlightTag[]>();
        for (const flight of activeFlights?.flights ?? []) {
            tags.set(flight.targetIndex, [...(tags.get(flight.targetIndex) ?? []), { mutagen: flight.mutagen, starName: flight.starName }]);
        }
        return tags;
    }, [activeFlights]);

    // 连线：三方四正为焦点宫 → 两个三合宫（实线）、→ 对宫（虚线）；飞星为飞出宫 → 各化落宫（四化色）
    const chartLines = useMemo((): ChartLine[] => {
        if (activeSelectedPalace === null) return [];
        const slotOf = (palaceIndex: number) => {
            const palace = canonicalChart.十二宫位.find((item) => item.宫位索引 === palaceIndex);
            return palace ? SLOT_BY_BRANCH.get(getBranchIndex(palace.干支.slice(-1))) : undefined;
        };
        const originSlot = slotOf(activeSelectedPalace);
        if (!originSlot) return [];
        const from = getAnchorPoint(originSlot);

        if (activeFlights) {
            const outgoing = activeFlights.flights.filter((flight) => flight.targetIndex !== activeFlights.sourceIndex);
            return outgoing.flatMap((flight) => {
                const slot = slotOf(flight.targetIndex);
                if (!slot) return [];
                const sameTarget = outgoing.filter((item) => item.targetIndex === flight.targetIndex);
                const position = sameTarget.indexOf(flight) - (sameTarget.length - 1) / 2;
                const segment = offsetSegment(from, getAnchorPoint(slot), position * FLIGHT_LINE_SPACING);
                return [{ key: `flight-${flight.mutagen}`, kind: 'flight' as const, mutagen: flight.mutagen, ...segment }];
            });
        }

        if (!relatedPalaces) return [];
        const targets: Array<{ index: number; kind: LineKind }> = [
            ...relatedPalaces.triangle.map((index) => ({ index, kind: 'triangle' as const })),
            { index: relatedPalaces.opposite, kind: 'opposite' as const },
        ];
        return targets.flatMap(({ index, kind }) => {
            const slot = slotOf(index);
            return slot ? [{ key: `${kind}-${index}`, kind, from, to: getAnchorPoint(slot) }] : [];
        });
    }, [activeSelectedPalace, activeFlights, canonicalChart.十二宫位, relatedPalaces]);
    // 三合三角形的第三边（两个三合宫之间）：以 path 绘制，与「焦点宫出发的三条连线」区分。
    const triangleLines = chartLines.filter((line) => line.kind === 'triangle');
    const triangleClosure = triangleLines.length === 2
        ? `M ${triangleLines[0].to.x} ${triangleLines[0].to.y} L ${triangleLines[1].to.x} ${triangleLines[1].to.y}`
        : null;
    const flightLines = chartLines.filter((line) => line.kind === 'flight');

    // 获取宫位高亮类型（多色支持）
    const getHighlightTypes = (palaceIndex: number) => {
        const types: string[] = [];
        if (horoscopeHighlight.decadalIndex === palaceIndex) types.push('decadal');
        if (horoscopeHighlight.yearlyIndex === palaceIndex) types.push('yearly');
        if (horoscopeHighlight.ageIndex === palaceIndex) types.push('age');
        if (horoscopeHighlight.monthlyIndex === palaceIndex) types.push('monthly');
        if (horoscopeHighlight.dailyIndex === palaceIndex) types.push('daily');
        return types;
    };

    // 生成宫位的流年流月信息
    const getFlowInfoForPalace = (palaceIndex: number) => {
        if (!horoscopeInfo) return undefined;

        const flowInfo: {
            decadal?: { stem: string; ages: string };
            yearly?: string;
            monthly?: string;
            daily?: string
        } = {};

        if (horoscopeInfo.decadal && horoscopeInfo.decadal.palace.index === palaceIndex) {
            flowInfo.decadal = {
                stem: horoscopeInfo.decadal.heavenlyStem,
                ages: `${horoscopeInfo.decadal.startAge}岁`,
            };
        }

        if (horoscopeInfo.yearly && horoscopeInfo.yearly.palaceIndex === palaceIndex) {
            flowInfo.yearly = horoscopeInfo.yearly.heavenlyStem;
        }

        if (horoscopeInfo.monthly && horoscopeInfo.monthly.palaceIndex === palaceIndex) {
            flowInfo.monthly = horoscopeInfo.monthly.heavenlyStem;
        }

        if (horoscopeInfo.daily && horoscopeInfo.daily.palaceIndex === palaceIndex) {
            flowInfo.daily = horoscopeInfo.daily.heavenlyStem;
        }

        return Object.keys(flowInfo).length > 0 ? flowInfo : undefined;
    };

    const focusedPalace = activeSelectedPalace === null
        ? undefined
        : canonicalChart.十二宫位.find((palace) => palace.宫位索引 === activeSelectedPalace);
    // 详情卡按「命 财 官 迁」的传统次序列出：焦点宫 −4、+4 两个三合宫，再列对宫
    const relatedPalaceList = relatedPalaces && activeSelectedPalace !== null
        ? [...relatedPalaces.triangle].sort((left, right) => (right - activeSelectedPalace + 12) % 12 - (left - activeSelectedPalace + 12) % 12)
            .concat(relatedPalaces.opposite)
            .flatMap((index) => {
                const palace = canonicalChart.十二宫位.find((item) => item.宫位索引 === index);
                return palace ? [{ palace, relation: getRelation(index) ?? '三合' }] : [];
            })
        : [];
    const endpointDots = activeFlights
        ? flightLines.map((line) => ({ key: line.key, point: line.to, className: `size-[5px] ${MUTAGEN_BADGE_CLASS[line.mutagen ?? ''] ?? 'bg-accent'}` }))
        : chartLines.length > 0
            ? [chartLines[0].from, ...chartLines.map((line) => line.to)].map((point, index) => ({
                key: `${point.x}-${point.y}-${index}`,
                point,
                className: `bg-accent ${index === 0 ? 'size-1.5' : 'size-[5px]'}`,
            }))
            : [];

    return (
        <div className={`${ZIWEI_CONTAINER_CLASS} w-full`}>
            {/* 工具栏：仅非受控杂曜显隐时显示（如对话嵌入）；结果页由页面菜单接管 */}
            {controlledShowAdjStars === undefined && (
                <div className="mb-2 flex justify-end">
                    <button
                        type="button"
                        onClick={() => setUncontrolledShowAdjStars(!uncontrolledShowAdjStars)}
                        aria-pressed={uncontrolledShowAdjStars}
                        className={TOOLBAR_BUTTON_CLASS}
                    >
                        {uncontrolledShowAdjStars ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        {uncontrolledShowAdjStars ? '隐藏杂曜' : '显示杂曜'}
                    </button>
                </div>
            )}

            {/* 4×4 命盘：中宫背景 → 连线 → 中宫文字（z-index 分层） */}
            <div className="relative grid grid-cols-4 grid-rows-4 gap-px overflow-hidden rounded-xl bg-border p-px @2xl/ziwei:rounded-[18px]">
                {GRID_SLOTS.map((slot) => {
                    const palace = canonicalChart.十二宫位.find((p) => getBranchIndex(p.干支.slice(-1)) === slot.branch);
                    if (!palace || typeof palace.宫位索引 !== 'number') return null;

                    const palaceIndex = palace.宫位索引;
                    const highlightTypes = getHighlightTypes(palaceIndex);
                    const relation = getRelation(palaceIndex);

                    return (
                        <div key={`palace-${slot.branch}`} className={`min-w-0 ${ROW_START_CLASS[slot.row]} ${COL_START_CLASS[slot.col]}`}>
                            <PalaceCard
                                palace={palace}
                                isSelected={interaction ? interaction.palaceIndices.includes(palaceIndex) : activeSelectedPalace === palaceIndex}
                                isLifePalace={palaceIndex === lifePalaceIndex}
                                isHighlighted={highlightTypes.length > 0 || relation !== undefined}
                                highlightTypes={highlightTypes}
                                isSanFangSiZheng={relation !== undefined}
                                relation={relation}
                                showAdjStars={showAdjStars || Boolean(interaction?.stars.some(star => star.palaceIndex === palaceIndex && star.group === '杂曜'))}
                                flowInfo={getFlowInfoForPalace(palaceIndex)}
                                flightTags={flightTagsByPalace.get(palaceIndex)}
                                isFlightSource={activeFlights?.sourceIndex === palaceIndex}
                                highlightedStars={interaction?.stars.filter(star => star.palaceIndex === palaceIndex)}
                                onStarSelect={interaction ? (group, starIndex) => interaction.onStarSelect(palaceIndex, group, starIndex) : undefined}
                                onClick={() => selectPalace(palaceIndex)}
                            />
                        </div>
                    );
                })}

                <div className="col-span-2 col-start-2 row-span-2 row-start-2 min-w-0 bg-panel">
                    <ZiweiChartCenter chart={canonicalChart} subjectName={subjectName} birthTime={birthTime} birthPlace={birthPlace} legend={variant} />
                </div>

                {chartLines.length > 0 && (
                    <svg
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
                        viewBox="0 0 400 400"
                        preserveAspectRatio="none"
                    >
                        {chartLines.map((line) => line.kind === 'flight' ? (
                            <path
                                key={line.key}
                                d={getFlightPath(line.from, line.to)}
                                fill="none"
                                className={MUTAGEN_STROKE_CLASS[line.mutagen ?? ''] ?? 'stroke-accent'}
                                strokeWidth={1.5}
                                strokeOpacity={0.9}
                                vectorEffect="non-scaling-stroke"
                            />
                        ) : (
                            <line
                                key={line.key}
                                x1={line.from.x}
                                y1={line.from.y}
                                x2={line.to.x}
                                y2={line.to.y}
                                className="stroke-accent"
                                strokeWidth={1.5}
                                strokeOpacity={0.75}
                                strokeDasharray={line.kind === 'opposite' ? '5 5' : undefined}
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}
                        {triangleClosure && (
                            <path
                                d={triangleClosure}
                                fill="none"
                                className="stroke-accent"
                                strokeWidth={1.5}
                                strokeOpacity={0.75}
                                vectorEffect="non-scaling-stroke"
                            />
                        )}
                    </svg>
                )}
                {/* 连线端点圆点：三方四正仅紧凑盘显示；飞线在完整盘也标出落点 */}
                {endpointDots.length > 0 && (
                    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 z-[1] ${activeFlights ? '' : '@2xl/ziwei:hidden'}`}>
                        {endpointDots.map(({ key, point, className }) => (
                            <span
                                key={key}
                                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${className}`}
                                style={{ left: toPercent(point.x), top: toPercent(point.y) }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* 图例 + 焦点宫详情：紧凑盘始终显示，完整盘按需显示详情 */}
            <div className={`mt-3 space-y-3 ${showPalaceDetail ? '' : '@2xl/ziwei:hidden'}`}>
                <div className="@2xl/ziwei:hidden">
                    <ZiweiChartLegend compact variant={variant} />
                </div>
                {focusedPalace && (
                    <ZiweiPalaceDetail
                        palace={focusedPalace}
                        related={relatedPalaceList}
                        showAdjStars={showAdjStars}
                    />
                )}
            </div>
        </div>
    );
}
