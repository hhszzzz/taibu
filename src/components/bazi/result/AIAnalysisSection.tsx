/**
 * AI 分析通用组件
 *
 * 提取 AIWuxingAnalysis 和 AIPersonalityAnalysis 的共同逻辑
 * 支持流式输出，通过 props 差异化展示
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState, useEffect)
 * - 包含流式响应交互
 */
'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { RefreshCw, Copy, Check } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { AIAnalysisLock } from '@/components/bazi/result/AIAnalysisLock';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import type { MembershipType } from '@/lib/user/membership';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { CreditsModal } from '@/components/ui/CreditsModal';
import { useToast } from '@/components/ui/Toast';
import { useStreamingResponse, isCreditsError } from '@/lib/hooks/useStreamingResponse';
import { runSharedAnalysisFlow } from '@/lib/ai/analysis-runner';
import { CUSTOM_PROVIDER_CHANGED_EVENT, getCustomProvider } from '@/lib/chat/custom-provider';

interface AIAnalysisSectionProps {
    chartId: string;
    userId: string;
    credits?: number | null;
    savedAnalysis?: string | null;
    savedReasoning?: string | null;
    savedModelId?: string | null;
    onSaveAnalysis: (analysis: string) => void;
    onLoginRequired?: () => void;
    /** API 请求的 type 参数 */
    type: 'wuxing' | 'personality';
    /** 标题 */
    title: string;
    /** 副标题 */
    subtitle: string;
    /** 锁定描述 */
    lockDescription: string;
    /** 加载中提示文字 */
    loadingText: string;
    /** 图标渲染 */
    icon: ReactNode;
    /** 图标容器样式 */
    iconContainerClass: string;
    /** 头部渐变样式 */
    headerGradientClass: string;
}

export function AIAnalysisSection({
    chartId,
    userId,
    credits,
    savedAnalysis,
    savedReasoning,
    savedModelId,
    onSaveAnalysis,
    onLoginRequired,
    type,
    title,
    subtitle,
    lockDescription,
    loadingText,
    icon,
    iconContainerClass,
    headerGradientClass,
}: AIAnalysisSectionProps) {
    const [isUnlocked, setIsUnlocked] = useState(!!savedAnalysis);
    const [analysis, setAnalysis] = useState(savedAnalysis || '');
    const [analysisReasoning, setAnalysisReasoning] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const [showCreditsModal, setShowCreditsModal] = useState(false);
    const [hasCustomProvider, setHasCustomProvider] = useState(false);
    const streaming = useStreamingResponse();
    const { showToast } = useToast();
    const { userId: sessionUserId, membershipInfo, membershipLoading, membershipResolved } = useSessionMembership();
    const membershipPending = membershipLoading || !membershipResolved;
    const canBypassLockWithCustomProvider = hasCustomProvider && !!userId;
    const membershipType: MembershipType = sessionUserId === userId
        ? (membershipResolved ? (membershipInfo?.type ?? 'free') : 'free')
        : 'free';

    useEffect(() => {
        if (savedAnalysis) {
            setIsUnlocked(true);
            setAnalysis(savedAnalysis);
        }
        if (savedReasoning) {
            setAnalysisReasoning(savedReasoning);
        }
    }, [savedAnalysis, savedReasoning]);

    useEffect(() => {
        if (savedModelId) setSelectedModel(savedModelId);
        if (savedReasoning) setReasoningEnabled(true);
    }, [savedModelId, savedReasoning]);

    useEffect(() => {
        const syncCustomProvider = () => {
            setHasCustomProvider(!!getCustomProvider());
        };

        syncCustomProvider();
        window.addEventListener(CUSTOM_PROVIDER_CHANGED_EVENT, syncCustomProvider);
        return () => {
            window.removeEventListener(CUSTOM_PROVIDER_CHANGED_EVENT, syncCustomProvider);
        };
    }, []);

    const handleUnlock = async () => {
        setIsUnlocked(true);
        await startAnalysis();
    };

    const startAnalysis = async () => {
        if (loading) return;
        if (!userId) {
            onLoginRequired?.();
            return;
        }
        setLoading(true);
        streaming.reset();
        setAnalysis('');
        setAnalysisReasoning(null);

        try {
            const result = await runSharedAnalysisFlow({
                endpoint: '/api/bazi/analysis',
                streaming,
                isCreditsError,
                direct: {
                    prepareBody: {
                        action: 'direct_prepare',
                        chartId,
                        type,
                    },
                    persistBody: {
                        action: 'direct_persist',
                        chartId,
                        type,
                    },
                },
                streamBody: {
                    chartId,
                    type,
                    modelId: selectedModel,
                    reasoning: reasoningEnabled,
                    stream: true,
                },
            });

            if (result.requiresCredits) {
                setShowCreditsModal(true);
                return;
            }

            if (result.content) {
                setIsUnlocked(true);
                setAnalysis(result.content);
                if (result.reasoning) setAnalysisReasoning(result.reasoning);
                onSaveAnalysis(result.content);
            } else if (result.error) {
                showToast('error', result.error);
                throw new Error(result.error);
            } else {
                setAnalysis('分析失败，请点击重新分析按钮重试。');
            }
        } catch (error) {
            console.error('Analysis error:', error);
            setAnalysis('分析失败，请点击重新分析按钮重试。');
            setAnalysisReasoning(null);
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(analysis);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const placeholder = (
        <div className="p-6 space-y-4 min-h-[280px]">
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${iconContainerClass}`}>{icon}</div>
                <div>
                    <h4 className="font-display text-lg">{title}</h4>
                    <p className="text-sm text-foreground-secondary">{subtitle}</p>
                </div>
            </div>
            <div className="space-y-2">
                <div className="h-4 bg-background-tertiary rounded w-full" />
                <div className="h-4 bg-background-tertiary rounded w-4/5" />
                <div className="h-4 bg-background-tertiary rounded w-3/4" />
                <div className="h-4 bg-background-tertiary rounded w-5/6" />
                <div className="h-4 bg-background-tertiary rounded w-2/3" />
                <div className="h-4 bg-background-tertiary rounded w-4/5" />
            </div>
        </div>
    );

    const modelControls = (
        <div className="flex justify-end">
            <ModelSelector
                compact
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                reasoningEnabled={reasoningEnabled}
                onReasoningChange={setReasoningEnabled}
                userId={userId}
                membershipType={membershipType}
            />
        </div>
    );

    if (sessionUserId === userId && membershipPending) {
        return (
            <div className="space-y-2">
                {modelControls}
                <div className="flex min-h-[280px] items-center justify-center rounded-2xl border-[0.5px] border-border bg-surface">
                    <SoundWaveLoader variant="inline" />
                </div>
            </div>
        );
    }

    const content = (
        <div className="overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface">
            <div className={`flex flex-wrap items-center justify-between gap-3 border-b-[0.5px] border-border p-4 ${headerGradientClass}`}>
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${iconContainerClass}`}>{icon}</div>
                    <div>
                        <h4 className="font-display text-lg">{title}</h4>
                        <p className="text-sm text-foreground-secondary">{subtitle}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {analysis && !loading && (
                        <button type="button" onClick={handleCopy} className="p-2 rounded-lg hover:bg-background-secondary transition-colors" title="复制" aria-label="复制">
                            {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4 text-foreground-secondary" />}
                        </button>
                    )}
                    <button type="button" onClick={startAnalysis} disabled={loading}
                        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3 text-sm text-foreground transition-colors hover:bg-background-secondary disabled:opacity-50">
                        {loading ? <SoundWaveLoader variant="inline" /> : <RefreshCw className="w-4 h-4" />}
                        {loading ? '分析中...' : '重新分析'}
                    </button>
                </div>
            </div>
            <div className="p-4 prose prose-sm dark:prose-invert max-w-none min-h-[200px] overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                        {streaming.isStreaming && (streaming.content || streaming.reasoning) ? (
                            <>
                                {streaming.reasoning && (
                                    <ThinkingBlock content={streaming.reasoning} isStreaming={streaming.isStreaming && !streaming.content}
                                        startTime={streaming.reasoningStartTime} duration={streaming.reasoningDuration} />
                                )}
                                {streaming.content && (
                                    <MarkdownContent content={streaming.content} className="text-sm text-foreground-secondary" />
                                )}
                            </>
                        ) : (
                            <>
                                <SoundWaveLoader variant="inline" />
                                <p className="text-sm text-foreground-secondary">{loadingText}</p>
                            </>
                        )}
                    </div>
                ) : (
                    <>
                        {analysisReasoning && <ThinkingBlock content={analysisReasoning} duration={streaming.reasoningDuration} />}
                        <MarkdownContent content={analysis || '点击「重新分析」开始AI分析'} className="text-sm text-foreground-secondary" />
                    </>
                )}
            </div>
        </div>
    );

    return (
        <div className="space-y-2">
            {modelControls}
            <AIAnalysisLock type={type} title={title} description={lockDescription}
                isUnlocked={isUnlocked || canBypassLockWithCustomProvider} placeholder={placeholder} userId={userId}
                credits={credits} onUnlock={handleUnlock} onLoginRequired={onLoginRequired}>
                {content}
            </AIAnalysisLock>
            <CreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />
        </div>
    );
}
