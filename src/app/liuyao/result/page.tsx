/**
 * 六爻解卦结果页面
 *
 * 标题区「本卦 之 变卦」+ 保存 / 问太卜，四柱旬空、卦盘、卦辞与盘面要点、用神分析；解读统一进入 AI 对话。
 * 'use client'：结果来自 sessionStorage，且含多处交互状态。
 */
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RotateCw, BookOpen, Copy, Check, BookOpenText, X, Album, ChevronLeft } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Dialog } from '@/components/ui/Dialog';
import { HexagramDisplay } from '@/components/liuyao/HexagramDisplay';
import { LiuyaoPillars } from '@/components/liuyao/LiuyaoPillars';
import { LiuyaoResultHeader } from '@/components/liuyao/LiuyaoResultHeader';
import { TraditionalAnalysis } from '@/components/liuyao/TraditionalAnalysis';
import { YongShenTargetPicker } from '@/components/liuyao/YongShenTargetPicker';
import { ResultMobileActions } from '@/components/bazi/result/ResultHeader';
import { useToast } from '@/components/ui/Toast';
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
import { useSessionBalance } from '@/lib/hooks/useSessionBalance';
import { createSaveOnce, buildAskTaibuText, openChatWithResult } from '@/lib/chat/result-handoff';
import { readSessionJSON, scopeResultSession, updateSessionJSON, writeSessionJSON } from '@/lib/cache/session-storage';
import { useResultIdentity } from '@/lib/hooks/useIdentityGuard';
import { AuthModal } from '@/components/auth/AuthModal';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { useHeaderMenu, useHeaderTitle, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { LIUYAO_TERM_GROUPS } from '@/lib/divination/liuyao-term-tips';
import { useAdminJsonCopy } from '@/lib/admin/useAdminJsonCopy';
import { CopyTextModal } from '@/components/divination/CopyTextModal';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';

type LiuyaoResultSession = Omit<DivinationResult, 'createdAt'> & {
    createdAt: string;
    divinationId?: string | null;
    recordOwnerId?: string | null;
};

type LiuyaoQuestionSession = {
    yongShenTargets?: LiuQin[];
};

const DERIVED_KEYS = ['互卦', '错卦', '综卦'] as const;
const MENU_ICON_CLASS = 'h-4 w-4';

export default function ResultPage() {
    const identity = useResultIdentity();
    return <LiuyaoResultContent key={identity.key} isCurrent={identity.isCurrent} />;
}

function LiuyaoResultContent({ isCurrent }: { isCurrent: () => boolean }) {
    const router = useRouter();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const [result, setResult] = useState<DivinationResult | null>(null);
    const [divinationId, setDivinationId] = useState<string | null>(null);
    const [showTraditional, setShowTraditional] = useState(true);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [kbModalOpen, setKbModalOpen] = useState(false);
    const [showTermsModal, setShowTermsModal] = useState(false);
    const [pendingYongShenTargets, setPendingYongShenTargets] = useState<LiuQin[]>([]);
    const [copyDetailLevel, setCopyDetailLevel] = useState<ChartTextDetailLevel>('default');
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [copied, setCopied] = useState(false);
    const [saving, setSaving] = useState(false);
    const yongShenPickerRef = useRef<HTMLElement>(null);
    const saveOnce = useMemo(() => createSaveOnce(), []);
    const { showToast } = useToast();
    const { user, userId, sessionLoading } = useSessionBalance();

    const yongShenTargetState = useMemo(() => (
        resolveResultYongShenState(result?.yongShenTargets, pendingYongShenTargets)
    ), [pendingYongShenTargets, result?.yongShenTargets]);
    const appliedYongShenTargets = yongShenTargetState.appliedTargets;
    const hasQuestion = Boolean(result?.question?.trim());
    const missingYongShenTargets = hasQuestion && appliedYongShenTargets.length === 0;
    const hasAppliedTargets = appliedYongShenTargets.length > 0;
    const canAnalyze = hasAppliedTargets;
    // 盘面展示不依赖 AI 前置条件：未填写问题或尚未选用神时，仍输出完整旺衰/动静/神煞/卦身。
    const liuyaoBundle = useMemo(() => {
        if (!result) return null;
        return calculateLiuyaoBundle({
            yaos: result.yaos,
            question: result.question,
            date: result.createdAt,
            yongShenTargets: appliedYongShenTargets,
            requireYongShen: canAnalyze,
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
        if (sessionLoading) return;
        void Promise.resolve().then(() => {
            const stored = readSessionJSON<LiuyaoResultSession>('liuyao_result');
            if (stored) {
                const parsed = scopeResultSession(stored, userId);
                writeSessionJSON('liuyao_result', parsed);
                const questionPayload = readSessionJSON<LiuyaoQuestionSession | string>('liuyao_question');
                const questionSessionTargets = questionPayload && typeof questionPayload !== 'string'
                    ? questionPayload.yongShenTargets
                    : [];
                const normalizedTargets = resolveResultYongShenTargets(parsed.yongShenTargets, [], questionSessionTargets || []);
                setResult({ ...parsed, createdAt: new Date(parsed.createdAt), yongShenTargets: normalizedTargets });
                setPendingYongShenTargets(normalizedTargets);
                setDivinationId(parsed.divinationId || null);
            } else router.push('/liuyao');
        });
    }, [router, sessionLoading, userId]);

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

    const handleApplyYongShenTargets = async () => {
        if (!result) return;
        const normalized = normalizeYongShenTargets(pendingYongShenTargets);
        if (normalized.length === 0) { showToast('error', '请至少选择一个分析目标'); return; }
        setResult(prev => prev ? ({ ...prev, yongShenTargets: normalized }) : null);
        updateSessionJSON('liuyao_result', (prev: LiuyaoResultSession | null) => ({ ...(prev || {}), yongShenTargets: normalized } as LiuyaoResultSession));
        if (divinationId && userId) {
            await fetch('/api/liuyao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', divinationId, yongShenTargets: normalized }) });
        }
    };

    /** 落库（不带提示）：「保存」与「问太卜」共用，返回记录 ID。 */
    const persistResult = useCallback(async (): Promise<string | null> => {
        if (!result || divinationId || saving || sessionLoading || missingYongShenTargets) return divinationId;
        if (!user) return null;
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
            if (!isCurrent() || !saved.ok || !saved.id) return null;
            setDivinationId(saved.id);
            updateSessionJSON('liuyao_result', (prev: LiuyaoResultSession | null) => ({ ...(prev || {}), divinationId: saved.id } as LiuyaoResultSession));
            return saved.id;
        } catch {
            return null;
        } finally {
            if (isCurrent()) setSaving(false);
        }
    }, [appliedYongShenTargets, divinationId, isCurrent, missingYongShenTargets, result, saving, sessionLoading, user]);

    /** 保存起卦记录：起卦时未登录或保存失败的结果可在此补存；已有记录 ID 即视为已保存。 */
    const handleSave = async () => {
        if (!result || divinationId || saving || sessionLoading) return;
        if (!user) { setShowAuthModal(true); return; }
        if (missingYongShenTargets) {
            showToast('error', '请先选择分析目标');
            yongShenPickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        const id = await saveOnce(persistResult);
        if (!isCurrent()) return;
        showToast(id ? 'success' : 'error', id ? '已保存到命理记录' : '保存起卦记录失败');
    };

    /** 问太卜：未保存时先落库，再带上卦象进入 AI 对话；未选用神时先在页内补齐。 */
    const handleAskTaibu = async () => {
        if (sessionLoading) return;
        if (missingYongShenTargets) {
            showToast('error', '请先选择分析目标');
            yongShenPickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        const id = divinationId ?? (user ? await saveOnce(persistResult) : null);
        if (user && !id) showToast('error', '保存失败，卦象未能带入对话');
        const question = result?.question?.trim();
        openChatWithResult(router, {
            text: buildAskTaibuText({
                question,
                prompt: '请结合这一卦的用神与动变，解读卦象与应期。',
                questionless: hasAppliedTargets
                    ? '我起卦时没填所问之事，已经选好用神目标。请先看这一卦的盘面与所选用神目标，再问我这次想问什么；等我回答后结合盘面事实把结论落到具体事上。'
                    : '我起卦时没填所问之事。请先看这一卦的卦象（本卦、变卦、动爻与卦辞），再问我这次想问什么；等我回答后再取用神断卦。',
                chartAttached: Boolean(id),
            }),
            mentions: id ? [{
                type: 'liuyao_divination',
                id,
                name: `六爻 · ${result?.hexagram.name ?? ''}${hasChangedHexagram && result?.changedHexagram ? `之${result.changedHexagram.name}` : ''}`,
                preview: question || '六爻起卦（未填写所问之事）',
            }] : [],
        });
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
    const askDisabled = sessionLoading;

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[1104px] motion-stagger flex-col gap-3 px-4 pt-0.5 pb-28 sm:px-8 lg:gap-[22px] lg:pt-8 lg:pb-14">
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
                            <Button className="h-10 rounded-xl px-5" onClick={handleApplyYongShenTargets} disabled={pendingYongShenTargets.length === 0}>确认</Button>
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
                <section aria-label="卦盘" className="rounded-2xl border-[0.5px] border-border bg-surface px-2 pb-3.5 pt-3 sm:rounded-2xl sm:px-6 sm:pb-4">
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
                            <Button unstyled
                                type="button"
                                onClick={handleAskTaibu}
                                disabled={askDisabled}
                                className="mt-auto hidden h-11 w-full items-center justify-center rounded-xl bg-foreground text-sm text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:flex"
                            >
                                让太卜断这一卦
                            </Button>
                        )}
                    />
                )}

            </div>

            {/* 术语弹窗 */}
            {showTermsModal && (
                <Dialog bare open onClose={() => setShowTermsModal(false)} labelledBy="liuyao-terms-title" className="dialog-plain dialog-lg">
                    <div className="relative w-full overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface shadow-[var(--shadow-lg)] animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between border-b-[0.5px] border-border px-5 py-3.5">
                            <div id="liuyao-terms-title" className="font-display text-lg">术语参考</div>
                            <IconButton label="关闭" size="sm" expand="none" onClick={() => setShowTermsModal(false)}><X aria-hidden="true" /></IconButton>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto p-6 space-y-8">
                            {LIUYAO_TERM_GROUPS.map(group => (
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
                </Dialog>
            )}

            <ResultMobileActions
                saving={saving}
                saved={saveState.saved}
                saveDisabled={saveState.disabled}
                onSave={saveState.onSave}
                ask={{ label: '问太卜', onClick: handleAskTaibu, disabled: askDisabled }}
            />

            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
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
