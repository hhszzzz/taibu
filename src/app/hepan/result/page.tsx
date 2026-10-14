/**
 * 合盘结果页面
 *
 * 'use client'：结果从 sessionStorage 读取，AI 解读为流式交互
 */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, RotateCw, Sparkles, Lightbulb, RefreshCw, Quote } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { CompatibilityChart } from '@/components/hepan/CompatibilityChart';
import { ConflictPoints } from '@/components/hepan/ConflictPoints';
import { CompatibilityTrendChart, type CompatibilityTrendPoint } from '@/components/hepan/CompatibilityTrendChart';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import {
    type HepanResult,
    getHepanTypeName,
    calculateCompatibilityTrend,
    getRelationshipAdvice,
} from '@/lib/divination/hepan';
import { readSessionJSON } from '@/lib/cache/session-storage';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import { AuthModal } from '@/components/auth/AuthModal';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { useHeaderMenu } from '@/components/layout/HeaderMenuContext';
import { CreditsModal } from '@/components/ui/CreditsModal';
import { useStreamingResponse, isCreditsError } from '@/lib/hooks/useStreamingResponse';
import { useAnalysisSnapshot } from '@/lib/hooks/useAnalysisSnapshot';
import { runSharedAnalysisFlow } from '@/lib/ai/analysis-runner';
export default function HepanResultPage() {
    const router = useRouter();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const [result, setResult] = useState<HepanResult | null>(null);
    const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
    const [analysisReasoning, setAnalysisReasoning] = useState<string | null>(null);
    const [loadingAI, setLoadingAI] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [trendPeriod, setTrendPeriod] = useState<6 | 12>(6);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const errorBanner = error ? (
        <p data-testid="analysis-error" role="alert" className="mb-4 rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>
    ) : null;
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [kbModalOpen, setKbModalOpen] = useState(false);
    const [showCreditsModal, setShowCreditsModal] = useState(false);
    // 使用共享的流式响应 hook
    const streaming = useStreamingResponse();
    const { user, membershipInfo, membershipLoading, membershipResolved } = useSessionMembership();
    const membershipPending = membershipLoading || !membershipResolved;
    const membershipType = membershipResolved ? (membershipInfo?.type ?? 'free') : 'free';
    const currentUser = user ? { id: user.id } : null;

    useEffect(() => {
        // 从 sessionStorage 获取结果
        type HepanSession = Omit<HepanResult, 'createdAt'> & {
            createdAt: string;
            chartId?: string;
            conversationId?: string | null;
        };
        const parsed = readSessionJSON<HepanSession>('hepan_result');
        if (parsed) {
            try {
                setResult({
                    ...parsed,
                    createdAt: new Date(parsed.createdAt),
                });
                setConversationId(parsed.conversationId || null);
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

    const handleGetAIAnalysis = async () => {
        if (!result || !currentUser) return;

        setLoadingAI(true);
        streaming.reset();
        setError(null);
        setAnalysisReasoning(null);
        setAiAnalysis(null);

        try {
            const baseBody = {
                result,
                chartId: (result as unknown as { chartId?: string }).chartId,
            };
            const analysisResult = await runSharedAnalysisFlow({
                endpoint: '/api/hepan',
                streaming,
                isCreditsError,
                direct: {
                    prepareBody: { action: 'analyze_prepare', ...baseBody },
                    persistBody: { action: 'analyze_persist', ...baseBody },
                },
                streamBody: {
                    action: 'analyze',
                    ...baseBody,
                    modelId: selectedModel,
                    reasoning: reasoningEnabled,
                    stream: true,
                },
            });
            if (analysisResult.requiresCredits) {
                setShowCreditsModal(true);
                return;
            }
            if (analysisResult.error) {
                throw new Error(analysisResult.error);
            }
            if (analysisResult.content) {
                setAiAnalysis(analysisResult.content);
            } else {
                setAiAnalysis('分析失败，请重试');
            }
            if (analysisResult.reasoning) {
                setAnalysisReasoning(analysisResult.reasoning);
            }
            if (analysisResult.conversationId) {
                setConversationId(analysisResult.conversationId);
            }

        } catch (err) {
            setError(err instanceof Error ? err.message : '分析失败');
        } finally {
            setLoadingAI(false);
        }
    };

    useAnalysisSnapshot({
        conversationId,
        recordId: (result as unknown as { chartId?: string })?.chartId,
        divinationType: 'hepan',
        sessionKey: 'hepan_result',
        hasExistingAnalysis: !!aiAnalysis,
        skip: !result,
        callbacks: {
            onAnalysis: setAiAnalysis,
            onReasoning: setAnalysisReasoning,
            onModelId: setSelectedModel,
            onReasoningEnabled: setReasoningEnabled,
            onConversationIdResolved: setConversationId,
        },
    });

    // 从 result 中提取 chartId（在 early return 之前）
    const chartId = result ? (result as unknown as { chartId?: string }).chartId : undefined;

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
            <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5 px-4 pb-10 pt-4 sm:gap-6 sm:px-6 lg:px-8 lg:pb-16 lg:pt-7 animate-fade-in">
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
                        <button
                            type="button"
                            onClick={() => setKbModalOpen(true)}
                            className="inline-flex h-10 items-center rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3.5 text-sm text-foreground transition-colors hover:bg-background-secondary"
                        >
                            加入知识库
                        </button>
                    )}
                </div>

                {/* 标题 */}
                <header className="flex flex-col items-center gap-2 text-center lg:items-start lg:text-left">
                    <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs text-accent-strong">
                        {getHepanTypeName(result.type)}分析
                    </span>
                    <h1 className="flex flex-wrap items-center justify-center gap-x-3 font-display text-[1.75rem] font-normal leading-tight text-foreground lg:justify-start lg:text-[34px]">
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

                {/* AI 深度分析 */}
                <AIFeatureGate><section className="rounded-2xl border-[0.5px] border-border bg-surface p-5 sm:p-6">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                        <h2 className="flex items-center gap-2 font-display text-lg text-foreground sm:text-xl">
                            <Sparkles className="h-[18px] w-[18px] text-clay" />
                            AI 深度洞察
                        </h2>
                        <div className="flex items-center gap-2">
                            <ModelSelector
                                compact
                                selectedModel={selectedModel}
                                onModelChange={setSelectedModel}
                                reasoningEnabled={reasoningEnabled}
                                onReasoningChange={setReasoningEnabled}
                                userId={currentUser?.id}
                                membershipType={membershipType}
                                disabled={membershipPending}
                            />
                            {aiAnalysis && (
                                <button
                                    type="button"
                                    data-testid="reanalyze-button"
                                    onClick={handleGetAIAnalysis}
                                    disabled={loadingAI || membershipPending}
                                    className="rounded-lg p-2 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground disabled:opacity-50"
                                    title="重新分析"
                                    aria-label="重新分析"
                                >
                                    {loadingAI ? (
                                        <SoundWaveLoader variant="inline" />
                                    ) : (
                                        <RefreshCw className="h-4 w-4" />
                                    )}
                                </button>
                            )}
                        </div>
                    </div>

                    {aiAnalysis ? (
                        <div>
                            {errorBanner}
                            <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground-secondary prose-strong:text-foreground prose-strong:font-semibold">
                                {analysisReasoning && (
                                    <ThinkingBlock
                                        content={analysisReasoning}
                                        isStreaming={streaming.isStreaming && !aiAnalysis}
                                        startTime={streaming.reasoningStartTime}
                                        duration={streaming.reasoningDuration}
                                    />
                                )}
                                <div className="rounded-xl bg-panel p-4 sm:p-5">
                                    <MarkdownContent content={aiAnalysis} className="text-[15px] leading-relaxed text-foreground-secondary" />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="py-6 text-center">
                            {errorBanner}

                            {!user ? (
                                <div className="mx-auto max-w-sm rounded-2xl bg-panel p-6">
                                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
                                        <Quote className="h-6 w-6" />
                                    </div>
                                    <h3 className="mb-2 font-display text-lg text-foreground">解锁深度解读</h3>
                                    <p className="mb-6 text-sm text-foreground-secondary">
                                        登录后获取 AI 对您关系的深度剖析与个性化建议
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => setShowAuthModal(true)}
                                        className="h-11 w-full rounded-xl bg-accent font-medium text-on-accent transition-colors hover:bg-accent-hover"
                                    >
                                        登录 / 注册
                                    </button>
                                </div>
                            ) : membershipPending ? (
                                <div className="flex justify-center">
                                    <SoundWaveLoader variant="inline" />
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleGetAIAnalysis}
                                    disabled={loadingAI || membershipPending}
                                    className="inline-flex h-12 items-center gap-2 rounded-xl bg-foreground px-7 text-base font-medium text-background
                                        transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {loadingAI ? (
                                        <>
                                            <SoundWaveLoader variant="inline" />
                                            正在解读天机...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="h-4 w-4" />
                                            获取 AI 深度分析
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    )}
                </section></AIFeatureGate>

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

            <AuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
            />

            <CreditsModal
                isOpen={showCreditsModal}
                onClose={() => setShowCreditsModal(false)}
            />
        </div>
    );
}
