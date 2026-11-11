/**
 * 塔罗结果页
 *
 * 牌阵展示（真实牌面、正逆位）、牌义与数秘术；解读统一进入 AI 对话
 */
'use client'; // 需要抽牌请求、翻牌状态与 sessionStorage

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BookOpenText, Copy, Check, ChevronLeft, Save } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Button } from '@/components/ui/Button';
import Image from 'next/image';
import { TarotRevealCard } from '@/components/tarot/TarotRevealCard';
import { TarotMeaningGrid, TarotMeaningList, type TarotMeaningEntry } from '@/components/tarot/TarotSpreadParts';
import { getTarotSpreadGridClass } from '@/components/tarot/tarot-display';
import { MobileActionBar, MOBILE_SECONDARY_ACTION_CLASS } from '@/components/bazi/result/ResultHeader';
import { ResultHeaderActions } from '@/components/divination/ResultHeaderActions';
import {
    buildTarotCanonicalJSON,
    createTarotDrawSession,
    findTarotCardByChineseName,
    generateTarotReadingText,
    getTarotResultHrefAfterDraw,
    readTarotDrawRequest,
    TAROT_SPREADS,
    type DrawnCard,
    type TarotNumerology,
    type TarotResultSession,
    type TarotSpread,
} from '@/lib/divination/tarot';
import { readSessionJSON, scopeResultSession, updateSessionJSON, writeSessionJSON } from '@/lib/cache/session-storage';
import { useIdentityGuard } from '@/lib/hooks/useIdentityGuard';
import { useSessionBalance } from '@/lib/hooks/useSessionBalance';
import { createSaveOnce, buildAskTaibuText, openChatWithResult } from '@/lib/chat/result-handoff';
import { AuthModal } from '@/components/auth/AuthModal';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { useHeaderMenu, useHeaderTitle, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { useToast } from '@/components/ui/Toast';
import { CopyTextModal } from '@/components/divination/CopyTextModal';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';
import { saveDivinationAction } from '@/lib/divination/save-client';

const MENU_ICON_CLASS = 'h-4 w-4';
const ASK_LABEL = '问太卜';
const NUMEROLOGY_SLOTS = [
    { key: 'personalityCard', label: '人格牌' },
    { key: 'soulCard', label: '灵魂牌' },
    { key: 'yearlyCard', label: '年度牌' },
] as const;

/** /api/tarot `draw-only` 的响应 */
type TarotDrawResponse = {
    success?: boolean;
    data?: { spread: TarotSpread; cards: DrawnCard[]; numerology?: TarotNumerology | null; seed?: string | null };
};

function TarotResultContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const { showToast } = useToast();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const historyTimestamp = searchParams.get('t');
    // 入口页发起的一次性抽牌请求（取消「包含逆位」时 allowReversed 为 false）
    const drawRequest = readTarotDrawRequest(searchParams);
    const spreadId = drawRequest?.spreadId ?? null;
    const questionParam = drawRequest?.question ?? '';
    const birthDateParam = drawRequest?.birthDate ?? '';
    const allowReversed = drawRequest?.allowReversed ?? true;
    const hrefAfterDraw = getTarotResultHrefAfterDraw(searchParams);

    const [selectedSpread, setSelectedSpread] = useState<TarotSpread | null>(null);
    const [drawnCards, setDrawnCards] = useState<DrawnCard[]>([]);
    const [question, setQuestion] = useState(questionParam);
    const [birthDate, setBirthDate] = useState(birthDateParam);
    const [numerology, setNumerology] = useState<TarotNumerology | null>(null);
    const [seed, setSeed] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [revealedCards, setRevealedCards] = useState<number[]>([]);
    const [storedReadingId, setReadingId] = useState<string | null>(null);
    const [historyMissing, setHistoryMissing] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [kbModalOpen, setKbModalOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copyDetailLevel, setCopyDetailLevel] = useState<ChartTextDetailLevel>('default');
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [saving, setSaving] = useState(false);
    /** 本页已抽出牌并换掉了抽牌地址：牌面与翻牌状态都在内存中 */
    const drawnInPageRef = useRef(false);
    const { user, userId, sessionLoading } = useSessionBalance();
    const captureIdentity = useIdentityGuard(userId);
    const [resultOwnerId, setResultOwnerId] = useState<string | null | undefined>(undefined);
    const readingId = resultOwnerId === userId ? storedReadingId : null;
    const [prevSavingUserId, setPrevSavingUserId] = useState(userId);
    if (prevSavingUserId !== userId) {
        setPrevSavingUserId(userId);
        setSaving(false);
    }

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

    // 抽牌：地址上的抽牌参数是一次性请求。抽到牌后整体替换会话并换成不带这些参数的地址，
    // 之后刷新、前进或后退都从会话恢复同一组牌，而不是重新抽一组。抽牌失败时保留地址，刷新即重试。
    useEffect(() => {
        if (!spreadId || sessionLoading) return;
        let cancelled = false;
        const drawCards = async () => {
            setIsLoading(true); setRevealedCards([]);
            try {
                const res = await fetch('/api/tarot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draw-only', spreadId, allowReversed, birthDate: birthDateParam || undefined }) });
                const data: TarotDrawResponse = await res.json();
                if (cancelled || !data.success || !data.data?.cards) return;
                const draw = data.data;
                writeSessionJSON('tarot_result', { ...createTarotDrawSession(draw, { question: questionParam, birthDate: birthDateParam }, new Date().toISOString()), recordOwnerId: userId });
                setResultOwnerId(userId);
                setReadingId(null);
                drawnInPageRef.current = true;
                setSelectedSpread(draw.spread); setDrawnCards(draw.cards); setNumerology(draw.numerology || null); setSeed(draw.seed || null);
                window.history.replaceState(null, '', hrefAfterDraw);
            } catch (e) { console.error(e); } finally { if (!cancelled) setIsLoading(false); }
        };
        void drawCards();
        return () => { cancelled = true; };
    }, [allowReversed, birthDateParam, hrefAfterDraw, questionParam, spreadId, sessionLoading, userId]);

    // 从会话恢复：刷新、历史记录（带 t）以及抽牌后换掉的地址
    useEffect(() => {
        if (spreadId || sessionLoading) return;
        // 本页刚抽的牌已在屏幕上，按会话重置会把未翻开的牌全部翻开；历史记录跳转（带 t）仍照常恢复
        if (drawnInPageRef.current && !historyTimestamp && resultOwnerId === userId) return;
        void Promise.resolve().then(() => {
            const stored = readSessionJSON<TarotResultSession>('tarot_result');
            const parsed = stored ? scopeResultSession(stored, userId) : null;
            if (parsed?.cards) {
                const spread = TAROT_SPREADS.find(s => s.id === (parsed.spreadId || parsed.spread?.id)) || null;
                if (spread) {
                    setSelectedSpread(spread); setDrawnCards(parsed.cards); setQuestion(parsed.question || ''); setBirthDate(parsed.birthDate || '');
                    setNumerology(parsed.numerology || null); setSeed(parsed.seed || null); setRevealedCards(parsed.cards.map((_: DrawnCard, i: number) => i));
                    setReadingId(parsed.readingId || null);
                    setResultOwnerId(userId);
                    setIsLoading(false); return;
                }
            }
            if (historyTimestamp) { setHistoryMissing(true); setIsLoading(false); return; }
            router.push('/tarot');
        });
    }, [historyTimestamp, router, spreadId, sessionLoading, userId, resultOwnerId]);

    // 进入结果页后自动逐张翻开，无需手动点击；历史恢复的牌面已经是全开状态。
    useEffect(() => {
        if (isLoading || sessionLoading || drawnCards.length === 0) return;
        const stagger = drawnCards.length > 5 ? 240 : 380;
        const timers = drawnCards.map((_, index) => window.setTimeout(() => {
            setRevealedCards(prev => (prev.includes(index) ? prev : [...prev, index]));
        }, 300 + index * stagger));
        return () => timers.forEach(timer => window.clearTimeout(timer));
    }, [drawnCards, isLoading, sessionLoading]);

    useEffect(() => {
        if (!selectedSpread || drawnCards.length === 0 || sessionLoading || resultOwnerId !== userId) return;

        updateSessionJSON<TarotResultSession>('tarot_result', (prev) => ({
            ...(prev || {}),
            recordOwnerId: userId,
            spread: selectedSpread,
            spreadId: selectedSpread.id,
            cards: drawnCards,
            question,
            birthDate,
            numerology,
            seed,
            readingId,
            createdAt: prev?.createdAt || new Date().toISOString(),
        }));
    }, [birthDate, drawnCards, numerology, question, readingId, seed, selectedSpread, sessionLoading, userId, resultOwnerId]);

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

    const saved = resultOwnerId === userId && Boolean(readingId);
    const saveOnce = useMemo(() => createSaveOnce(), []);

    /** 落库（不带提示）：「保存」与「问太卜」共用，返回记录 ID。 */
    const persistReading = useCallback(async (): Promise<string | null> => {
        if (!selectedSpread || drawnCards.length === 0 || sessionLoading) return null;
        if (readingId) return readingId;
        if (!user) return null;
        const isCurrent = captureIdentity();
        setSaving(true);
        try {
            const result = await saveDivinationAction({
                endpoint: '/api/tarot',
                body: { spreadId: selectedSpread.id, cards: drawnCards, question: question || undefined, birthDate: birthDate || undefined, numerology: numerology || undefined, seed: seed || undefined },
                idKey: 'readingId',
                fallbackMessage: '保存塔罗记录失败',
            });
            if (!isCurrent() || !result.ok || !result.id) return null;
            setReadingId(result.id);
            return result.id;
        } catch {
            return null;
        } finally {
            if (isCurrent()) setSaving(false);
        }
    }, [birthDate, captureIdentity, drawnCards, numerology, question, readingId, seed, selectedSpread, sessionLoading, user]);

    /** 「保存」：未登录先登录；已登录则把本次抽牌写入命理记录 */
    const handleSave = useCallback(async () => {
        if (!selectedSpread || drawnCards.length === 0 || saved || saving || sessionLoading) return;
        if (!user) { setShowAuthModal(true); return; }
        const id = await saveOnce(persistReading);
        showToast(id ? 'success' : 'error', id ? '已保存到命理记录' : '保存失败，请重试');
    }, [drawnCards.length, persistReading, saveOnce, saved, saving, selectedSpread, sessionLoading, showToast, user]);

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

    /** 「问太卜」：先把牌面全部翻开；未保存时先落库，再带上牌阵进入 AI 对话。 */
    const handleAskTaibu = async () => {
        if (drawnCards.length === 0) return;
        setRevealedCards(drawnCards.map((_, i) => i));
        const id = readingId ?? (user ? await saveOnce(persistReading) : null);
        if (user && !id) showToast('error', '保存失败，牌阵未能带入对话');
        openChatWithResult(router, {
            text: buildAskTaibuText({
                question,
                prompt: `请结合这个${selectedSpread?.name ?? ''}牌阵与牌义，解读牌面与建议。`,
                questionless: '我抽牌时没填所问之事。请先看这个牌阵的牌面与元素分布，说说整体基调，再问我这次想问什么；等我回答后再串叙事、给建议。',
                chartAttached: Boolean(id),
            }),
            mentions: id ? [{
                type: 'tarot_reading',
                id,
                name: `塔罗 · ${selectedSpread?.name ?? '牌阵'}`,
                preview: question || '塔罗牌阵',
            }] : [],
        });
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
                    className="inline-flex h-10 items-center rounded-xl bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                >
                    返回
                </Link>
            </div>
        );
    }

    const positionsText = selectedSpread.positions.map(position => position.name).join(' / ');
    const saveState = { saving, saved, disabled: saved || saving || sessionLoading, onSave: () => { void handleSave(); } };

    return (
        <div className="min-h-full bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[1024px] motion-stagger flex-col gap-3.5 px-4 pt-0.5 pb-28 lg:gap-7 lg:px-8 lg:pt-8 lg:pb-16">
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
                            <p className="rounded-2xl bg-panel px-4 py-3.5 text-center font-display text-base leading-relaxed lg:hidden">{question}</p>
                        )}
                    </div>
                    <ResultHeaderActions actions={resultActions} actionsLabel="牌阵操作" save={saveState} />
                </header>

                {/* 牌阵 */}
                <section aria-label="牌阵" className="@container flex flex-col items-center gap-6 lg:rounded-2xl lg:bg-panel lg:px-8 lg:py-9">
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
                                    reversed={(canonicalCard?.状态 || (card.orientation === 'reversed' ? '逆位' : '正位')) === '逆位'}
                                    isRevealed={isRevealed}
                                    large={drawnCards.length === 1}
                                    onClick={() => { if (!isRevealed) setRevealedCards(prev => [...prev, index]); }}
                                />
                            );
                        })}
                    </div>
                </section>

                {/* 牌义：宽屏为卡片网格，窄屏为列表卡 */}
                <TarotMeaningGrid entries={revealedMeaningEntries} className="hidden lg:grid" />
                <TarotMeaningList entries={revealedMeaningEntries} className="lg:hidden" />

                {/* 解读入口：页内不再生成解读，统一进入 AI 对话 */}
                <section aria-label="太卜解读" className="flex scroll-mt-24 flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border-[0.5px] border-border bg-sidebar px-4 py-4 lg:px-[22px] lg:py-[18px]">
                    <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
                        <h2 className="font-display text-[17px] font-normal">让太卜结合牌阵解读</h2>
                        <p className="text-sm text-foreground-secondary">带上牌阵进入 AI 对话；如果还没说明所问，太卜会先看牌阵再询问你。</p>
                    </div>
                    <Button unstyled
                        type="button"
                        onClick={handleAskTaibu}
                        disabled={drawnCards.length === 0}
                        className="h-10 rounded-xl bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {ASK_LABEL}
                    </Button>
                </section>

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
                                        <div className="relative aspect-[4/7] w-full max-w-[100px] overflow-hidden rounded-xl border-[0.5px] border-foreground/20 bg-panel shadow-[var(--shadow-md)]">
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
