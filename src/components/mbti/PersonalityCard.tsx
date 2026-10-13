/**
 * MBTI 性格类型展示卡片
 */
'use client'; // 需要 useState/useEffect 加载人格详情并控制折叠

import { useState, useEffect } from 'react';
import { type Dimension, type MBTIType, type TestResult, type PersonalityData, PERSONALITY_BASICS, loadPersonalityData, getDimensionDescription } from '@/lib/divination/mbti';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface PersonalityCardProps {
    result: TestResult;
    showDimensions?: boolean;  // 是否显示维度分析（默认 true）
}

function getDimensionRows(percentages: TestResult['percentages']): { left: Dimension; right: Dimension; leftPercent: number; rightPercent: number }[] {
    return [
        { left: 'E', right: 'I', leftPercent: percentages.EI.E, rightPercent: percentages.EI.I },
        { left: 'S', right: 'N', leftPercent: percentages.SN.S, rightPercent: percentages.SN.N },
        { left: 'T', right: 'F', leftPercent: percentages.TF.T, rightPercent: percentages.TF.F },
        { left: 'J', right: 'P', leftPercent: percentages.JP.J, rightPercent: percentages.JP.P },
    ];
}

/** 人格类型头部：表情、类型字母、称号与简介。结果页与人格图鉴详情页共用。 */
export function PersonalityHero({ type }: { type: MBTIType }) {
    const basic = PERSONALITY_BASICS[type];
    return (
        <section className="flex flex-col items-center gap-2 rounded-2xl border-[0.5px] border-border bg-surface px-5 py-8 text-center lg:rounded-[20px] lg:px-10 lg:py-10">
            <div className="mb-2 text-6xl lg:text-7xl" aria-hidden="true">{basic.emoji}</div>
            <h1 className="font-display text-5xl font-normal tracking-wide lg:text-6xl">{type}</h1>
            <p className="font-display text-xl text-accent-strong lg:text-2xl">{basic.title}</p>
            <p className="mt-2 max-w-lg text-[0.9375rem] leading-relaxed text-foreground-secondary lg:text-base">
                {basic.description}
            </p>
        </section>
    );
}

function DimensionBar({ left, right, leftPercent, rightPercent }: {
    left: Dimension;
    right: Dimension;
    leftPercent: number;
    rightPercent: number;
}) {
    const leftInfo = getDimensionDescription(left);
    const rightInfo = getDimensionDescription(right);
    const isLeftDominant = leftPercent >= rightPercent;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-between gap-3 text-sm">
                <span className={isLeftDominant ? 'font-medium text-accent-strong' : 'text-foreground-secondary'}>
                    {leftInfo.name} ({left}) {leftPercent}%
                </span>
                <span className={!isLeftDominant ? 'font-medium text-water' : 'text-foreground-secondary'}>
                    {rightPercent}% ({right}) {rightInfo.name}
                </span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-background-tertiary">
                <div
                    className={`h-full transition-all duration-1000 ease-out ${isLeftDominant ? 'bg-clay' : 'bg-transparent'}`}
                    style={{ width: `${leftPercent}%` }}
                />
                <div
                    className={`h-full transition-all duration-1000 ease-out ${!isLeftDominant ? 'bg-water' : 'bg-transparent'}`}
                    style={{ width: `${rightPercent}%` }}
                />
            </div>
        </div>
    );
}

export function PersonalityCard({ result, showDimensions = true }: PersonalityCardProps) {
    const [personalityData, setPersonalityData] = useState<PersonalityData | null>(null);
    const [loading, setLoading] = useState(true);
    const [expandedSections, setExpandedSections] = useState<string[]>(['概览']);

    useEffect(() => {
        loadPersonalityData(result.type).then((data) => {
            setPersonalityData(data);
            setLoading(false);
        });
    }, [result.type]);

    const toggleSection = (section: string) => {
        setExpandedSections(prev =>
            prev.includes(section)
                ? prev.filter(s => s !== section)
                : [...prev, section]
        );
    };

    return (
        <div className="flex animate-fade-in flex-col gap-5 lg:gap-6">
            {/* 头部：类型标识 */}
            <PersonalityHero type={result.type} />

            {/* 维度分析 - 可选显示 */}
            {showDimensions && result.percentages && (
                <section className="flex flex-col gap-5 rounded-2xl border-[0.5px] border-border bg-surface p-5 lg:p-7">
                    <h2 className="font-display text-lg font-medium">维度分析</h2>
                    <div className="flex flex-col gap-5">
                        {getDimensionRows(result.percentages).map((row) => (
                            <DimensionBar key={row.left + row.right} {...row} />
                        ))}
                    </div>
                </section>
            )}

            {/* 详细描述 */}
            {loading ? (
                <div className="flex flex-col gap-3" aria-busy="true">
                    <div className="h-6 w-24 animate-pulse rounded-md bg-background-secondary" />
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="flex items-center justify-between rounded-2xl border-[0.5px] border-border bg-surface p-5">
                            <div className="h-5 w-32 animate-pulse rounded bg-background-secondary" />
                            <div className="h-5 w-5 animate-pulse rounded bg-background-secondary" />
                        </div>
                    ))}
                </div>
            ) : personalityData ? (
                <div className="flex flex-col gap-3">
                    <h2 className="px-1 font-display text-lg font-medium">详细解读</h2>
                    {Object.entries(personalityData.sections).map(([title, content]) => {
                        const expanded = expandedSections.includes(title);
                        return (
                            <section
                                key={title}
                                className="overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface transition-colors hover:border-border-hover"
                            >
                                <button
                                    type="button"
                                    onClick={() => toggleSection(title)}
                                    aria-expanded={expanded}
                                    className="group flex w-full items-center justify-between gap-3 p-5 text-left"
                                >
                                    <span className="font-display text-base text-foreground transition-colors group-hover:text-accent-strong lg:text-[1.0625rem]">
                                        {title}
                                    </span>
                                    {expanded
                                        ? <ChevronUp className="h-5 w-5 shrink-0 text-foreground-tertiary group-hover:text-accent-strong" aria-hidden="true" />
                                        : <ChevronDown className="h-5 w-5 shrink-0 text-foreground-tertiary group-hover:text-accent-strong" aria-hidden="true" />
                                    }
                                </button>
                                {expanded && (
                                    <div className="animate-fade-in px-5 pb-5">
                                        <div className="mb-4 h-px w-full bg-border" />
                                        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary lg:text-[0.9375rem]">
                                            {content}
                                        </p>
                                    </div>
                                )}
                            </section>
                        );
                    })}
                </div>
            ) : (
                <p className="text-center text-sm text-foreground-secondary">加载人格详情失败</p>
            )}
        </div>
    );
}
