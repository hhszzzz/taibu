import type { ZiweiCanonicalJSON } from 'taibu-core/ziwei';
import { MUTAGEN_BADGE_CLASS, MUTAGEN_BORDER_CLASS, MUTAGEN_ORDER } from '@/components/ziwei/ziwei-display';

/** 中宫图例：本命/运限为三方四正连线，飞星模式为四化飞线。 */
export type ZiweiLegendVariant = 'natal' | 'flying';

interface ZiweiChartCenterProps {
    chart: ZiweiCanonicalJSON;
    /** 命主称呼；与乾造/坤造拼成中宫标题 */
    subjectName?: string;
    /** 出生钟表时间（HH:mm）；缺省时取真太阳时信息中的钟表时间 */
    birthTime?: string;
    /** 出生地；有真太阳时则附在其后，否则单列一行 */
    birthPlace?: string;
    legend?: ZiweiLegendVariant;
}

const GENDER_LABEL: Record<string, string> = { 男: '乾造', 女: '坤造' };

/** core 阳历 "1984-9-27" → "1984-09-27"。 */
function padSolarDate(value: string): string {
    const parts = value.split('-');
    return parts.length === 3 ? [parts[0], parts[1].padStart(2, '0'), parts[2].padStart(2, '0')].join('-') : value;
}

/** core 时辰 "寅时（03:00~05:00）" → "寅时"。 */
function shortShichen(value: string | undefined): string {
    return value ? value.split(/[（(]/u)[0].trim() : '';
}

function BirthMutagens({ chart, compact = false }: { chart: ZiweiCanonicalJSON; compact?: boolean }) {
    const mutagens = chart.基本信息.生年四化?.四化星曜 ?? [];
    if (mutagens.length === 0) return null;
    return (
        <span className={`flex flex-wrap ${compact ? 'justify-center gap-x-1.5 gap-y-[3px] text-[10px]' : 'gap-x-3 gap-y-1.5 text-[13px]'}`}>
            {mutagens.map((item) => (
                <span key={item.四化 + item.星曜} className={`inline-flex items-center ${compact ? 'gap-0.5' : 'gap-[5px]'}`} title={`${item.星曜}化${item.四化}（${item.宫位}）`}>
                    <span className={`inline-flex items-center justify-center leading-none text-surface ${compact ? 'size-[13px] rounded-[3px] text-[9px]' : 'size-4 rounded text-[10px]'} ${MUTAGEN_BADGE_CLASS[item.四化] ?? 'bg-foreground-secondary'}`}>
                        {item.四化}
                    </span>
                    {item.星曜}
                </span>
            ))}
        </span>
    );
}

const LINE_SWATCH_CLASS = 'w-[18px] border-t-[1.5px]';

/**
 * 命盘图例；不使用 svg，避免与命盘连线混淆。
 * 完整盘（中宫底部）先列连线再列星曜；紧凑盘（命盘下方）先列星曜再列连线。
 */
export function ZiweiChartLegend({ compact = false, variant = 'natal' }: { compact?: boolean; variant?: ZiweiLegendVariant }) {
    const lines = variant === 'flying' ? (
        <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {MUTAGEN_ORDER.map((mutagen) => (
                <span key={mutagen} className="inline-flex items-center gap-1">
                    <span aria-hidden="true" className={`${LINE_SWATCH_CLASS} ${MUTAGEN_BORDER_CLASS[mutagen]}`} />
                    化{mutagen}
                </span>
            ))}
        </span>
    ) : (
        <>
            <span className="inline-flex items-center gap-[5px]">
                <span aria-hidden="true" className={`${LINE_SWATCH_CLASS} border-accent`} />{compact ? '三合' : '三方'}
            </span>
            <span className="inline-flex items-center gap-[5px]">
                <span aria-hidden="true" className={`${LINE_SWATCH_CLASS} border-dashed border-accent`} />对宫
            </span>
        </>
    );
    const stars = compact ? (
        <span><span className="text-accent-strong">主星</span> · 辅星 · <span className="text-danger">煞星</span></span>
    ) : (
        <span>主星 · <span className="text-foreground/80">辅星</span> · <span className="text-danger">煞星</span> · <span className="text-foreground-tertiary">杂曜</span></span>
    );
    const mutagens = <span>↓ 离心自化　↑ 向心自化</span>;

    return (
        <div className={`flex flex-wrap items-center text-[11px] text-foreground-secondary ${compact ? 'gap-x-3 gap-y-1' : 'gap-x-3.5 gap-y-1.5'}`}>
            {compact ? <>{stars}{mutagens}{lines}</> : <>{lines}{stars}{mutagens}</>}
        </div>
    );
}

/**
 * 命盘中宫：完整盘显示基本信息表 + 生年四化 + 图例；紧凑盘居中显示五行局与要点。
 * 外层由 ZiweiChartGrid 提供 bg-panel 背景；本组件文字层位于连线之上（z-[2]）。
 */
export function ZiweiChartCenter({ chart, subjectName, birthTime, birthPlace, legend = 'natal' }: ZiweiChartCenterProps) {
    const info = chart.基本信息;
    const genderLabel = info.性别 ? GENDER_LABEL[info.性别] : undefined;
    const title = [subjectName?.trim(), genderLabel].filter(Boolean).join(' · ');
    const shichen = shortShichen(info.时辰);
    const clockTime = birthTime ?? info.真太阳时?.钟表时间;
    const solarText = [padSolarDate(info.阳历), clockTime, shichen].filter(Boolean).join(' ');
    const mutagenStem = info.生年四化?.天干;
    const place = birthPlace?.trim();

    return (
        <>
            {/* 完整盘 */}
            <div className="relative z-[2] hidden h-full flex-col gap-3 px-[26px] py-[22px] @2xl/ziwei:flex">
                <div className="flex items-baseline justify-between gap-3">
                    {title ? (
                        <>
                            <span className="min-w-0 truncate font-display text-[22px] text-foreground">{title}</span>
                            <span className="shrink-0 font-display text-[15px] text-foreground-secondary">{info.五行局}</span>
                        </>
                    ) : (
                        <span className="font-display text-[22px] text-accent-strong">{info.五行局}</span>
                    )}
                </div>
                <dl className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-[7px] text-[13px]">
                    <dt className="text-foreground-secondary">阳历</dt>
                    <dd className="min-w-0 tabular-nums">{solarText}</dd>
                    <dt className="text-foreground-secondary">农历</dt>
                    <dd className="min-w-0">{info.农历}</dd>
                    <dt className="text-foreground-secondary">四柱</dt>
                    <dd className="min-w-0 font-display text-sm">{info.四柱}</dd>
                    <dt className="text-foreground-secondary">命主</dt>
                    <dd className="min-w-0">
                        {info.命主}
                        <span className="text-foreground-secondary">　身主</span> {info.身主}
                        {info.斗君 && <><span className="text-foreground-secondary">　斗君</span> {info.斗君}</>}
                    </dd>
                    {info.真太阳时 ? (
                        <>
                            <dt className="text-foreground-secondary">真太阳时</dt>
                            <dd className="min-w-0 truncate tabular-nums">
                                {info.真太阳时.真太阳时}
                                {place && <span className="text-foreground-secondary">　{place}</span>}
                            </dd>
                        </>
                    ) : place && (
                        <>
                            <dt className="text-foreground-secondary">出生地</dt>
                            <dd className="min-w-0 truncate">{place}</dd>
                        </>
                    )}
                </dl>
                {info.生年四化 && (
                    <div className="flex flex-col gap-[7px]">
                        <span className="text-xs text-foreground-secondary">生年四化{mutagenStem ? ` · ${mutagenStem}干` : ''}</span>
                        <BirthMutagens chart={chart} />
                    </div>
                )}
                <div className="mt-auto">
                    <ZiweiChartLegend variant={legend} />
                </div>
            </div>

            {/* 紧凑盘 */}
            <div className="relative z-[2] flex h-full flex-col items-center justify-center gap-1.5 p-2.5 text-center @2xl/ziwei:hidden">
                {title && <span className="max-w-full truncate text-[11px] text-foreground-secondary">{title}</span>}
                <span className="font-display text-[22px] leading-tight text-accent-strong">{info.五行局}</span>
                <span className="text-[10.5px] leading-[1.6] text-foreground/80">
                    {[info.农历, shichen].filter(Boolean).join(' ')}
                    <br />
                    {info.四柱}
                </span>
                <span className="text-[10.5px] text-foreground/80">命主 {info.命主} · 身主 {info.身主}</span>
                <BirthMutagens chart={chart} compact />
            </div>
        </>
    );
}
