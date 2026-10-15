import type { ZiweiStarJSON } from 'taibu-core/ziwei';
import {
    MALEFIC_MINOR_STARS,
    MUTAGEN_BADGE_CLASS,
    MUTAGEN_TEXT_CLASS,
} from '@/components/ziwei/ziwei-display';

type StarBadgeStar = ZiweiStarJSON & {
    type: 'major' | 'minor' | 'auxiliary';
};

interface StarBadgeProps {
    star: StarBadgeStar;
    size?: 'sm' | 'md';
}

type StarTone = 'major' | 'minor' | 'malefic' | 'auxiliary';

/**
 * 星名样式：紧凑盘（默认）横排，宽于 @2xl/ziwei 的完整盘竖排（逐字堆叠，不依赖字体的竖排度量）。
 * 紧凑盘主星用 clay 衬线以便在小字号下突出；完整盘主星为正文色大号衬线，辅星次深色、六煞 danger、杂曜小号三级色。
 *
 * 注意：带响应式/容器变体的基础字号不能写成 `text-[Npx]`——全局 font-scale.css 以非分层的
 * `[class~="text-[Npx]"]` 规则覆盖这些类，会压过所有变体。基础字号因此使用 rem 或标准刻度。
 */
const NAME_CLASS: Record<StarTone, Record<'sm' | 'md', string>> = {
    major: {
        sm: 'font-display font-medium text-accent-strong text-[0.8125rem] @2xl/ziwei:text-foreground @2xl/ziwei:text-[17px]',
        md: 'font-display font-medium text-accent-strong text-sm @2xl/ziwei:text-foreground @2xl/ziwei:text-lg',
    },
    minor: {
        sm: 'text-foreground/80 text-[0.625rem] @2xl/ziwei:font-display @2xl/ziwei:text-sm',
        md: 'text-foreground/80 text-xs @2xl/ziwei:font-display @2xl/ziwei:text-[15px]',
    },
    malefic: {
        sm: 'text-danger text-[0.625rem] @2xl/ziwei:font-display @2xl/ziwei:text-sm',
        md: 'text-danger text-xs @2xl/ziwei:font-display @2xl/ziwei:text-[15px]',
    },
    auxiliary: {
        sm: 'text-foreground-tertiary text-[0.625rem] @2xl/ziwei:text-xs',
        md: 'text-foreground-tertiary text-[0.6875rem] @2xl/ziwei:text-[13px]',
    },
};

const META_TEXT_CLASS = 'text-[0.5625rem] leading-none @2xl/ziwei:text-[11px] @2xl/ziwei:leading-tight';

function getStarTone(star: StarBadgeStar): StarTone {
    if (star.type === 'major') return 'major';
    if (star.type === 'auxiliary') return 'auxiliary';
    return MALEFIC_MINOR_STARS.has(star.星名) ? 'malefic' : 'minor';
}

export function StarBadge({ star, size = 'sm' }: StarBadgeProps) {
    const tone = getStarTone(star);
    const birthMutagenClass = star.四化 ? MUTAGEN_BADGE_CLASS[star.四化] : undefined;
    const selfMutagens = [
        star.离心自化 ? { key: 'out', label: `↓${star.离心自化}`, title: `离心自化${star.离心自化}`, mutagen: star.离心自化 } : null,
        star.向心自化 ? { key: 'in', label: `↑${star.向心自化}`, title: `向心自化${star.向心自化}`, mutagen: star.向心自化 } : null,
    ].filter((item): item is { key: string; label: string; title: string; mutagen: string } => item !== null);

    return (
        <span className="inline-flex flex-wrap items-center gap-0.5 whitespace-nowrap leading-tight @2xl/ziwei:flex-col @2xl/ziwei:flex-nowrap @2xl/ziwei:gap-0.5">
            <span className={`inline-flex @2xl/ziwei:flex-col @2xl/ziwei:items-center @2xl/ziwei:leading-[1.12] ${NAME_CLASS[tone][size]}`}>
                {Array.from(star.星名).map((char, index) => <span key={index}>{char}</span>)}
            </span>
            {star.亮度 && (
                <span className={`${META_TEXT_CLASS} text-foreground-tertiary @2xl/ziwei:text-foreground-secondary`}>{star.亮度}</span>
            )}
            {star.四化 && (
                birthMutagenClass ? (
                    <span
                        title={`生年化${star.四化}`}
                        className={`inline-flex size-[13px] items-center justify-center rounded-[3px] text-[0.5625rem] leading-none text-surface @2xl/ziwei:size-4 @2xl/ziwei:rounded @2xl/ziwei:text-[10px] ${birthMutagenClass}`}
                    >
                        {star.四化}
                    </span>
                ) : (
                    <span className={`${META_TEXT_CLASS} text-foreground-secondary`}>{star.四化}</span>
                )
            )}
            {selfMutagens.map((marker) => (
                <span
                    key={marker.key}
                    title={marker.title}
                    className={`${META_TEXT_CLASS} ${MUTAGEN_TEXT_CLASS[marker.mutagen] ?? 'text-foreground-secondary'}`}
                >
                    {marker.label}
                </span>
            ))}
        </span>
    );
}
