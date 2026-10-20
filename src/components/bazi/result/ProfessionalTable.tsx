/**
 * 八字专业排盘表格组件
 *
 * 结果页与对话 Agent（CanonicalChartView）共用：
 * - 以容器宽度（@container）切换紧凑 / 宽松两种密度，窄容器（手机卡片、约 480px 的对话抽屉）
 *   使用短标签与紧凑藏干，宽容器展示完整标签与「藏干 + 十神」明细。
 * - 干支使用衬线字体并按五行着色；日柱表头为陶土强调色。
 *
 * 'use client'：神煞行展开 / 收起需要 useState
 */
'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import type { BaziCanonicalJSON, BaziCellJSON } from 'taibu-core/bazi';
import { getDiShi, getKongWang } from 'taibu-core/utils';
import {
    type DaYunInfo,
    type LiuNianInfo,
    type LiuYueInfo,
    type LiuRiInfo,
} from '@/lib/divination/bazi';
import type { HiddenStemDetail } from '@/types';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ganZhiTextClass } from '@/components/bazi/element-classes';

// 神煞吉凶分类
const JI_SHEN = new Set([
    '天乙贵人', '太极贵人', '天德贵人', '月德贵人', '天德合', '月德合',
    '三奇贵人', '文昌贵人', '文昌', '学堂', '词馆', '华盖', '金舆',
    '天医', '福星', '禄神', '天禄', '暗禄', '驿马', '将星', '天厨',
    '金匮', '玉堂', '龙德', '紫薇', '天喜', '红鸾', '月德', '天德',
    '天赦', '天巫', '国印', '进神', '天罗', '地网', '天官', '福德',
    '红鸾', '天喜',
]);

const XIONG_SHA = new Set([
    '羊刃', '飞刃', '亡神', '劫煞', '灾煞', '血刃', '血光',
    '白虎', '丧门', '吊客', '天狗', '勾绞', '孤辰', '寡宿',
    '空亡', '元辰', '破碎', '大耗', '小耗', '咸池', '桃花',
    '红艳', '流霞', '披麻', '天哭', '病符', '死符', '官符',
    '岁破', '月破', '四废', '阴差阳错', '孤鸾', '童子煞',
    '铁扫', '扫把', '寒命', '孤神', '亡劫', '六厄',
]);

const PILLAR_KEYS = ['year', 'month', 'day', 'hour'] as const;
const PILLAR_SHORT_LABELS: Record<string, string> = { 年柱: '年', 月柱: '月', 日柱: '日', 时柱: '时' };
const DAY_PILLAR_INDEX = 2;
const LABEL_COLUMN_PERCENT = 10;
const HOUR_PILLAR_INDEX = 3;

// 获取神煞的吉凶样式（吉神用成功色、凶煞用危险色）
function getShenShaClass(sha: string): string {
    if (JI_SHEN.has(sha)) return 'bg-success/10 text-success';
    if (XIONG_SHA.has(sha)) return 'bg-danger/10 text-danger';
    return 'bg-background-secondary text-foreground-secondary';
}

interface FortuneColumn {
    key: string;
    label: string;
    stem: string;
    branch: string;
    shiShen?: string;
    hiddenStems: HiddenStemDetail[];
    naYin: string;
    diShi: string;
    shenSha: string[];
}

/* ---------- 样式常量（容器查询：@lg = 32rem） ---------- */
const LABEL_CELL_CLASS = 'sticky left-0 z-10 whitespace-nowrap bg-surface py-1.5 pr-1.5 text-left text-xs font-normal text-foreground-secondary @lg:py-3 @lg:text-sm';
const TEXT_CELL_CLASS = 'px-1 py-1.5 text-[0.8125rem] whitespace-nowrap text-foreground @lg:py-3 @lg:text-sm';
const GLYPH_CLASS = 'font-display text-[1.75rem] leading-[1.2] @lg:text-[32px]';
const ROW_DIVIDER_CLASS = '@lg:border-t-[0.5px] @lg:border-border';
/** 自坐 / 空亡为宽松模式附加行，窄容器（手机、对话抽屉）隐藏以保持紧凑 */
const WIDE_ONLY_ROW_CLASS = `hidden @lg:table-row ${ROW_DIVIDER_CLASS}`;
const FORTUNE_CELL_CLASS = 'bg-panel/70';

/** 干支自坐的十二长生（天干临本柱地支） */
const selfSittingOf = (stem: string, branch: string) => getDiShi(stem, branch) || '-';
/** 干支所在旬的空亡地支 */
const voidBranchesOf = (stem: string, branch: string) => getKongWang(stem, branch).kongZhi.join('');

/** 紧凑 / 宽松两套标签，按容器宽度切换 */
function DualLabel({ short, full }: { short: string; full: string }) {
    if (short === full) return <>{full}</>;
    return (
        <>
            <span className="@lg:hidden">{short}</span>
            <span className="hidden @lg:inline">{full}</span>
        </>
    );
}

/**
 * 字旁的根、透、无根标记（来自五行详查）：根写在作根的藏干旁并写出所指的天干（日·时），
 * 透写在月令透出的藏干旁并写出透到哪一干，无根写在该天干的十神旁。
 * spot 是悬停时一并点亮的字（「柱:部位」），由画在表上的关系层负责聚焦。
 */
export interface GlyphMark {
    kind: 'root' | 'reveal' | 'rootless';
    text: string;
    /** 所指的天干，如「日·时」；无根为空 */
    detail?: string;
    title: string;
    spot: string[];
}

/** hidden 按「柱:藏干」取，stems 按柱取。 */
export interface GlyphMarks {
    hidden: Record<string, GlyphMark[]>;
    stems: Record<string, GlyphMark[]>;
}

const MARK_TONE: Record<GlyphMark['kind'], string> = { root: 'text-accent', reveal: 'text-warning', rootless: 'text-foreground-tertiary' };

function GlyphMarkTag({ mark, compact = false }: { mark: GlyphMark; compact?: boolean }) {
    const className = compact
        ? `ml-px align-super text-[0.5rem] leading-none ${MARK_TONE[mark.kind]}`
        : `ml-1 inline-flex items-baseline gap-0.5 rounded-[4px] border border-current px-1 align-middle text-[0.625rem] font-medium leading-[0.875rem] ${MARK_TONE[mark.kind]}`;
    return <span role="img" aria-label={mark.title} title={mark.title} data-relation-tag={mark.kind} data-relation-spot={mark.spot.join(' ')} className={className}>
        {mark.text}{!compact && mark.detail && <span className="font-normal text-foreground-secondary">{mark.detail}</span>}
    </span>;
}

function HiddenStemsCell({ stems, marksOf }: { stems: { stem: string; tenGod: string }[]; marksOf?: (stem: string) => GlyphMark[] | undefined }) {
    return (
        <>
            {/* 紧凑：仅干字，同行排列；根、透只留上标 */}
            <span className="inline-flex gap-px @lg:hidden">
                {stems.map((item, idx) => (
                    <span key={idx} className={ganZhiTextClass(item.stem)}>{item.stem}{marksOf?.(item.stem)?.map(mark => <GlyphMarkTag key={mark.kind} mark={mark} compact />)}</span>
                ))}
            </span>
            {/* 宽松：干字 + 十神，逐行；根、透写出所指的天干 */}
            <span className="hidden flex-col items-center gap-0.5 leading-[1.6] @lg:inline-flex">
                {stems.map((item, idx) => (
                    <span key={idx} className="whitespace-nowrap">
                        <span className={ganZhiTextClass(item.stem)}>{item.stem}</span>
                        <span className="ml-1 text-foreground">{item.tenGod}</span>
                        {marksOf?.(item.stem)?.map(mark => <GlyphMarkTag key={mark.kind} mark={mark} />)}
                    </span>
                ))}
            </span>
        </>
    );
}

function ShenShaCell({ items, expanded }: { items: string[]; expanded: boolean }) {
    const visible = expanded ? items : items.slice(0, 1);
    return (
        <div className="flex flex-col items-center gap-1 @lg:flex-row @lg:flex-wrap @lg:justify-center">
            {visible.map((sha, idx) => (
                <span key={idx} className={`max-w-[calc(2em+0.5rem)] rounded-md px-1 py-0.5 text-[0.625rem] leading-tight @lg:max-w-none @lg:whitespace-nowrap @lg:px-2 @lg:text-xs @lg:leading-normal ${getShenShaClass(sha)}`}>{sha}</span>
            ))}
            {!expanded && items.length > 1 && (
                <span className="text-[0.625rem] text-foreground-tertiary @lg:text-[11px]">+{items.length - 1}</span>
            )}
        </div>
    );
}

export function ProfessionalTable({
    canonicalChart,
    isUnknownTime = false,
    activeDaYun,
    activeLiuNian,
    activeLiuYue,
    activeLiuRi,
    highlightedCells,
    onCellSelect,
    canonicalLabels = false,
    overlay,
    relationBands,
    glyphMarks,
}: {
    canonicalChart: BaziCanonicalJSON;
    isUnknownTime?: boolean;
    activeDaYun?: DaYunInfo;
    activeLiuNian?: LiuNianInfo;
    activeLiuYue?: LiuYueInfo;
    activeLiuRi?: LiuRiInfo;
    highlightedCells?: BaziCellJSON[];
    onCellSelect?: (cell: BaziCellJSON) => void;
    /** Name rows by the canonical fields (十神, 地势) and the day pillar 日主, as the Agent workspace does. */
    canonicalLabels?: boolean;
    /** 画在表上的关系层（GanzhiRelationOverlay）；它按 data-relation-cell 找字形的位置。 */
    overlay?: ReactNode;
    /** 天干行上方、地支行下方、干支之间为连线留出的高度（px）。 */
    relationBands?: { stem: number; branch: number; cross?: number };
    /** 五行详查给出的根、透、无根标记（Agent 盘面）。 */
    glyphMarks?: GlyphMarks;
}) {
    const [shenShaExpanded, setShenShaExpanded] = useState(false);

    const fortuneSources: { key: string; label: string; info?: DaYunInfo | LiuNianInfo | LiuYueInfo | LiuRiInfo }[] = [
        { key: 'liuRi', label: '流日', info: activeLiuRi },
        { key: 'liuYue', label: '流月', info: activeLiuYue },
        { key: 'liuNian', label: '流年', info: activeLiuNian },
        { key: 'daYun', label: '大运', info: activeDaYun },
    ];
    const fortuneColumns: FortuneColumn[] = fortuneSources.flatMap(({ key, label, info }) => info ? [{
        key,
        label,
        stem: info.gan,
        branch: info.zhi,
        shiShen: info.tenGod,
        hiddenStems: info.hiddenStems,
        naYin: info.naYin,
        diShi: info.diShi,
        shenSha: info.shenSha,
    }] : []);

    const columns = canonicalChart.四柱.map((pillar, index) => {
        const stem = pillar.干支.charAt(0);
        const branch = pillar.干支.charAt(1);
        return {
            key: PILLAR_KEYS[index] || `pillar-${index}`,
            label: pillar.柱,
            pillar,
            stem,
            branch,
            shiShen: index === DAY_PILLAR_INDEX ? (canonicalLabels ? '日主' : canonicalChart.基本信息.性别 === '男' ? '元男' : '元女') : (pillar.天干十神 || ''),
            hidden: isUnknownTime && index === HOUR_PILLAR_INDEX,
            isDay: index === DAY_PILLAR_INDEX,
        };
    });
    type PillarColumn = typeof columns[number];

    const hasShenSha = columns.some(col => (col.pillar.神煞 || []).length > 0)
        || fortuneColumns.some(col => col.shenSha.length > 0);
    // Canonical JSON may leave 纳音 out; an empty row says nothing.
    const hasNaYin = columns.some(col => col.pillar.纳音) || fortuneColumns.some(col => col.naYin);
    const hasFortuneColumns = fortuneColumns.length > 0;
    const columnCount = fortuneColumns.length + columns.length;
    // 标签列占 10%，其余列等分；内容放不下时表格自动加宽并横向滚动
    const dataColumnWidth = `${((100 - LABEL_COLUMN_PERCENT) / Math.max(columnCount, 1)).toFixed(3)}%`;

    /** 本命柱单元格公共样式：时辰未知的时柱降低透明度；与运势列之间加分隔线 */
    const pillarCellClass = (col: PillarColumn, idx: number) => [
        col.hidden ? 'opacity-30' : '',
        idx === 0 && hasFortuneColumns ? 'border-l-[0.5px] border-border' : '',
    ].join(' ');

    const character = (col: PillarColumn, part: BaziCellJSON['部位'], index: number) => {
        const char = part === '天干' ? col.stem : col.branch;
        const colorClass = col.hidden ? 'text-foreground-tertiary' : ganZhiTextClass(char);
        if (!onCellSelect || col.hidden) return <span className={`${GLYPH_CLASS} ${colorClass}`} data-relation-cell={col.hidden ? undefined : col.label + ':' + part}>{col.hidden ? '*' : char}</span>;
        const cell: BaziCellJSON = { 柱: col.label as BaziCellJSON['柱'], 部位: part, 字: char };
        const highlighted = highlightedCells?.some(item => item.柱 === cell.柱 && item.部位 === cell.部位 && item.字 === char) ?? false;
        return <button type="button" className={`chart-cell-button ${GLYPH_CLASS} ${colorClass}`}
            data-chart-target={'bazi:cell:' + index + ':' + (part === '天干' ? 0 : 1)} data-relation-cell={col.label + ':' + part}
            aria-label={col.label + part + char} aria-pressed={highlighted} onClick={() => onCellSelect(cell)}>{char}</button>;
    };

    /** 一整行：标签 + 运势列 + 本命列 */
    const renderRow = ({
        key,
        label,
        className = '',
        fortune,
        pillar,
        cellClass = TEXT_CELL_CLASS,
        style,
    }: {
        key: string;
        label: ReactNode;
        className?: string;
        fortune: (col: FortuneColumn) => ReactNode;
        pillar: (col: PillarColumn, idx: number) => ReactNode;
        cellClass?: string;
        style?: CSSProperties;
    }) => (
        <tr key={key} className={className} data-row={key}>
            <th scope="row" className={LABEL_CELL_CLASS} style={style}>{label}</th>
            {fortuneColumns.map((col) => (
                <td key={col.key} className={`${cellClass} ${FORTUNE_CELL_CLASS}`} style={style}>{fortune(col)}</td>
            ))}
            {columns.map((col, idx) => (
                <td key={col.key} className={`${cellClass} ${pillarCellClass(col, idx)}`} style={style}>{pillar(col, idx)}</td>
            ))}
        </tr>
    );

    return (
        <div className="@container w-full">
            <div className="relative overflow-x-auto">
                <table className="w-full border-collapse text-center">
                    <colgroup>
                        <col style={{ width: `${LABEL_COLUMN_PERCENT}%` }} />
                        {Array.from({ length: columnCount }).map((_, idx) => (
                            <col key={idx} style={{ width: dataColumnWidth }} />
                        ))}
                    </colgroup>
                    <thead>
                        <tr>
                            <th scope="col" className={LABEL_CELL_CLASS}><span className="sr-only">项目</span></th>
                            {fortuneColumns.map((col) => (
                                <th key={col.key} scope="col" className={`px-1 py-1.5 text-xs font-medium text-accent-strong @lg:py-3.5 @lg:text-sm ${FORTUNE_CELL_CLASS}`}>
                                    {col.label}
                                </th>
                            ))}
                            {columns.map((col, idx) => (
                                <th
                                    key={col.key}
                                    scope="col"
                                    className={`px-1 py-1.5 text-xs @lg:py-3.5 @lg:text-sm ${col.isDay ? 'font-medium text-accent' : 'font-normal text-foreground-secondary'} ${idx === 0 && hasFortuneColumns ? 'border-l-[0.5px] border-border' : ''}`}
                                >
                                    <DualLabel short={PILLAR_SHORT_LABELS[col.label] ?? col.label} full={col.label} />
                                    {col.hidden && <span className="ml-0.5 text-warning">*</span>}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {renderRow({
                            key: 'shiShen',
                            label: '十神',
                            className: ROW_DIVIDER_CLASS,
                            fortune: (col) => col.shiShen || '-',
                            pillar: (col) => (
                                <>
                                    <span className={col.isDay ? 'text-accent' : ''}>{col.hidden ? '?' : col.shiShen}</span>
                                    {!col.hidden && glyphMarks?.stems[col.label]?.map(mark => <GlyphMarkTag key={mark.kind} mark={mark} />)}
                                </>
                            ),
                        })}
                        {renderRow({
                            key: 'stem',
                            label: <DualLabel short="干" full="天干" />,
                            className: ROW_DIVIDER_CLASS,
                            cellClass: 'px-1 pt-1.5 pb-0 @lg:pt-3',
                            style: relationBands?.stem || relationBands?.cross ? {
                                ...(relationBands.stem ? { paddingTop: `calc(${relationBands.stem}px + 0.375rem)` } : {}),
                                ...(relationBands.cross ? { paddingBottom: `calc(${relationBands.cross}px + 0.25rem)` } : {}),
                            } : undefined,
                            fortune: (col) => <span className={`${GLYPH_CLASS} ${ganZhiTextClass(col.stem)}`} data-relation-cell={col.label + ':天干'}>{col.stem}</span>,
                            pillar: (col, idx) => character(col, '天干', idx),
                        })}
                        {renderRow({
                            key: 'branch',
                            label: <DualLabel short="支" full="地支" />,
                            cellClass: 'px-1 pt-0 pb-1.5 @lg:pb-3',
                            style: relationBands?.branch ? { paddingBottom: `calc(${relationBands.branch}px + 0.375rem)` } : undefined,
                            fortune: (col) => <span className={`${GLYPH_CLASS} ${ganZhiTextClass(col.branch)}`} data-relation-cell={col.label + ':地支'}>{col.branch}</span>,
                            pillar: (col, idx) => character(col, '地支', idx),
                        })}
                        {renderRow({
                            key: 'hiddenStems',
                            label: '藏干',
                            className: ROW_DIVIDER_CLASS,
                            fortune: (col) => (
                                <HiddenStemsCell stems={col.hiddenStems.map(item => ({ stem: item.stem, tenGod: item.tenGod }))} />
                            ),
                            pillar: (col) => col.hidden ? '*' : (
                                <HiddenStemsCell stems={(col.pillar.藏干 || []).map(item => ({ stem: item.天干, tenGod: item.十神 }))}
                                    marksOf={glyphMarks && (stem => glyphMarks.hidden[col.label + ':' + stem])} />
                            ),
                        })}
                        {renderRow({
                            key: 'diShi',
                            label: canonicalLabels ? '地势' : '星运',
                            className: ROW_DIVIDER_CLASS,
                            fortune: (col) => col.diShi,
                            pillar: (col) => col.hidden ? '?' : col.pillar.地势,
                        })}
                        {renderRow({
                            key: 'selfSitting',
                            label: '自坐',
                            className: WIDE_ONLY_ROW_CLASS,
                            fortune: (col) => selfSittingOf(col.stem, col.branch),
                            pillar: (col) => col.hidden ? '?' : selfSittingOf(col.stem, col.branch),
                        })}
                        {renderRow({
                            key: 'voidBranches',
                            label: '空亡',
                            className: WIDE_ONLY_ROW_CLASS,
                            fortune: (col) => voidBranchesOf(col.stem, col.branch),
                            pillar: (col) => col.hidden ? '?' : voidBranchesOf(col.stem, col.branch),
                        })}
                        {hasNaYin && renderRow({
                            key: 'naYin',
                            label: '纳音',
                            className: ROW_DIVIDER_CLASS,
                            fortune: (col) => col.naYin,
                            pillar: (col) => col.hidden ? '?' : col.pillar.纳音,
                        })}
                        {hasShenSha && renderRow({
                            key: 'shenSha',
                            label: (
                                <button
                                    type="button"
                                    onClick={() => setShenShaExpanded(!shenShaExpanded)}
                                    aria-expanded={shenShaExpanded}
                                    className="inline-flex items-center gap-0.5 transition-colors hover:text-foreground"
                                >
                                    神煞
                                    {shenShaExpanded
                                        ? <ChevronUp className="hidden h-3 w-3 text-foreground-tertiary @lg:block" />
                                        : <ChevronDown className="hidden h-3 w-3 text-foreground-tertiary @lg:block" />}
                                </button>
                            ),
                            className: ROW_DIVIDER_CLASS,
                            cellClass: 'px-1 py-1.5 align-top @lg:py-3',
                            fortune: (col) => <ShenShaCell items={col.shenSha} expanded={shenShaExpanded} />,
                            pillar: (col) => col.hidden ? '?' : <ShenShaCell items={col.pillar.神煞 || []} expanded={shenShaExpanded} />,
                        })}
                    </tbody>
                </table>
                {overlay}
            </div>
            {isUnknownTime && <p className="mt-3 text-xs text-warning">* 时辰未知，时柱数据仅供逻辑参考</p>}
        </div>
    );
}
