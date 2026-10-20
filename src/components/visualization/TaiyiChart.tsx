'use client';
// 'use client'：对话命盘中的 ChartTarget 需要点击交互。
import type { TaiyiCanonicalJSON } from 'taibu-core/taiyi';
import { ChartTarget, chartSelected, type ChartInteraction } from './ChartTarget';
import { BoardFacts } from './BoardFacts';

const SPIRIT_FIELDS = ['太乙', '文昌', '始击', '计神', '合神', '太岁'] as const;
const SIDES = [
    { name: '主', fields: ['主算', '主大将', '主参将'] as const },
    { name: '客', fields: ['客算', '客大将', '客参将'] as const },
];
const CARD = 'rounded-xl border-[0.5px] border-border bg-surface';
const SELECTED = 'data-[chart-selected=true]:border-accent data-[chart-selected=true]:bg-accent-light';

/** 太乙盘：时空底盘在上；传统七十二局为十六宫 + 神将 + 主客算，九星法为四层观测卡；古典参考可展开。 */
export function TaiyiChart({ chart, interaction }: { chart: TaiyiCanonicalJSON; interaction?: ChartInteraction }) {
    const base = chart.问卜与时空底盘;
    const env = chart.外部时空环境;
    const board = chart.太乙七十二局;
    const classic = [chart.古典参考.主诀原文, chart.古典参考.使用提示].filter(Boolean);
    return <div className="@container flex flex-col gap-3">
        <BoardFacts label="时空底盘" facts={[
            { label: '时间', value: [base.时间, base.分钟段].filter(Boolean).join(' · ') },
            { label: '农历', value: [base.农历, base.节气].filter(Boolean).join(' · ') },
            { label: '四柱', value: <span className="flex gap-2 font-display">{base.四柱.split(' ').map((pillar, index) => <span key={index}>{pillar}</span>)}</span> },
            { label: '值日', value: `星宿 ${env.星宿} · 值星 ${env.值星} · 天神 ${env.天神}` },
            { label: '能量', value: chart.核心物理关系.能量交互 },
        ]} />
        {board ? <>
            <p className="px-1 text-xs text-foreground-secondary">{board.流派} · <span className="font-display text-sm text-foreground">{board.局式}</span> · 积数 {board.积数}</p>
            <section aria-label="十六宫" className="grid grid-cols-4 gap-1.5 @2xl:grid-cols-8">{board.十六宫.map((palace, index) => {
                const id = 'taiyi:palace:' + index;
                const hasTaiyi = palace.星将.includes('太乙');
                return <article key={index} data-chart-selected={chartSelected(interaction, id)}
                    className={`${CARD} ${SELECTED} flex min-w-0 flex-col gap-1 px-2 py-1.5 ${hasTaiyi ? 'bg-accent-soft' : ''}`}>
                    <span className="flex items-baseline justify-between gap-1">
                        <ChartTarget interaction={interaction} id={id} className="font-display text-base">{palace.宫位}</ChartTarget>
                        <span className="truncate text-[0.6875rem] text-foreground-tertiary">{palace.宫神}</span>
                    </span>
                    <span className="flex min-h-4 flex-wrap gap-x-1.5 gap-y-0.5 text-xs">
                        {palace.星将.map((star, starIndex) => <ChartTarget key={starIndex} interaction={interaction} id={id + ':star:' + starIndex}
                            className={star === '太乙' ? 'text-accent-strong' : 'text-foreground-secondary'}>{star}</ChartTarget>)}
                    </span>
                </article>;
            })}</section>
            <div className="grid gap-1.5 @xl:grid-cols-[3fr_2fr]">
                <section aria-label="神将" className="grid grid-cols-3 gap-1.5 @md:grid-cols-6 @xl:grid-cols-3">{SPIRIT_FIELDS.map(field =>
                    <div key={field} data-chart-selected={chartSelected(interaction, 'taiyi:field:' + field)} className={`${CARD} ${SELECTED} flex flex-col items-center px-2 py-1.5`}>
                        <ChartTarget interaction={interaction} id={'taiyi:field:' + field} className="text-xs text-foreground-secondary">{field}</ChartTarget>
                        <span className="font-display text-lg">{board[field]}</span>
                    </div>)}</section>
                <section aria-label="主客算" className={`${CARD} grid grid-cols-[auto_repeat(3,minmax(0,1fr))] items-center gap-x-2 gap-y-1 px-3 py-2 text-center`}>
                    <span />{['算', '大将', '参将'].map(name => <span key={name} className="text-xs text-foreground-tertiary">{name}</span>)}
                    {SIDES.map(side => <div key={side.name} className="contents">
                        <span className="font-display text-sm text-foreground-secondary">{side.name}</span>
                        {side.fields.map(field => <span key={field} data-chart-selected={chartSelected(interaction, 'taiyi:field:' + field)}
                            className="rounded-md data-[chart-selected=true]:bg-accent-light">
                            <ChartTarget interaction={interaction} id={'taiyi:field:' + field} className="font-display text-lg">{board[field]}</ChartTarget>
                        </span>)}
                    </div>)}
                </section>
            </div>
        </> : <section aria-label="九星阵列" className="grid grid-cols-2 gap-1.5 @2xl:grid-cols-4">{chart.九星阵列.map((star, index) => {
            const id = 'taiyi:star:' + index;
            return <article key={index} data-chart-selected={chartSelected(interaction, id)} className={`${CARD} ${SELECTED} flex min-w-0 flex-col gap-1 px-3 py-2.5`}>
                <span className="text-xs text-foreground-tertiary">{star.观测层级}</span>
                <span className="flex items-baseline gap-1.5">
                    <ChartTarget interaction={interaction} id={id} className="font-display text-lg">{star.太乙名}</ChartTarget>
                    <span className="text-xs text-foreground-secondary">{star.神性}</span>
                </span>
                <span className="text-xs text-foreground-secondary">{star.北斗名} · {star.映射参考}</span>
                <span className="text-xs text-foreground-secondary">{star.五行} · {star.方位} · {star.宫位}宫</span>
            </article>;
        })}</section>}
        {classic.length > 0 && <details className={`${CARD} px-3.5 py-2.5`}>
            <summary className="cursor-pointer text-xs text-foreground-secondary">古典参考</summary>
            <div className="mt-2 flex flex-col gap-1.5 text-[0.8125rem] leading-relaxed">
                {chart.古典参考.主诀原文 && <p className="font-display text-foreground">{chart.古典参考.主诀原文}</p>}
                {chart.古典参考.使用提示 && <p className="text-foreground-tertiary">{chart.古典参考.使用提示}</p>}
            </div>
        </details>}
    </div>;
}
