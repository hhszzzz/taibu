/**
 * 大六壬课盘：三传、四课与天地盘
 *
 * 'use client'：Agent 视图的 ChartTarget 交互需要点击回调。
 * 结果页与聊天 Agent（CanonicalChartView，约 480px）共用同一组件；
 * 布局按容器宽度切换：窄栏依次为三传 / 四课 / 天地盘，宽栏为天地盘居左、三传四课居右。
 */
'use client';

import type { ReactNode } from 'react';
import type { DaliurenCanonicalJSON } from 'taibu-core/daliuren';
import { TianDiPanGrid } from './TianDiPanGrid';
import { ChartTarget, isChartTargetSelected, type ChartInteraction } from '@/components/visualization/ChartTarget';
import { getGanZhiTextClass, isPlaceholder, splitLabel } from './daliuren-display';

/** 四课自右向左：四课 → 一课 */
const LESSON_ORDER = ['四课', '三课', '二课', '一课'] as const;

const CARD_CLASS = 'flex min-w-0 flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-surface p-4 @3xl:gap-3.5 @3xl:px-[22px] @3xl:py-5';

function SectionHeader({ title, hint }: { title: string; hint?: ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-[1.0625rem] font-medium text-foreground @3xl:text-xl">{title}</h3>
            {hint && <span className="text-xs text-foreground-secondary">{hint}</span>}
        </div>
    );
}

/**
 * 窄栏为时间线：陶土色徽标 + 「初传 发端」/ 天将 · 六亲两行；
 * 宽栏按设计稿排成四列：传序（上下两行）· 五行着色的大字 · 天将 · 六亲 · 遁干。
 * 两种字形各占一个节点并按容器宽度切换显示，传序 ChartTarget 只渲染一次。
 */
function TransmissionTimeline({ chart, interaction }: { chart: DaliurenCanonicalJSON; interaction?: ChartInteraction }) {
    return (
        <ol className="flex flex-col gap-3">
            {chart.三传.map((step, index) => {
                const { name, note } = splitLabel(step.传序);
                const isLast = index === chart.三传.length - 1;
                return (
                    <li
                        key={index}
                        data-chart-selected={isChartTargetSelected(interaction, 'daliuren:transmission:' + index) || undefined}
                        className="relative grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-xl @3xl:grid-cols-[56px_44px_minmax(0,1fr)_auto]"
                    >
                        {!isLast && <span aria-hidden className="absolute left-[21.5px] top-11 -bottom-3 w-px bg-accent/35 @3xl:hidden" />}
                        <span className="col-start-1 row-span-2 row-start-1 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft font-display text-[22px] text-accent-strong @3xl:hidden">
                            {step.地支}
                        </span>
                        <span className="col-start-2 row-start-1 self-end text-sm font-medium text-foreground @3xl:col-start-1 @3xl:row-span-2 @3xl:self-center @3xl:text-xs @3xl:font-normal @3xl:leading-normal @3xl:text-accent-strong">
                            <ChartTarget interaction={interaction} id={'daliuren:transmission:' + index}>{name}</ChartTarget>
                            {note && <span className="ml-1 text-xs font-normal text-foreground-secondary @3xl:ml-0 @3xl:block">{note}</span>}
                        </span>
                        <span className={`hidden font-display text-[30px] leading-none @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1 @3xl:block ${getGanZhiTextClass(step.地支)}`}>
                            {step.地支}
                        </span>
                        <span className="col-start-2 row-start-2 self-start truncate text-[0.8125rem] text-foreground-secondary @3xl:col-start-3 @3xl:row-span-2 @3xl:row-start-1 @3xl:self-center @3xl:text-sm @3xl:text-foreground">
                            {[step.天将, step.六亲].filter(value => !isPlaceholder(value)).join(' · ')}
                        </span>
                        <span className="col-start-3 row-span-2 row-start-1 text-xs text-foreground-secondary @3xl:col-start-4 @3xl:text-[0.8125rem]">
                            遁 <span className="font-display text-[0.9375rem] text-foreground @3xl:font-sans @3xl:text-[0.8125rem] @3xl:text-foreground-secondary">{isPlaceholder(step.遁干) ? '—' : step.遁干}</span>
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

function LessonColumns({ chart, interaction }: { chart: DaliurenCanonicalJSON; interaction?: ChartInteraction }) {
    return (
        <div className="grid grid-cols-4 gap-1.5">
            {LESSON_ORDER.map(prefix => {
                const lesson = chart.四课.find(item => item.课别.startsWith(prefix));
                const index = lesson ? chart.四课.indexOf(lesson) : -1;
                // 课别括注（干上 / 干阴 / 支上 / 支阴）与课序一一对应，按设计稿只显示课序
                const { name } = splitLabel(lesson?.课别 ?? prefix);
                const isFirst = prefix === '一课';
                return (
                    <div
                        key={prefix}
                        data-chart-selected={isChartTargetSelected(interaction, 'daliuren:lesson:' + index) || undefined}
                        className={`flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-center @3xl:gap-1.5 @3xl:rounded-[10px] ${isFirst ? 'bg-accent-soft' : 'bg-background'}`}
                    >
                        <span className={`text-[11px] ${isFirst ? 'text-accent-strong' : 'text-foreground-secondary'}`}>
                            {lesson ? <ChartTarget interaction={interaction} id={'daliuren:lesson:' + index}>{name}</ChartTarget> : name}
                        </span>
                        <span className="text-[0.6875rem] text-foreground @3xl:text-xs">{lesson?.乘将 ?? '—'}</span>
                        <span className={`font-display text-[1.375rem] leading-tight @3xl:text-2xl ${getGanZhiTextClass(lesson?.上神)}`}>{lesson?.上神 ?? '—'}</span>
                        <span aria-hidden className="h-px w-[22px] bg-border-hover @3xl:hidden" />
                        <span className={`font-display text-lg leading-tight @3xl:text-xl ${getGanZhiTextClass(lesson?.下神)}`}>{lesson?.下神 ?? '—'}</span>
                    </div>
                );
            })}
        </div>
    );
}

/** The same returned board is used by the result page and Agent workflow. */
export function DaliurenChart({ chart, interaction, includeRelated = true, aside }: {
    chart: DaliurenCanonicalJSON;
    interaction?: ChartInteraction;
    includeRelated?: boolean;
    /** 结果页在三传 / 四课一栏底部追加的内容（如解读入口）；Agent 视图不传 */
    aside?: ReactNode;
}) {
    const relatedBranches = interaction && includeRelated ? [
        ...chart.三传.flatMap((step, index) => interaction.selectedIds.includes('daliuren:transmission:' + index) ? [step.地支] : []),
        ...chart.四课.flatMap((lesson, index) => interaction.selectedIds.includes('daliuren:lesson:' + index) ? [lesson.上神] : []),
    ] : [];
    const boardInteraction = interaction ? { ...interaction, selectedIds: [...interaction.selectedIds, ...chart.天地盘.flatMap((palace, index) => relatedBranches.includes(palace.天盘) ? ['daliuren:palace:' + index] : [])] } : undefined;
    return (
        <div className="@container w-full">
            {/* 宽档两栏按设计稿的 flex 560px / 340px 等量分配剩余宽度：右栏 = 50% − 122px，不窄于 300px */}
            <div className="flex flex-col gap-3 @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_max(300px,calc(50%_-_122px))] @3xl:grid-rows-[auto_auto_1fr] @3xl:gap-x-6 @3xl:gap-y-[18px]">
                <section aria-label="三传" className={`${CARD_CLASS} order-1 @3xl:order-none @3xl:col-start-2 @3xl:row-start-1`}>
                    <SectionHeader title="三传" hint={<span className="@3xl:hidden">初 → 中 → 末</span>} />
                    <TransmissionTimeline chart={chart} interaction={interaction} />
                </section>
                <section aria-label="四课" className={`${CARD_CLASS} order-2 @3xl:order-none @3xl:col-start-2 @3xl:row-start-2`}>
                    <SectionHeader title="四课" hint="自右向左" />
                    <LessonColumns chart={chart} interaction={interaction} />
                </section>
                <section
                    aria-label="天地盘"
                    className="order-3 flex min-w-0 flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-surface px-3 py-4 @3xl:order-none @3xl:col-start-1 @3xl:row-span-3 @3xl:row-start-1 @3xl:gap-2.5 @3xl:border-0 @3xl:bg-transparent @3xl:p-0"
                >
                    <SectionHeader
                        title="天地盘"
                        hint={<><span className="@3xl:hidden">大字天盘 · 角标地盘 · 遁干</span><span className="hidden @3xl:inline">大字为天盘，角标为地盘 · 遁干</span></>}
                    />
                    <TianDiPanGrid result={chart} interaction={boardInteraction} />
                </section>
                {aside && <div className="order-4 min-w-0 @3xl:order-none @3xl:col-start-2 @3xl:row-start-3 @3xl:self-start">{aside}</div>}
            </div>
        </div>
    );
}
