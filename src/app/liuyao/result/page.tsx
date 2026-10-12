/**
 * 六爻解卦结果页面
 *
 * 标题区「本卦 之 变卦」+ 保存 / 问太卜解卦，四柱旬空、卦盘、卦辞与盘面要点、用神分析，页内 AI 深度解读。
 * 'use client'：结果来自 sessionStorage，且含 AI 流式解读与多处交互状态。
 */
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, RotateCw, AlertCircle, BookOpen, RefreshCw, Copy, Check, BookOpenText, X, Album, ChevronLeft } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { HexagramDisplay } from '@/components/liuyao/HexagramDisplay';
import { LiuyaoPillars } from '@/components/liuyao/LiuyaoPillars';
import { LiuyaoResultHeader } from '@/components/liuyao/LiuyaoResultHeader';
import { TraditionalAnalysis } from '@/components/liuyao/TraditionalAnalysis';
import { YongShenTargetPicker } from '@/components/liuyao/YongShenTargetPicker';
import { ResultMobileActions } from '@/components/bazi/result/ResultHeader';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { useToast } from '@/components/ui/Toast';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import {
    buildLiuyaoCanonicalJSON,
    calculateLiuyaoBundle,
    generateLiuyaoChartText,
    type DivinationResult,
    type LiuQin,
    normalizeYongShenTargets,
} from '@/lib/divination/liuyao';
import {
    resolveResultYongShenState,
    resolveResultYongShenTargets,
    resolveTraditionalYongShenPositions,
} from '@/lib/divination/liuyao-result-state';
import { saveDivinationAction } from '@/lib/divination/save-client';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import { readSessionJSON, updateSessionJSON } from '@/lib/cache/session-storage';
import { AuthModal } from '@/components/auth/AuthModal';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { useHeaderMenu, useHeaderTitle, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { CreditsModal } from '@/components/ui/CreditsModal';
import { useStreamingResponse, isCreditsError } from '@/lib/hooks/useStreamingResponse';
import { useAnalysisSnapshot } from '@/lib/hooks/useAnalysisSnapshot';
import { LIU_QIN_TIPS, SHEN_XI_TIPS, TERM_TIPS } from '@/lib/divination/liuyao-term-tips';
import { useAdminJsonCopy } from '@/lib/admin/useAdminJsonCopy';
import { runSharedAnalysisFlow } from '@/lib/ai/analysis-runner';
import { CopyTextModal } from '@/components/divination/CopyTextModal';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';

type LiuyaoResultSession = Omit<DivinationResult, 'createdAt'> & {
    createdAt: string;
    divinationId?: string | null;
    conversationId?: string | null;
};

type LiuyaoQuestionSession = {
    yongShenTargets?: LiuQin[];
};

const DERIVED_KEYS = ['互卦', '错卦', '综卦'] as const;
const MENU_ICON_CLASS = 'h-4 w-4';

export default function ResultPage() {
    const router = useRouter();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const [result, setResult] = useState<DivinationResult | null>(null);
    const [divinationId, setDivinationId] = useState<string | null>(null);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [interpretation, setInterpretation] = useState<string | null>(null);
    const [interpretationReasoning, setInterpretationReasoning] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showTraditional, setShowTraditional] = useState(true);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [kbModalOpen, setKbModalOpen] = useState(false);
    const [showCreditsModal, setShowCreditsModal] = useState(false);
    const [showTermsModal, setShowTermsModal] = useState(false);
    const [pendingYongShenTargets, setPendingYongShenTargets] = useState<LiuQin[]>([]);
    const [copyDetailLevel, setCopyDetailLevel] = useState<ChartTextDetailLevel>('default');
    const [showCopyModal, setShowCopyModal] = useState(false);
    const streaming = useStreamingResponse();
    const [copied, setCopied] = useState(false);
    const [saving, setSaving] = useState(false);
    const aiSectionRef = useRef<HTMLElement>(null);
    const yongShenPickerRef = useRef<HTMLElement>(null);
    const { showToast } = useToast();
    const { user, userId, sessionLoading, membershipInfo, membershipLoading, membershipResolved } = useSessionMembership();
    const membershipPending = membershipLoading || !membershipResolved;
    const membershipType = membershipResolved ? (membershipInfo?.type ?? 'free') : 'free';

    const yongShenTargetState = useMemo(() => (
        resolveResultYongShenState(result?.yongShenTargets, pendingYongShenTargets)
    ), [pendingYongShenTargets, result?.yongShenTargets]);
    const appliedYongShenTargets = yongShenTargetState.appliedTargets;
    const requiresYongShenTargets = Boolean(result?.question?.trim());
    const missingYongShenTargets = requiresYongShenTargets && appliedYongShenTargets.length === 0;
    const hasAppliedTargets = appliedYongShenTargets.length > 0;
    const canAnalyze = requiresYongShenTargets && hasAppliedTargets;
    const liuyaoBundle = useMemo(() => {
        if (!result || !canAnalyze) return null;
        return calculateLiuyaoBundle({
            yaos: result.yaos,
            question: result.question,
            date: result.createdAt,
            yongShenTargets: appliedYongShenTargets,
            hexagram: result.hexagram,
            changedHexagram: result.changedHexagram,
        });
    }, [appliedYongShenTargets, canAnalyze, result]);

    const traditionalCanonical = useMemo(() => {
        if (!liuyaoBundle) return null;
        return buildLiuyaoCanonicalJSON(liuyaoBundle.output);
    }, [liuyaoBundle]);
    const { isAdmin, jsonCopied, copyJson } = useAdminJsonCopy(traditionalCanonical);
    const traditionalYongShenPositions = useMemo(() => resolveTraditionalYongShenPositions(traditionalCanonical), [traditionalCanonical]);

    const handleConfirmCopy = async (level: ChartTextDetailLevel) => {
        setCopyDetailLevel(level);
        const text = liuyaoBundle
            ? generateLiuyaoChartText(liuyaoBundle.output, { detailLevel: level })
            : '';
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            showToast('success', '卦象数据已复制');
        } catch {
            showToast('error', '复制失败，请重试');
        }
        setShowCopyModal(false);
    };

    useEffect(() => {
        const parsed = readSessionJSON<LiuyaoResultSession>('liuyao_result');
        if (parsed) {
            const questionPayload = readSessionJSON<LiuyaoQuestionSession | string>('liuyao_question');
            const questionSessionTargets = questionPayload && typeof questionPayload !== 'string'
                ? questionPayload.yongShenTargets
                : [];
            const normalizedTargets = resolveResultYongShenTargets(parsed.yongShenTargets, [], questionSessionTargets || []);
            setResult({ ...parsed, createdAt: new Date(parsed.createdAt), yongShenTargets: normalizedTargets });
            setPendingYongShenTargets(normalizedTargets);
            setDivinationId(parsed.divinationId || null);
            setConversationId(parsed.conversationId || null);
        } else router.push('/liuyao');
    }, [router]);

    // 次要操作：桌面端收进标题区「更多」，移动端进顶栏三点菜单（另加重新起卦）
    const resultActions = useMemo((): HeaderMenuItem[] => {
        const items: HeaderMenuItem[] = [
            { id: 'traditional', label: showTraditional ? '隐藏传统分析' : '显示传统分析', icon: <BookOpen className={MENU_ICON_CLASS} />, onClick: () => setShowTraditional((value) => !value) },
            { id: 'terms', label: '术语参考', icon: <Album className={MENU_ICON_CLASS} />, onClick: () => setShowTermsModal(true) },
        ];
        if (liuyaoBundle) items.push({ id: 'copy', label: copied ? '卦象已复制' : '复制卦象', icon: copied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => setShowCopyModal(true) });
        if (knowledgeBaseEnabled && divinationId) items.push({ id: 'add-to-kb', label: '收藏', icon: <BookOpenText className={MENU_ICON_CLASS} />, onClick: () => setKbModalOpen(true) });
        if (isAdmin && traditionalCanonical) items.push({ id: 'copy-json', label: jsonCopied ? 'JSON 已复制' : '复制 JSON', icon: jsonCopied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => { void copyJson(); } });
        return items;
    }, [copied, copyJson, divinationId, isAdmin, jsonCopied, knowledgeBaseEnabled, liuyaoBundle, showTraditional, traditionalCanonical]);

    useEffect(() => {
        setMenuItems([{ id: 'restart', label: '重新起卦', icon: <RotateCw className={MENU_ICON_CLASS} />, onClick: () => router.push('/liuyao') }, ...resultActions]);
        return () => clearMenuItems();
    }, [resultActions, router, setMenuItems, clearMenuItems]);

    const hasChangedHexagram = Boolean(result?.changedHexagram && result.changedLines.length > 0);
    useHeaderTitle(result ? `${result.hexagram.name}${hasChangedHexagram && result.changedHexagram ? ` 之 ${result.changedHexagram.name}` : ''}` : null);

    useAnalysisSnapshot({
        conversationId,
        recordId: divinationId,
        divinationType: 'liuyao',
        sessionKey: 'liuyao_result',
        hasExistingAnalysis: !!interpretation,
        skip: !result,
        callbacks: {
            onAnalysis: setInterpretation,
            onReasoning: setInterpretationReasoning,
            onModelId: setSelectedModel,
            onReasoningEnabled: setReasoningEnabled,
            onConversationIdResolved: setConversationId,
        },
    });

    const handleGetInterpretation = async () => {
        if (!result || !user || !canAnalyze) return;
        setIsLoading(true); streaming.reset(); setError(null); setInterpretationReasoning(null); setInterpretation(null);
        try {
            const baseBody = {
                question: result.question,
                yongShenTargets: appliedYongShenTargets,
                hexagram: result.hexagram,
                changedHexagram: result.changedHexagram,
                changedLines: result.changedLines,
                yaos: result.yaos,
                divinationId,
            };
            const analysisResult = await runSharedAnalysisFlow({
                endpoint: '/api/liuyao',
                streaming,
                isCreditsError,
                direct: {
                    prepareBody: { action: 'interpret_prepare', ...baseBody },
                    persistBody: { action: 'interpret_persist', ...baseBody },
                },
                streamBody: {
                    action: 'interpret',
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
            if (analysisResult.error) throw new Error(analysisResult.error);
            setInterpretation(analysisResult.content || '解读失败');
            if (analysisResult.reasoning) setInterpretationReasoning(analysisResult.reasoning);
            if (analysisResult.conversationId) {
                setConversationId(analysisResult.conversationId);
                updateSessionJSON('liuyao_result', (prev: LiuyaoResultSession | null) => ({ ...(prev || {}), conversationId: analysisResult.conversationId } as LiuyaoResultSession));
            }
        } catch (err) { setError(err instanceof Error ? err.message : '解读失败'); } finally { setIsLoading(false); }
    };

    const handleApplyYongShenTargets = async () => {
        if (!result) return;
        const normalized = normalizeYongShenTargets(pendingYongShenTargets);
        if (normalized.length === 0) { setError('请至少选择一个分析目标'); return; }
        setError(null);
        setResult(prev => prev ? ({ ...prev, yongShenTargets: normalized }) : null);
        updateSessionJSON('liuyao_result', (prev: LiuyaoResultSession | null) => ({ ...(prev || {}), yongShenTargets: normalized } as LiuyaoResultSession));
        if (divinationId && userId) {
            await fetch('/api/liuyao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', divinationId, yongShenTargets: normalized }) });
        }
    };

    /** 保存起卦记录：起卦时未登录或保存失败的结果可在此补存；已有记录 ID 即视为已保存。 */
    const handleSave = async () => {
        if (!result || divinationId || saving || sessionLoading) return;
        if (!user) { setShowAuthModal(true); return; }
        if (missingYongShenTargets) {
            showToast('error', '请先选择分析目标');
            yongShenPickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        setSaving(true);
        try {
            const saved = await saveDivinationAction({
                endpoint: '/api/liuyao',
                body: {
                    question: result.question,
                    yongShenTargets: appliedYongShenTargets,
                    yaos: result.yaos,
                    changedHexagram: result.changedHexagram,
                    changedLines: result.changedLines,
                },
                idKey: 'divinationId',
                fallbackMessage: '保存起卦记录失败',
            });
            if (!saved.ok || !saved.id) {
                showToast('error', saved.ok ? '保存起卦记录失败' : saved.error.message || '保存起卦记录失败');
                return;
            }
            const savedId = saved.id;
            setDivinationId(savedId);
            updateSessionJSON('liuyao_result', (prev: LiuyaoResultSession | null) => ({ ...(prev || {}), divinationId: savedId } as LiuyaoResultSession));
            showToast('success', '已保存到命理记录');
        } finally {
            setSaving(false);
        }
    };

    /** 问太卜解卦：定位到页内 AI 解读；尚未解读时直接发起（未登录先登录，无问题不可解，缺用神先选目标）。 */
    const handleAskTaibu = () => {
        if (sessionLoading) return;
        if (!user) { setShowAuthModal(true); return; }
        if (!requiresYongShenTargets) { showToast('error', '起卦时未填写所问之事，无法解卦'); return; }
        if (missingYongShenTargets) {
            showToast('error', '请先选择分析目标');
            yongShenPickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        aiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (interpretation || isLoading || streaming.isStreaming || membershipPending || !canAnalyze) return;
        void handleGetInterpretation();
    };

    if (!result) return (
        <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="text-center animate-fade-in">
                <SoundWaveLoader variant="block" text="正在推演卦象" />
            </div>
        </div>
    );

    const derivedHexagrams = traditionalCanonical
        ? DERIVED_KEYS.flatMap((key) => {
            const derived = traditionalCanonical.卦盘[key];
            return derived ? [{ key, name: derived.卦名 }] : [];
        })
        : [];
    const derivedFooter = derivedHexagrams.length > 0 ? (
        <span className="flex flex-wrap gap-1.5 @2xl:gap-5">
            {derivedHexagrams.map((item) => (
                <span key={item.key} className="rounded-md bg-background-secondary px-2 py-0.5 text-foreground-secondary @2xl:bg-transparent @2xl:p-0">
                    {item.key} <span className="text-foreground @2xl:font-display">{item.name}</span>
                </span>
            ))}
        </span>
    ) : undefined;

    const saveState = {
        saving,
        saved: Boolean(divinationId),
        disabled: saving || Boolean(divinationId) || sessionLoading || missingYongShenTargets,
        onSave: () => { void handleSave(); },
    };
    const askDisabled = sessionLoading || isLoading || streaming.isStreaming;

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[1104px] animate-fade-in flex-col gap-3 px-4 pt-0.5 pb-28 sm:px-8 lg:gap-[22px] lg:pt-8 lg:pb-14">
                <Link href="/liuyao" className="hidden w-fit items-center gap-1.5 text-sm text-foreground-secondary transition-colors hover:text-foreground lg:inline-flex">
                    <ChevronLeft className="h-4 w-4" />重新起卦
                </Link>

                <LiuyaoResultHeader
                    question={result.question}
                    yongShenTargets={appliedYongShenTargets}
                    hexagramName={result.hexagram.name}
                    changedHexagramName={hasChangedHexagram ? result.changedHexagram?.name : undefined}
                    actions={resultActions}
                    save={saveState}
                    onAsk={handleAskTaibu}
                    askDisabled={askDisabled}
                />

                {missingYongShenTargets && (
                    <section ref={yongShenPickerRef} aria-label="选择分析目标" className="flex scroll-mt-20 flex-col gap-4 rounded-2xl bg-accent-light p-5 ring-1 ring-inset ring-accent/50">
                        <div className="flex flex-col gap-1">
                            <h3 className="font-display text-lg text-accent-strong">选择分析目标</h3>
                            <p className="text-xs text-foreground-secondary">先明确本次解卦重点，再进入后续分析。</p>
                        </div>
                        <YongShenTargetPicker value={pendingYongShenTargets} onChange={setPendingYongShenTargets} variant="block" />
                        <div className="flex justify-end">
                            <button type="button" onClick={handleApplyYongShenTargets} disabled={pendingYongShenTargets.length === 0} className="h-10 rounded-[10px] bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50">确认</button>
                        </div>
                    </section>
                )}

                {showTraditional && traditionalCanonical && (
                    <div className="flex flex-col gap-1.5">
                        <LiuyaoPillars pillars={traditionalCanonical.干支时间} />
                        <p className="text-[11px] text-foreground-tertiary">{'注：六爻断卦判空亡以"日旬空"为主，年/月/时旬空供参考。'}</p>
                    </div>
                )}

                {/* 卦盘 */}
                <section aria-label="卦盘" className="rounded-2xl border-[0.5px] border-border bg-surface px-2 pb-3.5 pt-3 sm:rounded-[18px] sm:px-6 sm:pb-4">
                    <HexagramDisplay
                        yaos={result.yaos}
                        hexagram={result.hexagram}
                        changedHexagram={result.changedHexagram}
                        changedLines={result.changedLines}
                        showDetails={true}
                        fullYaos={traditionalCanonical?.六爻}
                        showTraditional={showTraditional}
                        yongShenPositions={traditionalYongShenPositions}
                        palaces={{ base: traditionalCanonical?.卦盘.本卦.卦宫, changed: traditionalCanonical?.卦盘.变卦?.卦宫 }}
                        footer={showTraditional ? derivedFooter : undefined}
                    />
                </section>

                {/* 传统分析 */}
                {showTraditional && traditionalCanonical && (
                    <TraditionalAnalysis
                        analysis={traditionalCanonical}
                        highlightAction={(
                            <AIFeatureGate>
                                <button
                                    type="button"
                                    onClick={handleAskTaibu}
                                    disabled={askDisabled}
                                    className="mt-auto hidden h-11 w-full items-center justify-center rounded-[10px] bg-foreground text-sm text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:flex"
                                >
                                    让太卜断这一卦
                                </button>
                            </AIFeatureGate>
                        )}
                    />
                )}

                {/* AI 解读 */}
                <AIFeatureGate><section ref={aiSectionRef} aria-label="AI 深度解读" className="flex scroll-mt-20 flex-col gap-5 rounded-2xl border-[0.5px] border-border bg-panel p-5 sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
                            <h2 className="flex items-center gap-2 font-display text-lg font-normal"><Sparkles className="h-4 w-4 text-accent" />AI 深度解读</h2>
                            <p className="text-sm text-foreground-secondary">让太卜结合所问、用神与动变断这一卦</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <ModelSelector compact selectedModel={selectedModel} onModelChange={setSelectedModel} reasoningEnabled={reasoningEnabled} onReasoningChange={setReasoningEnabled} userId={userId} membershipType={membershipType} disabled={membershipPending} />
                            {(interpretation || streaming.isStreaming) && <button type="button" onClick={handleGetInterpretation} disabled={isLoading} aria-label="重新获取 AI 解读" className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-foreground-secondary transition-colors hover:bg-background-secondary"><RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} /></button>}
                        </div>
                    </div>

                    {error && <div className="flex items-center gap-2 rounded-[10px] bg-fire-soft px-3 py-2.5 text-xs text-danger"><AlertCircle className="h-3.5 w-3.5" />{error}</div>}

                    {(interpretation || streaming.isStreaming) ? (
                        <div className="prose prose-sm max-w-none rounded-xl border-[0.5px] border-border bg-surface p-4 prose-p:leading-relaxed prose-headings:text-foreground sm:p-5">
                            {(interpretationReasoning || streaming.reasoning) && <ThinkingBlock content={interpretationReasoning || streaming.reasoning || ''} isStreaming={streaming.isStreaming && !interpretation} startTime={streaming.reasoningStartTime} duration={streaming.reasoningDuration} />}
                            <MarkdownContent content={interpretation || streaming.content || ''} className="text-sm text-foreground leading-relaxed" />
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {user === null ? (
                                <>
                                    <p className="text-sm text-foreground-secondary">登录后解锁 AI 深度解读卦象天机</p>
                                    <button type="button" onClick={() => setShowAuthModal(true)} className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 sm:w-auto sm:self-start">立即登录</button>
                                </>
                            ) : (
                                <button type="button" onClick={handleGetInterpretation} disabled={isLoading || !canAnalyze || membershipPending} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50 sm:w-auto sm:self-start"><Sparkles className="h-4 w-4" />获取 AI 解读</button>
                            )}
                        </div>
                    )}
                </section></AIFeatureGate>
            </div>

            {/* 术语弹窗 */}
            {showTermsModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-foreground/20" onClick={() => setShowTermsModal(false)} />
                    <div role="dialog" aria-modal="true" aria-label="术语参考" className="relative w-full max-w-2xl overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface shadow-[var(--shadow-lg)] animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between border-b-[0.5px] border-border px-5 py-3.5">
                            <div className="font-display text-lg">术语参考</div>
                            <button type="button" onClick={() => setShowTermsModal(false)} aria-label="关闭" className="rounded-lg p-1.5 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto p-6 space-y-8">
                            {[ { label: '六亲', data: LIU_QIN_TIPS }, { label: '神系', data: SHEN_XI_TIPS }, { label: '其他', data: TERM_TIPS } ].map(group => (
                                <div key={group.label} className="space-y-3">
                                    <h3 className="border-b-[0.5px] border-border pb-1.5 text-xs font-medium text-foreground-secondary">{group.label}</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                                        {Object.entries(group.data).map(([name, tip]) => (
                                            <div key={name} className="text-xs leading-relaxed"><span className="font-display text-[13px] text-foreground">{name}</span><span className="text-foreground-secondary mx-1">/</span><span className="text-foreground-secondary">{tip}</span></div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <ResultMobileActions
                saving={saving}
                saved={saveState.saved}
                saveDisabled={saveState.disabled}
                onSave={saveState.onSave}
                ask={{ label: '问太卜解卦', onClick: handleAskTaibu, disabled: askDisabled }}
            />

            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
            <CreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />
            {knowledgeBaseEnabled && divinationId && <AddToKnowledgeBaseModal open={kbModalOpen} onClose={() => setKbModalOpen(false)} sourceTitle={result.question || '六爻占卜'} sourceType="liuyao_divination" sourceId={divinationId} />}
            <CopyTextModal
                isOpen={showCopyModal}
                value={copyDetailLevel}
                onChange={setCopyDetailLevel}
                onClose={() => setShowCopyModal(false)}
                onConfirm={handleConfirmCopy}
            />
        </div>
    );
}
