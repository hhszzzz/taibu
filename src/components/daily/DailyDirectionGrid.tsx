interface DailyDirectionGridProps {
    /** 当日干支（居中显示）。 */
    dayGanZhi: string;
    caiShen: string;
    xiShen: string;
    fuShen: string;
    yangGui: string;
    /** 阴贵方位：来自 core 黄历细项，计算完成前可缺省。 */
    yinGui?: string;
    /** 煞方（单字方位，如「东」）。 */
    sha: string;
    /** 胎神占方原文（如「仓库床 外正东」），仅解析「外 + 方位」。 */
    taiShen: string;
}

type DirectionKey = '西北' | '正北' | '东北' | '正西' | '正东' | '西南' | '正南' | '东南';

/** 上北下南、左西右东的九宫排布；null 为中宫。 */
const GRID: ReadonlyArray<DirectionKey | null> = ['西北', '正北', '东北', '正西', null, '正东', '西南', '正南', '东南'];
const DIRECTION_SET: ReadonlySet<string> = new Set(GRID.filter((item): item is DirectionKey => item !== null));
const SINGLE_TO_DIRECTION: Record<string, DirectionKey> = { 东: '正东', 西: '正西', 南: '正南', 北: '正北' };
const TAISHEN_OUTER_PATTERN = /外(正东|正西|正南|正北|东北|东南|西北|西南)/u;

type CellTone = 'sha' | 'god' | 'plain';

const CELL_TONE_CLASS: Record<CellTone, { cell: string; label: string; value: string }> = {
    sha: { cell: 'bg-fire-soft', label: 'text-fire', value: 'text-fire' },
    god: { cell: 'bg-accent-light', label: 'text-accent-strong', value: 'text-accent-strong' },
    plain: { cell: 'bg-background', label: 'text-foreground-secondary', value: 'text-foreground' },
};

function normalizeDirection(value: string | undefined): DirectionKey | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (DIRECTION_SET.has(trimmed)) return trimmed as DirectionKey;
    return SINGLE_TO_DIRECTION[trimmed] ?? null;
}

/** 方位九宫：财神 / 喜神 / 福神 / 阳贵 / 阴贵 / 煞 / 胎神（仅外方位）。 */
export function DailyDirectionGrid({ dayGanZhi, caiShen, xiShen, fuShen, yangGui, yinGui, sha, taiShen }: DailyDirectionGridProps) {
    const entries: Array<{ direction: DirectionKey | null; label: string; tone: CellTone }> = [
        { direction: normalizeDirection(yangGui), label: '阳贵', tone: 'plain' },
        { direction: normalizeDirection(yinGui), label: '阴贵', tone: 'plain' },
        { direction: normalizeDirection(caiShen), label: '财神', tone: 'god' },
        { direction: normalizeDirection(xiShen), label: '喜神', tone: 'god' },
        { direction: normalizeDirection(fuShen), label: '福神', tone: 'god' },
        { direction: normalizeDirection(sha), label: '煞', tone: 'sha' },
        { direction: normalizeDirection(taiShen.match(TAISHEN_OUTER_PATTERN)?.[1]), label: '胎神', tone: 'sha' },
    ];

    return (
        <div className="flex flex-col gap-2">
            <span className="text-[13px] text-foreground-secondary">方位 · 上北下南</span>
            <div className="grid grid-cols-3 gap-1 text-center text-xs">
                {GRID.map((direction) => {
                    if (direction === null) {
                        return (
                            <div key="center" className="flex h-[58px] items-center justify-center rounded-lg bg-foreground font-display text-base text-background">
                                {dayGanZhi}
                            </div>
                        );
                    }
                    const gods = entries.filter((entry) => entry.direction === direction);
                    const tone: CellTone = gods.some((god) => god.tone === 'sha')
                        ? 'sha'
                        : gods.some((god) => god.tone === 'god') ? 'god' : 'plain';
                    const toneClass = CELL_TONE_CLASS[tone];
                    return (
                        <div key={direction} className={`flex h-[58px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 ${toneClass.cell}`}>
                            <span className={toneClass.label}>{direction}</span>
                            {gods.length > 0 && (
                                <span className={`font-display text-sm leading-tight ${toneClass.value}`}>
                                    {gods.map((god) => god.label).join(' · ')}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
