/**
 * 奇门遁甲排盘结果页面
 *
 * 'use client'：会话缓存读取、宫位选择状态与 AI 流式解读都依赖浏览器端 hooks。
 */
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RotateCw, RefreshCw, Copy, Check, ChevronLeft, BookOpenText } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { ResultMobileActions } from '@/components/bazi/result/ResultHeader';
import { ResultHeaderActions } from '@/components/divination/ResultHeaderActions';
import { QimenGrid } from '@/components/qimen/QimenGrid';
import { QimenLegend } from '@/components/qimen/QimenLegend';
import { QimenPalaceDetail } from '@/components/qimen/QimenPalaceDetail';
import { formatJuLabel } from '@/components/qimen/qimen-display';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { AuthModal } from '@/components/auth/AuthModal';
import { CreditsModal } from '@/components/ui/CreditsModal';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { useHeaderMenu, useHeaderTitle, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { useStreamingResponse, isCreditsError } from '@/lib/hooks/useStreamingResponse';
import { readSessionJSON, updateSessionJSON } from '@/lib/cache/session-storage';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { runSharedAnalysisFlow } from '@/lib/ai/analysis-runner';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import { useAnalysisSnapshot } from '@/lib/hooks/useAnalysisSnapshot';
import { useAdminJsonCopy } from '@/lib/admin/useAdminJsonCopy';
import { CopyTextModal } from '@/components/divination/CopyTextModal';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';
import { saveDivinationAction } from '@/lib/divination/save-client';
import {
    calculateQimenBundle,
    buildQimenCanonicalJSON,
    generateQimenChartText,
    type QimenInput,
    type QimenOutput,
} from '@/lib/divination/qimen';

const PILLAR_LABELS = ['年', '月', '日', '时'] as const;
const MENU_ICON_CLASS = 'h-4 w-4';
const ASK_LABEL = '问太卜断局';

function pad2(value: number): string {
    return Number.isFinite(value) ? String(value).padStart(2, '0') : '--';
}

/** 起局时间（用户输入的民用时间），如 2026-10-10 21:30 */
function formatInputTime(input: Pick<QimenInput, 'year' | 'month' | 'day' | 'hour' | 'minute'>): string {
    return `${input.year}-${pad2(input.month)}-${pad2(input.day)} ${pad2(input.hour)}:${pad2(input.minute)}`;
}

interface QimenSessionData extends QimenInput {
    output?: QimenOutput;
    createdAt: string;
    chartId?: string;
    conversationId?: string;
}

function pickQimenInput(sessionData: QimenSessionData): QimenInput {
    return {
        year: sessionData.year,
        month: sessionData.month,
        day: sessionData.day,
        hour: sessionData.hour,
        minute: sessionData.minute,
        timezone: sessionData.timezone,
        question: sessionData.question,
        panType: sessionData.panType,
        juMethod: sessionData.juMethod,
        zhiFuJiGong: sessionData.zhiFuJiGong,
    };
}

function buildQimenActionPayload(sessionData: QimenSessionData) {
    return {
        year: sessionData.year,
        month: sessionData.month,
        day: sessionData.day,
        hour: sessionData.hour,
        minute: sessionData.minute,
        timezone: sessionData.timezone,
        question: sessionData.question,
        panType: sessionData.panType,
        juMethod: sessionData.juMethod,
        zhiFuJiGong: sessionData.zhiFuJiGong,
    };
}

export default function QimenResultPage() {
    const router = useRouter();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const { showToast } = useToast();
    const [result, setResult] = useState<QimenSessionData | null>(null);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const [interpretation, setInterpretation] = useState<string | null>(null);
    const [interpretationReasoning, setInterpretationReasoning] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showCreditsModal, setShowCreditsModal] = useState(false);
    const [showKbModal, setShowKbModal] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copyDetailLevel, setCopyDetailLevel] = useState<ChartTextDetailLevel>('default');
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [selectedPalace, setSelectedPalace] = useState<number | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const hasSavedRef = useRef(false);
    const aiSectionRef = useRef<HTMLElement>(null);
    const streaming = useStreamingResponse();
    const { user, membershipInfo, sessionLoading, membershipLoading, membershipResolved } = useSessionMembership();
    const membershipPending = membershipLoading || !membershipResolved;
    const membershipType = membershipResolved ? (membershipInfo?.type ?? 'free') : 'free';
    const currentUser = useMemo(() => (user ? { id: user.id } : null), [user]);
    const qimenOutput = result?.output ?? null;
    const canonicalResult = useMemo(
        () => (qimenOutput ? buildQimenCanonicalJSON(qimenOutput) : null),
        [qimenOutput],
    );
    const { isAdmin, jsonCopied, copyJson } = useAdminJsonCopy(canonicalResult);

    /** 保存起局记录（进入页面时自动保存与「保存」按钮共用），成功后回写 chartId */
    const saveChartRecord = useCallback(async (record: QimenSessionData): Promise<boolean> => {
        setIsSaving(true);
        try {
            const saveResult = await saveDivinationAction({
                endpoint: '/api/qimen',
                body: buildQimenActionPayload(record),
                idKey: 'chartId',
                fallbackMessage: '保存奇门记录失败',
            });
            if (!saveResult.ok) {
                throw new Error(saveResult.error.message || '保存奇门记录失败');
            }
            const savedChartId = saveResult.id;
            if (savedChartId) {
                updateSessionJSON('qimen_result', (prev) => ({ ...(prev || {}), chartId: savedChartId }));
                setResult(prev => prev ? { ...prev, chartId: savedChartId } : prev);
            }
            return true;
        } catch (e) {
            console.error(e);
            return false;
        } finally {
            setIsSaving(false);
        }
    }, []);

    useEffect(() => {
        if (sessionLoading) return;
        const init = async () => {
            const parsed = readSessionJSON<QimenSessionData>('qimen_result');
            if (!parsed) { router.push('/qimen'); return; }
            let nextResult = parsed;

            if (!nextResult.output) {
                try {
                    const { output } = await calculateQimenBundle(pickQimenInput(parsed));
                    nextResult = { ...parsed, output };
                    updateSessionJSON('qimen_result', () => nextResult);
                } catch (e) {
                    console.error('[qimen/result] 重新计算命盘失败:', e);
                    router.push('/qimen');
                    return;
                }
            }

            setResult(nextResult);

            if (!nextResult.chartId && currentUser && !hasSavedRef.current) {
                hasSavedRef.current = true;
                await saveChartRecord(nextResult);
            }
        };
        void init();
    }, [currentUser, router, saveChartRecord, sessionLoading]);

    // 次要操作：桌面端收进标题区「更多」，移动端进顶栏三点菜单（另加重新起局）
    // 收藏到知识库依赖已保存的 chartId，保存完成前不出现
    const chartId = result?.chartId;
    const resultActions = useMemo((): HeaderMenuItem[] => {
        const items: HeaderMenuItem[] = [
            { id: 'copy-chart', label: copied ? '排盘已复制' : '复制排盘', icon: copied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => setShowCopyModal(true) },
        ];
        if (isAdmin && canonicalResult) items.push({ id: 'copy-json', label: jsonCopied ? 'JSON 已复制' : '复制 JSON', icon: jsonCopied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => { void copyJson(); } });
        if (knowledgeBaseEnabled && chartId) items.push({ id: 'add-to-kb', label: '收藏到知识库', icon: <BookOpenText className={MENU_ICON_CLASS} />, onClick: () => setShowKbModal(true) });
        return items;
    }, [canonicalResult, chartId, copied, copyJson, isAdmin, jsonCopied, knowledgeBaseEnabled]);

    useEffect(() => {
        setMenuItems([{ id: 'restart', label: '重新起局', icon: <RotateCw className={MENU_ICON_CLASS} />, onClick: () => router.push('/qimen') }, ...resultActions]);
        return () => clearMenuItems();
    }, [clearMenuItems, resultActions, router, setMenuItems]);

    const juLabel = qimenOutput
        ? formatJuLabel(canonicalResult?.基本信息.局式 ?? `${qimenOutput.dunType === 'yang' ? '阳遁' : '阴遁'}${qimenOutput.juNumber}局`)
        : '';
    // 移动端顶栏标题：节气 · 阴/阳遁 X 局（桌面端由页内标题承担）
    useHeaderTitle(qimenOutput ? `${qimenOutput.dateInfo.solarTerm} · ${juLabel}` : null);

    useAnalysisSnapshot({
        conversationId: result?.conversationId,
        recordId: result?.chartId,
        divinationType: 'qimen',
        sessionKey: 'qimen_result',
        hasExistingAnalysis: !!interpretation,
        skip: !result?.conversationId && !result?.chartId,
        callbacks: {
            onAnalysis: setInterpretation,
            onReasoning: setInterpretationReasoning,
            onModelId: setSelectedModel,
            onReasoningEnabled: setReasoningEnabled,
            onConversationIdResolved: (resolvedId) => {
                setResult(prev => prev ? { ...prev, conversationId: resolvedId } : prev);
                updateSessionJSON('qimen_result', (prev) => ({ ...(prev || {}), conversationId: resolvedId }));
            },
        },
    });

    const handleGetInterpretation = async () => {
        if (!result || !currentUser) return;
        setIsLoading(true); streaming.reset(); setError(null); setInterpretationReasoning(null); setInterpretation(null);
        try {
            const baseBody = {
                ...buildQimenActionPayload(result),
                chartId: result.chartId || null,
            };
            const analysisResult = await runSharedAnalysisFlow({
                endpoint: '/api/qimen',
                streaming,
                isCreditsError,
                direct: {
                    prepareBody: {
                        action: 'interpret_prepare',
                        ...baseBody,
                    },
                    persistBody: {
                        action: 'interpret_persist',
                        ...baseBody,
                    },
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
            if (analysisResult.error) {
                setError(analysisResult.error);
                return;
            }
            if (analysisResult.content) {
                setInterpretation(analysisResult.content);
            } else {
                setInterpretation('解读失败');
            }
            if (analysisResult.reasoning) {
                setInterpretationReasoning(analysisResult.reasoning);
            }
            if (analysisResult.conversationId) {
                setResult((prev) => prev ? { ...prev, conversationId: analysisResult.conversationId || undefined } : prev);
                updateSessionJSON('qimen_result', (prev) => ({ ...(prev || {}), conversationId: analysisResult.conversationId }));
            }
        } catch (err) { setError(err instanceof Error ? err.message : '解读失败'); } finally { setIsLoading(false); }
    };

    const handleConfirmCopy = async (level: ChartTextDetailLevel) => {
        if (!result?.output) return;
        setCopyDetailLevel(level);
        try {
            await navigator.clipboard.writeText(generateQimenChartText(result.output, {
                question: result.question,
                detailLevel: level,
            }));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            showToast('success', '排盘文本已复制');
        } catch {
            showToast('error', '复制失败，请重试');
        }
        setShowCopyModal(false);
    };

    /** 「问太卜断局」：滚动到解读区，并沿用解读区主按钮的同一套前置判断 */
    const handleAskTaibu = () => {
        aiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (sessionLoading || membershipPending || isLoading || interpretation) return;
        if (!currentUser) {
            setShowAuthModal(true);
            return;
        }
        void handleGetInterpretation();
    };

    /** 「保存」：未登录先登录（登录后页面自动保存），已登录则手动重试保存 */
    const handleSave = async () => {
        if (!result || result.chartId || isSaving || sessionLoading) return;
        if (!currentUser) {
            setShowAuthModal(true);
            return;
        }
        hasSavedRef.current = true;
        const saved = await saveChartRecord(result);
        showToast(saved ? 'success' : 'error', saved ? '已保存到命理记录' : '保存失败，请重试');
    };

    if (!result || !qimenOutput) return (
        <div className="min-h-screen bg-background flex items-center justify-center">
            <SoundWaveLoader variant="block" text="正在排盘" />
        </div>
    );

    const basicInfo = canonicalResult?.基本信息;
    const palaces = canonicalResult?.九宫盘 ?? [];
    const question = basicInfo?.占问 || result.question;
    const zhiShiGate = basicInfo?.值使 ?? qimenOutput.zhiShi.gate;
    const activePalaceIndex = selectedPalace ?? qimenOutput.zhiShi.palace;
    const activePalace = palaces.find(palace => palace.宫位序号 === activePalaceIndex);
    const activePalaceInfo = qimenOutput.palaces.find(palace => palace.palaceIndex === activePalaceIndex);
    const pillars = [qimenOutput.siZhu.year, qimenOutput.siZhu.month, qimenOutput.siZhu.day, qimenOutput.siZhu.hour];
    const ruleLabel = `${qimenOutput.panType}${qimenOutput.juMethod.replace(/法$/u, '')}${result.zhiFuJiGong === 'jiLiuYi' ? ' · 阳八阴二' : ''}`;
    const yuan = basicInfo?.三元 ?? qimenOutput.yuan;
    // 伏吟反吟、五不遇时等全盘格局不属于单宫，随四柱信息条展示
    const boardFormations = qimenOutput.boardFormations ?? [];
    const keyChips = [
        { label: '旬首', value: basicInfo?.旬首 ?? qimenOutput.xunShou },
        { label: '值符', value: basicInfo?.值符 ?? qimenOutput.zhiFu.star },
        { label: '值使', value: zhiShiGate },
        ...(boardFormations.length > 0 ? [{ label: '全盘', value: boardFormations.join('、') }] : []),
    ];
    const saved = !!result.chartId;
    const saveState = {
        saving: isSaving,
        saved,
        disabled: saved || isSaving || sessionLoading,
        onSave: () => { void handleSave(); },
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[1104px] flex-col gap-3 px-4 pb-28 pt-3 animate-fade-in lg:gap-[22px] lg:px-8 lg:pb-16 lg:pt-8">
                <Link href="/qimen" className="hidden w-fit items-center gap-1.5 text-sm text-foreground-secondary transition-colors hover:text-foreground lg:inline-flex">
                    <ChevronLeft className="h-4 w-4" />重新起局
                </Link>

                {/* 标题：节气 · 阴/阳遁 X 局 + 元；移动端标题位于顶栏，此处只保留问事与起局时间 */}
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div className="flex w-full min-w-0 flex-col gap-2 text-center lg:w-auto lg:text-left">
                        <p className="text-[0.8125rem] leading-normal text-foreground-secondary lg:text-sm">
                            {question && <span>问：{question}</span>}
                            {question && <><span className="hidden lg:inline"> · </span><br className="lg:hidden" /></>}
                            <span>{formatInputTime(result)} · {ruleLabel}</span>
                        </p>
                        <h1 className="hidden font-display text-[2.125rem] font-normal leading-tight lg:block">
                            {qimenOutput.dateInfo.solarTerm} · {juLabel}
                            <span className="ml-2 text-xl text-foreground-secondary">{yuan}</span>
                        </h1>
                    </div>
                    <ResultHeaderActions actions={resultActions} actionsLabel="排盘操作" save={saveState} ask={{ label: ASK_LABEL, onClick: handleAskTaibu }} />
                </header>

                {/* 四柱与旬首 / 值符 / 值使：桌面为一行信息条，移动端为四柱面板 + 标签 */}
                <div className="hidden flex-wrap items-baseline gap-x-6 gap-y-2 rounded-xl border-[0.5px] border-border bg-surface px-[18px] py-3.5 text-sm lg:flex">
                    <span className="font-display text-[17px] tracking-[1px]">{pillars.join('　')}</span>
                    {keyChips.map(chip => (
                        <span key={chip.label}><span className="text-foreground-secondary">{chip.label}</span> {chip.value}</span>
                    ))}
                </div>
                <div className="mt-1 grid grid-cols-4 rounded-xl bg-panel px-1 py-2.5 lg:hidden">
                    {pillars.map((pillar, index) => (
                        <div key={PILLAR_LABELS[index]} className="flex flex-col items-center gap-px">
                            <span className="text-[11px] text-foreground-secondary">{PILLAR_LABELS[index]}</span>
                            <span className="font-display text-[17px]">{pillar}</span>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap gap-1.5 lg:hidden">
                    {[yuan, ...keyChips.map(chip => `${chip.label} ${chip.value}`)].map(text => (
                        <span key={text} className="whitespace-nowrap rounded-md bg-background-secondary px-2 py-0.5 text-xs text-foreground-secondary">{text}</span>
                    ))}
                </div>

                {/* 九宫格 → 图例 → 选中宫位详情 */}
                <QimenGrid
                    palaces={palaces}
                    monthPhaseMap={qimenOutput.monthPhase}
                    zhiShi={zhiShiGate}
                    selectedPalace={activePalaceIndex}
                    onPalaceSelect={setSelectedPalace}
                />
                <QimenLegend />
                {activePalace && (
                    <QimenPalaceDetail
                        palace={activePalace}
                        palaces={palaces}
                        zhiShi={zhiShiGate}
                        monthPhaseMap={qimenOutput.monthPhase}
                        formations={activePalaceInfo?.formations}
                        elementState={activePalaceInfo?.elementState}
                    />
                )}

                {/* AI 解读入口与结果 */}
                <AIFeatureGate>
                    <section ref={aiSectionRef} aria-label="太卜断局" className="flex scroll-mt-24 flex-col gap-4 rounded-2xl border-[0.5px] border-border bg-panel p-4 lg:px-[22px] lg:py-[18px]">
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                            <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1">
                                <h2 className="hidden font-display text-[17px] font-normal lg:block">点宫位查看门星神仪的旺衰与格局</h2>
                                <p className="text-sm text-foreground-secondary">
                                    {question ? `也可以直接问太卜：「${question}」` : '也可以直接问太卜这一局的吉凶。'}
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <ModelSelector compact selectedModel={selectedModel} onModelChange={setSelectedModel} reasoningEnabled={reasoningEnabled} onReasoningChange={setReasoningEnabled} userId={currentUser?.id} membershipType={membershipType} disabled={membershipPending} />
                                {(interpretation || streaming.isStreaming) && (
                                    <button onClick={handleGetInterpretation} disabled={isLoading} aria-label="重新解读" className="rounded-[10px] p-2 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground">
                                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                                    </button>
                                )}
                                {!interpretation && (
                                    sessionLoading || membershipPending ? (
                                        <SoundWaveLoader variant="inline" />
                                    ) : (
                                        <button
                                            onClick={currentUser ? handleGetInterpretation : () => setShowAuthModal(true)}
                                            disabled={isLoading || membershipPending}
                                            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-foreground px-4 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                                        >
                                            {isLoading && <SoundWaveLoader variant="inline" className="[&_.sound-wave-bar]:bg-background" />}
                                            让太卜断这一局
                                        </button>
                                    )
                                )}
                            </div>
                        </div>
                        {error && (
                            <div role="alert" className="rounded-[10px] border-[0.5px] border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                                {error}
                            </div>
                        )}
                        {interpretation && (
                            <div className="prose prose-sm max-w-none rounded-xl border-[0.5px] border-border bg-surface p-4 lg:p-5">
                                {interpretationReasoning && <ThinkingBlock content={interpretationReasoning} isStreaming={streaming.isStreaming && !interpretation} startTime={streaming.reasoningStartTime} duration={streaming.reasoningDuration} />}
                                <MarkdownContent content={interpretation} className="text-sm text-foreground leading-relaxed" />
                            </div>
                        )}
                    </section>
                </AIFeatureGate>
            </div>

            <ResultMobileActions saving={isSaving} saved={saved} saveDisabled={sessionLoading} onSave={saveState.onSave} ask={{ label: ASK_LABEL, onClick: handleAskTaibu }} />

            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
            <CreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />
            {knowledgeBaseEnabled && result.chartId && <AddToKnowledgeBaseModal open={showKbModal} onClose={() => setShowKbModal(false)} sourceTitle={result.question || '奇门遁甲排盘'} sourceType="qimen_chart" sourceId={result.chartId} />}
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
