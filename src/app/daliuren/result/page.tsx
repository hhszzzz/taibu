/**
 * 大六壬排盘结果页
 *
 * 'use client'：会话参数读取、起课请求与 AI 流式解读都依赖浏览器端 hooks。
 */
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RotateCcw, RefreshCw, Copy, Check, ChevronLeft } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { ResultMobileActions } from '@/components/bazi/result/ResultHeader';
import { ResultHeaderActions } from '@/components/divination/ResultHeaderActions';
import { readSessionJSON, updateSessionJSON } from '@/lib/cache/session-storage';
import { DaliurenChart } from '@/components/daliuren/DaliurenChart';
import { formatBenMing, formatCastTime, formatKeShiDetail, parseKeShi } from '@/components/daliuren/daliuren-display';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { useStreamingResponse, isCreditsError } from '@/lib/hooks/useStreamingResponse';
import { AuthModal } from '@/components/auth/AuthModal';
import { CreditsModal } from '@/components/ui/CreditsModal';
import { useHeaderMenu, useHeaderTitle, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { useAnalysisSnapshot } from '@/lib/hooks/useAnalysisSnapshot';
import { useAdminJsonCopy } from '@/lib/admin/useAdminJsonCopy';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { runSharedAnalysisFlow } from '@/lib/ai/analysis-runner';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import { CopyTextModal } from '@/components/divination/CopyTextModal';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';
import { saveDivinationAction } from '@/lib/divination/save-client';
import {
    buildDaliurenCanonicalJSON,
    generateDaliurenChartText,
    type DaliurenOutput,
} from '@/lib/divination/daliuren';

const PILLAR_LABELS = ['年', '月', '日', '时'] as const;
const MENU_ICON_CLASS = 'h-4 w-4';
const ASK_LABEL = '问太卜断课';

type DaliurenSessionParams = Record<string, unknown> & {
    date?: string;
    divinationId?: string;
    conversationId?: string;
};

export default function DaliurenResultPage() {
    const router = useRouter();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const { showToast } = useToast();
    const [result, setResult] = useState<DaliurenOutput | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_ID);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showCreditsModal, setShowCreditsModal] = useState(false);
    const [divinationId, setDivinationId] = useState<string | undefined>();
    const [conversationId, setConversationId] = useState<string | undefined>();
    const [interpretation, setInterpretation] = useState<string | null>(null);
    const [interpretationReasoning, setInterpretationReasoning] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [copyDetailLevel, setCopyDetailLevel] = useState<ChartTextDetailLevel>('default');
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [sessionParams, setSessionParams] = useState<DaliurenSessionParams | null>(null);
    const [saving, setSaving] = useState(false);
    const hasAutoSavedRef = useRef(false);
    const aiSectionRef = useRef<HTMLElement>(null);

    const streaming = useStreamingResponse();
    const { userId, membershipInfo, sessionLoading, membershipLoading, membershipResolved } = useSessionMembership();
    const membershipPending = membershipLoading || !membershipResolved;
    const membershipType = membershipResolved ? (membershipInfo?.type ?? 'free') : 'free';
    const canonicalResult = useMemo(
        () => (result ? buildDaliurenCanonicalJSON(result) : null),
        [result],
    );
    const { isAdmin, jsonCopied, copyJson } = useAdminJsonCopy(canonicalResult);

    const persistSessionIds = useCallback((next: { divinationId?: string; conversationId?: string; }) => {
        updateSessionJSON('daliuren_params', (prev) => ({ ...(prev || {}), ...next }));
    }, []);

    const saveDivinationRecord = useCallback(async (params: DaliurenSessionParams, nextResult: DaliurenOutput) => {
        setSaving(true);
        try {
            const saveResult = await saveDivinationAction({
                endpoint: '/api/daliuren',
                body: { ...params, resultData: nextResult },
                idKey: 'divinationId',
                fallbackMessage: '保存排盘记录失败',
            });
            if (!saveResult.ok) {
                console.error('[daliuren/result] 保存排盘记录失败:', saveResult.error.message);
                return undefined;
            }
            if (saveResult.id) { setDivinationId(saveResult.id); persistSessionIds({ divinationId: saveResult.id }); return saveResult.id; }
            return undefined;
        } finally {
            setSaving(false);
        }
    }, [persistSessionIds]);

    useEffect(() => {
        if (sessionLoading) return;
        const init = async () => {
            const params = readSessionJSON<DaliurenSessionParams>('daliuren_params');
            if (!params?.date) { router.replace('/daliuren'); return; }
            try {
                const response = await fetch('/api/daliuren', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'calculate', ...params }) });
                const payload = await response.json();
                if (payload?.data) {
                    setResult(payload.data); setSessionParams(params); if (params.divinationId) setDivinationId(params.divinationId); if (params.conversationId) setConversationId(params.conversationId);
                    if (!params.divinationId && userId && !hasAutoSavedRef.current) { hasAutoSavedRef.current = true; await saveDivinationRecord(params, payload.data); }
                }
            } catch (e) { console.error(e); } finally { setIsLoading(false); }
        };
        void init();
    }, [router, saveDivinationRecord, sessionLoading, userId]);

    const handleConfirmCopy = async (level: ChartTextDetailLevel) => {
        if (!result) return;
        try {
            setCopyDetailLevel(level);
            await navigator.clipboard.writeText(generateDaliurenChartText(result, { detailLevel: level }));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            showToast('success', '排盘文本已复制');
            setShowCopyModal(false);
        } catch {
            showToast('error', '复制失败，请重试');
        }
    };

    // 次要操作：桌面端收进标题区「更多」，移动端进顶栏三点菜单（另加重新起课）
    const resultActions = useMemo((): HeaderMenuItem[] => {
        if (!result) return [];
        const items: HeaderMenuItem[] = [
            { id: 'copy-chart', label: copied ? '排盘已复制' : '复制排盘', icon: copied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => setShowCopyModal(true) },
        ];
        if (isAdmin && canonicalResult) items.push({ id: 'copy-json', label: jsonCopied ? 'JSON 已复制' : '复制 JSON', icon: jsonCopied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => { void copyJson(); } });
        return items;
    }, [canonicalResult, copied, copyJson, isAdmin, jsonCopied, result]);

    useEffect(() => {
        if (!result) return;
        setMenuItems([{ id: 'restart', label: '重新起课', icon: <RotateCcw className={MENU_ICON_CLASS} />, onClick: () => router.push('/daliuren') }, ...resultActions]);
        return () => clearMenuItems();
    }, [clearMenuItems, result, resultActions, router, setMenuItems]);

    // 移动端顶栏标题为课体（如「重审课」），桌面端由页内标题承担
    useHeaderTitle(canonicalResult ? parseKeShi(canonicalResult.基本信息.课式).title : null);

    useAnalysisSnapshot({
        conversationId,
        recordId: divinationId,
        divinationType: 'daliuren',
        sessionKey: 'daliuren_params',
        hasExistingAnalysis: !!interpretation || !!streaming.content,
        skip: !result || (!conversationId && !divinationId),
        callbacks: {
            onAnalysis: setInterpretation,
            onReasoning: setInterpretationReasoning,
            onReasoningEnabled: setReasoningEnabled,
            onModelId: setModelId,
            onConversationIdResolved: (resolvedConversationId) => {
                setConversationId(resolvedConversationId);
                persistSessionIds({ conversationId: resolvedConversationId });
            },
        },
    });

    const handleInterpret = useCallback(async () => {
        if (!result || !userId) { if (!userId) setShowAuthModal(true); return; }
        setError(null);
        setInterpretation(null);
        setInterpretationReasoning(null);
        streaming.reset();
        try {
            const analysisResult = await runSharedAnalysisFlow({
                endpoint: '/api/daliuren',
                streaming,
                isCreditsError,
                direct: {
                    prepareBody: { action: 'interpret_prepare', resultData: result, divinationId },
                    persistBody: { action: 'interpret_persist', resultData: result, divinationId },
                },
                streamBody: {
                    action: 'interpret',
                    resultData: result,
                    divinationId,
                    modelId,
                    reasoning: reasoningEnabled,
                    stream: true,
                },
            });
            if (analysisResult.requiresCredits) {
                setShowCreditsModal(true);
            } else {
                if (analysisResult.error) {
                    setError(analysisResult.error);
                }
                if (analysisResult.content) {
                    setInterpretation(analysisResult.content);
                }
                if (analysisResult.reasoning) {
                    setInterpretationReasoning(analysisResult.reasoning);
                }
                if (analysisResult.conversationId) {
                    setConversationId(analysisResult.conversationId);
                    persistSessionIds({ conversationId: analysisResult.conversationId });
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '解读失败');
        }
    }, [divinationId, modelId, persistSessionIds, reasoningEnabled, result, streaming, userId]);

    /** 「保存」：未登录先登录（登录后页面自动保存），已登录则手动重试保存 */
    const handleSave = async () => {
        if (!result || !sessionParams || divinationId || saving || sessionLoading) return;
        if (!userId) {
            setShowAuthModal(true);
            return;
        }
        hasAutoSavedRef.current = true;
        const savedId = await saveDivinationRecord(sessionParams, result);
        showToast(savedId ? 'success' : 'error', savedId ? '已保存到命理记录' : '保存失败，请重试');
    };

    /** 「问太卜断课」：滚动到解读入口，并沿用入口主按钮的同一套前置判断 */
    const handleAskTaibu = () => {
        aiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (sessionLoading || membershipPending || streaming.isStreaming || interpretation || streaming.content) return;
        void handleInterpret();
    };

    if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><SoundWaveLoader variant="block" text="正在起课" /></div>;
    if (!result) return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4 text-center">
            <p className="text-sm text-foreground-secondary">排盘失败</p>
            <button onClick={() => router.back()} className="h-10 rounded-[10px] bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover">返回重试</button>
        </div>
    );

    const { 基本信息: coreInfo } = canonicalResult!;
    const keShi = parseKeShi(coreInfo.课式);
    const keShiDetail = formatKeShiDetail(keShi.detail);
    const pillars = coreInfo.四柱.split(/\s+/u).filter(Boolean);
    const benMingText = formatBenMing(sessionParams, result.xingNian);
    const question = coreInfo.占事;
    const questionText = question ? `问：${question}` : '';
    const desktopMeta = [questionText, `${formatCastTime(sessionParams, coreInfo.占测时间)} ${coreInfo.昼夜}`, benMingText].filter(Boolean).join(' · ');
    const mobileMeta = [[questionText, coreInfo.昼夜].filter(Boolean).join(' · '), [keShiDetail, benMingText].filter(Boolean).join(' · ')];
    const keyChips = [
        { label: '月将', value: coreInfo.月将 },
        { label: '空亡', value: coreInfo.关键状态.空亡.join('') },
        { label: '驿马', value: coreInfo.关键状态.驿马 },
        { label: '丁马', value: coreInfo.关键状态.丁马 },
        { label: '天马', value: coreInfo.关键状态.天马 },
    ].filter(chip => chip.value);
    const hasInterpretation = !!(interpretation || streaming.content);
    const saved = Boolean(divinationId);
    const saveState = {
        saving,
        saved,
        disabled: saved || saving || sessionLoading || !sessionParams,
        onSave: () => { void handleSave(); },
    };

    const aiEntry = (
        <AIFeatureGate>
            <section ref={aiSectionRef} aria-label="太卜推演" className="flex scroll-mt-24 flex-col gap-2.5 rounded-2xl border-[0.5px] border-border bg-panel px-5 py-[18px]">
                <h2 className="font-display text-[17px] font-normal">让太卜推演事态</h2>
                <p className="text-sm leading-relaxed text-foreground-secondary">结合三传、四课与本命行年，说明这件事的来龙去脉。</p>
                <div className="flex flex-wrap items-center gap-2">
                    <ModelSelector compact selectedModel={modelId} onModelChange={setModelId} reasoningEnabled={reasoningEnabled} onReasoningChange={setReasoningEnabled} userId={userId} membershipType={membershipType} disabled={membershipPending} />
                    {interpretation && (
                        <button onClick={handleInterpret} disabled={streaming.isStreaming} aria-label="重新解读" className="rounded-[10px] p-2 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground">
                            <RefreshCw className={`h-4 w-4 ${streaming.isStreaming ? 'animate-spin' : ''}`} />
                        </button>
                    )}
                </div>
                {!hasInterpretation && (
                    sessionLoading || membershipPending ? (
                        <SoundWaveLoader variant="inline" className="self-center py-2" />
                    ) : !userId ? (
                        <button onClick={() => setShowAuthModal(true)} className="h-[42px] rounded-[10px] bg-foreground text-sm text-background transition-opacity hover:opacity-90">登录解锁 AI 解读</button>
                    ) : (
                        <button onClick={handleInterpret} disabled={membershipPending} className="inline-flex h-[42px] items-center justify-center rounded-[10px] bg-foreground text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-50">
                            开始解读
                        </button>
                    )
                )}
            </section>
        </AIFeatureGate>
    );

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[1124px] flex-col gap-3 px-4 pb-28 pt-0.5 animate-fade-in lg:gap-[22px] lg:px-8 lg:pb-16 lg:pt-8">
                <Link href="/daliuren" className="hidden w-fit items-center gap-1.5 text-sm text-foreground-secondary transition-colors hover:text-foreground lg:inline-flex">
                    <ChevronLeft className="h-4 w-4" />重新起课
                </Link>

                {/* 标题：课体 + 日局 · 干上；移动端课体位于顶栏，此处为问事与日局两行 */}
                <header className="flex flex-wrap items-end justify-between gap-4 pb-1 lg:pb-0">
                    <div className="flex w-full min-w-0 flex-col gap-2 text-center lg:w-auto lg:text-left">
                        <p className="text-[0.8125rem] leading-relaxed text-foreground-secondary lg:text-sm">
                            <span className="hidden lg:inline">{desktopMeta}</span>
                            <span className="lg:hidden">{mobileMeta[0]}{mobileMeta[0] && mobileMeta[1] && <br />}{mobileMeta[1]}</span>
                        </p>
                        <h1 className="hidden font-display text-[2.125rem] font-normal leading-tight lg:block">
                            {keShi.title}
                            {keShiDetail && <span className="ml-2 text-xl text-foreground-secondary">{keShiDetail}</span>}
                        </h1>
                    </div>
                    <ResultHeaderActions actions={resultActions} actionsLabel="课盘操作" save={saveState} ask={{ label: ASK_LABEL, onClick: handleAskTaibu }} />
                </header>

                {/* 四柱与月将 / 空亡 / 驿马 / 丁马 / 天马 */}
                <div className="hidden flex-wrap items-baseline gap-x-6 gap-y-2 rounded-xl border-[0.5px] border-border bg-surface px-[18px] py-3.5 text-sm lg:flex">
                    <span className="flex gap-4 font-display text-[17px] tracking-[1px]">
                        {pillars.map((pillar, index) => <span key={`${pillar}-${index}`}>{pillar}</span>)}
                    </span>
                    {keyChips.map(chip => (
                        <span key={chip.label}><span className="text-foreground-secondary">{chip.label}</span> {chip.value}</span>
                    ))}
                </div>
                <div className="grid grid-cols-4 rounded-xl bg-panel px-1 py-2.5 lg:hidden">
                    {pillars.map((pillar, index) => (
                        <div key={`${pillar}-${index}`} className="flex flex-col items-center gap-px">
                            <span className="text-[11px] text-foreground-secondary">{PILLAR_LABELS[index] ?? ''}</span>
                            <span className="font-display text-[17px]">{pillar}</span>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap gap-1.5 lg:hidden">
                    {keyChips.map(chip => `${chip.label} ${chip.value}`).map(text => (
                        <span key={text} className="whitespace-nowrap rounded-md bg-background-secondary px-2 py-0.5 text-xs text-foreground-secondary">{text}</span>
                    ))}
                </div>

                <DaliurenChart chart={canonicalResult!} aside={aiEntry} />

                {/* AI 解读内容（入口卡位于三传四课一栏，正文需要整宽阅读） */}
                <AIFeatureGate>
                    {(error || hasInterpretation) && (
                        <section aria-label="太卜解读" className="flex flex-col gap-4 rounded-2xl border-[0.5px] border-border bg-surface p-5 lg:p-6">
                            <h2 className="font-display text-lg font-normal">太卜解读</h2>
                            {error && (
                                <div role="alert" className="rounded-[10px] border-[0.5px] border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                                    {error}
                                </div>
                            )}
                            {hasInterpretation && (
                                <div className="prose prose-sm max-w-none">
                                    {(interpretationReasoning || streaming.reasoning) && <ThinkingBlock content={interpretationReasoning || streaming.reasoning || ''} isStreaming={streaming.isStreaming && !interpretation} />}
                                    <MarkdownContent content={interpretation || streaming.content || ''} className="text-sm text-foreground leading-relaxed" />
                                </div>
                            )}
                        </section>
                    )}
                </AIFeatureGate>
            </div>

            <ResultMobileActions saving={saving} saved={saved} saveDisabled={sessionLoading || !sessionParams} onSave={saveState.onSave} ask={{ label: ASK_LABEL, onClick: handleAskTaibu }} />

            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
            <CreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />
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
