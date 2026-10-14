/**
 * MBTI 测试结果页面
 * 
 * 人格卡片、维度分析与 AI 深度分析
 */
'use client'; // 需要 sessionStorage 结果、流式 AI 分析与查询参数

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RotateCw, Sparkles, RefreshCw, ChevronLeft, BookOpenText } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { PersonalityCard } from '@/components/mbti/PersonalityCard';
import { buildViewResult, type TestResult } from '@/lib/divination/mbti';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { AuthModal } from '@/components/auth/AuthModal';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { readSessionJSON } from '@/lib/cache/session-storage';
import { useHeaderMenu } from '@/components/layout/HeaderMenuContext';
import { CreditsModal } from '@/components/ui/CreditsModal';
import { useStreamingResponse, isCreditsError } from '@/lib/hooks/useStreamingResponse';
import { useAnalysisSnapshot } from '@/lib/hooks/useAnalysisSnapshot';
import { runSharedAnalysisFlow } from '@/lib/ai/analysis-runner';
type MBTIResultSession = TestResult & {
    conversationId?: string | null;
    readingId?: string | null;
};

function MBTIResultContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const viewType = searchParams.get('type');
    const isViewMode = searchParams.get('view') === 'true';

    const [result, setResult] = useState<MBTIResultSession | null>(null);
    const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
    const [analysisReasoning, setAnalysisReasoning] = useState<string | null>(null);
    const [loadingAI, setLoadingAI] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [kbModalOpen, setKbModalOpen] = useState(false);
    const [showCreditsModal, setShowCreditsModal] = useState(false);
    const streaming = useStreamingResponse();
    const { user, userId, sessionLoading, membershipInfo, membershipLoading, membershipResolved } = useSessionMembership();
    const membershipPending = membershipLoading || !membershipResolved;
    const membershipType = membershipResolved ? (membershipInfo?.type ?? 'free') : 'free';
    const checkingAuth = sessionLoading || membershipPending;

    useEffect(() => {
        const stored = readSessionJSON<MBTIResultSession>('mbti_result');
        if (stored) {
            setResult(stored);
            setConversationId(stored.conversationId || null);
        } else if (isViewMode && viewType) {
            const viewResult = buildViewResult(viewType.toUpperCase());
            if (viewResult) setResult(viewResult);
            else router.push('/mbti');
        } else router.push('/mbti');
    }, [router, isViewMode, viewType]);

    useAnalysisSnapshot({
        conversationId,
        recordId: result?.readingId,
        divinationType: 'mbti',
        sessionKey: 'mbti_result',
        hasExistingAnalysis: !!aiAnalysis,
        skip: !result || !user,
        callbacks: {
            onAnalysis: setAiAnalysis,
            onReasoning: setAnalysisReasoning,
            onModelId: setSelectedModel,
            onReasoningEnabled: setReasoningEnabled,
            onConversationIdResolved: setConversationId,
        },
    });

    const handleGetAIAnalysis = async () => {
        if (!result || !user) { if (!user) setShowAuthModal(true); return; }
        setLoadingAI(true); streaming.reset(); setError(null); setAnalysisReasoning(null); setAiAnalysis(null);
        try {
            const baseBody = { type: result.type, scores: result.scores, percentages: result.percentages, readingId: result.readingId };
            const analysisResult = await runSharedAnalysisFlow({
                endpoint: '/api/mbti',
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
            if (analysisResult.requiresCredits) setShowCreditsModal(true);
            else {
                if (analysisResult.error) setError(analysisResult.error);
                if (analysisResult.content) setAiAnalysis(analysisResult.content);
                if (analysisResult.reasoning) setAnalysisReasoning(analysisResult.reasoning);
                if (analysisResult.conversationId) setConversationId(analysisResult.conversationId);
            }
        } catch (err) { setError(err instanceof Error ? err.message : '分析失败'); } finally { setLoadingAI(false); }
    };

    const isTestMode = result ? (!isViewMode && result.scores && result.percentages) : false;
    const readingId = result?.readingId;

    useEffect(() => {
        if (!result) return;
        const items = [];
        if (isTestMode) items.push({ id: 'retest', label: '重新测试', icon: <RotateCw className="w-4 h-4" />, onClick: () => router.push('/mbti/test') });
        if (knowledgeBaseEnabled && readingId) items.push({ id: 'add-to-kb', label: '收藏', icon: <BookOpenText className="w-4 h-4" />, onClick: () => setKbModalOpen(true) });
        setMenuItems(items);
        return () => clearMenuItems();
    }, [knowledgeBaseEnabled, readingId, isTestMode, result, router, setMenuItems, clearMenuItems]);

    if (!result) return (
        <div className="flex min-h-[60vh] items-center justify-center bg-background">
            <SoundWaveLoader variant="block" text="" />
        </div>
    );

    return (
        <div className="min-h-full bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[820px] animate-fade-in flex-col gap-5 px-4 py-4 lg:gap-6 lg:px-8 lg:py-8">
                {/* 头部导航（桌面端；移动端由顶栏承载） */}
                <div className="hidden items-center justify-between lg:flex">
                    <Link href="/mbti" className="inline-flex items-center gap-1 text-sm text-foreground-secondary transition-colors hover:text-foreground"><ChevronLeft className="h-4 w-4" aria-hidden="true" />返回 MBTI 首页</Link>
                    {isTestMode && <button type="button" onClick={() => router.push('/mbti/test')} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3.5 text-sm transition-colors hover:bg-background-secondary"><RotateCw className="h-3.5 w-3.5" aria-hidden="true" />重新测试</button>}
                </div>

                {/* 性格卡片 */}
                <PersonalityCard result={result} showDimensions={!!isTestMode} />

                {/* AI 深度分析 */}
                {isTestMode && (<AIFeatureGate>
                    <section className="flex flex-col rounded-2xl border-[0.5px] border-border bg-surface">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b-[0.5px] border-border px-4 py-3.5 lg:px-6">
                            <h2 className="inline-flex items-center gap-2 font-display text-[17px] font-medium"><Sparkles className="h-4 w-4 text-clay" aria-hidden="true" />AI 深度分析</h2>
                            <div className="flex items-center gap-2">
                                <ModelSelector compact selectedModel={selectedModel} onModelChange={setSelectedModel} reasoningEnabled={reasoningEnabled} onReasoningChange={setReasoningEnabled} userId={userId} membershipType={membershipType} disabled={membershipPending} />
                                {aiAnalysis && <button type="button" onClick={handleGetAIAnalysis} disabled={loadingAI} aria-label="重新分析" className="rounded-md p-1.5 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loadingAI ? 'animate-spin' : ''}`} /></button>}
                            </div>
                        </div>

                        <div className="px-4 py-5 lg:px-6">
                            {error && <p className="mb-3 text-xs text-danger">{error}</p>}

                            {aiAnalysis || streaming.content ? (
                                <div>
                                    {(analysisReasoning || streaming.reasoning) && <ThinkingBlock content={analysisReasoning || streaming.reasoning || ''} isStreaming={streaming.isStreaming && !aiAnalysis} />}
                                    <MarkdownContent content={aiAnalysis || streaming.content || ''} className="text-sm leading-relaxed text-foreground" />
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-4 py-8 text-center">
                                    {checkingAuth ? <SoundWaveLoader variant="inline" /> : !user ? (
                                        <div className="flex w-full max-w-sm flex-col gap-4">
                                            <p className="text-sm text-foreground-secondary">登录后即可获取基于您性格维度的专属 AI 深度分析</p>
                                            <button type="button" onClick={() => setShowAuthModal(true)} className="h-11 w-full rounded-xl bg-accent text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover">立即登录</button>
                                        </div>
                                    ) : (
                                        <>
                                            <p className="text-sm text-foreground-secondary">让太卜结合你的四个维度倾向，给出更具体的性格与成长建议。</p>
                                            <button type="button" onClick={handleGetAIAnalysis} disabled={loadingAI} className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50">{loadingAI ? <SoundWaveLoader variant="inline" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}获取 AI 深度分析</button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </section>
                </AIFeatureGate>)}

                {/* 底部收藏操作 */}
                {knowledgeBaseEnabled && !!readingId && (
                    <div className="flex justify-center pt-2">
                        <button type="button" onClick={() => setKbModalOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl border-[0.5px] border-border-hover bg-surface px-5 text-sm text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"><BookOpenText className="h-4 w-4" aria-hidden="true" />收藏至知识库</button>
                    </div>
                )}

                {/* 查看模式：开始测试按钮 */}
                {!isTestMode && (
                    <div className="flex justify-center pt-4">
                        <Link href="/mbti/test" className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-7 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"><Sparkles className="h-4 w-4" aria-hidden="true" />开始 MBTI 测试</Link>
                    </div>
                )}
            </div>

            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
            <CreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />
            {knowledgeBaseEnabled && readingId && <AddToKnowledgeBaseModal open={kbModalOpen} onClose={() => setKbModalOpen(false)} sourceTitle={`MBTI - ${result.type}`} sourceType="mbti_reading" sourceId={readingId} />}
        </div>
    );
}

export default function MBTIResultPage() {
    return (
        <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center bg-background"><SoundWaveLoader variant="block" /></div>}>
            <MBTIResultContent />
        </Suspense>
    );
}
