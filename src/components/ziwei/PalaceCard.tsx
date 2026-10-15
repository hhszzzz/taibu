import type { ZiweiPalaceJSON } from 'taibu-core/ziwei';
import { StarBadge } from '@/components/ziwei/StarBadge';
import {
    MUTAGEN_BADGE_CLASS,
    PALACE_TAG_TONE_CLASS,
    formatDecadalRange,
    type PalaceTagTone,
} from '@/components/ziwei/ziwei-display';

interface FlowInfo {
    decadal?: { stem: string; ages: string };
    yearly?: string;
    monthly?: string;
    daily?: string;
}

type StarGroup = '主星及四化' | '辅星' | '杂曜';

/** 飞星模式下落入本宫的一条宫干飞化。 */
export interface PalaceFlightTag {
    mutagen: string;
    starName: string | null;
}

interface PalaceCardProps {
    palace: ZiweiPalaceJSON;
    isSelected?: boolean;
    isLifePalace?: boolean;
    isHighlighted?: boolean;
    highlightTypes?: string[];
    isSanFangSiZheng?: boolean;
    /** 与焦点宫的关系，用于区分「三合」与「对宫」标签；缺省时三方四正统一标为「三合」。 */
    relation?: '三合' | '对宫';
    showAdjStars?: boolean;
    flowInfo?: FlowInfo;
    /** 飞星模式：落入本宫的飞化；本宫即飞出宫时标为「自化」。 */
    flightTags?: PalaceFlightTag[];
    isFlightSource?: boolean;
    onClick?: () => void;
    onStarSelect?: (group: StarGroup, index: number) => void;
    highlightedStars?: Array<{ group: StarGroup; starIndex: number }>;
}

interface PalaceTag {
    key: string;
    label: string;
    /** 仅在完整盘显示的补充信息（如流年天干、飞化星名）。 */
    detail?: string;
    /** 外观：预设色调，或直接给出底色/文字色类名（四化色）。 */
    tone: PalaceTagTone | { className: string };
    /** 仅紧凑盘显示（完整盘以宫名颜色表达同一信息）。 */
    compactOnly?: boolean;
}

const STAR_GROUP_ORDER: readonly StarGroup[] = ['主星及四化', '辅星', '杂曜'];
/** 空宫（无主星）占位文字；完整盘与星名同样逐字竖排。 */
const EMPTY_MAJOR_LABEL = '无主星';
const STAR_TYPE_BY_GROUP: Record<StarGroup, 'major' | 'minor' | 'auxiliary'> = {
    主星及四化: 'major',
    辅星: 'minor',
    杂曜: 'auxiliary',
};

/** 运限高亮类型 → 标签；顺序即展示顺序。 */
const FLOW_TAGS: ReadonlyArray<{ type: string; label: string; tone: PalaceTagTone; flowKey?: 'yearly' | 'monthly' | 'daily' }> = [
    { type: 'decadal', label: '大限', tone: 'strong' },
    { type: 'yearly', label: '流年', tone: 'muted', flowKey: 'yearly' },
    { type: 'age', label: '小限', tone: 'muted' },
    { type: 'monthly', label: '流月', tone: 'muted', flowKey: 'monthly' },
    { type: 'daily', label: '流日', tone: 'muted', flowKey: 'daily' },
];

function buildTags(
    palace: ZiweiPalaceJSON,
    highlightTypes: string[],
    relation: '三合' | '对宫' | undefined,
    flowInfo: FlowInfo | undefined,
    flight: { tags: PalaceFlightTag[]; isSource: boolean; isLifePalace: boolean },
): PalaceTag[] {
    const tags: PalaceTag[] = [];
    if (flight.isLifePalace) tags.push({ key: 'life', label: '命', tone: 'accent', compactOnly: true });
    if (relation) tags.push({ key: 'relation', label: relation, tone: 'accent' });
    for (const item of flight.tags) {
        tags.push({
            key: `flight-${item.mutagen}`,
            label: `${flight.isSource ? '自化' : '化'}${item.mutagen}`,
            detail: item.starName ?? undefined,
            tone: { className: `${MUTAGEN_BADGE_CLASS[item.mutagen] ?? 'bg-foreground-secondary'} text-surface` },
        });
    }
    for (const flow of FLOW_TAGS) {
        if (!highlightTypes.includes(flow.type)) continue;
        tags.push({
            key: flow.type,
            label: flow.label,
            detail: flow.flowKey ? flowInfo?.[flow.flowKey] : undefined,
            tone: flow.tone,
        });
    }
    if (palace.是否身宫 === '是') tags.push({ key: 'body', label: '身宫', tone: 'muted' });
    if (palace.是否来因宫 === '是') tags.push({ key: 'origin', label: '来因', tone: 'muted' });
    return tags;
}

export function PalaceCard({
    palace,
    isSelected = false,
    isLifePalace = false,
    highlightTypes = [],
    isSanFangSiZheng = false,
    relation,
    showAdjStars = false,
    flowInfo,
    flightTags = [],
    isFlightSource = false,
    onClick,
    onStarSelect,
    highlightedStars = [],
}: PalaceCardProps) {
    const resolvedRelation = isSanFangSiZheng ? relation ?? '三合' : undefined;
    const tags = buildTags(palace, highlightTypes, resolvedRelation, flowInfo, { tags: flightTags, isSource: isFlightSource, isLifePalace });
    const shenSha = palace.神煞 ?? [];
    const shenShaLines = [shenSha.slice(0, 2), shenSha.slice(2)]
        .map((items) => items.filter(Boolean).join(' · '))
        .filter(Boolean);
    const decadalRange = formatDecadalRange(palace.大限);

    // 三级高亮：焦点宫（实线 2px 描边 + accent-soft）> 三方四正（1px 半透明描边 + accent-light）> 其他（surface）
    const toneClass = isSelected
        ? 'bg-accent-soft ring-2 ring-inset ring-accent'
        : resolvedRelation
            ? 'bg-accent-light ring-1 ring-inset ring-accent/55'
            : 'bg-surface hover:bg-background-secondary';

    const isStarHighlighted = (group: StarGroup, index: number) =>
        highlightedStars.some((item) => item.group === group && item.starIndex === index);

    const renderStar = (star: ZiweiPalaceJSON['主星及四化'][number], group: StarGroup, index: number, extraClass = '') => {
        const badge = <StarBadge star={{ ...star, type: STAR_TYPE_BY_GROUP[group] }} size="sm" />;
        if (!onStarSelect) {
            return <span key={group + index} className={extraClass || 'inline-flex'}>{badge}</span>;
        }
        const groupIndex = STAR_GROUP_ORDER.indexOf(group);
        return (
            <button
                key={group + index}
                type="button"
                className={`chart-star-button ${extraClass || 'inline-flex'}`}
                aria-label={palace.宫位 + star.星名}
                aria-pressed={isStarHighlighted(group, index)}
                data-chart-target={'ziwei:star:' + palace.宫位索引 + ':' + groupIndex + ':' + index}
                onClick={(event) => { event.stopPropagation(); onStarSelect(group, index); }}
            >
                {badge}
            </button>
        );
    };

    const adjStars = showAdjStars ? palace.杂曜 ?? [] : [];
    // 紧凑盘只保留主星与辅/煞；被对话焦点选中的杂曜仍需可见。
    const hasCompactAdjStar = adjStars.some((_, index) => isStarHighlighted('杂曜', index));

    return (
        <div
            role={onStarSelect ? 'group' : 'button'}
            aria-label={palace.宫位}
            tabIndex={onStarSelect ? -1 : 0}
            data-chart-palace={palace.宫位索引}
            data-chart-selected={isSelected || undefined}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onClick?.();
                }
            }}
            className={`relative flex h-full min-h-[116px] min-w-0 cursor-pointer flex-col gap-1 px-[5px] pt-[5px] pb-1 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent @2xl/ziwei:min-h-[204px] @2xl/ziwei:gap-2 @2xl/ziwei:px-2.5 @2xl/ziwei:pt-2.5 @2xl/ziwei:pb-2 ${toneClass}`}
        >
            {/* 星曜：紧凑盘横排分行；完整盘竖排、自右向左（主星 → 辅星 → 杂曜） */}
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 @2xl/ziwei:flex-row-reverse @2xl/ziwei:flex-wrap @2xl/ziwei:content-start @2xl/ziwei:items-start @2xl/ziwei:gap-x-1.5 @2xl/ziwei:gap-y-1">
                {palace.主星及四化.length > 0 ? (
                    <div className="flex flex-col items-start gap-px @2xl/ziwei:contents">
                        {palace.主星及四化.map((star, idx) => renderStar(star, '主星及四化', idx))}
                    </div>
                ) : (
                    <span className="inline-flex text-[0.625rem] leading-tight text-foreground-tertiary @2xl/ziwei:flex-col @2xl/ziwei:items-center @2xl/ziwei:font-display @2xl/ziwei:text-sm @2xl/ziwei:leading-[1.12]">
                        {Array.from(EMPTY_MAJOR_LABEL).map((char, index) => <span key={index}>{char}</span>)}
                    </span>
                )}
                {palace.辅星.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-px @2xl/ziwei:contents">
                        {palace.辅星.map((star, idx) => renderStar(star, '辅星', idx))}
                    </div>
                )}
                {adjStars.length > 0 && (
                    <div className={`${hasCompactAdjStar ? 'flex' : 'hidden'} flex-wrap items-center gap-x-1 @2xl/ziwei:contents`}>
                        {adjStars.map((star, idx) => renderStar(
                            star,
                            '杂曜',
                            idx,
                            `${isStarHighlighted('杂曜', idx) ? 'inline-flex' : 'hidden @2xl/ziwei:inline-flex'}${idx === 0 ? ' @2xl/ziwei:mr-1.5' : ''}`,
                        ))}
                    </div>
                )}
            </div>

            {/* 底栏：紧凑盘为「标签 / 宫名·干支 / 大限」，完整盘为「十二神 | 标签+宫名 | 干支+大限」 */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-1 gap-y-px @2xl/ziwei:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @2xl/ziwei:items-end @2xl/ziwei:gap-x-1.5 @2xl/ziwei:gap-y-1">
                {shenShaLines.length > 0 && (
                    <span className="hidden text-[11px] leading-[1.45] text-foreground-tertiary @2xl/ziwei:col-start-1 @2xl/ziwei:row-span-2 @2xl/ziwei:row-start-1 @2xl/ziwei:block @2xl/ziwei:self-end">
                        {shenShaLines.map((line) => <span key={line} className="block truncate">{line}</span>)}
                    </span>
                )}
                {tags.length > 0 && (
                    <span className="col-span-2 flex flex-wrap gap-0.5 @2xl/ziwei:col-span-1 @2xl/ziwei:col-start-2 @2xl/ziwei:row-start-1 @2xl/ziwei:justify-center @2xl/ziwei:gap-1">
                        {tags.map((tag) => (
                            <span
                                key={tag.key}
                                className={`rounded px-1 text-[0.5625rem] leading-[14px] whitespace-nowrap @2xl/ziwei:px-1.5 @2xl/ziwei:text-[10px] @2xl/ziwei:leading-4 ${typeof tag.tone === 'string' ? PALACE_TAG_TONE_CLASS[tag.tone] : tag.tone.className}${tag.compactOnly ? ' @2xl/ziwei:hidden' : ''}`}
                            >
                                {tag.label}
                                {tag.detail && <span className="hidden @2xl/ziwei:inline"> {tag.detail}</span>}
                            </span>
                        ))}
                    </span>
                )}
                <span className={`min-w-0 truncate text-xs font-medium @2xl/ziwei:col-start-2 @2xl/ziwei:row-start-2 @2xl/ziwei:text-center @2xl/ziwei:font-display @2xl/ziwei:text-base ${isLifePalace ? 'text-accent-strong @2xl/ziwei:font-semibold' : 'text-foreground @2xl/ziwei:font-normal'}`}>
                    {onStarSelect ? (
                        <button
                            type="button"
                            data-chart-target={'ziwei:palace:' + palace.宫位索引}
                            aria-label={'查看' + palace.宫位}
                            aria-pressed={isSelected}
                            className="chart-palace-button"
                            onClick={(event) => { event.stopPropagation(); onClick?.(); }}
                        >
                            {palace.宫位}
                        </button>
                    ) : palace.宫位}
                </span>
                <span className={`text-right text-[9.5px] @2xl/ziwei:col-start-3 @2xl/ziwei:row-start-1 @2xl/ziwei:self-end @2xl/ziwei:font-display @2xl/ziwei:text-sm ${isLifePalace ? 'text-accent-strong' : 'text-foreground-tertiary @2xl/ziwei:text-foreground'}`}>
                    {palace.干支}
                </span>
                {decadalRange && (
                    <span className={`col-span-2 text-right text-[0.5625rem] tabular-nums @2xl/ziwei:col-span-1 @2xl/ziwei:col-start-3 @2xl/ziwei:row-start-2 @2xl/ziwei:text-[11px] ${isLifePalace ? 'text-accent-strong' : 'text-foreground-tertiary @2xl/ziwei:text-foreground-secondary'}`}>
                        {decadalRange}
                    </span>
                )}
            </div>
        </div>
    );
}
