/**
 * 命理记录页面：今日小记 → 待印证 → 按日排开的全部记录（搜索、分类、标签、分页）
 *
 * 'use client'：列表加载、筛选与弹窗状态都在客户端
 */
'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, Ellipsis, Plus } from 'lucide-react';
import { MING_RECORD_SOURCE_TYPE } from '@/lib/data-sources/types';
import {
    createNote,
    deleteNote,
    deleteRecord,
    getAllRecords,
    getNotesInRange,
    getPredictionStatus,
    getRecord,
    getRecords,
    getShortDateLabel,
    groupNotesByDay,
    MingRecord,
    MingNote,
    NoteMood,
    PredictionStatus,
    PredictionVerdict,
    setRecordVerdict,
    shiftDateKey,
    toLocalDateKey,
    toggleRecordPin,
} from '@/lib/records';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useHeaderMenuSafe } from '@/components/layout/HeaderMenuContext';
import { RecordFilters, type RecordsCategoryFilter } from '@/components/records/RecordFilters';
import { RecordsTimeline } from '@/components/records/RecordsTimeline';
import { DailyNotes, getErrorMessage, ImportExportModal, RecordFormModal } from '@/components/records/RecordDetail';
import { RecordViewDialog } from '@/components/records/RecordViewDialog';
import { StatusPill, VerdictButtons } from '@/components/records/RecordDisplay';
import { useDatePillars } from '@/components/records/useDatePillars';
import type { DatePillars } from '@/lib/divination/calendar';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { KNOWLEDGE_BASE_SYNC_EVENT } from '@/lib/browser-api';

const PAGE_SIZE = 20;
/** 今日卡的心情条之外，时间线折叠往日小记需要的最近天数。 */
const NOTES_RANGE_DAYS = 34;

type ReadScope = {
    identity: string;
    controller: AbortController;
    request: AbortController | null;
};

/** A refresh supersedes every earlier request for this account/filter/page. */
function beginScopeRequest(
    lifecycle: { current: ReadScope | null },
    scope: ReadScope,
) {
    scope.request?.abort();
    const request = new AbortController();
    scope.request = request;
    const isCurrent = () => lifecycle.current === scope
        && !scope.controller.signal.aborted
        && scope.request === request
        && !request.signal.aborted;
    return { request, isCurrent };
}

function SectionError({
    message,
    onRetry,
}: {
    message: string;
    onRetry: () => void | Promise<void>;
}) {
    return (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-[0.5px] border-danger/30 bg-danger/5 px-4 py-3.5 text-sm text-danger">
            <p>{message}</p>
            <Button variant="ghost" className="h-9 rounded-lg border-[0.5px] border-danger/30 px-3 text-sm text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => { void onRetry(); }}>
                重试
            </Button>
        </div>
    );
}

function SectionTitle({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
    return (
        <div className="mb-2 flex min-h-7 items-center justify-between gap-3">
            <h2 id={id} className="text-[13px] font-medium text-foreground-tertiary">{children}</h2>
            {aside}
        </div>
    );
}

type PendingPrediction = { record: MingRecord; status: PredictionStatus };

/** 到期的最先，其次快到期的，最后是没有定应验日的。 */
function pendingRank(status: PredictionStatus) {
    if (status.kind === 'due') return -1000 - status.days;
    if (status.kind === 'upcoming') return status.days;
    return 10_000;
}

function PendingCard({ item, todayKey, pillarsOf, onOpen, onVerdict }: {
    item: PendingPrediction;
    todayKey: string;
    pillarsOf: (key: string | null | undefined) => DatePillars | null;
    onOpen: (record: MingRecord) => void;
    onVerdict: (record: MingRecord, verdict: PredictionVerdict) => void;
}) {
    const { record, status } = item;
    const datePillars = record.event_date ? pillarsOf(record.event_date) : null;
    return (
        <li className={`relative flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-[0.5px] bg-surface px-3 py-2 transition-colors hover:border-border-hover ${status.kind === 'due' ? 'border-accent/35' : 'border-border'}`}>
            <StatusPill status={status} />
            <Button unstyled onClick={() => onOpen(record)}
                className="min-w-0 flex-1 line-clamp-1 text-left text-[14px] font-medium text-foreground after:absolute after:inset-0">
                {record.title}
            </Button>
            {status.kind === 'due' ? (
                <div className="relative z-10 hidden shrink-0 sm:block"><VerdictButtons record={record} onVerdict={onVerdict} size="xs" /></div>
            ) : null}
            {record.event_date ? (
                <span className="hidden shrink-0 text-[11.5px] text-foreground-tertiary tabular-nums sm:inline">
                    {getShortDateLabel(record.event_date, todayKey)}{datePillars ? ` · ${datePillars.day}日` : ''}
                </span>
            ) : null}
        </li>
    );
}

function RecordsContent() {
    const router = useRouter();
    const deepLinkId = useSearchParams().get('id');
    const [todayKey, setTodayKey] = useState(() => toLocalDateKey());
    const [loading, setLoading] = useState(true);
    const [notesLoading, setNotesLoading] = useState(true);
    const [predictionsLoading, setPredictionsLoading] = useState(true);
    const [records, setRecords] = useState<MingRecord[]>([]);
    const [predictions, setPredictions] = useState<MingRecord[]>([]);
    const [notes, setNotes] = useState<MingNote[]>([]);
    const [total, setTotal] = useState(0);
    const [recordsError, setRecordsError] = useState<string | null>(null);
    const [notesError, setNotesError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<RecordsCategoryFilter>('all');
    const [tag, setTag] = useState<string | null>(null);
    const [pendingExpanded, setPendingExpanded] = useState(false);
    const [showRecordForm, setShowRecordForm] = useState(false);
    const [editingRecord, setEditingRecord] = useState<MingRecord | null>(null);
    const [viewRecord, setViewRecord] = useState<MingRecord | null>(null);
    const [showImportExport, setShowImportExport] = useState(false);
    const [kbTargetRecord, setKbTargetRecord] = useState<MingRecord | null>(null);
    const [deleteRecordId, setDeleteRecordId] = useState<string | null>(null);
    const [deleteNoteTarget, setDeleteNoteTarget] = useState<MingNote | null>(null);
    const { showToast } = useToast();
    const { user, loading: sessionLoading } = useSessionSafe();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const headerMenu = useHeaderMenuSafe();
    const setHeaderMenu = headerMenu?.setMenuItems;
    const clearHeaderMenu = headerMenu?.clearMenuItems;
    const pillarsOf = useDatePillars();
    const userId = user?.id;
    const accountIdentity = JSON.stringify([userId ?? null, sessionLoading]);
    const notesByDay = useMemo(() => groupNotesByDay(notes), [notes]);

    // 手机端顶栏的三点菜单：导入 / 导出收进这里，页头只留新建记录。
    useEffect(() => {
        if (!setHeaderMenu || !clearHeaderMenu) return;
        setHeaderMenu([{ id: 'import-export', label: '导入 / 导出', icon: <Download className="size-4" />, onClick: () => setShowImportExport(true) }]);
        return () => clearHeaderMenu();
    }, [setHeaderMenu, clearHeaderMenu]);

    useEffect(() => {
        if (sessionLoading || !userId) return;
        if (!deepLinkId) return;
        const controller = new AbortController();
        void Promise.resolve().then(() => {
            if (controller.signal.aborted) return;
            setEditingRecord(null);
            setShowRecordForm(false);
            return getRecord(deepLinkId, { signal: controller.signal }).then(record => {
                if (!controller.signal.aborted) setViewRecord(record);
            }).catch(error => {
                if (!controller.signal.aborted) showToast('error', getErrorMessage(error, '获取记录失败'));
            });
        });
        return () => controller.abort();
    }, [deepLinkId, sessionLoading, showToast, userId]);

    const recordsIdentity = JSON.stringify([accountIdentity, search, category, tag, page]);
    const recordsLifecycle = useRef<ReadScope | null>(null);
    const notesLifecycle = useRef<ReadScope | null>(null);
    const predictionsLifecycle = useRef<ReadScope | null>(null);
    const reloadRecordsRef = useRef<(() => Promise<void>) | null>(null);
    const reloadPredictionsRef = useRef<(() => Promise<void>) | null>(null);

    const closeKbModal = useCallback(() => {
        setKbTargetRecord(null);
    }, []);

    // quiet：增删改之后的刷新保留当前列表，不换成加载占位，变化由列表动效呈现。
    const loadRecords = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
        const scope = recordsLifecycle.current;
        if (!scope || scope.identity !== recordsIdentity || scope.controller.signal.aborted || sessionLoading) return;
        const { request, isCurrent } = beginScopeRequest(recordsLifecycle, scope);
        if (!userId) {
            setRecords([]);
            setTotal(0);
            setRecordsError('请先登录后查看命理记录');
            setLoading(false);
            return;
        }
        if (!quiet) setLoading(true);
        setRecordsError(null);
        try {
            const { records: nextRecords, total: nextTotal } = await getRecords(
                {
                    search: search || undefined,
                    category: category === 'all' ? undefined : category,
                    tags: tag ? [tag] : undefined,
                    sort: 'date',
                },
                page,
                PAGE_SIZE,
                { signal: request.signal },
            );
            if (!isCurrent()) return;
            const lastPage = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
            if (page > lastPage) {
                setPage(lastPage);
                return;
            }
            setRecords(nextRecords);
            setTotal(nextTotal);
        } catch (error) {
            if (!isCurrent()) return;
            const message = getErrorMessage(error, '获取记录失败');
            setRecords([]);
            setTotal(0);
            setRecordsError(message);
            showToast('error', message);
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [category, page, recordsIdentity, search, sessionLoading, showToast, tag, userId]);

    const loadNotes = useCallback(async () => {
        const scope = notesLifecycle.current;
        if (!scope || scope.identity !== accountIdentity || scope.controller.signal.aborted || sessionLoading) return;
        const { request, isCurrent } = beginScopeRequest(notesLifecycle, scope);
        if (!userId) {
            setNotes([]);
            setNotesError('请先登录后查看今日小记');
            setNotesLoading(false);
            return;
        }
        setNotesLoading(true);
        setNotesError(null);
        // 按用户本地日期取「今天」，与写入小记时的 note_date 一致。
        const today = toLocalDateKey();
        setTodayKey(today);
        try {
            const nextNotes = await getNotesInRange(shiftDateKey(today, -NOTES_RANGE_DAYS), today, { signal: request.signal });
            if (!isCurrent()) return;
            setNotes(nextNotes);
        } catch (error) {
            if (!isCurrent()) return;
            const message = getErrorMessage(error, '获取小记失败');
            setNotes([]);
            setNotesError(message);
            showToast('error', message);
        } finally {
            if (isCurrent()) setNotesLoading(false);
        }
    }, [accountIdentity, sessionLoading, showToast, userId]);

    // 待印证独立于列表筛选：一条预测到期与否，不该被搜索词藏起来。
    const loadPredictions = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
        const scope = predictionsLifecycle.current;
        if (!scope || scope.identity !== accountIdentity || scope.controller.signal.aborted || sessionLoading) return;
        const { request, isCurrent } = beginScopeRequest(predictionsLifecycle, scope);
        if (!userId) {
            setPredictions([]);
            setPredictionsLoading(false);
            return;
        }
        if (!quiet) setPredictionsLoading(true);
        try {
            const nextPredictions = await getAllRecords({ category: 'prediction' }, { signal: request.signal });
            if (!isCurrent()) return;
            setPredictions(nextPredictions);
        } catch {
            // 待印证是附加区块：读不到就不显示，不打断记录列表。
            if (isCurrent()) setPredictions([]);
        } finally {
            if (isCurrent()) setPredictionsLoading(false);
        }
    }, [accountIdentity, sessionLoading, userId]);

    // 写操作沿用账号级生命周期，账号切换或卸载后不再更新状态。
    const captureMutationScope = useCallback(() => {
        const scope = notesLifecycle.current;
        if (!scope || scope.identity !== accountIdentity || scope.controller.signal.aborted) return null;
        return {
            controller: scope.controller,
            isCurrent: () => notesLifecycle.current === scope && !scope.controller.signal.aborted,
        };
    }, [accountIdentity]);

    const refreshRecords = useCallback(async () => {
        await reloadRecordsRef.current?.();
        await reloadPredictionsRef.current?.();
    }, []);

    const handleKnowledgeBaseSuccess = useCallback((payload: {
        sourceId: string;
        kbId: string;
    }) => {
        const scope = notesLifecycle.current;
        if (!scope || scope.identity !== accountIdentity || scope.controller.signal.aborted) return;
        const markArchived = (record: MingRecord): MingRecord => {
            if (record.id !== payload.sourceId) return record;
            const archivedKbIds = Array.isArray(record.archived_kb_ids)
                ? Array.from(new Set([...record.archived_kb_ids, payload.kbId]))
                : [payload.kbId];
            return { ...record, is_archived: true, archived_kb_ids: archivedKbIds };
        };
        setRecords((prev) => prev.map(markArchived));
        setPredictions((prev) => prev.map(markArchived));
        setViewRecord(current => current ? markArchived(current) : current);
        closeKbModal();
    }, [accountIdentity, closeKbModal]);

    useLayoutEffect(() => {
        let mounted = true;
        let scope: ReadScope | null = null;
        void Promise.resolve().then(() => {
            if (!mounted) return;
            scope = { identity: recordsIdentity, controller: new AbortController(), request: null };
            recordsLifecycle.current = scope;
            reloadRecordsRef.current = () => loadRecords({ quiet: true });
            setRecords([]);
            setTotal(0);
            setRecordsError(null);
            setLoading(true);
            void loadRecords();
        });
        return () => {
            mounted = false;
            scope?.controller.abort();
            scope?.request?.abort();
        };
    }, [loadRecords, recordsIdentity]);

    // Notes are independent of search/category/page changes in the records list.
    useLayoutEffect(() => {
        let mounted = true;
        let scope: ReadScope | null = null;
        void Promise.resolve().then(() => {
            if (!mounted) return;
            scope = { identity: accountIdentity, controller: new AbortController(), request: null };
            notesLifecycle.current = scope;
            setNotes([]);
            setNotesError(null);
            setNotesLoading(true);
            setShowRecordForm(false);
            setEditingRecord(null);
            setViewRecord(null);
            setShowImportExport(false);
            setKbTargetRecord(null);
            setDeleteRecordId(null);
            setDeleteNoteTarget(null);
            void loadNotes();
        });
        return () => {
            mounted = false;
            scope?.controller.abort();
            scope?.request?.abort();
        };
    }, [accountIdentity, loadNotes]);

    useLayoutEffect(() => {
        let mounted = true;
        let scope: ReadScope | null = null;
        void Promise.resolve().then(() => {
            if (!mounted) return;
            scope = { identity: accountIdentity, controller: new AbortController(), request: null };
            predictionsLifecycle.current = scope;
            reloadPredictionsRef.current = () => loadPredictions({ quiet: true });
            setPredictions([]);
            setPredictionsLoading(true);
            void loadPredictions();
        });
        return () => {
            mounted = false;
            scope?.controller.abort();
            scope?.request?.abort();
        };
    }, [accountIdentity, loadPredictions]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleArchiveChanged = (event: Event) => {
            const detail = (event as CustomEvent<{
                pathname?: string;
                requestBody?: Record<string, unknown> | null;
                responseData?: Record<string, unknown> | null;
            }>).detail;
            const sourceType = detail?.pathname?.startsWith('/api/knowledge-base/ingest')
                ? detail.requestBody?.sourceType
                : detail?.responseData?.sourceType;
            if (sourceType !== 'record' && sourceType !== 'ming_record') {
                return;
            }
            void loadRecords();
        };

        window.addEventListener(KNOWLEDGE_BASE_SYNC_EVENT, handleArchiveChanged as EventListener);
        return () => {
            window.removeEventListener(KNOWLEDGE_BASE_SYNC_EVENT, handleArchiveChanged as EventListener);
        };
    }, [loadRecords]);

    const closeView = useCallback(() => {
        setViewRecord(null);
        if (deepLinkId) router.replace('/records', { scroll: false });
    }, [deepLinkId, router]);

    const openView = useCallback((record: MingRecord) => setViewRecord(record), []);

    const openEdit = useCallback((record: MingRecord) => {
        setViewRecord(null);
        setEditingRecord(record);
        setShowRecordForm(true);
        if (deepLinkId) router.replace('/records', { scroll: false });
    }, [deepLinkId, router]);

    const handleDelete = async (id: string) => {
        const scope = captureMutationScope();
        if (!scope || !userId) return;
        try {
            await deleteRecord(id, { signal: scope.controller.signal });
            if (!scope.isCurrent()) return;
            setDeleteRecordId(null);
            setViewRecord(current => current?.id === id ? null : current);
            if (deepLinkId === id) router.replace('/records', { scroll: false });
            // Drop the row now so it folds away while the list refreshes.
            setRecords(current => current.filter(record => record.id !== id));
            setPredictions(current => current.filter(record => record.id !== id));
            // Refresh the current filters, even if they changed while the mutation was pending.
            // The returned total, not a captured total-minus-one, determines the last page.
            await refreshRecords();
        } catch (error) {
            if (scope.isCurrent()) showToast('error', getErrorMessage(error, '删除记录失败'));
        }
    };

    const handleTogglePin = async (record: MingRecord) => {
        const scope = captureMutationScope();
        if (!scope || !userId) return;
        try {
            const updated = await toggleRecordPin(record.id, { signal: scope.controller.signal });
            if (!scope.isCurrent()) return;
            setViewRecord(current => current?.id === updated.id ? updated : current);
            await refreshRecords();
        } catch (error) {
            if (scope.isCurrent()) showToast('error', getErrorMessage(error, '更新记录失败'));
        }
    };

    const handleVerdict = useCallback(async (record: MingRecord, verdict: PredictionVerdict | null) => {
        const scope = captureMutationScope();
        if (!scope || !userId) return;
        try {
            const updated = await setRecordVerdict(record, verdict);
            if (!scope.isCurrent()) return;
            setViewRecord(current => current?.id === updated.id ? updated : current);
            await refreshRecords();
        } catch (error) {
            if (scope.isCurrent()) showToast('error', getErrorMessage(error, '保存印证结果失败'));
        }
    }, [captureMutationScope, refreshRecords, showToast, userId]);

    const handleAddNote = useCallback(async (content: string, mood: NoteMood) => {
        const scope = captureMutationScope();
        if (!scope) return false;
        try {
            // 带上用户本地日期，避免服务端按 UTC 把凌晨的小记归到前一天。
            await createNote({ content, mood, note_date: toLocalDateKey() });
            if (!scope.isCurrent()) return false;
            await loadNotes();
            return scope.isCurrent();
        } catch (error) {
            if (scope.isCurrent()) showToast('error', getErrorMessage(error, '创建小记失败'));
            return false;
        }
    }, [captureMutationScope, loadNotes, showToast]);

    const handleDeleteNote = async (note: MingNote) => {
        const scope = captureMutationScope();
        if (!scope) return;
        try {
            await deleteNote(note.id);
            if (!scope.isCurrent()) return;
            setDeleteNoteTarget(null);
            await loadNotes();
        } catch (error) {
            if (scope.isCurrent()) showToast('error', getErrorMessage(error, '删除小记失败'));
        }
    };

    const handleRecordSaved = () => {
        if (!captureMutationScope()) return;
        setShowRecordForm(false);
        setEditingRecord(null);
        void refreshRecords();
    };

    const handleImported = () => {
        if (!captureMutationScope()) return;
        void refreshRecords();
        void loadNotes();
    };

    const filtered = !!search.trim() || category !== 'all' || !!tag;
    const clearFilters = () => { setSearch(''); setCategory('all'); setTag(null); setPage(1); };

    const pendingPredictions = useMemo<PendingPrediction[]>(() => predictions
        .map(record => ({ record, status: getPredictionStatus(record, todayKey) }))
        .filter((item): item is PendingPrediction => item.status !== null
            && (item.status.kind === 'due' || item.status.kind === 'upcoming' || item.status.kind === 'open'))
        .sort((a, b) => pendingRank(a.status) - pendingRank(b.status)), [predictions, todayKey]);
    const visiblePending = pendingExpanded ? pendingPredictions : pendingPredictions.slice(0, 4);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <div className="min-h-screen bg-background pb-20 text-foreground lg:pb-8">
            <div className="mx-auto flex max-w-[46rem] flex-col gap-5 px-4 py-3 md:gap-6 md:py-7">
                {/* 手机端顶栏已显示「命理记录」，这里只保留操作。 */}
                <header className="flex flex-wrap items-center justify-between gap-3">
                    <div className="hidden items-baseline gap-3 md:flex">
                        <h1 className="font-display text-[1.75rem] leading-tight font-normal">命理记录</h1>
                        <p className="text-[13px] text-foreground-tertiary">记下断语、应验与感悟，日后对照印证。</p>
                    </div>
                    <div className="flex w-full items-center justify-end gap-2 md:w-auto">
                        <div className="hidden md:block">
                            <Menu>
                                <MenuTrigger aria-label="更多" className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground-secondary transition-colors hover:bg-fill-ghost-hover hover:text-foreground data-popup-open:bg-fill-ghost-hover">
                                    <Ellipsis className="h-[18px] w-[18px]" aria-hidden="true" />
                                </MenuTrigger>
                                <MenuContent align="end" className="w-44">
                                    <MenuItem onClick={() => setShowImportExport(true)}>
                                        <Download aria-hidden="true" />导入 / 导出…
                                    </MenuItem>
                                </MenuContent>
                            </Menu>
                        </div>
                        <Button className="h-8 rounded-lg px-3 text-[13px]" onClick={() => { setEditingRecord(null); setShowRecordForm(true); }}>
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            新建记录
                        </Button>
                    </div>
                </header>

                <section aria-labelledby="records-notes-title">
                    <h2 id="records-notes-title" className="mb-2 text-[12px] font-medium text-foreground-tertiary">今日小记</h2>
                    {notesError ? (
                        <SectionError message={notesError} onRetry={loadNotes} />
                    ) : notesLoading ? (
                        <div className="rounded-2xl border-[0.5px] border-border bg-surface p-6">
                            <SoundWaveLoader variant="block" text="加载小记中" />
                        </div>
                    ) : (
                        <DailyNotes notes={notes} todayKey={todayKey} loading={false} pillarsOf={pillarsOf}
                            onAddNote={handleAddNote} onDeleteNote={setDeleteNoteTarget} />
                    )}
                </section>

                {!predictionsLoading && pendingPredictions.length > 0 ? (
                    <section aria-labelledby="records-pending-title">
                        <SectionTitle id="records-pending-title" aside={<span className="text-xs text-foreground-tertiary">{pendingPredictions.length} 条</span>}>
                            待印证
                        </SectionTitle>
                        <ul className="flex flex-col gap-2">
                            {visiblePending.map(item => (
                                <PendingCard key={item.record.id} item={item} todayKey={todayKey} pillarsOf={pillarsOf}
                                    onOpen={openView} onVerdict={handleVerdict} />
                            ))}
                        </ul>
                        {pendingPredictions.length > 4 ? (
                            <Button variant="ghost" size="sm" onClick={() => setPendingExpanded(open => !open)} className="mt-2 text-[13px] text-foreground-secondary">
                                {pendingExpanded ? '收起' : `展开全部 ${pendingPredictions.length} 条`}
                            </Button>
                        ) : null}
                    </section>
                ) : null}

                <section aria-labelledby="records-list-title">
                    <h2 id="records-list-title" className="mb-2 text-[12px] font-medium text-foreground-tertiary">全部记录</h2>
                    <div className="flex flex-col gap-3">
                        <RecordFilters
                            search={search}
                            onSearchChange={(value) => { setSearch(value); setPage(1); }}
                            category={category}
                            onCategoryChange={(value) => { setCategory(value); setPage(1); }}
                            tag={tag}
                            onTagChange={(value) => { setTag(value); setPage(1); }}
                        />

                        {recordsError && !loading ? (
                            <SectionError message={recordsError} onRetry={loadRecords} />
                        ) : (
                            <RecordsTimeline
                                records={records}
                                notesByDay={notesByDay}
                                showNotes={!filtered}
                                todayKey={todayKey}
                                pillarsOf={pillarsOf}
                                loading={loading}
                                page={page}
                                totalPages={totalPages}
                                onPageChange={setPage}
                                filtered={filtered}
                                onClearFilters={clearFilters}
                                onCreateNew={() => { setEditingRecord(null); setShowRecordForm(true); }}
                                actions={{
                                    onOpen: openView,
                                    onEdit: openEdit,
                                    onDelete: (record) => setDeleteRecordId(record.id),
                                    onTogglePin: handleTogglePin,
                                    onAddToKnowledgeBase: setKbTargetRecord,
                                    onVerdict: handleVerdict,
                                    onTag: (value) => { setTag(value); setPage(1); setViewRecord(null); },
                                    onDeleteNote: setDeleteNoteTarget,
                                    showKnowledgeBase: knowledgeBaseEnabled,
                                }}
                            />
                        )}
                    </div>
                </section>

                {/* 模态框 */}
                {showRecordForm && (
                    <RecordFormModal
                        userId={user?.id ?? null}
                        record={editingRecord}
                        pillarsOf={pillarsOf}
                        onClose={() => { setShowRecordForm(false); setEditingRecord(null); }}
                        onSave={handleRecordSaved}
                    />
                )}

                {viewRecord && (
                    <RecordViewDialog
                        record={viewRecord}
                        todayKey={todayKey}
                        pillarsOf={pillarsOf}
                        onClose={closeView}
                        onTag={(value) => { setTag(value); setPage(1); closeView(); }}
                        onEdit={openEdit}
                        onTogglePin={(record) => { void handleTogglePin(record); }}
                        onAddToKnowledgeBase={setKbTargetRecord}
                        onDelete={(record) => setDeleteRecordId(record.id)}
                        onVerdict={(record, verdict) => { void handleVerdict(record, verdict); }}
                        onClearVerdict={(record) => { void handleVerdict(record, null); }}
                        showKnowledgeBase={knowledgeBaseEnabled}
                    />
                )}

                {showImportExport && (
                    <ImportExportModal
                        userId={user?.id ?? null}
                        onClose={() => setShowImportExport(false)}
                        onImport={handleImported}
                    />
                )}

                {kbTargetRecord && (
                    <AddToKnowledgeBaseModal
                        open
                        onClose={closeKbModal}
                        onSuccess={({ sourceId, kbId }) => handleKnowledgeBaseSuccess({ sourceId, kbId })}
                        sourceTitle={kbTargetRecord.title}
                        sourceType={MING_RECORD_SOURCE_TYPE}
                        sourceId={kbTargetRecord.id}
                    />
                )}

                <ConfirmDialog
                    isOpen={!!deleteRecordId}
                    onClose={() => setDeleteRecordId(null)}
                    onConfirm={() => deleteRecordId ? handleDelete(deleteRecordId) : undefined}
                    title="确认删除"
                    description="确定要删除这条记录吗？此操作无法撤销。"
                    confirmText="确认删除"
                    variant="danger"
                />

                <ConfirmDialog
                    isOpen={!!deleteNoteTarget}
                    onClose={() => setDeleteNoteTarget(null)}
                    onConfirm={() => deleteNoteTarget ? handleDeleteNote(deleteNoteTarget) : undefined}
                    title="确认删除"
                    description="确定要删除这条小记吗？此操作无法撤销。"
                    confirmText="确认删除"
                    variant="danger"
                />
            </div>
        </div>
    );
}

export default function RecordsPage() {
    return <Suspense fallback={<SoundWaveLoader />}><RecordsContent /></Suspense>;
}
