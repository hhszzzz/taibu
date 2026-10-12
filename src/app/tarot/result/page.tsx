/**
 * 塔罗结果页
 *
 * 牌阵展示（真实牌面、正逆位）、牌义、AI 解读与数秘术
 */
'use client'; // 需要抽牌请求、翻牌状态、流式 AI 解读与 sessionStorage

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, BookOpenText, Copy, Check, ChevronLeft, Save } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import Image from 'next/image';
import { TarotRevealCard } from '@/components/tarot/TarotRevealCard';
import { TarotMeaningGrid, TarotMeaningList, type TarotMeaningEntry } from '@/components/tarot/TarotSpreadParts';
import { getTarotInterpretCopy, getTarotSpreadGridClass } from '@/components/tarot/tarot-display';
import { MobileActionBar, MOBILE_SECONDARY_ACTION_CLASS } from '@/components/bazi/result/ResultHeader';
import { ResultHeaderActions } from '@/components/divination/ResultHeaderActions';
import { buildTarotCanonicalJSON, findTarotCardByChineseName, generateTarotReadingText, TAROT_SPREADS, type DrawnCard, type TarotNumerology, type TarotSpread } from '@/lib/divination/tarot';
import { readSessionJSON, updateSessionJSON } from '@/lib/cache/session-storage';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { AuthModal } from '@/components/auth/AuthModal';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { useHeaderMenu, useHeaderTitle, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { useToast } from '@/components/ui/Toast';
import { CreditsModal } from '@/components/ui/CreditsModal';
import { useStreamingResponse, isCreditsError } from '@/lib/hooks/useStreamingResponse';
import { useAnalysisSnapshot } from '@/lib/hooks/useAnalysisSnapshot';
import { CopyTextModal } from '@/components/divination/CopyTextModal';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';
import { runSharedAnalysisFlow } from '@/lib/ai/analysis-runner';
import { saveDivinationAction } from '@/lib/divination/save-client';

const MENU_ICON_CLASS = 'h-4 w-4';
const ASK_LABEL = '问太卜解读';
const NUMEROLOGY_SLOTS = [
    { key: 'personalityCard', label: '人格牌' },
    { key: 'soulCard', label: '灵魂牌' },
    { key: 'yearlyCard', label: '年度牌' },
] as const;

type TarotSession = {
    spread?: TarotSpread;
    spreadId?: string;
    cards?: DrawnCard[];
    question?: string;
    birthDate?: string;
    numerology?: TarotNumerology | null;
    seed?: string | null;
    readingId?: string | null;
    conversationId?: string | null;
    createdAt?: string;
};

function TarotResultContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const { showToast } = useToast();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const historyTimestamp = searchParams.get('t');
    const spreadId = searchParams.get('spreadId');
    const questionParam = searchParams.get('question');
    const birthDateParam = searchParams.get('birthDate');
    // 入口页取消「包含逆位」时带 reversed=0
    const allowReversed = searchParams.get('reversed') !== '0';

    const [selectedSpread, setSelectedSpread] = useState<TarotSpread | null>(null);
    const [drawnCards, setDrawnCards] = useState<DrawnCard[]>([]);
    const [question, setQuestion] = useState(questionParam || '');
    const [birthDate, setBirthDate] = useState(birthDateParam || '');
    const [numerology, setNumerology] = useState<TarotNumerology | null>(null);
    const [seed, setSeed] = useState<string | null>(null);
    const [interpretation, setInterpretation] = useState('');
    const [interpretationReasoning, setInterpretationReasoning] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isInterpreting, setIsInterpreting] = useState(false);
    const [revealedCards, setRevealedCards] = useState<number[]>([]);
    const [flippedToInterpretation, setFlippedToInterpretation] = useState<number[]>([]);
    const [readingId, setReadingId] = useState<string | null>(null);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [historyMissing, setHistoryMissing] = useState(false);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [kbModalOpen, setKbModalOpen] = useState(false);
    const [showCreditsModal, setShowCreditsModal] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copyDetailLevel, setCopyDetailLevel] = useState<ChartTextDetailLevel>('default');
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const aiSectionRef = useRef<HTMLElement>(null);
    const streaming = useStreamingResponse();
    const { user, userId, sessionLoading, membershipInfo, membershipLoading, membershipResolved } = useSessionMembership();
    const membershipPending = membershipLoading || !membershipResolved;
    const membershipType = membershipResolved ? (membershipInfo?.type ?? 'free') : 'free';

    const canonicalReading = useMemo(() => {
        if (!selectedSpread || drawnCards.length === 0) return null;
        return buildTarotCanonicalJSON({ spreadName: selectedSpread.name, spreadId: selectedSpread.id, question, cards: drawnCards, seed: seed || undefined, numerology, birthDate, detailLevel: 'full' });
    }, [birthDate, drawnCards, numerology, question, seed, selectedSpread]);

    // 牌义只列出已翻开的牌，避免提前剧透
    const revealedMeaningEntries = useMemo<TarotMeaningEntry[]>(() => drawnCards.flatMap((card, index) => {
        if (!revealedCards.includes(index)) return [];
        const canonicalCard = canonicalReading?.牌阵展开[index];
        return [{
            key: `${index}:${card.card.name}`,
            name: canonicalCard?.塔罗牌 || card.card.nameChinese,
            reversed: (canonicalCard?.状态 || (card.orientation === 'reversed' ? '逆位' : '正位')) === '逆位',
            keywords: canonicalCard?.核心基调 ?? [],
            element: canonicalCard?.元素,
            astro: canonicalCard?.星象,
        }];
    }), [canonicalReading, drawnCards, revealedCards]);

    // 获取抽牌
    useEffect(() => {
        if (!spreadId) return;
        const drawCards = async () => {
            setIsLoading(true); setRevealedCards([]); setInterpretation(''); setInterpretationReasoning(null);
            try {
                const res = await fetch('/api/tarot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draw-only', spreadId, allowReversed, birthDate: birthDateParam || undefined }) });
                const data = await res.json();
                if (data.success && data.data?.cards) {
                    setSelectedSpread(data.data.spread); setDrawnCards(data.data.cards); setNumerology(data.data.numerology || null); setSeed(data.data.seed);
                }
            } catch (e) { console.error(e); } finally { setIsLoading(false); }
        };
        drawCards();
    }, [allowReversed, birthDateParam, spreadId]);

    // 加载历史
    useEffect(() => {
        if (spreadId) return;
        const parsed = readSessionJSON<TarotSession>('tarot_result');
        if (parsed?.cards) {
            const spread = TAROT_SPREADS.find(s => s.id === (parsed.spreadId || parsed.spread?.id)) || null;
            if (spread) {
                setSelectedSpread(spread); setDrawnCards(parsed.cards); setQuestion(parsed.question || ''); setBirthDate(parsed.birthDate || '');
                setNumerology(parsed.numerology || null); setSeed(parsed.seed || null); setRevealedCards(parsed.cards.map((_: DrawnCard, i: number) => i));
                setReadingId(parsed.readingId || null); setConversationId(parsed.conversationId || null);
                setIsLoading(false); return;
            }
        }
        if (historyTimestamp) { setHistoryMissing(true); setIsLoading(false); return; }
        router.push('/tarot');
    }, [historyTimestamp, router, spreadId]);

    useEffect(() => {
        if (!selectedSpread || drawnCards.length === 0) return;

        updateSessionJSON<TarotSession>('tarot_result', (prev) => ({
            ...(prev || {}),
            spread: selectedSpread,
            spreadId: selectedSpread.id,
            cards: drawnCards,
            question,
            birthDate,
            numerology,
            seed,
            readingId,
            conversationId,
            createdAt: prev?.createdAt || new Date().toISOString(),
        }));
    }, [birthDate, conversationId, drawnCards, numerology, question, readingId, seed, selectedSpread]);

    const handleConfirmCopy = useCallback(async (level: ChartTextDetailLevel) => {
        if (!selectedSpread || drawnCards.length === 0) return;
        try {
            setCopyDetailLevel(level);
            await navigator.clipboard.writeText(generateTarotReadingText({ spreadName: selectedSpread.name, spreadId: selectedSpread.id, question, cards: drawnCards, seed: seed || undefined, numerology, birthDate, detailLevel: level }));
            setCopied(true); setTimeout(() => setCopied(false), 2000);
            showToast('success', '牌阵文本已复制');
            setShowCopyModal(false);
        } catch {
            showToast('error', '复制失败，请重试');
        }
    }, [birthDate, drawnCards, numerology, question, seed, selectedSpread, showToast]);

    const handleInterpret = useCallback(async () => {
        if (drawnCards.length === 0 || !user) { if (!user) setShowAuthModal(true); return; }
        // 解读覆盖整组牌，先把未翻开的牌全部翻开
        setRevealedCards(drawnCards.map((_, i) => i));
        setIsInterpreting(true); streaming.reset(); setInterpretationReasoning(null); setInterpretation('');
        try {
            const baseBody = {
                cards: drawnCards,
                question: question || undefined,
                birthDate: birthDate || undefined,
                numerology: numerology || undefined,
                seed: seed || undefined,
                spreadId: selectedSpread?.id,
                readingId: readingId || undefined,
            };
            const result = await runSharedAnalysisFlow({
                endpoint: '/api/tarot',
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
            if (result.requiresCredits) setShowCreditsModal(true);
            else {
                if (result.error) showToast('error', result.error);
                if (result.content) setInterpretation(result.content);
                if (result.reasoning) setInterpretationReasoning(result.reasoning);
                if (result.conversationId) setConversationId(result.conversationId);
            }
        } catch (e) { console.error(e); } finally { setIsInterpreting(false); }
    }, [birthDate, drawnCards, numerology, question, readingId, reasoningEnabled, seed, selectedModel, selectedSpread?.id, showToast, streaming, user]);

    // 未解读时抽牌结果只在会话里；解读后会随对话一起入库（历史绑定），此时视为已保存
    const saved = Boolean(readingId || conversationId);

    /** 「保存」：未登录先登录；已登录则把本次抽牌写入命理记录 */
    const handleSave = useCallback(async () => {
        if (!selectedSpread || drawnCards.length === 0 || saved || saving || sessionLoading) return;
        if (!user) { setShowAuthModal(true); return; }
        setSaving(true);
        try {
            const result = await saveDivinationAction({
                endpoint: '/api/tarot',
                body: { spreadId: selectedSpread.id, cards: drawnCards, question: question || undefined, birthDate: birthDate || undefined, numerology: numerology || undefined, seed: seed || undefined },
                idKey: 'readingId',
                fallbackMessage: '保存塔罗记录失败',
            });
            if (result.ok && result.id) {
                setReadingId(result.id);
                showToast('success', '已保存到命理记录');
            } else {
                showToast('error', result.ok ? '保存失败，请重试' : result.error.message || '保存失败，请重试');
            }
        } finally {
            setSaving(false);
        }
    }, [birthDate, drawnCards, numerology, question, saved, saving, seed, selectedSpread, sessionLoading, showToast, user]);

    useAnalysisSnapshot({
        conversationId,
        recordId: readingId,
        divinationType: 'tarot',
        sessionKey: 'tarot_result',
        hasExistingAnalysis: !!interpretation,
        callbacks: {
            onAnalysis: setInterpretation,
            onReasoning: setInterpretationReasoning,
            onModelId: setSelectedModel,
            onReasoningEnabled: setReasoningEnabled,
            onConversationIdResolved: setConversationId,
        },
    });

    // 次要操作：桌面端收进标题区「更多」，移动端进顶栏三点菜单（另加保存；重新洗牌在底栏）
    const resultActions = useMemo((): HeaderMenuItem[] => {
        if (drawnCards.length === 0) return [];
        const items: HeaderMenuItem[] = [
            { id: 'copy', label: copied ? '牌阵已复制' : '复制牌阵', icon: copied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => setShowCopyModal(true) },
        ];
        if (knowledgeBaseEnabled && readingId) items.push({ id: 'add-to-kb', label: '收藏到知识库', icon: <BookOpenText className={MENU_ICON_CLASS} />, onClick: () => setKbModalOpen(true) });
        return items;
    }, [copied, drawnCards.length, knowledgeBaseEnabled, readingId]);

    useEffect(() => {
        if (drawnCards.length === 0) return;
        const saveItem: HeaderMenuItem = {
            id: 'save',
            label: saved ? '已保存' : saving ? '保存中' : '保存',
            icon: saved ? <Check className={MENU_ICON_CLASS} /> : <Save className={MENU_ICON_CLASS} />,
            onClick: () => { void handleSave(); },
            disabled: saved || saving,
        };
        setMenuItems([saveItem, ...resultActions]);
        return () => clearMenuItems();
    }, [clearMenuItems, drawnCards.length, handleSave, resultActions, saved, saving, setMenuItems]);

    // 移动端顶栏标题为牌阵名，桌面端由页内标题承担
    useHeaderTitle(selectedSpread?.name ?? null);

    /** 「问太卜解读」：滚动到解读区，尚未解读时直接发起 */
    const handleAskTaibu = () => {
        aiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (isInterpreting || membershipPending || interpretation || streaming.content) return;
        void handleInterpret();
    };

    if (isLoading) return (
        <div className="flex min-h-[60vh] items-center justify-center bg-background">
            <SoundWaveLoader variant="block" text="正在洗牌抽取" className="animate-fade-in" />
        </div>
    );

    if (historyMissing || !selectedSpread) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 bg-background p-4 text-center">
                <p className="text-sm text-foreground-secondary">
                    {historyMissing ? '历史记录加载失败，请从历史列表重新进入' : '未找到牌阵信息'}
                </p>
                <Link
                    href={historyMissing ? '/tarot/history' : '/tarot'}
                    className="inline-flex h-10 items-center rounded-[10px] bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                >
                    返回
                </Link>
            </div>
        );
    }

    const positionsText = selectedSpread.positions.map(position => position.name).join(' / ');
    const interpretCopy = getTarotInterpretCopy({
        elements: (canonicalReading?.牌阵展开 ?? []).map(card => card.元素),
        allRevealed: revealedCards.length >= drawnCards.length,
        hasQuestion: Boolean(question),
    });
    const shownInterpretation = interpretation || streaming.content || '';
    const shownReasoning = interpretationReasoning || streaming.reasoning || '';
    const saveState = { saving, saved, disabled: saved || saving || sessionLoading, onSave: () => { void handleSave(); } };
    const modelControls = (
        <ModelSelector compact selectedModel={selectedModel} onModelChange={setSelectedModel} reasoningEnabled={reasoningEnabled} onReasoningChange={setReasoningEnabled} userId={userId} membershipType={membershipType} disabled={membershipPending} />
    );

    return (
        <div className="min-h-full bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[1024px] animate-fade-in flex-col gap-3.5 px-4 pt-0.5 pb-28 lg:gap-7 lg:px-8 lg:pt-8 lg:pb-16">
                {/* 桌面端返回；移动端由顶栏返回与底栏「重新洗牌」承载 */}
                <Link href="/tarot" className="hidden w-fit items-center gap-1.5 rounded-md text-sm text-foreground-secondary transition-colors hover:text-foreground lg:inline-flex">
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />重新洗牌
                </Link>

                {/* 标题：桌面端以所问之事为标题；移动端牌阵名在顶栏，这里给出牌位与问题 */}
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div className="flex w-full min-w-0 flex-col gap-3.5 lg:w-auto lg:max-w-[640px] lg:gap-2">
                        <p className="text-center text-[0.8125rem] text-foreground-secondary lg:text-left lg:text-sm">
                            <span className="hidden lg:inline">{question ? `${selectedSpread.name} · ` : ''}</span>{positionsText}
                        </p>
                        <h1 className="hidden font-display text-[1.875rem] font-normal leading-[1.35] lg:block">{question || selectedSpread.name}</h1>
                        {question && (
                            <p className="rounded-[14px] bg-panel px-4 py-3.5 text-center font-display text-base leading-relaxed lg:hidden">{question}</p>
                        )}
                    </div>
                    <ResultHeaderActions actions={resultActions} actionsLabel="牌阵操作" save={saveState} />
                </header>

                {/* 牌阵 */}
                <section aria-label="牌阵" className="@container flex flex-col items-center gap-6 lg:rounded-[20px] lg:bg-panel lg:px-8 lg:py-9">
                    <div className={`grid w-full justify-items-center gap-x-2 gap-y-6 lg:gap-x-6 ${getTarotSpreadGridClass(drawnCards.length)}`}>
                        {drawnCards.map((card, index) => {
                            const canonicalCard = canonicalReading?.牌阵展开[index];
                            const isRevealed = revealedCards.includes(index);
                            return (
                                <TarotRevealCard
                                    key={index}
                                    index={index}
                                    positionName={selectedSpread.positions[index]?.name || canonicalCard?.位置 || `第${index + 1}张`}
                                    name={canonicalCard?.塔罗牌 || card.card.nameChinese}
                                    image={card.card.image}
                                    meaning={card.orientation === 'reversed' ? card.card.reversedMeaning : card.card.uprightMeaning}
                                    reversed={(canonicalCard?.状态 || (card.orientation === 'reversed' ? '逆位' : '正位')) === '逆位'}
                                    isRevealed={isRevealed}
                                    isFlipped={flippedToInterpretation.includes(index)}
                                    large={drawnCards.length === 1}
                                    onClick={() => isRevealed ? setFlippedToInterpretation(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]) : setRevealedCards(prev => [...prev, index])}
                                />
                            );
                        })}
                    </div>
                    {revealedCards.length < drawnCards.length && (
                        <button type="button" onClick={() => setRevealedCards(drawnCards.map((_, i) => i))} className="h-11 rounded-xl bg-accent px-6 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover">翻开所有牌面</button>
                    )}
                </section>

                {/* 牌义：宽屏为卡片网格，窄屏为列表卡 */}
                <TarotMeaningGrid entries={revealedMeaningEntries} className="hidden lg:grid" />
                <TarotMeaningList entries={revealedMeaningEntries} className="lg:hidden" />

                {/* AI 解读：未解读时为入口卡，解读后展示正文 */}
                <AIFeatureGate>
                    {shownInterpretation ? (
                        <section ref={aiSectionRef} aria-label="太卜解读" className="flex scroll-mt-24 flex-col rounded-2xl border-[0.5px] border-border bg-surface">
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b-[0.5px] border-border px-4 py-3.5 lg:px-6">
                                <h2 className="font-display text-[17px] font-normal">太卜解读</h2>
                                <div className="flex items-center gap-2">
                                    {modelControls}
                                    <button type="button" onClick={() => { void handleInterpret(); }} disabled={isInterpreting} aria-label="重新解读" className="rounded-md p-1.5 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isInterpreting ? 'animate-spin' : ''}`} /></button>
                                </div>
                            </div>
                            <div className="px-4 py-5 lg:px-6">
                                {shownReasoning && <ThinkingBlock content={shownReasoning} isStreaming={streaming.isStreaming && !streaming.content} startTime={streaming.reasoningStartTime} duration={streaming.reasoningDuration} />}
                                <MarkdownContent content={shownInterpretation} className="text-sm leading-relaxed text-foreground" />
                            </div>
                        </section>
                    ) : (
                        <section ref={aiSectionRef} aria-label="太卜解读" className="flex scroll-mt-24 flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border-[0.5px] border-border bg-sidebar px-4 py-4 lg:px-[22px] lg:py-[18px]">
                            <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
                                <h2 className="font-display text-[17px] font-normal">{interpretCopy.title}</h2>
                                <p className="text-sm text-foreground-secondary">{interpretCopy.description}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {modelControls}
                                {isInterpreting || sessionLoading ? (
                                    <span className="inline-flex h-10 items-center px-3"><SoundWaveLoader variant="inline" /></span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => { void handleInterpret(); }}
                                        disabled={membershipPending}
                                        className="h-10 rounded-[10px] bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {userId ? '开始解读' : '登录后解读'}
                                    </button>
                                )}
                            </div>
                        </section>
                    )}
                </AIFeatureGate>

                {/* 数秘术 */}
                {(birthDate || numerology) && (
                    <section aria-label="塔罗数秘术" className="flex flex-col gap-4 rounded-2xl border-[0.5px] border-border bg-surface p-4 lg:p-6">
                        <h2 className="font-display text-[17px] font-medium">塔罗数秘术</h2>
                        <div className="grid grid-cols-3 gap-3 lg:gap-6">
                            {NUMEROLOGY_SLOTS.map(({ key, label }) => {
                                const card = numerology?.[key];
                                const cardImage = card ? findTarotCardByChineseName(card.nameChinese)?.image : null;
                                return (
                                    <div key={key} className="flex flex-col items-center gap-2.5 text-center">
                                        <span className="text-xs text-foreground-secondary">{label}</span>
                                        <div className="relative aspect-[4/7] w-full max-w-[100px] overflow-hidden rounded-[10px] border-[0.5px] border-foreground/20 bg-panel shadow-[0_4px_14px_rgba(20,20,19,0.08)]">
                                            {cardImage && card ? (
                                                <Image src={cardImage} alt={card.nameChinese} fill sizes="100px" className="object-cover" />
                                            ) : null}
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="font-display text-sm">{card?.nameChinese || '-'}</span>
                                            {typeof card?.year === 'number' && <span className="text-[11px] text-foreground-tertiary">年度 {card.year}</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}
            </div>

            <MobileActionBar ask={{ label: ASK_LABEL, onClick: handleAskTaibu }}>
                <Link href="/tarot" className={`${MOBILE_SECONDARY_ACTION_CLASS} text-foreground`}>重新洗牌</Link>
            </MobileActionBar>

            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
            <CreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />
            {knowledgeBaseEnabled && readingId && <AddToKnowledgeBaseModal open={kbModalOpen} onClose={() => setKbModalOpen(false)} sourceTitle={question || selectedSpread?.name || '塔罗占卜'} sourceType="tarot_reading" sourceId={readingId} />}
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

export default function TarotResultPage() {
    return (
        <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center bg-background"><SoundWaveLoader variant="block" /></div>}>
            <TarotResultContent />
        </Suspense>
    );
}
