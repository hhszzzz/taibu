/**
 * 奇门遁甲选中宫位详情卡
 *
 * 纯展示组件：宫格数据来自 canonical JSON，格局 / 宫旺衰等完整档字段由结果页
 * 从已有的 QimenOutput 透传（canonical 默认档不含这些字段）。
 */
import type { QimenPalaceJSON } from 'taibu-core/qimen';
import {
    CENTER_PALACE_INDEX,
    getCenterHostNote,
    getElementTextClass,
    getPalaceDetailTags,
    getPalaceDirection,
    getPalaceShortName,
    getStemTextClass,
    isPlaceholder,
} from './qimen-display';

interface QimenPalaceDetailProps {
    palace: QimenPalaceJSON;
    palaces: readonly QimenPalaceJSON[];
    zhiShi?: string;
    monthPhaseMap?: Record<string, string>;
    /** 该宫格局（来自 QimenOutput.palaces[].formations） */
    formations?: readonly string[];
    /** 宫五行旺衰（来自 QimenOutput.palaces[].elementState） */
    elementState?: string;
    className?: string;
}

function displayValue(value: string | undefined): string {
    return value && !isPlaceholder(value) ? value : '—';
}

function phaseOf(stem: string, monthPhaseMap: Record<string, string> | undefined): string | undefined {
    return isPlaceholder(stem) ? undefined : monthPhaseMap?.[stem.charAt(0)];
}

export function QimenPalaceDetail({
    palace,
    palaces,
    zhiShi,
    monthPhaseMap,
    formations,
    elementState,
    className = '',
}: QimenPalaceDetailProps) {
    const isCenter = palace.宫位序号 === CENTER_PALACE_INDEX;
    const direction = getPalaceDirection(palace);
    const tags = getPalaceDetailTags(palace, zhiShi);
    const hostNote = isCenter ? getCenterHostNote(palaces) : null;
    const heavenPhase = phaseOf(palace.天盘天干, monthPhaseMap);
    const earthPhase = phaseOf(palace.地盘天干, monthPhaseMap);

    const facts: { label: string; value: string }[] = [];
    facts.push({
        label: '五行',
        value: [
            `宫${displayValue(palace.宫位五行)}${elementState ? `（${elementState}）` : ''}`,
            palace.九星五行 ? `星${palace.九星五行}` : '',
            palace.八门五行 ? `门${palace.八门五行}` : '',
        ].filter(Boolean).join(' · '),
    });
    if (heavenPhase || earthPhase) {
        facts.push({
            label: '月令',
            value: [
                heavenPhase ? `天盘${palace.天盘天干}${heavenPhase}` : '',
                earthPhase ? `地盘${palace.地盘天干}${earthPhase}` : '',
            ].filter(Boolean).join(' · '),
        });
    }
    if (palace.寄星?.length || palace.寄天盘干?.length || palace.寄地盘干?.length) {
        facts.push({
            label: '寄宫',
            value: [...(palace.寄星 ?? []), ...(palace.寄天盘干 ?? []), ...(palace.寄地盘干 ?? [])].join('、'),
        });
    }
    if (hostNote) facts.push({ label: '寄宫', value: `${hostNote.subject}${hostNote.target}` });
    const allFormations = formations?.length ? formations : palace.格局;
    if (allFormations?.length) facts.push({ label: '格局', value: allFormations.join('、') });

    const cells = isCenter
        ? [{ label: '地盘干', value: displayValue(palace.地盘天干), tone: getStemTextClass(palace.地盘天干) }]
        : [
            { label: '八神', value: displayValue(palace.八神), tone: 'text-foreground' },
            { label: '九星', value: displayValue(palace.九星), tone: getElementTextClass(palace.九星五行) },
            { label: '八门', value: displayValue(palace.八门), tone: getElementTextClass(palace.八门五行) },
            { label: '天 / 地', value: `${displayValue(palace.天盘天干)} / ${displayValue(palace.地盘天干)}`, tone: 'text-foreground' },
        ];

    return (
        <section aria-label="宫位详情" className={`flex flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-surface p-4 lg:p-5 ${className}`}>
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg font-normal text-foreground">
                    {getPalaceShortName(palace)}宫{direction && !isCenter ? ` · ${direction}` : ''}
                </h2>
                {tags.length > 0 && (
                    <span className="flex flex-wrap justify-end gap-1">
                        {tags.map(tag => (
                            <span
                                key={tag.label}
                                className={`rounded-md px-2 py-0.5 text-[11px] whitespace-nowrap ${tag.emphasis ? 'bg-accent text-on-accent' : 'bg-background-secondary text-foreground-secondary'}`}
                            >
                                {tag.label}
                            </span>
                        ))}
                    </span>
                )}
            </div>

            <div className={`grid gap-1 text-center ${isCenter ? 'grid-cols-1' : 'grid-cols-4'}`}>
                {cells.map(cell => (
                    <div key={cell.label} className="flex min-w-0 flex-col gap-0.5 rounded-[10px] bg-background px-1 py-2">
                        <span className="text-[11px] text-foreground-secondary">{cell.label}</span>
                        <span className={`truncate font-display text-base ${cell.tone}`}>{cell.value}</span>
                    </div>
                ))}
            </div>

            {facts.length > 0 && (
                <dl className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                    {facts.map((fact, index) => (
                        <div key={`${fact.label}-${index}`} className="contents">
                            <dt className="text-foreground-secondary">{fact.label}</dt>
                            <dd className="text-foreground">{fact.value}</dd>
                        </div>
                    ))}
                </dl>
            )}

            <p className="text-xs text-foreground-secondary">点宫位查看门星神仪的旺衰与格局</p>
        </section>
    );
}
