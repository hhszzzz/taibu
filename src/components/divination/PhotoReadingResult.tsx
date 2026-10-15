/**
 * 面相 / 手相结果页
 *
 * 结果来自上传页写入的 sessionStorage，或历史记录回放（只有 readingId / conversationId，
 * 解读正文通过 useAnalysisSnapshot 补齐）。版式与其他占术结果页一致：
 * 桌面端标题区右侧「更多 · 再次分析 · 继续对话」，移动端操作在顶栏菜单与底部操作栏。
 */
'use client'; // 需要读取 sessionStorage、分析快照 hooks、顶栏菜单与路由跳转

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Brain, ChevronLeft, Lock, MessageCircle, RotateCcw, type LucideIcon } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { useHeaderMenu, useHeaderTitle, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { MobileActionBar, MOBILE_SECONDARY_ACTION_CLASS } from '@/components/bazi/result/ResultHeader';
import { ResultMoreActions } from '@/components/divination/ResultMoreActions';
import { readSessionJSON } from '@/lib/cache/session-storage';
import { useAnalysisSnapshot } from '@/lib/hooks/useAnalysisSnapshot';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import type { HistoryType } from '@/lib/history/registry';

/** 上传页与历史回放写入 sessionStorage 的公共字段；各相学可附加自己的字段（如手相 handType）。 */
export interface PhotoReadingSession {
    readingId?: string;
    conversationId?: string | null;
    analysisType: string;
    analysis?: string;
    createdAt?: string;
    isTemporary?: boolean;
}

export interface PhotoReadingDescription {
    /** 结果标题，如「综合分析」「左手 · 生命线」 */
    title: string;
    /** 加入知识库时的来源标题 */
    knowledgeBaseTitle: string;
}

/** 记录时间；缺失或无法解析时不显示。 */
function formatCreatedAt(value: string | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function PhotoReadingResult<T extends PhotoReadingSession>({
    divinationType,
    sessionKey,
    entryPath,
    kindLabel,
    icon: Icon,
    loadingText,
    emptyActionLabel,
    knowledgeBaseSourceType,
    notice,
    describe,
}: {
    divinationType: Extract<HistoryType, 'face' | 'palm'>;
    sessionKey: string;
    /** 上传页路径（重新上传 / 再次分析） */
    entryPath: string;
    /** 元信息行的相学名称，如「面相」 */
    kindLabel: string;
    icon: LucideIcon;
    loadingText: string;
    emptyActionLabel: string;
    knowledgeBaseSourceType: 'face_reading' | 'palm_reading';
    /** 解读下方的免责提示 */
    notice: string;
    describe: (result: T) => PhotoReadingDescription;
}) {
    const router = useRouter();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const { loaded: aiFeatureLoaded, isFeatureEnabled } = useFeatureToggles();
    const aiEnabled = aiFeatureLoaded && isFeatureEnabled('chat');
    const [loading, setLoading] = useState(true);
    const [result, setResult] = useState<T | null>(null);
    const [analysis, setAnalysis] = useState('');
    const [snapshotError, setSnapshotError] = useState<string | null>(null);
    const [awaitingSnapshot, setAwaitingSnapshot] = useState(false);
    const [kbModalOpen, setKbModalOpen] = useState(false);

    const snapshotCallbacks = useMemo(() => ({
        onAnalysis: (nextAnalysis: string) => setAnalysis(nextAnalysis),
        onConversationIdResolved: (conversationId: string) => {
            setResult((prev) => (prev ? { ...prev, conversationId } : prev));
        },
        onError: (message: string) => setSnapshotError(message),
        onComplete: () => setAwaitingSnapshot(false),
    }), []);
    const snapshotLoading = useAnalysisSnapshot({
        conversationId: result?.conversationId,
        recordId: result?.readingId,
        divinationType,
        sessionKey,
        hasExistingAnalysis: !!analysis,
        skip: !result || !aiEnabled,
        callbacks: snapshotCallbacks,
    });

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            // 与其他结果页一致：挂载后再读 sessionStorage，避免 effect 内同步 setState 造成级联渲染
            await Promise.resolve();
            if (cancelled) return;
            const stored = readSessionJSON<T>(sessionKey);
            setResult(stored);
            if (stored?.analysis) {
                setAnalysis(stored.analysis);
            } else {
                setAwaitingSnapshot(Boolean(stored?.conversationId || stored?.readingId));
            }
            setLoading(false);
        };
        void load();
        return () => { cancelled = true; };
    }, [sessionKey]);

    const description = result ? describe(result) : null;
    const conversationId = result?.conversationId ?? null;
    const canAddToKnowledgeBase = knowledgeBaseEnabled && Boolean(result?.readingId);
    useHeaderTitle(description?.title);

    const moreActions = useMemo<HeaderMenuItem[]>(() => (
        canAddToKnowledgeBase ? [{ id: 'add-to-kb', label: '加入知识库', onClick: () => setKbModalOpen(true) }] : []
    ), [canAddToKnowledgeBase]);

    // 移动端顶栏三点菜单：更多操作 + 继续对话 + 再次分析
    useEffect(() => {
        if (!aiEnabled) {
            clearMenuItems();
            return;
        }
        const items: HeaderMenuItem[] = [...moreActions];
        if (conversationId) {
            items.push({
                id: 'continue-chat',
                label: '继续对话',
                icon: <MessageCircle className="h-4 w-4" />,
                onClick: () => router.push(`/chat?id=${conversationId}`),
            });
        }
        items.push({
            id: 'reanalyze',
            label: '再次分析',
            icon: <RotateCcw className="h-4 w-4" />,
            onClick: () => router.push(entryPath),
        });
        setMenuItems(items);
        return () => clearMenuItems();
    }, [aiEnabled, moreActions, conversationId, entryPath, router, setMenuItems, clearMenuItems]);

    if (!aiEnabled) return null;

    if (loading || awaitingSnapshot || snapshotLoading) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center bg-background px-4">
                <div className="flex animate-fade-in flex-col items-center gap-4 text-center">
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-light text-accent">
                        <Icon className="h-7 w-7" aria-hidden="true" />
                    </span>
                    <SoundWaveLoader variant="block" text={loadingText} />
                </div>
            </div>
        );
    }

    if (!result || !description) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center bg-background px-4">
                <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border-[0.5px] border-border bg-surface p-8 text-center">
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel text-foreground-tertiary">
                        <Icon className="h-7 w-7" aria-hidden="true" />
                    </span>
                    <h1 className="font-display text-xl font-normal">未找到分析结果</h1>
                    <p className="text-sm leading-relaxed text-foreground-secondary">似乎没有找到刚才的分析记录，请重新分析。</p>
                    <Link
                        href={entryPath}
                        className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-accent text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                    >
                        {emptyActionLabel}
                    </Link>
                </div>
            </div>
        );
    }

    const createdAt = formatCreatedAt(result.createdAt);

    return (
        <>
            <div className="min-h-full bg-background text-foreground">
                <div className="mx-auto flex w-full max-w-[880px] animate-fade-in flex-col gap-3.5 px-4 pt-0.5 pb-28 sm:px-6 lg:gap-6 lg:px-8 lg:pt-8 lg:pb-16">
                    <Link href={entryPath} className="hidden w-fit items-center gap-1.5 text-sm text-foreground-secondary transition-colors hover:text-foreground lg:inline-flex">
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />重新上传
                    </Link>

                    <header className="flex flex-wrap items-end justify-between gap-4">
                        <div className="flex w-full min-w-0 flex-col items-center gap-2 lg:w-auto lg:items-start">
                            <p className="text-center text-[0.8125rem] text-foreground-secondary lg:text-left lg:text-sm">
                                {kindLabel}{createdAt && ` · ${createdAt}`}
                            </p>
                            {/* 移动端标题位于顶栏 */}
                            <h1 className="hidden font-display text-[2.125rem] font-normal leading-tight lg:block">{description.title}</h1>
                        </div>
                        <div className="hidden items-center gap-2 lg:flex">
                            <ResultMoreActions actions={moreActions} label="结果操作" />
                            <Link
                                href={entryPath}
                                className="flex h-10 items-center rounded-[10px] border-[0.5px] border-border-hover bg-surface px-4 text-sm text-foreground transition-colors hover:bg-background-secondary"
                            >
                                再次分析
                            </Link>
                            {conversationId && (
                                <Link
                                    href={`/chat?id=${conversationId}`}
                                    className="flex h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                                >
                                    继续对话
                                </Link>
                            )}
                        </div>
                    </header>

                    {result.isTemporary && (
                        <p className="rounded-xl bg-accent-light px-4 py-3 text-sm text-foreground-secondary">
                            <span className="font-medium text-warning">注意：</span>
                            由于网络原因，本次分析结果未能保存到历史记录，但你仍可在此查看结果。
                        </p>
                    )}

                    <section aria-label="AI 深度解读" className="flex flex-col gap-4 rounded-2xl border-[0.5px] border-border bg-surface p-5 sm:p-6 lg:p-8">
                        <h2 className="flex items-center gap-2 font-display text-lg font-normal">
                            <Brain className="h-4 w-4 text-accent" aria-hidden="true" />AI 深度解读
                        </h2>
                        {analysis ? (
                            <MarkdownContent content={analysis} className="text-sm leading-relaxed text-foreground" />
                        ) : (
                            <div className="flex flex-col items-center gap-3 py-10 text-center">
                                <Icon className="h-10 w-10 text-foreground-tertiary" aria-hidden="true" />
                                <p className="text-sm text-foreground-secondary">
                                    {snapshotError ? `解读加载失败：${snapshotError}` : '暂无分析内容'}
                                </p>
                            </div>
                        )}
                    </section>

                    <p className="flex gap-2.5 rounded-xl bg-panel px-3.5 py-3 text-xs leading-[1.7] text-foreground-secondary lg:bg-sidebar lg:px-4 lg:py-3.5 lg:text-[0.8125rem] lg:leading-relaxed">
                        <Lock className="mt-0.5 hidden h-4 w-4 shrink-0 lg:block" strokeWidth={1.7} aria-hidden="true" />
                        {notice}
                    </p>
                </div>
            </div>

            <MobileActionBar ask={conversationId ? { label: '继续对话', onClick: () => router.push(`/chat?id=${conversationId}`) } : undefined}>
                <Link href={entryPath} className={`${MOBILE_SECONDARY_ACTION_CLASS} text-foreground`}>再次分析</Link>
            </MobileActionBar>

            {canAddToKnowledgeBase && result.readingId && (
                <AddToKnowledgeBaseModal
                    open={kbModalOpen}
                    onClose={() => setKbModalOpen(false)}
                    sourceTitle={description.knowledgeBaseTitle}
                    sourceType={knowledgeBaseSourceType}
                    sourceId={result.readingId}
                />
            )}
        </>
    );
}
