/**
 * 卦象显示组件（卦盘表格）
 *
 * 一行一爻，自上而下：爻位 · 六神 · 六亲干支 · 本卦爻 · 世应 · 动爻标记 · 变卦爻 · 变出 · 神煞。
 * 传统信息（六亲/六神/世应/用神/旺衰/空亡/神煞）按爻位与本卦逐行对齐。
 * 传统视图在窄容器（手机 / 对话命盘）收拢为无表头的逐爻栅格：动爻标记贴在爻线旁，变卦信息并入「变出」。
 * 'use client'：神煞展开需要本地状态，对话命盘中的 ChartTarget 需要点击交互。
 */
'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { LiuyaoYaoJSON } from 'taibu-core/liuyao';
import {
    type Yao,
    type Hexagram,
    type FullYaoInfo,
    type FullYaoInfoExtended,
    getHexagramBrief,
    WANG_SHUAI_LABELS,
    KONG_WANG_LABELS,
} from '@/lib/divination/liuyao';
import { parseTraditionalYaoPosition } from '@/lib/divination/liuyao-result-state';
import { YaoLine } from '@/components/liuyao/YaoLine';
import { wuxingTextClass } from '@/components/liuyao/wuxing-tone';
import { ChartTarget, isChartTargetSelected, type ChartInteraction } from '@/components/visualization/ChartTarget';

type YaoSource = FullYaoInfo | FullYaoInfoExtended | LiuyaoYaoJSON;

// 静态常量提取到组件外部，避免每次渲染重新创建
const YAO_LABELS = ['初', '二', '三', '四', '五', '上'];
const BAR_WIDTH: Record<NonNullable<HexagramDisplayProps['size']>, string> = {
    sm: 'w-12 @2xl:w-24',
    md: 'w-[50px] @2xl:w-24 @3xl:w-[132px]',
    lg: 'w-14 @2xl:w-36',
};
const HEAD_CELL = 'whitespace-nowrap py-3 pr-1.5 text-[0.8125rem] font-normal text-foreground-secondary @2xl:pr-2';
/** 传统视图：窄容器不显示列头（逐爻栅格自解释），宽容器恢复为表格列头。 */
const WIDE_HEAD_CELL = `hidden @2xl:table-cell ${HEAD_CELL}`;
/** 传统视图窄容器的卦名头：左本卦、右变出，宽容器回到对应爻线列的列头。 */
const NAME_HEAD_CELL = 'whitespace-nowrap p-0 font-normal @2xl:py-3 @2xl:pr-2 @2xl:text-center @2xl:text-[0.8125rem]';
const NAME_TEXT = '@2xl:font-display @2xl:text-[0.9375rem] @2xl:text-foreground';
/** 传统视图窄容器的逐爻栅格列：爻位 · 六神 · 六亲干支 · 爻线 · 世应 ·（变出）。 */
const NARROW_ROW_COLUMNS = {
    withChanged: 'grid-cols-[30px_28px_minmax(0,1fr)_60px_22px_76px]',
    baseOnly: 'grid-cols-[30px_28px_minmax(0,1fr)_60px_22px]',
};

interface HexagramDisplayProps {
    yaos: Yao[];
    hexagram: Hexagram;
    changedHexagram?: Hexagram;
    changedLines?: number[];
    showDetails?: boolean;
    size?: 'sm' | 'md' | 'lg';
    fullYaos?: FullYaoInfo[] | FullYaoInfoExtended[] | LiuyaoYaoJSON[];
    showTraditional?: boolean;
    yongShenPositions?: number[];
    interaction?: ChartInteraction;
    /** 卦宫名（如「离」），用于列头「天火同人 · 离宫」。 */
    palaces?: { base?: string; changed?: string };
    /** 表格底部左侧的附加内容（如互卦/错卦/综卦标签）。 */
    footer?: ReactNode;
}

interface RowView {
    label: string;
    liuShen: string;
    liuQin: string;
    naJia: string;
    wuXing: string;
    shiYing?: '世' | '应';
    wangShuai?: string;
    kongWang?: string;
    shenSha: string[];
    changedTo?: { liuQin: string; naJia: string; wuXing: string };
}

function sourcePosition(yao: YaoSource): number | null {
    if ('爻位' in yao) return parseTraditionalYaoPosition(yao.爻位);
    return typeof yao.position === 'number' ? yao.position : null;
}

function toRowView(yao: YaoSource): RowView {
    if ('爻位' in yao) {
        return {
            label: yao.爻位,
            liuShen: yao.六神,
            liuQin: yao.六亲,
            naJia: yao.纳甲,
            wuXing: yao.五行,
            shiYing: yao.世应 === '世' || yao.世应 === '应' ? yao.世应 : undefined,
            wangShuai: yao.旺衰,
            kongWang: yao.空亡,
            shenSha: Array.isArray(yao.神煞) ? yao.神煞 : [],
            changedTo: yao.变爻 ? { liuQin: yao.变爻.六亲, naJia: yao.变爻.纳甲, wuXing: yao.变爻.五行 } : undefined,
        };
    }
    const extended = 'strength' in yao ? yao : undefined;
    return {
        label: `${YAO_LABELS[yao.position - 1] ?? yao.position}爻`,
        liuShen: yao.liuShen,
        liuQin: yao.liuQin,
        naJia: yao.naJia,
        wuXing: yao.wuXing,
        shiYing: yao.isShiYao ? '世' : yao.isYingYao ? '应' : undefined,
        wangShuai: extended ? WANG_SHUAI_LABELS[extended.strength.wangShuai] : undefined,
        kongWang: extended && extended.kongWangState !== 'not_kong' ? KONG_WANG_LABELS[extended.kongWangState] : undefined,
        shenSha: extended?.shenSha ?? [],
        changedTo: extended?.changedYao ? { liuQin: extended.changedYao.liuQin, naJia: extended.changedYao.naJia, wuXing: extended.changedYao.wuXing } : undefined,
    };
}

/** 按爻位对齐传统信息；来源缺少爻位时回退为自下而上的下标顺序。 */
function pairByPosition(yaos: Yao[], fullYaos: readonly YaoSource[] | undefined): Map<number, RowView> {
    const rows = new Map<number, RowView>();
    if (!fullYaos?.length) return rows;
    const positioned = fullYaos.map((yao) => [sourcePosition(yao), yao] as const);
    if (positioned.every(([position]) => typeof position === 'number')) {
        for (const [position, yao] of positioned) rows.set(position as number, toRowView(yao));
        return rows;
    }
    yaos.forEach((yao, index) => {
        const source = fullYaos[index];
        if (source) rows.set(yao.position, toRowView(source));
    });
    return rows;
}

function Bar({ yang, tone, width }: { yang: boolean; tone: string; width: string }) {
    const segment = `block h-2 rounded-[2px] @2xl:h-2.5 @2xl:rounded-[3px] ${tone}`;
    if (yang) return <span className={`${segment} ${width}`} />;
    return (
        <span className={`flex gap-2.5 @2xl:gap-[18px] ${width}`}>
            <span className={`flex-1 ${segment}`} />
            <span className={`flex-1 ${segment}`} />
        </span>
    );
}

/** 动爻标记：老阴 ×、老阳 ○；读屏读出完整含义。 */
function MovingMark({ yang, className }: { yang: boolean; className: string }) {
    const label = yang ? '老阳，动爻' : '老阴，动爻';
    return (
        <span title={label} className={className}>
            <span aria-hidden="true">{yang ? '○' : '×'}</span>
            <span className="sr-only">{label}</span>
        </span>
    );
}

/** 干支：窄容器按五行着色，宽容器随所在列取色（className 覆盖）。 */
function GanZhi({ naJia, wuXing, className = '' }: { naJia: string; wuXing: string; className?: string }) {
    return <span className={`${wuxingTextClass(wuXing)} @2xl:font-display ${className}`}>{naJia}{wuXing}</span>;
}

export function HexagramDisplay({
    yaos,
    hexagram,
    changedHexagram,
    changedLines = [],
    showDetails = true,
    size = 'md',
    fullYaos,
    showTraditional = false,
    yongShenPositions = [],
    interaction,
    palaces,
    footer,
}: HexagramDisplayProps) {
    const displayYaos = useMemo(() => [...yaos].sort((a, b) => b.position - a.position), [yaos]);
    const rows = useMemo(() => pairByPosition(yaos, fullYaos), [fullYaos, yaos]);
    const traditional = showTraditional && rows.size > 0;
    const showChanged = Boolean(changedHexagram && (changedLines.length > 0 || interaction));
    const hasShenSha = traditional && [...rows.values()].some((row) => row.shenSha.length > 0);
    const hasMoving = displayYaos.some((yao) => yao.change === 'changing');
    const [expandedShenShaRows, setExpandedShenShaRows] = useState<Set<number>>(() => new Set());
    const barWidth = BAR_WIDTH[size];

    const toggleShenShaRow = (position: number) => {
        setExpandedShenShaRows((prev) => {
            const next = new Set(prev);
            if (next.has(position)) next.delete(position);
            else next.add(position);
            return next;
        });
    };

    const baseName = <ChartTarget interaction={interaction} id="liuyao:hexagram:base">{hexagram.name}</ChartTarget>;
    const changedName = changedHexagram && <ChartTarget interaction={interaction} id="liuyao:hexagram:changed">{changedHexagram.name}</ChartTarget>;
    // 传统视图：窄容器只保留逐爻栅格，变卦爻列与动爻列只在宽容器显示（变卦信息由「变出」承担）。
    const wideOnlyCell = traditional ? 'hidden @2xl:table-cell' : '';
    const narrowRowColumns = showChanged ? NARROW_ROW_COLUMNS.withChanged : NARROW_ROW_COLUMNS.baseOnly;

    return (
        <div className="@container flex flex-col gap-2">
            <div className="overflow-x-auto">
                <table className={`w-full border-collapse text-sm ${traditional ? 'block @2xl:table' : ''}`} data-hexagram="base" data-chart-selected={isChartTargetSelected(interaction, 'liuyao:hexagram:base') || undefined}>
                    <thead className={traditional ? 'block @2xl:table-header-group' : undefined}>
                        <tr className={traditional ? 'flex items-baseline justify-between gap-3 px-2 pb-2 text-xs text-foreground-secondary @2xl:table-row @2xl:p-0' : undefined}>
                            <th scope="col" className={`${traditional ? WIDE_HEAD_CELL : HEAD_CELL} text-left @2xl:w-[60px]`}>爻位</th>
                            {traditional && <th scope="col" className={`${WIDE_HEAD_CELL} text-left @2xl:w-[60px]`}>六神</th>}
                            {traditional && <th scope="col" className={`${WIDE_HEAD_CELL} text-left @2xl:w-[120px] @3xl:w-[148px]`}>六亲 · 干支</th>}
                            <th scope="col" className={traditional ? `${NAME_HEAD_CELL} text-left` : `${HEAD_CELL} text-center`}>
                                <span className={traditional ? NAME_TEXT : 'font-display text-foreground @2xl:text-[0.9375rem]'}>{baseName}</span>
                                {palaces?.base && <span className={traditional ? undefined : 'hidden @2xl:inline'}> · {palaces.base}宫</span>}
                            </th>
                            {traditional && <th scope="col" className="hidden @2xl:table-cell @2xl:w-[52px]"><span className="sr-only">世应</span></th>}
                            <th scope="col" className={traditional ? 'hidden @2xl:table-cell @2xl:w-11' : 'w-5 @2xl:w-11'}><span className="sr-only">动爻</span></th>
                            {showChanged && (
                                <th scope="col" className={traditional ? `${NAME_HEAD_CELL} text-right` : `${HEAD_CELL} text-center`} data-hexagram="changed" data-chart-selected={isChartTargetSelected(interaction, 'liuyao:hexagram:changed') || undefined}>
                                    {traditional && <span className="@2xl:hidden">变出 · </span>}
                                    <span className={traditional ? NAME_TEXT : 'font-display text-foreground @2xl:text-[0.9375rem]'}>{changedName}</span>
                                    {palaces?.changed && <span> · {palaces.changed}宫</span>}
                                </th>
                            )}
                            {showChanged && traditional && <th scope="col" className={`${WIDE_HEAD_CELL} text-left @2xl:w-24`}>变出</th>}
                            {hasShenSha && <th scope="col" className={`${HEAD_CELL} hidden text-left @4xl:table-cell`}>神煞</th>}
                        </tr>
                    </thead>
                    <tbody className={traditional ? 'flex flex-col gap-0.5 @2xl:table-row-group' : undefined}>
                        {displayYaos.map((yao) => {
                            const row = rows.get(yao.position);
                            const isChanging = yao.change === 'changing';
                            const isShi = traditional && row?.shiYing === '世';
                            const isYongShen = yongShenPositions.includes(yao.position);
                            const changedType: Yao['type'] = changedLines.includes(yao.position) ? (yao.type === 1 ? 0 : 1) : yao.type;
                            const isChangedLine = changedLines.includes(yao.position);
                            const shenSha = row?.shenSha ?? [];
                            const isShenShaExpanded = expandedShenShaRows.has(yao.position);
                            const rowClass = traditional
                                ? `grid ${narrowRowColumns} items-center gap-1.5 rounded-[10px] px-2 py-[9px] @2xl:table-row @2xl:h-[58px] @2xl:rounded-none @2xl:border-t-[0.5px] @2xl:border-border @2xl:p-0 ${isShi ? 'bg-accent-light' : ''}`
                                : 'h-12 border-t-[0.5px] border-border @2xl:h-[58px]';
                            const labelClass = traditional
                                ? `text-[0.6875rem] text-foreground-tertiary @2xl:pr-2 @2xl:text-sm ${isShi ? '@2xl:pl-2 @2xl:text-accent-strong' : '@2xl:text-foreground-secondary'}`
                                : `pr-1.5 text-[0.8125rem] @2xl:pr-2 @2xl:text-sm ${isChanging ? 'text-accent-strong' : 'text-foreground-secondary'}`;
                            // 宽容器的变卦爻列已用黏土色标出动爻，本卦爻保持墨色；窄容器无变卦爻列，本卦动爻直接着色。
                            const baseTone = isChanging ? (traditional ? 'bg-accent @2xl:bg-foreground' : 'bg-accent') : 'bg-foreground';
                            return (
                                <tr
                                    key={yao.position}
                                    data-chart-selected={isChartTargetSelected(interaction, 'liuyao:line:' + yao.position) || undefined}
                                    className={rowClass}
                                >
                                    <td className={`whitespace-nowrap ${labelClass}`}>
                                        <ChartTarget interaction={interaction} id={'liuyao:line:' + yao.position}>{traditional && row ? row.label : YAO_LABELS[yao.position - 1]}</ChartTarget>
                                    </td>
                                    {traditional && <td className="whitespace-nowrap text-xs text-foreground-secondary @2xl:pr-2 @2xl:text-sm @2xl:text-foreground">{row?.liuShen}</td>}
                                    {traditional && (
                                        <td className="min-w-0 text-[0.8125rem] @2xl:py-1.5 @2xl:pr-2 @2xl:text-sm">
                                            {row && (
                                                <div className="flex flex-col gap-px @2xl:flex-row @2xl:flex-wrap @2xl:items-baseline @2xl:gap-x-1.5 @2xl:gap-y-0.5">
                                                    <span className="whitespace-nowrap">
                                                        <span className={isYongShen ? '@2xl:font-medium' : ''}>{row.liuQin}</span> <GanZhi naJia={row.naJia} wuXing={row.wuXing} className="@2xl:text-foreground" />
                                                    </span>
                                                    {(isYongShen || row.kongWang || row.wangShuai) && (
                                                        <span className={`flex-wrap items-center gap-1 text-[0.625rem] leading-tight text-foreground-tertiary @2xl:flex @2xl:text-[0.6875rem] ${isYongShen || row.kongWang ? 'flex' : 'hidden'}`}>
                                                            {isYongShen && <span className="text-accent-strong @2xl:rounded @2xl:bg-accent @2xl:px-[5px] @2xl:py-px @2xl:text-on-accent">用神</span>}
                                                            {row.kongWang && <span className="@2xl:text-foreground-secondary">{row.kongWang}</span>}
                                                            {/* 旺衰只在宽容器显示，窄容器保持与设计稿一致的两行以内 */}
                                                            {row.wangShuai && <span className="hidden @2xl:inline">{row.wangShuai}</span>}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    )}
                                    <td className={traditional ? '@2xl:px-1' : 'px-1'}>
                                        <div className={`flex items-center ${traditional ? 'gap-1 @2xl:justify-center' : 'justify-center'}`}>
                                            <Bar yang={yao.type === 1} tone={baseTone} width={barWidth} />
                                            {traditional && isChanging && <MovingMark yang={yao.type === 1} className="text-xs leading-none text-accent @2xl:hidden" />}
                                        </div>
                                    </td>
                                    {traditional && (
                                        <td className="text-center">
                                            {row?.shiYing === '世' && <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent text-[0.6875rem] text-on-accent @2xl:size-[26px] @2xl:bg-foreground @2xl:font-display @2xl:text-sm @2xl:text-background">世</span>}
                                            {row?.shiYing === '应' && <span className="inline-flex size-5 items-center justify-center rounded-full border-[0.5px] border-border-hover text-[0.6875rem] text-foreground-secondary @2xl:size-auto @2xl:rounded-none @2xl:border-0 @2xl:font-display @2xl:text-[0.9375rem]">应</span>}
                                        </td>
                                    )}
                                    <td className={`text-center ${wideOnlyCell}`}>
                                        {isChanging && <MovingMark yang={yao.type === 1} className="font-display text-lg leading-none text-accent" />}
                                    </td>
                                    {showChanged && (
                                        <td className={`px-1 ${wideOnlyCell}`} data-chart-selected={traditional ? undefined : isChartTargetSelected(interaction, 'liuyao:changed:line:' + yao.position) || undefined}>
                                            <div className="flex items-center justify-center gap-2">
                                                {!traditional && interaction && <span className="text-[11px] text-foreground-tertiary"><ChartTarget interaction={interaction} id={'liuyao:changed:line:' + yao.position}>{YAO_LABELS[yao.position - 1]}</ChartTarget></span>}
                                                <Bar yang={changedType === 1} tone={isChangedLine ? 'bg-accent' : 'bg-border-hover'} width={barWidth} />
                                            </div>
                                        </td>
                                    )}
                                    {showChanged && traditional && (
                                        <td className="whitespace-nowrap text-xs @2xl:pr-2 @2xl:text-sm" data-chart-selected={isChartTargetSelected(interaction, 'liuyao:changed:line:' + yao.position) || undefined}>
                                            <ChartTarget interaction={interaction} id={'liuyao:changed:line:' + yao.position}>
                                                {isChanging && row?.changedTo ? (
                                                    <span className="inline-flex items-center gap-[3px] @2xl:text-accent-strong">
                                                        <span aria-hidden="true" className="text-accent @2xl:hidden">→</span>
                                                        <span>{row.changedTo.liuQin} <GanZhi naJia={row.changedTo.naJia} wuXing={row.changedTo.wuXing} className="@2xl:text-accent-strong" /></span>
                                                    </span>
                                                ) : <span className="text-foreground-tertiary @2xl:text-foreground-secondary">—</span>}
                                            </ChartTarget>
                                        </td>
                                    )}
                                    {hasShenSha && (
                                        <td className="hidden py-1.5 text-[11px] text-foreground-secondary @4xl:table-cell">
                                            {shenSha.length > 0 ? (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="leading-4">{isShenShaExpanded ? shenSha.join('、') : shenSha[0]}</span>
                                                    {shenSha.length > 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleShenShaRow(yao.position)}
                                                            className="shrink-0 rounded border-[0.5px] border-border-hover px-1 py-px text-[10px] text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"
                                                        >
                                                            {isShenShaExpanded ? '收起' : `+${shenSha.length - 1}`}
                                                        </button>
                                                    )}
                                                </div>
                                            ) : <span className="text-foreground-tertiary">—</span>}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {(footer || hasMoving || (showDetails && !traditional)) && (
                <div className={traditional
                    ? 'flex flex-wrap items-center gap-1.5 px-2 pt-1 text-xs text-foreground-secondary @2xl:gap-x-5 @2xl:gap-y-2 @2xl:border-t-[0.5px] @2xl:border-border @2xl:px-0 @2xl:pt-3.5 @2xl:text-[0.8125rem]'
                    : 'flex flex-wrap items-center gap-x-5 gap-y-2 border-t-[0.5px] border-border pt-3.5 text-[0.8125rem] text-foreground-secondary'}
                >
                    {footer}
                    {showDetails && !traditional && <span>{getHexagramBrief(hexagram.name)}</span>}
                    {hasMoving && (
                        <span className={`ml-auto flex gap-x-3 ${traditional ? 'text-[0.6875rem] text-foreground-tertiary @2xl:text-[0.8125rem] @2xl:text-foreground-secondary' : ''}`}>
                            <span>× 老阴动</span>
                            <span>○ 老阳动</span>
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

// 小型卦象预览
export function HexagramPreview({ hexagram, yaos }: { hexagram: Hexagram; yaos: Yao[] }) {
    const displayYaos = [...yaos].reverse();

    return (
        <div className="flex items-center gap-3">
            <div className="flex flex-col gap-0.5">
                {displayYaos.map((yao) => (
                    <YaoLine key={yao.position} yao={yao} size="sm" />
                ))}
            </div>
            <span className="font-display text-sm text-foreground">{hexagram.name}</span>
        </div>
    );
}
