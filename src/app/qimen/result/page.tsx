/**
 * 奇门遁甲排盘结果页面
 *
 * 'use client'：会话缓存读取与宫位选择状态依赖浏览器端 hooks；解读统一进入 AI 对话。
 */
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RotateCw, Copy, Check, ChevronLeft, BookOpenText } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { ResultMobileActions } from '@/components/bazi/result/ResultHeader';
import { ResultHeaderActions } from '@/components/divination/ResultHeaderActions';
import { QimenGrid } from '@/components/qimen/QimenGrid';
import { QimenLegend } from '@/components/qimen/QimenLegend';
import { QimenPalaceDetail } from '@/components/qimen/QimenPalaceDetail';
import { formatJuLabel } from '@/components/qimen/qimen-display';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { AuthModal } from '@/components/auth/AuthModal';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { useHeaderMenu, useHeaderTitle, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { readSessionJSON, scopeResultSession, updateSessionJSON } from '@/lib/cache/session-storage';
import { useIdentityGuard } from '@/lib/hooks/useIdentityGuard';
import { useSessionBalance } from '@/lib/hooks/useSessionBalance';
import { createSaveOnce, openChatWithResult } from '@/lib/chat/result-handoff';
import { useAdminJsonCopy } from '@/lib/admin/useAdminJsonCopy';
import { CopyTextModal } from '@/components/divination/CopyTextModal';
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
const ASK_LABEL = '问太卜';

function pad2(value: number): string {
    return Number.isFinite(value) ? String(value).padStart(2, '0') : '--';
}

/** 起局时间（用户输入的民用时间），如 2026-10-10 21:30 */
function formatInputTime(input: Pick<QimenInput, 'year' | 'month' | 'day' | 'hour' | 'minute'>): string {
    return `${input.year}-${pad2(input.month)}-${pad2(input.day)} ${pad2(input.hour)}:${pad2(input.minute)}`;
}

interface QimenSessionData extends QimenInput {
    recordOwnerId?: string | null;
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
    const [storedResult, setResult] = useState<QimenSessionData | null>(null);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showKbModal, setShowKbModal] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copyDetailLevel, setCopyDetailLevel] = useState<ChartTextDetailLevel>('default');
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [selectedPalace, setSelectedPalace] = useState<number | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const hasSavedRef = useRef<string | null>(null);
    const saveOnce = useMemo(() => createSaveOnce(), []);
    const { user, userId, sessionLoading } = useSessionBalance();
    const captureIdentity = useIdentityGuard(userId);
    const result = storedResult?.recordOwnerId === userId ? storedResult : null;
    const [prevQimenUserId, setPrevQimenUserId] = useState(userId);
    if (prevQimenUserId !== userId) {
        setPrevQimenUserId(userId);
        setIsSaving(false);
    }
    const currentUser = useMemo(() => (user ? { id: user.id } : null), [user]);
    const qimenOutput = result?.output ?? null;
    const canonicalResult = useMemo(
        () => (qimenOutput ? buildQimenCanonicalJSON(qimenOutput) : null),
        [qimenOutput],
    );
    const { isAdmin, jsonCopied, copyJson } = useAdminJsonCopy(canonicalResult);

    /** 保存起局记录（进入页面时自动保存、手动保存与「问太卜」共用），返回记录 ID。 */
    const saveChartRecord = useCallback(async (record: QimenSessionData): Promise<string | undefined> => {
        if (!userId || record.recordOwnerId !== userId) return undefined;
        const isCurrent = captureIdentity();
        setIsSaving(true);
        try {
            const saveResult = await saveDivinationAction({
                endpoint: '/api/qimen',
                body: buildQimenActionPayload(record),
                idKey: 'chartId',
                fallbackMessage: '保存奇门记录失败',
            });
            if (!isCurrent()) return undefined;
            if (!saveResult.ok) {
                throw new Error(saveResult.error.message || '保存奇门记录失败');
            }
            const savedChartId = saveResult.id;
            if (savedChartId) {
                updateSessionJSON('qimen_result', (prev) => ({ ...(prev || {}), recordOwnerId: userId, chartId: savedChartId }));
                setResult(prev => prev ? { ...prev, chartId: savedChartId } : prev);
            }
            return savedChartId ?? undefined;
        } catch (e) {
            console.error(e);
            return undefined;
        } finally {
            if (isCurrent()) setIsSaving(false);
        }
    }, [captureIdentity, userId]);

    useEffect(() => {
        if (sessionLoading) return;
        let cancelled = false;
        const isCurrent = captureIdentity();
        const init = async () => {
            const stored = readSessionJSON<QimenSessionData>('qimen_result');
            if (!stored) { router.push('/qimen'); return; }
            const parsed = scopeResultSession(stored, userId);
            let nextResult = parsed;

            if (!nextResult.output) {
                try {
                    const { output } = await calculateQimenBundle(pickQimenInput(parsed));
                    if (cancelled || !isCurrent()) return;
                    nextResult = { ...parsed, output };
                    updateSessionJSON('qimen_result', () => nextResult);
                } catch (e) {
                    if (cancelled || !isCurrent()) return;
                    console.error('[qimen/result] 重新计算命盘失败:', e);
                    router.push('/qimen');
                    return;
                }
            }

            setResult(nextResult);
            updateSessionJSON('qimen_result', () => nextResult);

            const saveKey = `${userId}:${nextResult.createdAt}`;
            if (!nextResult.chartId && userId && hasSavedRef.current !== saveKey) {
                hasSavedRef.current = saveKey;
                await saveOnce(() => saveChartRecord(nextResult));
            }
        };
        void init();
        return () => { cancelled = true; };
    }, [userId, router, saveChartRecord, saveOnce, sessionLoading, captureIdentity]);

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

    /** 「问太卜」：未保存时先落库，再带上排盘进入 AI 对话。 */
    const handleAskTaibu = async () => {
        if (!result) return;
        const question = result.question?.trim();
        const chartId = result.chartId ?? (userId ? await saveOnce(() => saveChartRecord(result)) : undefined);
        if (userId && !chartId) showToast('error', '保存失败，排盘未能带入对话');
        openChatWithResult(router, {
            text: `${question ? `我问的是「${question}」。` : ''}请结合这一局奇门遁甲，解读用神、门星神仪的旺衰与格局，并给出应期与行动建议。`,
            mentions: chartId ? [{
                type: 'qimen_chart',
                id: chartId,
                name: `奇门遁甲 · ${juLabel}`,
                preview: question || `${qimenOutput?.dunType === 'yang' ? '阳遁' : '阴遁'}${qimenOutput?.juNumber ?? ''}局`,
            }] : [],
        });
    };

    /** 「保存」：未登录先登录（登录后页面自动保存），已登录则手动重试保存 */
    const handleSave = async () => {
        if (!result || result.chartId || isSaving || sessionLoading) return;
        if (!currentUser) {
            setShowAuthModal(true);
            return;
        }
        hasSavedRef.current = `${userId}:${result.createdAt}`;
        const isCurrent = captureIdentity();
        const savedId = await saveOnce(() => saveChartRecord(result));
        if (!isCurrent()) return;
        showToast(savedId ? 'success' : 'error', savedId ? '已保存到命理记录' : '保存失败，请重试');
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
            <div className="mx-auto flex w-full max-w-[1104px] flex-col gap-3 px-4 pb-28 pt-3 motion-stagger lg:gap-[22px] lg:px-8 lg:pb-16 lg:pt-8">
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
                        <h1 className="hidden font-display text-[1.875rem] font-normal leading-tight lg:block">
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

            </div>

            <ResultMobileActions saving={isSaving} saved={saved} saveDisabled={sessionLoading} onSave={saveState.onSave} ask={{ label: ASK_LABEL, onClick: handleAskTaibu }} />

            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
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
