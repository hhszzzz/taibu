import type { ReactNode } from 'react';
import type { BaziCanonicalJSON } from 'taibu-core/bazi';
import { calculateProfessionalData, type DaYunInfo, type LiuNianInfo, type LiuYueInfo, type LiuRiInfo } from '@/lib/divination/bazi';
import { DaYunTable } from '@/components/bazi/result/DaYunTable';
import { LiuNianTable } from '@/components/bazi/result/LiuNianTable';
import { LiuYueTable } from '@/components/bazi/result/LiuYueTable';
import { LiuRiTable } from '@/components/bazi/result/LiuRiTable';
import { ProfessionalTable } from '@/components/bazi/result/ProfessionalTable';

/** 区块标题：衬线标题 + 右侧说明 */
function SectionHeading({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="font-display text-lg font-medium text-foreground sm:text-[22px]">{title}</h2>
            {aside && <span className="text-xs text-foreground-secondary sm:text-[13px]">{aside}</span>}
        </div>
    );
}

export function ProfessionalSection({
    canonicalChart,
    proData,
    isUnknownTime = false,
    selectedDaYunIndex,
    onSelectDaYun,
    currentLiuNian,
    selectedLiuNianYear,
    onSelectLiuNian,
    liuYue,
    selectedLiuYueMonth,
    onSelectLiuYue,
    liuRi,
    selectedLiuRiDate,
    onSelectLiuRi,
    activeLiuYue,
}: {
    canonicalChart: BaziCanonicalJSON;
    proData: ReturnType<typeof calculateProfessionalData>;
    isUnknownTime?: boolean;
    selectedDaYunIndex: number;
    onSelectDaYun: (index: number) => void;
    currentLiuNian: LiuNianInfo[];
    selectedLiuNianYear: number;
    onSelectLiuNian: (year: number) => void;
    liuYue: LiuYueInfo[];
    selectedLiuYueMonth: number;
    onSelectLiuYue: (month: number) => void;
    liuRi: LiuRiInfo[];
    selectedLiuRiDate: string;
    onSelectLiuRi: (date: string) => void;
    activeLiuYue: LiuYueInfo | null;
}) {
    // 获取当前选中的运势信息
    const activeDaYun: DaYunInfo | undefined = proData.daYun[selectedDaYunIndex];
    const activeLiuNian: LiuNianInfo | undefined = currentLiuNian.find(ln => ln.year === selectedLiuNianYear);
    const activeLiuRi: LiuRiInfo | undefined = liuRi.find(lr => lr.date === selectedLiuRiDate);
    const relationHighlights = isUnknownTime ? [] : canonicalChart.干支关系;
    const hasGanZhiHighlights = relationHighlights.length > 0;
    const basicInfo = canonicalChart.基本信息;
    const chartFacts = [
        basicInfo.胎元 ? { label: '胎元', value: basicInfo.胎元 } : null,
        basicInfo.命宫 ? { label: '命宫', value: basicInfo.命宫 } : null,
        basicInfo.真太阳时 ? { label: '真太阳时', value: `${basicInfo.真太阳时.真太阳时}（钟表 ${basicInfo.真太阳时.钟表时间}）` } : null,
    ].filter((item): item is { label: string; value: string } => Boolean(item));

    return (
        <div className="flex flex-col gap-6 sm:gap-7">
            <section className="rounded-2xl border-[0.5px] border-border bg-surface px-3 py-2 sm:px-6 sm:py-3">
                <ProfessionalTable
                    canonicalChart={canonicalChart}
                    isUnknownTime={isUnknownTime}
                    // 运势信息
                    activeDaYun={activeDaYun}
                    activeLiuNian={activeLiuNian}
                    activeLiuYue={activeLiuYue ?? undefined}
                    activeLiuRi={activeLiuRi}
                />
                {(chartFacts.length > 0 || hasGanZhiHighlights) && (
                    <dl className="mt-2 flex flex-col gap-1.5 border-t-[0.5px] border-border py-3 text-xs text-foreground-secondary sm:text-[13px]">
                        {chartFacts.length > 0 && (
                            <div className="flex flex-wrap gap-x-5 gap-y-1">
                                {chartFacts.map((fact) => (
                                    <div key={fact.label} className="flex gap-1.5">
                                        <dt className="text-foreground-tertiary">{fact.label}</dt>
                                        <dd className="text-foreground">{fact.value}</dd>
                                    </div>
                                ))}
                            </div>
                        )}
                        {hasGanZhiHighlights && (
                            <div className="flex gap-1.5">
                                <dt className="shrink-0 text-foreground-tertiary">干支关系</dt>
                                <dd className="text-foreground">{relationHighlights.join('、')}</dd>
                            </div>
                        )}
                    </dl>
                )}
            </section>

            <section className="flex flex-col gap-3">
                <SectionHeading
                    title="大运"
                    aside={(
                        <>
                            <span className="sm:hidden">左右滑动 · </span>
                            {proData.startAgeDetail}
                        </>
                    )}
                />
                <DaYunTable
                    daYun={proData.daYun}
                    selectedIndex={selectedDaYunIndex}
                    onSelect={onSelectDaYun}
                    currentIndex={proData.currentDaYunIndex}
                />
            </section>

            {currentLiuNian.length > 0 && (
                <section className="flex flex-col gap-3">
                    <SectionHeading title={activeDaYun ? `流年 · ${activeDaYun.gan}${activeDaYun.zhi}运` : '流年'} />
                    <LiuNianTable
                        liuNian={currentLiuNian}
                        selectedYear={selectedLiuNianYear}
                        onSelect={onSelectLiuNian}
                    />
                </section>
            )}

            {liuYue.length > 0 && (
                <section className="flex flex-col gap-3">
                    <SectionHeading title={`${selectedLiuNianYear}年 · 流月`} aside="点击流月展开流日" />
                    <LiuYueTable
                        liuYue={liuYue}
                        selectedMonth={selectedLiuYueMonth}
                        onSelect={onSelectLiuYue}
                    />
                </section>
            )}

            {liuRi.length > 0 && activeLiuYue && (
                <section className="flex flex-col gap-3">
                    <SectionHeading title="流日" aside={`${activeLiuYue.startDate} — ${activeLiuYue.endDate}`} />
                    <LiuRiTable
                        liuRi={liuRi}
                        selectedDate={selectedLiuRiDate}
                        onSelect={onSelectLiuRi}
                    />
                </section>
            )}
        </div>
    );
}
