/**
 * 合盘结果页面
 *
 * 'use client'：结果从 sessionStorage 读取；解读统一进入 AI 对话
 */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, RotateCw, Sparkles, Lightbulb } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Button } from '@/components/ui/Button';
import { CompatibilityChart } from '@/components/hepan/CompatibilityChart';
import { ConflictPoints } from '@/components/hepan/ConflictPoints';
import { CompatibilityTrendChart, type CompatibilityTrendPoint } from '@/components/hepan/CompatibilityTrendChart';
import {
    type HepanResult,
    getHepanTypeName,
    calculateCompatibilityTrend,
    getRelationshipAdvice,
} from '@/lib/divination/hepan';
import { readSessionJSON } from '@/lib/cache/session-storage';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { openChatWithResult } from '@/lib/chat/result-handoff';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { useHeaderMenu } from '@/components/layout/HeaderMenuContext';
export default function HepanResultPage() {
    const router = useRouter();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const [result, setResult] = useState<HepanResult | null>(null);
    const [trendPeriod, setTrendPeriod] = useState<6 | 12>(6);
    const [kbModalOpen, setKbModalOpen] = useState(false);

    useEffect(() => {
        // 从 sessionStorage 获取结果
        type HepanSession = Omit<HepanResult, 'createdAt'> & {
            createdAt: string;
            chartId?: string;
        };
        const parsed = readSessionJSON<HepanSession>('hepan_result');
        if (parsed) {
            try {
                setResult({
                    ...parsed,
                    createdAt: new Date(parsed.createdAt),
                });
            } catch {
                router.push('/hepan');
            }
        } else {
            router.push('/hepan');
        }
    }, [router]);

    // 计算走势数据（保存原始数据以便复用）
    const rawTrendData = useMemo(() => {
        if (!result) return [];
        return calculateCompatibilityTrend(
            result.person1,
            result.person2,
            trendPeriod
        );
    }, [result, trendPeriod]);

    // 转换为图表所需格式
    const trendData = useMemo((): CompatibilityTrendPoint[] => {
        return rawTrendData.map(t => ({
            month: t.month,
            fullMonth: t.fullMonth,
            score: t.score,
            dimension: t.dimension,
            event: t.event,
        }));
    }, [rawTrendData]);

    // 获取关系发展建议（复用已计算的趋势数据）
    const relationshipAdvice = useMemo(() => {
        if (!result || rawTrendData.length === 0) return [];
        return getRelationshipAdvice(rawTrendData, result.type);
    }, [result, rawTrendData]);

    // 从 result 中提取 chartId（在 early return 之前）
    const chartId = result ? (result as unknown as { chartId?: string }).chartId : undefined;

    /** 问太卜：带上已保存的合盘进入 AI 对话。 */
    const handleAsk = () => {
        if (!result) return;
        openChatWithResult(router, {
            text: '请结合这两人的合盘，分析关系优势、冲突点与相处建议。',
            mentions: chartId ? [{
                type: 'hepan_chart',
                id: chartId,
                name: `合盘 · ${result.person1.name} × ${result.person2.name}`,
                preview: `${result.person1.name} × ${result.person2.name}`,
            }] : [],
        });
    };

    // 设置移动端 Header 菜单项
    useEffect(() => {
        if (!result) return;
        const items = [];
        if (knowledgeBaseEnabled && chartId) {
            items.push({
                id: 'add-to-kb',
                label: '加入知识库',
                onClick: () => setKbModalOpen(true),
            });
        }
        items.push({
            id: 'reanalyze',
            label: '重新分析',
            icon: <RotateCw className="w-4 h-4" />,
            onClick: () => router.push('/hepan'),
        });
        setMenuItems(items);
        return () => clearMenuItems();
    }, [chartId, knowledgeBaseEnabled, result, router, setMenuItems, clearMenuItems]);

    if (!result) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <SoundWaveLoader variant="block" text="" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5 px-4 pb-10 pt-4 sm:gap-6 sm:px-6 lg:px-8 lg:pb-16 lg:pt-7 motion-stagger">
                {/* 头部导航 - 仅桌面端显示 */}
                <div className="hidden items-center justify-between lg:flex">
                    <Link
                        href="/hepan"
                        className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary transition-colors hover:text-foreground"
                    >
                        <ChevronLeft className="h-4 w-4" />
                        返回列表
                    </Link>
                    {knowledgeBaseEnabled && !!chartId && (
                        <Button unstyled
                            type="button"
                            onClick={() => setKbModalOpen(true)}
                            className="inline-flex h-10 items-center rounded-xl border-[0.5px] border-border-hover bg-surface px-3.5 text-sm text-foreground transition-colors hover:bg-background-secondary"
                        >
                            加入知识库
                        </Button>
                    )}
                </div>

                {/* 标题 */}
                <header className="flex flex-col items-center gap-2 text-center lg:items-start lg:text-left">
                    <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs text-accent-strong">
                        {getHepanTypeName(result.type)}分析
                    </span>
                    <h1 className="flex flex-wrap items-center justify-center gap-x-3 font-display text-[1.75rem] font-normal leading-tight text-foreground lg:justify-start lg:text-[2rem]">
                        <span>{result.person1.name}</span>
                        <span className="text-foreground-tertiary">&amp;</span>
                        <span>{result.person2.name}</span>
                    </h1>
                </header>

                {/* 兼容性图表 */}
                <CompatibilityChart
                    dimensions={result.dimensions}
                    overallScore={result.overallScore}
                />

                {/* 走势曲线 */}
                <CompatibilityTrendChart
                    data={trendData}
                    period={trendPeriod}
                    onPeriodChange={setTrendPeriod}
                />

                {/* 发展建议 */}
                {relationshipAdvice.length > 0 && (
                    <section className="rounded-2xl border-[0.5px] border-border bg-surface p-5 sm:p-6">
                        <h2 className="mb-3 flex items-center gap-2 font-display text-lg text-foreground">
                            <Lightbulb className="h-[18px] w-[18px] text-clay" />
                            发展建议
                        </h2>
                        <ul className="space-y-2.5">
                            {relationshipAdvice.map((advice, idx) => (
                                <li
                                    key={idx}
                                    className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground-secondary"
                                >
                                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-clay" />
                                    {advice}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* 冲突点 */}
                <ConflictPoints conflicts={result.conflicts} hepanType={result.type} />

                {/* 解读入口：页内不再生成解读，统一进入 AI 对话 */}
                <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-[0.5px] border-border bg-surface p-5 sm:p-6">
                    <div className="flex min-w-0 flex-col gap-1">
                        <h2 className="flex items-center gap-2 font-display text-lg text-foreground sm:text-xl">
                            <Sparkles className="h-[18px] w-[18px] text-clay" />
                            合盘解读
                        </h2>
                        <p className="text-sm text-foreground-secondary">带上两人的合盘进入 AI 对话，由太卜在对话里展开分析。</p>
                    </div>
                    <Button unstyled
                        type="button"
                        onClick={handleAsk}
                        className="h-11 rounded-xl bg-accent px-6 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                    >
                        问太卜
                    </Button>
                </section>

                {/* 操作按钮 */}
                <div className="flex justify-center pt-2">
                    <Link
                        href="/hepan"
                        className="inline-flex h-11 items-center gap-2 rounded-xl border-[0.5px] border-border-hover bg-surface px-6 text-sm font-medium text-foreground transition-colors hover:bg-background-secondary"
                    >
                        <RotateCw className="h-4 w-4" />
                        重新分析
                    </Link>
                </div>
            </div>

            {knowledgeBaseEnabled && chartId && (
                <AddToKnowledgeBaseModal
                    open={kbModalOpen}
                    onClose={() => setKbModalOpen(false)}
                    sourceTitle={`${result.person1.name} × ${result.person2.name}`}
                    sourceType="hepan_chart"
                    sourceId={chartId}
                />
            )}
        </div>
    );
}
