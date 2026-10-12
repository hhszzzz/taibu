/**
 * 奇门遁甲九宫格组件
 *
 * 'use client'：宫位点选回调与 Agent 视图的 ChartTarget 交互都依赖浏览器事件。
 *
 * 同一组件同时用于结果页与聊天 Agent（CanonicalChartView，约 480px 宽），
 * 因此宫格尺寸按容器宽度（@container）而非视口切换紧凑 / 宽松两档。
 */
'use client';

import type { QimenPalaceJSON } from 'taibu-core/qimen';
import { ChartTarget, isChartTargetSelected, type ChartInteraction } from '@/components/visualization/ChartTarget';
import {
    CENTER_PALACE_INDEX,
    LUOSHU_ORDER,
    findZhiShiPalaceIndex,
    formatJuLabel,
    getCenterHostNote,
    getElementTextClass,
    getHostedStarLabel,
    getPalaceCellTags,
    getPalaceDirection,
    getPalaceShortName,
    getShortStarName,
    getStemTextClass,
    isPlaceholder,
    isZhiFuPalace,
    isZhiShiPalace,
    type PalaceTag,
} from './qimen-display';

interface QimenGridProps {
    palaces: QimenPalaceJSON[];
    /** 十干月令旺衰（干 → 旺/相/休/囚/死），用于天地盘干的提示文字 */
    monthPhaseMap?: Record<string, string>;
    /** 中宫底部的局式标注（Agent 视图没有标题）；结果页标题已含局式，不传。 */
    ju?: string;
    interaction?: ChartInteraction;
    /** 值使门（如「死门」）。提供时标注值使宫，并在未指定选中宫时默认高亮该宫 */
    zhiShi?: string;
    /** 结果页受控的选中宫位序号（1-9） */
    selectedPalace?: number | null;
    /** 结果页点选宫位；Agent 视图使用 interaction，二者同时存在时以 interaction 为准 */
    onPalaceSelect?: (palaceIndex: number) => void;
}

const CELL_BASE = 'relative min-w-0 min-h-[118px] @xl:min-h-[172px] @3xl:min-h-[208px] text-left transition-colors';
const CELL_SELECTED = 'bg-accent-light ring-2 ring-inset ring-accent';
const CELL_MARKED = 'bg-surface ring-1 ring-inset ring-accent/50';
const CELL_IDLE = 'bg-surface';

function buildStemTitle(stem: string, monthPhaseMap: Record<string, string> | undefined, layer: string): string {
    const phase = monthPhaseMap?.[stem.charAt(0)];
    return phase ? `${layer} ${stem} · 月令${phase}` : `${layer} ${stem}`;
}

function TagChip({ tag, className = '' }: { tag: PalaceTag; className?: string }) {
    return (
        <span
            className={`inline-flex items-center rounded px-1 text-[0.5625rem] leading-[14px] whitespace-nowrap @xl:px-[7px] @xl:py-0.5 @xl:text-[11px] @xl:leading-4 ${
                tag.emphasis ? 'bg-accent text-on-accent' : 'bg-background-secondary text-foreground-secondary'
            } ${className}`}
        >
            {tag.label}
        </span>
    );
}

function CenterPalace({
    palace,
    palaces,
    ju,
    interaction,
}: {
    palace: QimenPalaceJSON;
    palaces: readonly QimenPalaceJSON[];
    ju?: string;
    interaction?: ChartInteraction;
}) {
    const hostNote = getCenterHostNote(palaces);
    const stems = [palace.天盘天干, palace.地盘天干].filter(stem => !isPlaceholder(stem));
    return (
        <span className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center @xl:gap-2.5 @xl:p-4">
            <span className="text-[0.6875rem] text-foreground-secondary @xl:text-xs">
                <ChartTarget interaction={interaction} id={`qimen:palace:${CENTER_PALACE_INDEX}`}>中五宫</ChartTarget>
            </span>
            {stems.length > 0 && (
                <span className="flex items-baseline gap-1 font-display text-xl leading-none @xl:text-[28px]">
                    {stems.map((stem, index) => (
                        <span key={`${stem}-${index}`} className={getStemTextClass(stem)}>{stem}</span>
                    ))}
                </span>
            )}
            {hostNote && (
                <span className="text-[0.625rem] leading-relaxed text-foreground-secondary @xl:text-xs">
                    {hostNote.subject}
                    <br />
                    {hostNote.target}
                </span>
            )}
            {ju && <span className="text-[0.625rem] text-foreground-tertiary @xl:text-xs">{formatJuLabel(ju)}</span>}
        </span>
    );
}

function OuterPalace({
    palace,
    zhiShi,
    monthPhaseMap,
    interaction,
    highlighted,
}: {
    palace: QimenPalaceJSON;
    zhiShi?: string;
    monthPhaseMap?: Record<string, string>;
    interaction?: ChartInteraction;
    highlighted: boolean;
}) {
    const id = `qimen:palace:${palace.宫位序号}`;
    const tags = getPalaceCellTags(palace, zhiShi);
    const hostedStar = getHostedStarLabel(palace.寄星);
    const direction = getPalaceDirection(palace);
    const headerTone = highlighted ? 'text-accent-strong' : '';

    return (
        <span className="flex h-full flex-col gap-0.5 px-[7px] py-1.5 @xl:gap-1 @xl:px-4 @xl:py-3.5">
            {/* 左上八神 · 右上宫位 */}
            <span className="flex items-baseline justify-between gap-1">
                <span className={`truncate text-[0.6875rem] @xl:text-[13px] ${headerTone || 'text-foreground-secondary'} ${isZhiFuPalace(palace) ? 'font-medium' : ''}`}>
                    <ChartTarget interaction={interaction} id={`${id}:八神`}>{palace.八神}</ChartTarget>
                </span>
                <span className={`shrink-0 text-[0.625rem] @xl:text-xs ${headerTone || 'text-foreground-tertiary'}`}>
                    <ChartTarget interaction={interaction} id={id}>
                        {getPalaceShortName(palace)}
                        {direction && <span className="hidden @xl:inline"> · {direction}</span>}
                    </ChartTarget>
                </span>
            </span>

            {/* 中：九星 / 八门；右：天盘干 over 地盘干 */}
            <span className="grid flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 font-display">
                <span className="flex min-w-0 flex-col @xl:gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-1">
                        <span className={`text-[0.9375rem] leading-tight @xl:text-[17px] ${getElementTextClass(palace.九星五行)}`}>
                            <ChartTarget interaction={interaction} id={`${id}:九星`}>{getShortStarName(palace.九星)}</ChartTarget>
                        </span>
                        {hostedStar && (
                            <span className="truncate font-sans text-[0.625rem] text-foreground-secondary @xl:text-[13px]">
                                <span className="hidden @xl:inline">· </span>{hostedStar}
                            </span>
                        )}
                    </span>
                    <span className={`text-[0.9375rem] leading-tight @xl:text-[26px] ${getElementTextClass(palace.八门五行)}`}>
                        <ChartTarget interaction={interaction} id={`${id}:八门`}>{palace.八门}</ChartTarget>
                    </span>
                </span>
                <span className="flex flex-col items-end @xl:items-center">
                    <span className="flex items-baseline gap-0.5 leading-tight">
                        <span
                            className={`text-[0.9375rem] @xl:text-2xl ${getStemTextClass(palace.天盘天干, palace.天盘天干五行)}`}
                            title={buildStemTitle(palace.天盘天干, monthPhaseMap, '天盘')}
                        >
                            <ChartTarget interaction={interaction} id={`${id}:天盘天干`}>{palace.天盘天干}</ChartTarget>
                        </span>
                        {palace.寄天盘干?.map(stem => (
                            <span key={stem} className={`text-[0.6875rem] @xl:text-sm ${getStemTextClass(stem)}`}>{stem}</span>
                        ))}
                    </span>
                    <span aria-hidden className="my-0.5 h-px w-3.5 bg-border-hover @xl:my-1.5 @xl:w-[18px]" />
                    <span className="flex items-baseline gap-0.5 leading-tight">
                        <span
                            className={`text-[0.8125rem] @xl:text-xl ${getStemTextClass(palace.地盘天干, palace.地盘天干五行)}`}
                            title={buildStemTitle(palace.地盘天干, monthPhaseMap, '地盘')}
                        >
                            <ChartTarget interaction={interaction} id={`${id}:地盘天干`}>{palace.地盘天干}</ChartTarget>
                        </span>
                        {palace.寄地盘干?.map(stem => (
                            <span key={stem} className={`text-[0.6875rem] @xl:text-sm ${getStemTextClass(stem)}`}>{stem}</span>
                        ))}
                    </span>
                </span>
            </span>

            {/* 底部状态标签 */}
            <span className="flex min-h-3.5 flex-wrap gap-0.5 @xl:min-h-5 @xl:gap-1.5">
                {tags.map(tag => <TagChip key={tag.label} tag={tag} />)}
            </span>
        </span>
    );
}

export function QimenGrid({ palaces, monthPhaseMap, ju, interaction, zhiShi, selectedPalace, onPalaceSelect }: QimenGridProps) {
    const palaceMap = new Map(palaces.map(palace => [palace.宫位序号, palace]));
    const selectable = !interaction && !!onPalaceSelect;
    // Agent 视图的选中态由 interaction 驱动；结果页未显式选择时默认高亮值使宫
    const highlightedPalace = interaction ? undefined : (selectedPalace ?? findZhiShiPalaceIndex(palaces, zhiShi));

    return (
        <div className="@container w-full">
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[14px] border-[0.5px] border-border bg-border @xl:rounded-2xl">
                {LUOSHU_ORDER.map((num) => {
                    const palace = palaceMap.get(num);
                    if (!palace) return <div key={num} className={`${CELL_BASE} ${CELL_IDLE}`} />;

                    const isCenter = num === CENTER_PALACE_INDEX;
                    const chartSelected = isChartTargetSelected(interaction, `qimen:palace:${num}`);
                    const highlighted = chartSelected || highlightedPalace === num;
                    const marked = !isCenter && (isZhiFuPalace(palace) || isZhiShiPalace(palace, zhiShi));
                    const tone = highlighted ? CELL_SELECTED : isCenter ? 'bg-panel' : marked ? CELL_MARKED : CELL_IDLE;
                    const title = palace.格局?.length ? `格局：${palace.格局.join('、')}` : undefined;
                    const content = isCenter
                        ? <CenterPalace palace={palace} palaces={palaces} ju={ju} interaction={interaction} />
                        : <OuterPalace palace={palace} zhiShi={zhiShi} monthPhaseMap={monthPhaseMap} interaction={interaction} highlighted={highlighted} />;

                    if (selectable) {
                        return (
                            <button
                                key={num}
                                type="button"
                                aria-pressed={highlighted}
                                title={title}
                                onClick={() => onPalaceSelect?.(num)}
                                className={`${CELL_BASE} ${tone} focus-visible:outline-offset-[-3px] ${highlighted ? '' : 'hover:bg-background-secondary'}`}
                            >
                                {content}
                            </button>
                        );
                    }

                    return (
                        <div
                            key={num}
                            data-chart-selected={chartSelected || undefined}
                            title={title}
                            className={`${CELL_BASE} ${tone}`}
                        >
                            {content}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
