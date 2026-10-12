import type { ReactNode } from 'react';
import type { ZiweiPalaceJSON, ZiweiStarJSON } from 'taibu-core/ziwei';
import {
    MALEFIC_MINOR_STARS,
    MUTAGEN_BADGE_CLASS,
    MUTAGEN_TEXT_CLASS,
    SHENSHA_GROUP_LABELS,
    formatDecadalRange,
} from '@/components/ziwei/ziwei-display';

interface ZiweiPalaceDetailProps {
    palace: ZiweiPalaceJSON;
    related: Array<{ palace: ZiweiPalaceJSON; relation: '三合' | '对宫' }>;
    showAdjStars: boolean;
}

/** 详情卡内的星曜（横排、纯展示，不承载对话焦点 data-chart-target，避免与命盘重复）。 */
function DetailStar({ star, tone }: { star: ZiweiStarJSON; tone: 'major' | 'minor' }) {
    const nameClass = tone === 'major'
        ? 'font-display text-foreground'
        : MALEFIC_MINOR_STARS.has(star.星名) ? 'text-danger' : 'text-foreground';
    return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className={nameClass}>{star.星名}</span>
            {star.亮度 && <span>{star.亮度}</span>}
            {star.四化 && (
                <span className={`inline-flex size-4 items-center justify-center rounded-[3px] text-[10px] leading-none text-surface ${MUTAGEN_BADGE_CLASS[star.四化] ?? 'bg-foreground-secondary'}`}>
                    {star.四化}
                </span>
            )}
            {star.离心自化 && <span className={`text-[10px] ${MUTAGEN_TEXT_CLASS[star.离心自化] ?? ''}`}>↓{star.离心自化}</span>}
            {star.向心自化 && <span className={`text-[10px] ${MUTAGEN_TEXT_CLASS[star.向心自化] ?? ''}`}>↑{star.向心自化}</span>}
        </span>
    );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid grid-cols-[56px_minmax(0,1fr)] items-baseline gap-2 text-[13px]">
            <dt className="text-foreground-secondary">{label}</dt>
            <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 leading-[1.7]">{children}</dd>
        </div>
    );
}

/** 紧凑盘下方的焦点宫详情卡（窄屏 / 对话侧栏）。 */
export function ZiweiPalaceDetail({ palace, related, showAdjStars }: ZiweiPalaceDetailProps) {
    const decadalRange = formatDecadalRange(palace.大限);
    const shenSha = palace.神煞 ?? [];
    const adjStars = showAdjStars ? palace.杂曜 ?? [] : [];

    return (
        <section aria-label={`${palace.宫位}详情`} className="flex flex-col gap-2.5 rounded-2xl border-[0.5px] border-border bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-[19px] text-accent-strong">{palace.宫位} · {palace.干支}</h3>
                {decadalRange && <span className="text-xs text-foreground-secondary">大限 {decadalRange} 岁</span>}
            </div>
            <dl className="flex flex-col gap-2">
                <DetailRow label="主星">
                    {palace.主星及四化.length > 0
                        ? palace.主星及四化.map((star) => <DetailStar key={star.星名} star={star} tone="major" />)
                        : <span className="text-foreground-secondary">无主星</span>}
                </DetailRow>
                {palace.辅星.length > 0 && (
                    <DetailRow label="辅星">
                        {palace.辅星.map((star) => <DetailStar key={star.星名} star={star} tone="minor" />)}
                    </DetailRow>
                )}
                {adjStars.length > 0 && (
                    <DetailRow label="杂曜">
                        <span className="text-foreground-secondary">{adjStars.map((star) => star.星名).join('　')}</span>
                    </DetailRow>
                )}
                {shenSha.length > 0 && (
                    <DetailRow label="十二神">
                        <span className="text-foreground-secondary">
                            {shenSha.map((name, index) => `${SHENSHA_GROUP_LABELS[index] ? `${SHENSHA_GROUP_LABELS[index]} ` : ''}${name}`).join(' · ')}
                        </span>
                    </DetailRow>
                )}
                {related.length > 0 && (
                    <DetailRow label="三方四正">
                        {related.map(({ palace: item, relation }) => (
                            <span key={item.宫位} title={relation} className="rounded-md bg-accent-light px-2 py-0.5 text-xs whitespace-nowrap text-accent-strong">
                                {item.宫位} {item.干支}
                            </span>
                        ))}
                    </DetailRow>
                )}
            </dl>
        </section>
    );
}
