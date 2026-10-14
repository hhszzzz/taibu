/**
 * 大六壬天地盘宫格组件
 *
 * 4x4 外圈十二宫（巳午未申 / 辰·酉 / 卯·戌 / 寅丑子亥），中心 2x2 显示课名、日局与月将加时。
 * 尺寸按容器宽度（@container）切换，结果页与聊天 Agent 窄栏共用。
 */
import type { DaliurenCanonicalJSON } from 'taibu-core/daliuren';
import { ChartTarget, isChartTargetSelected, type ChartInteraction } from '@/components/visualization/ChartTarget';
import {
    TIANDIPAN_GRID_POSITIONS,
    getGanZhiTextClass,
    getHourBranch,
    getPalaceCornerText,
    getPalaceTags,
    parseKeShi,
    type DaliurenCellTag,
} from './daliuren-display';

type Palace = DaliurenCanonicalJSON['天地盘'][number];

interface TianDiPanGridProps {
    result: DaliurenCanonicalJSON;
    interaction?: ChartInteraction;
}

const CELL_TONE = {
    first: 'bg-accent-soft ring-2 ring-inset ring-accent',
    transmission: 'bg-accent-soft ring-1 ring-inset ring-accent/60',
    idle: 'bg-surface',
} as const;

function CellTag({ tag, extra }: { tag: DaliurenCellTag; extra: boolean }) {
    return (
        <span
            className={`${extra ? 'hidden @xl:inline-flex' : 'inline-flex'} items-center rounded px-1 text-[0.5625rem] leading-[14px] whitespace-nowrap @xl:px-[5px] @xl:text-[0.6875rem] @xl:leading-4 ${
                tag.emphasis ? 'bg-accent text-on-accent' : 'bg-background-tertiary text-foreground-secondary'
            }`}
        >
            {tag.label}
        </span>
    );
}

function PalaceCell({
    palace,
    index,
    row,
    col,
    chart,
    kongSet,
    interaction,
}: {
    palace: Palace;
    index: number;
    row: number;
    col: number;
    chart: DaliurenCanonicalJSON;
    kongSet: ReadonlySet<string>;
    interaction?: ChartInteraction;
}) {
    const id = 'daliuren:palace:' + index;
    const tags = getPalaceTags(palace, chart);
    const transmissionIndex = chart.三传.findIndex(step => step.地支 === palace.天盘);
    const tone = transmissionIndex === 0 ? CELL_TONE.first : transmissionIndex > 0 ? CELL_TONE.transmission : CELL_TONE.idle;
    const corner = getPalaceCornerText(palace, kongSet);
    const heavenKong = kongSet.has(palace.天盘);
    const phase = [palace.旺衰, palace.长生十二神 !== '-' ? palace.长生十二神 : ''].filter(Boolean).join(' · ');

    return (
        <div
            data-chart-selected={isChartTargetSelected(interaction, id) || undefined}
            style={{ gridRow: row, gridColumn: col }}
            className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr_auto_auto] gap-x-1 px-[5px] py-1 @xl:grid-rows-[auto_1fr_auto] @xl:px-2.5 @xl:py-2 ${tone}`}
        >
            {/* 左上：地盘 · 遁干（旬空标「空」） */}
            <span className={`min-w-0 truncate text-[0.59375rem] leading-[14px] @xl:text-[0.6875rem] @xl:leading-4 ${corner.isKong ? 'text-accent' : 'text-foreground-tertiary'}`}>
                <ChartTarget interaction={interaction} id={id + ':地盘'}>{palace.地盘}</ChartTarget>
                {corner.dunGan && ` · ${corner.dunGan}`}
            </span>
            {/* 右上：三传 / 干上 / 支上 / 贵人，紧凑档只显示首个 */}
            <span className="flex items-start justify-end gap-0.5">
                {/* ChartTarget 按钮继承父级字号（font: inherit），字号需设在外层 */}
                {interaction && <span className="text-[10px] leading-[14px] text-foreground-secondary"><ChartTarget interaction={interaction} id={id}>{palace.地盘}宫</ChartTarget></span>}
                {tags.map((tag, tagIndex) => <CellTag key={tag.label} tag={tag} extra={tagIndex > 0} />)}
            </span>
            {/* 天盘 */}
            <span className={`col-span-2 self-center text-center font-display text-[1.375rem] leading-none @xl:text-[1.875rem] ${getGanZhiTextClass(palace.天盘, palace.五行)}`}>
                <ChartTarget interaction={interaction} id={id + ':天盘'}>{palace.天盘}</ChartTarget>
                {heavenKong && <span className="ml-0.5 align-super font-sans text-[9px] text-foreground-tertiary" title="天盘空亡">空</span>}
            </span>
            {/* 天将 · 旺衰：紧凑档上下居中，宽松档左右分列 */}
            <span className="col-span-2 truncate text-center text-[0.6875rem] text-foreground @xl:col-span-1 @xl:text-left">
                <ChartTarget interaction={interaction} id={id + ':天将'}>{palace.天将}</ChartTarget>
            </span>
            <span className="col-span-2 truncate text-center text-[0.59375rem] text-foreground-tertiary @xl:col-span-1 @xl:text-right @xl:text-[0.6875rem]">
                {phase}
            </span>
        </div>
    );
}

function CenterPanel({ result }: { result: DaliurenCanonicalJSON }) {
    const info = result.基本信息;
    const keShi = parseKeShi(info.课式);
    const hourBranch = getHourBranch(info.四柱);
    const dayJu = [keShi.day, keShi.ju].filter(Boolean).join(' · ') || keShi.detail;
    const yueJiang = hourBranch ? `月将${info.月将}加${hourBranch}时` : `月将${info.月将}`;
    return (
        <div style={{ gridRow: '2 / span 2', gridColumn: '2 / span 2' }} className="flex flex-col items-center justify-center gap-1 bg-panel p-2 text-center @xl:gap-2">
            <span className="font-display text-lg leading-tight text-foreground @xl:text-[1.625rem]">{keShi.title}</span>
            {dayJu && <span className="text-[0.6875rem] text-foreground-secondary @xl:text-[0.8125rem]">{dayJu}</span>}
            <span className="text-[0.6875rem] text-foreground-secondary @xl:text-[0.8125rem]">{yueJiang} · {info.昼夜}</span>
        </div>
    );
}

export function TianDiPanGrid({ result, interaction }: TianDiPanGridProps) {
    const kongSet = new Set(result.基本信息.关键状态.空亡);
    return (
        <div className="@container w-full">
            <div className="grid grid-cols-4 grid-rows-[repeat(4,minmax(86px,auto))] gap-px overflow-hidden rounded-[14px] border-[0.5px] border-border bg-border @xl:grid-rows-[repeat(4,minmax(132px,auto))] @xl:rounded-2xl">
                {TIANDIPAN_GRID_POSITIONS.map(({ index, row, col }) => {
                    const palace = result.天地盘[index];
                    if (!palace) return <div key={index} style={{ gridRow: row, gridColumn: col }} className="bg-surface" />;
                    return (
                        <PalaceCell
                            key={index}
                            palace={palace}
                            index={index}
                            row={row}
                            col={col}
                            chart={result}
                            kongSet={kongSet}
                            interaction={interaction}
                        />
                    );
                })}
                <CenterPanel result={result} />
            </div>
        </div>
    );
}
