import type { ZiweiPalaceFlight, ZiweiPalaceFlights } from '@/lib/divination/ziwei';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { MUTAGEN_BADGE_CLASS, MUTAGEN_ORDER, MUTAGEN_TEXT_CLASS } from '@/components/ziwei/ziwei-display';

interface ZiweiFlyingStarPanelProps {
    /** 十二宫飞化；null 表示仍在计算。 */
    palaces: ZiweiPalaceFlights[] | null;
    failed?: boolean;
    /** 当前飞出宫（宫名）；null 表示未选宫。 */
    selectedPalace: string | null;
    onSelectPalace: (palace: string) => void;
}

const MATRIX_COLUMNS_CLASS = 'grid grid-cols-[minmax(0,1.15fr)_repeat(4,minmax(0,1fr))] items-center gap-x-2 lg:grid-cols-[minmax(0,0.9fr)_repeat(4,minmax(0,1.5fr))]';

function flightOf(entry: ZiweiPalaceFlights, mutagen: string): ZiweiPalaceFlight | undefined {
    return entry.flights.find((flight) => flight.mutagen === mutagen);
}

function describeFlight(source: string, flight: ZiweiPalaceFlight | undefined, mutagen: string): string {
    if (!flight?.targetPalace) return `化${mutagen}无落宫`;
    const star = flight.starName ? `${flight.starName}` : '';
    return flight.targetPalace === source ? `${star}化${mutagen}自化` : `${star}化${mutagen}入${flight.targetPalace}`;
}

/** 飞星模式下的宫干飞化：上方为飞出宫四化摘要，下方为十二宫飞化总表（点行切换飞出宫）。 */
export function ZiweiFlyingStarPanel({ palaces, failed = false, selectedPalace, onSelectPalace }: ZiweiFlyingStarPanelProps) {
    if (failed) {
        return (
            <section className="rounded-2xl border-[0.5px] border-border bg-surface px-4 py-3.5 text-sm text-foreground-secondary lg:px-[22px] lg:py-[18px]">
                飞星数据暂时无法计算，请稍后重试。
            </section>
        );
    }
    if (!palaces) {
        return (
            <section className="flex items-center gap-2 rounded-2xl border-[0.5px] border-border bg-surface px-4 py-3.5 text-sm text-foreground-secondary lg:px-[22px] lg:py-[18px]">
                <SoundWaveLoader variant="inline" />
                正在推算宫干飞化
            </section>
        );
    }

    const selected = palaces.find((entry) => entry.palace === selectedPalace) ?? null;

    return (
        <section aria-label="宫干飞化" className="flex flex-col gap-4 rounded-2xl border-[0.5px] border-border bg-surface p-4 lg:px-[22px] lg:py-[18px]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="font-display text-[17px]">
                    {selected ? <>{selected.palace} · {selected.ganZhi}<span className="ml-2 text-sm text-foreground-secondary">宫干「{selected.ganZhi.charAt(0)}」飞化</span></> : '宫干飞化'}
                </h2>
                <span className="text-xs text-foreground-secondary">点命盘宫位或下表任一行，切换飞出宫</span>
            </div>

            {selected ? (
                <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {MUTAGEN_ORDER.map((mutagen) => {
                        const flight = flightOf(selected, mutagen);
                        const isSelf = flight?.targetPalace === selected.palace;
                        return (
                            <li key={mutagen} className="flex items-center gap-2.5 rounded-xl bg-background px-3 py-2.5">
                                <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md text-xs text-surface ${MUTAGEN_BADGE_CLASS[mutagen]}`}>{mutagen}</span>
                                <span className="min-w-0 text-[13px] leading-snug">
                                    <span className="block font-display text-[15px]">{flight?.starName ?? '—'}</span>
                                    <span className="text-foreground-secondary">
                                        {flight?.targetPalace ? (isSelf ? '自化 · 留在本宫' : `飞入${flight.targetPalace}`) : '无落宫'}
                                    </span>
                                </span>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <p className="text-[13px] text-foreground-secondary">点选任一宫位，查看其宫干化出的禄、权、科、忌落入何宫。</p>
            )}

            <div className="flex flex-col">
                <div aria-hidden="true" className={`${MATRIX_COLUMNS_CLASS} border-b-[0.5px] border-border px-2 pb-1.5 text-[11px] text-foreground-secondary`}>
                    <span>宫位</span>
                    {MUTAGEN_ORDER.map((mutagen) => <span key={mutagen} className={MUTAGEN_TEXT_CLASS[mutagen]}>化{mutagen}</span>)}
                </div>
                <ul aria-label="十二宫飞化总表">
                    {palaces.map((entry) => {
                        const isSelected = entry.palace === selectedPalace;
                        return (
                            <li key={entry.palace}>
                                <button
                                    type="button"
                                    aria-pressed={isSelected}
                                    aria-label={`${entry.palace}（${entry.ganZhi}）：${MUTAGEN_ORDER.map((mutagen) => describeFlight(entry.palace, flightOf(entry, mutagen), mutagen)).join('，')}`}
                                    onClick={() => onSelectPalace(entry.palace)}
                                    className={`${MATRIX_COLUMNS_CLASS} w-full rounded-lg px-2 py-[7px] text-left text-[13px] transition-colors ${isSelected ? 'bg-accent-light' : 'hover:bg-background-secondary'}`}
                                >
                                    <span className={`truncate ${isSelected ? 'text-accent-strong' : ''}`}>
                                        {entry.palace}
                                        <span className="ml-1 text-[11px] text-foreground-tertiary">{entry.ganZhi.charAt(0)}</span>
                                    </span>
                                    {MUTAGEN_ORDER.map((mutagen) => {
                                        const flight = flightOf(entry, mutagen);
                                        const isSelf = flight?.targetPalace === entry.palace;
                                        return (
                                            <span key={mutagen} className="min-w-0 truncate">
                                                {flight?.starName && <span className="hidden text-foreground-secondary lg:inline">{flight.starName} → </span>}
                                                <span className={MUTAGEN_TEXT_CLASS[mutagen]}>{flight?.targetPalace ? (isSelf ? '自化' : flight.targetPalace) : '—'}</span>
                                            </span>
                                        );
                                    })}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </section>
    );
}
