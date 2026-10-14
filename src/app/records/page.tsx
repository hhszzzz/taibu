/**
 * 命理记录页面：今日小记 + 全部记录（搜索、分类、分页）
 *
 * 'use client'：列表加载、筛选与弹窗状态都在客户端
 */
'use client';

import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { Plus, ArrowDownUp } from 'lucide-react';
import { MING_RECORD_SOURCE_TYPE } from '@/lib/data-sources/types';
import {
    deleteRecord,
    getNotesByDate,
    getRecords,
    getRecord,
    MingRecord,
    MingNote,
    RecordCategory,
    toggleRecordPin,
    toLocalDateKey,
} from '@/lib/records';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { RecordFilters } from '@/components/records/RecordFilters';
import { RecordsList } from '@/components/records/RecordsList';
import {
    RecordFormModal,
    DailyNotes,
    ImportExportModal,
} from '@/components/records/RecordDetail';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import {
    KNOWLEDGE_BASE_SYNC_EVENT,
} from '@/lib/browser-api';

const PAGE_SIZE = 10;

type ReadScope = {
    identity: string;
    controller: AbortController;
    request: AbortController | null;
};

function SectionError({
    message,
    onRetry,
}: {
    message: string;
    onRetry: () => void | Promise<void>;
}) {
    return (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border-[0.5px] border-danger/30 bg-danger/5 px-4 py-3.5 text-sm text-danger">
            <p>{message}</p>
            <button
                type="button"
                onClick={() => { void onRetry(); }}
                className="inline-flex h-9 items-center rounded-lg border-[0.5px] border-danger/30 px-3 text-sm text-danger transition-colors hover:bg-danger/10"
            >
                重试
            </button>
        </div>
    );
}

export default function RecordsPage() {
    const [loading, setLoading] = useState(true);
    const [notesLoading, setNotesLoading] = useState(true);
    const [records, setRecords] = useState<MingRecord[]>([]);
    const [notes, setNotes] = useState<MingNote[]>([]);
    const [total, setTotal] = useState(0);
    const [recordsError, setRecordsError] = useState<string | null>(null);
    const [notesError, setNotesError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<RecordCategory | ''>('');
    const [showRecordForm, setShowRecordForm] = useState(false);
    const [editingRecord, setEditingRecord] = useState<MingRecord | null>(null);
    const [showImportExport, setShowImportExport] = useState(false);
    const [kbTargetRecord, setKbTargetRecord] = useState<MingRecord | null>(null);
    const [deleteRecordId, setDeleteRecordId] = useState<string | null>(null);
    const { showToast } = useToast();
    const { user, loading: sessionLoading } = useSessionSafe();
    const userId = user?.id;
    const accountIdentity = JSON.stringify([userId ?? null, sessionLoading]);
    useEffect(() => {
        if (sessionLoading || !userId) return;
        const recordId = new URLSearchParams(window.location.search).get('id');
        if (!recordId) return;
        const controller = new AbortController();
        void getRecord(recordId, { signal: controller.signal }).then(record => {
            if (controller.signal.aborted) return;
            setEditingRecord(record);
            setShowRecordForm(true);
        }).catch(error => {
            if (!controller.signal.aborted) showToast('error', error instanceof Error ? error.message : '获取记录失败');
        });
        return () => controller.abort();
    }, [sessionLoading, showToast, userId]);
    const recordsIdentity = JSON.stringify([accountIdentity, search, category, page]);
    const recordsLifecycle = useRef<ReadScope | null>(null);
    const notesLifecycle = useRef<ReadScope | null>(null);
    const reloadRecordsRef = useRef<(() => Promise<void>) | null>(null);

    const openAddToKb = useCallback((record: MingRecord) => {
        setKbTargetRecord(record);
    }, []);

    const closeKbModal = useCallback(() => {
        setKbTargetRecord(null);
    }, []);

    // A refresh supersedes every earlier request for this account/filter/page.
    const loadRecords = useCallback(async () => {
        const scope = recordsLifecycle.current;
        if (!scope || scope.identity !== recordsIdentity || scope.controller.signal.aborted || sessionLoading) return;
        scope.request?.abort();
        const request = new AbortController();
        scope.request = request;
        const isCurrent = () => recordsLifecycle.current === scope && !scope.controller.signal.aborted
            && scope.request === request && !request.signal.aborted;
        if (!userId) {
            setRecords([]);
            setTotal(0);
            setRecordsError('请先登录后查看命理记录');
            setLoading(false);
            return;
        }
        setLoading(true);
        setRecordsError(null);
        try {
            const { records: nextRecords, total: nextTotal } = await getRecords(
                { search: search || undefined, category: category || undefined },
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
            const message = error instanceof Error ? error.message : '获取记录失败';
            setRecords([]);
            setTotal(0);
            setRecordsError(message);
            showToast('error', message);
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [category, page, recordsIdentity, search, sessionLoading, showToast, userId]);

    const loadNotes = useCallback(async () => {
        const scope = notesLifecycle.current;
        if (!scope || scope.identity !== accountIdentity || scope.controller.signal.aborted || sessionLoading) return;
        scope.request?.abort();
        const request = new AbortController();
        scope.request = request;
        const isCurrent = () => notesLifecycle.current === scope && !scope.controller.signal.aborted
            && scope.request === request && !request.signal.aborted;
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
        try {
            const nextNotes = await getNotesByDate(today, { signal: request.signal });
            if (!isCurrent()) return;
            setNotes(nextNotes);
        } catch (error) {
            if (!isCurrent()) return;
            const message = error instanceof Error ? error.message : '获取小记失败';
            setNotes([]);
            setNotesError(message);
            showToast('error', message);
        } finally {
            if (isCurrent()) setNotesLoading(false);
        }
    }, [accountIdentity, sessionLoading, showToast, userId]);

    const handleKnowledgeBaseSuccess = useCallback((payload: {
        sourceId: string;
        kbId: string;
    }) => {
        const scope = notesLifecycle.current;
        if (!scope || scope.identity !== accountIdentity || scope.controller.signal.aborted) return;
        setRecords((prev) => prev.map((record) => {
            if (record.id !== payload.sourceId) {
                return record;
            }

            const archivedKbIds = Array.isArray(record.archived_kb_ids)
                ? Array.from(new Set([...record.archived_kb_ids, payload.kbId]))
                : [payload.kbId];
            return {
                ...record,
                is_archived: true,
                archived_kb_ids: archivedKbIds,
            };
        }));
        closeKbModal();
    }, [accountIdentity, closeKbModal]);

    useLayoutEffect(() => {
        const scope: ReadScope = { identity: recordsIdentity, controller: new AbortController(), request: null };
        recordsLifecycle.current = scope;
        reloadRecordsRef.current = loadRecords;
        setRecords([]);
        setTotal(0);
        setRecordsError(null);
        setLoading(true);
        void loadRecords();
        return () => {
            scope.controller.abort();
            scope.request?.abort();
        };
    }, [loadRecords, recordsIdentity]);

    // Notes are independent of search/category/page changes in the records list.
    useLayoutEffect(() => {
        const scope: ReadScope = { identity: accountIdentity, controller: new AbortController(), request: null };
        notesLifecycle.current = scope;
        setNotes([]);
        setNotesError(null);
        setNotesLoading(true);
        setShowRecordForm(false);
        setEditingRecord(null);
        setShowImportExport(false);
        setKbTargetRecord(null);
        setDeleteRecordId(null);
        void loadNotes();
        return () => {
            scope.controller.abort();
            scope.request?.abort();
        };
    }, [accountIdentity, loadNotes]);

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

    const handleDelete = async (id: string) => {
        const scope = notesLifecycle.current;
        if (!scope || scope.identity !== accountIdentity || scope.controller.signal.aborted || !userId) return;
        const isCurrent = () => notesLifecycle.current === scope && !scope.controller.signal.aborted;
        try {
            await deleteRecord(id, { signal: scope.controller.signal });
            if (!isCurrent()) return;
            setDeleteRecordId(null);
            // Refresh the current filters, even if they changed while the mutation was pending.
            // The returned total, not a captured total-minus-one, determines the last page.
            await reloadRecordsRef.current?.();
        } catch (error) {
            if (isCurrent()) showToast('error', error instanceof Error ? error.message : '删除记录失败');
        }
    };

    const handleTogglePin = async (id: string) => {
        const scope = notesLifecycle.current;
        if (!scope || scope.identity !== accountIdentity || scope.controller.signal.aborted || !userId) return;
        const isCurrent = () => notesLifecycle.current === scope && !scope.controller.signal.aborted;
        try {
            await toggleRecordPin(id, { signal: scope.controller.signal });
            if (isCurrent()) await reloadRecordsRef.current?.();
        } catch (error) {
            if (isCurrent()) showToast('error', error instanceof Error ? error.message : '更新记录失败');
        }
    };

    const handleRecordSaved = () => {
        const scope = notesLifecycle.current;
        if (!scope || scope.identity !== accountIdentity || scope.controller.signal.aborted) return;
        setShowRecordForm(false);
        setEditingRecord(null);
        void reloadRecordsRef.current?.();
    };

    const handleImported = () => {
        const scope = notesLifecycle.current;
        if (!scope || scope.identity !== accountIdentity || scope.controller.signal.aborted) return;
        void reloadRecordsRef.current?.();
        void loadNotes();
    };

    const totalPages = Math.ceil(total / PAGE_SIZE);

    const sectionTitleClass = 'mb-3 text-[13px] font-medium text-foreground-tertiary';

    return (
        <div className="min-h-screen bg-background pb-20 text-foreground lg:pb-8">
            <div className="mx-auto flex max-w-[52rem] flex-col gap-8 px-4 py-4 md:gap-10 md:py-10">
                {/* 手机端顶栏已显示「命理记录」，这里只保留操作。 */}
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div className="hidden flex-col gap-1.5 md:flex">
                        <h1 className="font-display text-[2.125rem] leading-tight font-normal">命理记录</h1>
                        <p className="text-[15px] text-foreground-secondary">记下断语、应验与感悟，日后对照印证。</p>
                    </div>
                    <div className="flex w-full items-center justify-end gap-2 md:w-auto">
                        <button
                            type="button"
                            onClick={() => setShowImportExport(true)}
                            aria-label="导入 / 导出"
                            className="inline-flex h-11 items-center gap-2 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3 text-[15px] text-foreground transition-colors hover:bg-background-secondary md:px-4"
                        >
                            <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
                            <span className="hidden md:inline" aria-hidden="true">导入 / 导出</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowRecordForm(true)}
                            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-accent px-[18px] text-[15px] font-medium text-on-accent transition-colors hover:bg-accent/90"
                        >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            新建记录
                        </button>
                    </div>
                </header>

                <section aria-labelledby="records-notes-title">
                    <h2 id="records-notes-title" className={sectionTitleClass}>今日小记</h2>
                    {notesError ? (
                        <SectionError message={notesError} onRetry={loadNotes} />
                    ) : (
                        <div className="rounded-[14px] border-[0.5px] border-border bg-surface">
                            {notesLoading ? (
                                <div className="p-6">
                                    <SoundWaveLoader variant="block" text="加载小记中" />
                                </div>
                            ) : (
                                <DailyNotes userId={user?.id ?? null} notes={notes} onRefresh={loadNotes} />
                            )}
                        </div>
                    )}
                </section>

                <section aria-labelledby="records-list-title">
                    <h2 id="records-list-title" className={sectionTitleClass}>所有记录</h2>
                    <div className="flex flex-col gap-4">
                        <RecordFilters
                            search={search}
                            onSearchChange={(v) => { setSearch(v); setPage(1); }}
                            category={category}
                            onCategoryChange={(v) => { setCategory(v); setPage(1); }}
                        />

                        {recordsError && !loading ? (
                            <SectionError message={recordsError} onRetry={loadRecords} />
                        ) : (
                            <RecordsList
                                loading={loading}
                                records={records}
                                page={page}
                                totalPages={totalPages}
                                onPageChange={setPage}
                                onEdit={(record) => { setEditingRecord(record); setShowRecordForm(true); }}
                                onDelete={(id) => setDeleteRecordId(id)}
                                onTogglePin={handleTogglePin}
                                onAddToKnowledgeBase={openAddToKb}
                                onCreateNew={() => setShowRecordForm(true)}
                            />
                        )}
                    </div>
                </section>

                {/* 模态框 */}
                {showRecordForm && (
                    <RecordFormModal
                        userId={user?.id ?? null}
                        record={editingRecord}
                        onClose={() => { setShowRecordForm(false); setEditingRecord(null); }}
                        onSave={handleRecordSaved}
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
            </div>
        </div>
    );
}
