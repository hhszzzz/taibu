/**
 * 知识库管理
 *
 * 'use client' 标记说明：
 * - 管理知识库列表、归档分页（IntersectionObserver）与文件上传状态
 * - 监听全站知识库同步事件，让其他页面「加入知识库」后这里的归档列表保持一致
 */
'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ChevronDown, FileText, PencilLine, Plus, Search, Trash2, Unlink2, Upload } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { KNOWLEDGE_BASE_SYNC_EVENT } from '@/lib/browser-api';
import { formatShortDate } from '@/lib/short-date';
import { MING_RECORD_SOURCE_TYPE } from '@/lib/data-sources/types';
import {
    createKnowledgeBase,
    deleteKnowledgeBase,
    listKnowledgeBaseArchives,
    listKnowledgeBases,
    removeKnowledgeBaseArchive,
    type ArchivedSource,
    type KnowledgeBaseSummary,
    updateKnowledgeBase,
    uploadKnowledgeBaseFile,
} from '@/lib/knowledge-base/browser-client';
import type { KnowledgeBaseWeight } from '@/lib/knowledge-base/types';
import { KNOWLEDGE_FILE_ACCEPT, KNOWLEDGE_FILE_HINT, validateKnowledgeFile } from '@/lib/knowledge-base/upload-policy';
import { getCurrentUserSettings, updateCurrentUserSettings } from '@/lib/user/settings';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';

type KnowledgeBase = KnowledgeBaseSummary & {
    weight: KnowledgeBaseWeight;
};

type ArchiveBucket = {
    items: ArchivedSource[];
    hasMore: boolean;
    nextOffset: number | null;
    loaded: boolean;
    loading: boolean;
    error: string | null;
    appendError: string | null;
};

type KnowledgeBaseDraft = {
    id: string;
    name: string;
    description: string;
};

const ARCHIVE_PAGE_SIZE = 20;
const EMPTY_ARCHIVE_BUCKET: ArchiveBucket = {
    items: [],
    hasMore: false,
    nextOffset: null,
    loaded: false,
    loading: false,
    error: null,
    appendError: null,
};

function mergeArchivedSources(current: ArchivedSource[], incoming: ArchivedSource[]) {
    if (incoming.length === 0) {
        return current;
    }

    const merged = new Map(current.map((item) => [item.id, item] as const));
    for (const item of incoming) {
        merged.set(item.id, item);
    }
    return Array.from(merged.values());
}

const WEIGHT_OPTIONS: Array<{ value: KnowledgeBaseWeight; label: string }> = [
    { value: 'high', label: '高优先级' },
    { value: 'normal', label: '默认' },
    { value: 'low', label: '低优先级' },
];

const sourceTypeLabel: Record<string, string> = {
    conversation: '对话',
    record: '命理记录',
    chat_message: '对话回复',
    file: '上传文件',
    bazi_chart: '八字命盘',
    ziwei_chart: '紫微命盘',
    tarot_reading: '塔罗占卜',
    liuyao_divination: '六爻占卜',
    hepan_chart: '合盘分析',
    face_reading: '面相分析',
    palm_reading: '手相分析',
    mbti_reading: 'MBTI 分析',
    [MING_RECORD_SOURCE_TYPE]: '命理记录',
    daily_fortune: '今日运势',
    monthly_fortune: '本月运势',
    qimen_chart: '奇门遁甲',
    daliuren_divination: '大六壬',
    meihua_divination: '梅花易数',
    xiaoliuren_divination: '小六壬',
};

// 上传文件没有内容摘要可读，用文件名更好认；其他来源优先显示归档内容的首段。
function getArchiveTitle(archive: ArchivedSource) {
    if (archive.source_type === 'file') return archive.source_id;
    return archive.preview || archive.source_id;
}

const SECTION_TITLE = 'text-[13px] font-medium text-foreground-tertiary';
const CARD = 'rounded-[14px] border border-border bg-surface';

export default function KnowledgeBasePanel() {
    const { showToast } = useToast();
    const {
        userId,
        sessionLoading,
        membershipInfo,
        membershipLoading,
        membershipResolved,
    } = useSessionMembership();
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);
    const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
    const [expandedKbId, setExpandedKbId] = useState<string | null>(null);
    const [archives, setArchives] = useState<Record<string, ArchiveBucket>>({});
    const [createOpen, setCreateOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [draft, setDraft] = useState<KnowledgeBaseDraft | null>(null);
    const [savingKbId, setSavingKbId] = useState<string | null>(null);
    const [deletingKbId, setDeletingKbId] = useState<string | null>(null);
    const [removingArchiveId, setRemovingArchiveId] = useState<string | null>(null);
    const [uploadKbId, setUploadKbId] = useState<string | null>(null);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
    const [promptKbIds, setPromptKbIds] = useState<string[]>([]);
    const [promptSavingId, setPromptSavingId] = useState<string | null>(null);
    const [pendingDeleteKbId, setPendingDeleteKbId] = useState<string | null>(null);
    const archiveLoadMoreRef = useRef<HTMLDivElement | null>(null);
    const createNameRef = useRef<HTMLInputElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const initializedUserIdRef = useRef<string | null>(null);
    const archivesRef = useRef<Record<string, ArchiveBucket>>({});
    const archiveRequestKeyRef = useRef<Record<string, string>>({});
    const membershipType = membershipResolved ? (membershipInfo?.type ?? 'free') : null;
    // 创建、导入与检索都要求 Plus 及以上；会员状态未确定前不锁界面，最终由服务端校验。
    const membershipLocked = membershipType === 'free';
    const draftKb = draft ? kbs.find((kb) => kb.id === draft.id) ?? null : null;
    const draftDirty = !!draft && !!draftKb
        && (draft.name !== draftKb.name || draft.description !== (draftKb.description ?? ''));
    // 被选中的知识库删除后回落到第一个，避免把文件传到已不存在的知识库。
    const targetUploadKbId = kbs.some((kb) => kb.id === uploadKbId) ? uploadKbId : kbs[0]?.id ?? null;
    useUnsavedSettingsGuard(!!newName.trim() || !!newDescription.trim() || !!uploadFile || draftDirty);

    useEffect(() => {
        archivesRef.current = archives;
    }, [archives]);

    useEffect(() => {
        if (createOpen) createNameRef.current?.focus();
    }, [createOpen]);

    const loadKnowledgeBases = useCallback(async () => {
        setListError(null);
        try {
            const kbList = await listKnowledgeBases();
            setKbs(kbList.map((kb) => ({ ...kb, weight: kb.weight ?? 'normal' })));
        } catch (loadError) {
            setListError(loadError instanceof Error ? loadError.message : '获取知识库失败');
            setKbs([]);
        }
    }, []);

    const loadPromptKbIds = useCallback(async () => {
        const { settings, error } = await getCurrentUserSettings();
        if (error) {
            showToast('error', error.message || '加载知识库设置失败');
            return;
        }
        setPromptKbIds(settings?.promptKbIds ?? []);
    }, [showToast]);

    useEffect(() => {
        const init = async () => {
            if (sessionLoading) {
                return;
            }
            if (!userId) {
                initializedUserIdRef.current = null;
                setLoading(false);
                return;
            }
            if (initializedUserIdRef.current === userId) {
                return;
            }
            initializedUserIdRef.current = userId;
            setLoading(true);
            await Promise.all([
                loadKnowledgeBases(),
                loadPromptKbIds(),
            ]);
            setLoading(false);
        };
        void init();
    }, [loadKnowledgeBases, loadPromptKbIds, sessionLoading, userId]);

    const invalidateArchiveBucket = useCallback((kbId: string) => {
        setArchives(prev => {
            const next = { ...prev };
            delete next[kbId];
            return next;
        });
    }, []);

    const loadArchives = useCallback(async (kbId: string, options?: { append?: boolean; offset?: number }) => {
        const append = options?.append === true;
        const current = archivesRef.current[kbId] ?? EMPTY_ARCHIVE_BUCKET;
        const nextOffset = options?.offset ?? (append ? current.nextOffset ?? 0 : 0);
        const requestKey = append ? `append:${nextOffset}` : 'initial:0';
        if (append && archiveRequestKeyRef.current[kbId] === requestKey) {
            return;
        }
        archiveRequestKeyRef.current[kbId] = requestKey;
        setArchives(prev => ({
            ...prev,
            [kbId]: {
                ...(prev[kbId] ?? EMPTY_ARCHIVE_BUCKET),
                loading: true,
                error: append ? (prev[kbId]?.error ?? null) : null,
                appendError: append ? null : (prev[kbId]?.appendError ?? null),
            },
        }));
        try {
            const archivePage = await listKnowledgeBaseArchives(kbId, {
                limit: ARCHIVE_PAGE_SIZE,
                offset: nextOffset,
            });
            setArchives(prev => ({
                ...prev,
                [kbId]: {
                    items: append ? mergeArchivedSources(prev[kbId]?.items ?? [], archivePage.items) : archivePage.items,
                    hasMore: archivePage.hasMore,
                    nextOffset: archivePage.nextOffset,
                    loaded: true,
                    loading: false,
                    error: null,
                    appendError: null,
                },
            }));
        } catch (loadError) {
            const message = loadError instanceof Error ? loadError.message : '获取归档失败';
            setArchives(prev => ({
                ...prev,
                [kbId]: {
                    ...(prev[kbId] ?? EMPTY_ARCHIVE_BUCKET),
                    items: prev[kbId]?.items ?? [],
                    hasMore: prev[kbId]?.hasMore ?? false,
                    nextOffset: prev[kbId]?.nextOffset ?? null,
                    loading: false,
                    loaded: true,
                    error: append ? (prev[kbId]?.error ?? null) : message,
                    appendError: append ? message : null,
                },
            }));
        } finally {
            delete archiveRequestKeyRef.current[kbId];
        }
    }, []);

    const toggleExpand = useCallback(async (kbId: string) => {
        if (expandedKbId === kbId) {
            setExpandedKbId(null);
            return;
        }
        setExpandedKbId(kbId);
        const bucket = archives[kbId];
        if (!bucket?.loaded && !bucket?.loading) {
            await loadArchives(kbId);
        }
    }, [archives, expandedKbId, loadArchives]);

    useEffect(() => {
        const bucket = expandedKbId ? archives[expandedKbId] : null;
        if (
            !expandedKbId
            || !bucket?.loaded
            || bucket.loading
            || !!bucket.appendError
            || !bucket.hasMore
            || bucket.nextOffset == null
            || !archiveLoadMoreRef.current
        ) {
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                void loadArchives(expandedKbId, {
                    append: true,
                    offset: bucket.nextOffset ?? 0,
                });
            }
        }, {
            rootMargin: '160px 0px',
        });

        observer.observe(archiveLoadMoreRef.current);
        return () => observer.disconnect();
    }, [archives, expandedKbId, loadArchives]);

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
            const pathname = detail?.pathname ?? '';
            const kbId = pathname.startsWith('/api/knowledge-base/ingest')
                ? detail.requestBody?.kbId
                : detail?.responseData?.kbId;

            if (typeof kbId !== 'string' || !kbId) {
                if (pathname.startsWith('/api/knowledge-base/archive/') && expandedKbId) {
                    invalidateArchiveBucket(expandedKbId);
                    void loadArchives(expandedKbId);
                }
                return;
            }

            invalidateArchiveBucket(kbId);
            if (expandedKbId === kbId) {
                void loadArchives(kbId);
            }
        };

        window.addEventListener(KNOWLEDGE_BASE_SYNC_EVENT, handleArchiveChanged as EventListener);
        return () => {
            window.removeEventListener(KNOWLEDGE_BASE_SYNC_EVENT, handleArchiveChanged as EventListener);
        };
    }, [expandedKbId, invalidateArchiveBucket, loadArchives]);

    const closeCreateForm = useCallback(() => {
        setCreateOpen(false);
        setNewName('');
        setNewDescription('');
        setCreateError(null);
    }, []);

    const createKb = useCallback(async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const name = newName.trim();
        if (!name) {
            setCreateError('请输入知识库名称');
            return;
        }
        setCreating(true);
        setCreateError(null);
        try {
            await createKnowledgeBase({
                name,
                description: newDescription.trim() ? newDescription.trim() : null,
            });
            closeCreateForm();
            await loadKnowledgeBases();
            showToast('success', '知识库创建成功');
        } catch (createFailure) {
            setCreateError(createFailure instanceof Error ? createFailure.message : '创建知识库失败');
        } finally {
            setCreating(false);
        }
    }, [closeCreateForm, loadKnowledgeBases, newDescription, newName, showToast]);

    const togglePromptKb = useCallback(async (kbId: string) => {
        if (!userId) return;
        if (membershipLoading) {
            showToast('info', '会员状态加载中，请稍后重试');
            return;
        }
        if (membershipType === 'free') {
            showToast('info', '仅限 Plus 以上会员使用');
            return;
        }
        const next = promptKbIds.includes(kbId)
            ? promptKbIds.filter(id => id !== kbId)
            : [...promptKbIds, kbId];
        setPromptKbIds(next);
        setPromptSavingId(kbId);
        const saved = await updateCurrentUserSettings({ promptKbIds: next });
        setPromptSavingId(null);
        if (!saved) {
            setPromptKbIds(promptKbIds);
            showToast('error', '保存知识库失败');
            return;
        }
        setPromptKbIds(saved.promptKbIds);
    }, [membershipLoading, membershipType, promptKbIds, showToast, userId]);

    const updateKb = useCallback(async (
        kbId: string,
        input: Parameters<typeof updateKnowledgeBase>[1],
        successMessage: string,
    ) => {
        setSavingKbId(kbId);
        try {
            await updateKnowledgeBase(kbId, input);
            await loadKnowledgeBases();
            showToast('success', successMessage);
            return true;
        } catch (saveError) {
            showToast('error', saveError instanceof Error ? saveError.message : '更新知识库失败');
            return false;
        } finally {
            setSavingKbId(null);
        }
    }, [loadKnowledgeBases, showToast]);

    const saveDraft = useCallback(async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const name = draft?.name.trim();
        if (!draft || !name) return;
        const saved = await updateKb(draft.id, {
            name,
            description: draft.description.trim() || null,
        }, '知识库已更新');
        if (saved) setDraft(null);
    }, [draft, updateKb]);

    // 优先级即改即存：先更新界面，失败时恢复原值。
    const changeWeight = useCallback(async (kb: KnowledgeBase, weight: KnowledgeBaseWeight) => {
        setKbs(prev => prev.map(item => item.id === kb.id ? { ...item, weight } : item));
        const saved = await updateKb(kb.id, { weight }, '检索优先级已更新');
        if (!saved) setKbs(prev => prev.map(item => item.id === kb.id ? { ...item, weight: kb.weight } : item));
    }, [updateKb]);

    const deleteKb = useCallback(async (kbId: string) => {
        setDeletingKbId(kbId);
        try {
            await deleteKnowledgeBase(kbId);
            if (expandedKbId === kbId) setExpandedKbId(null);
            setDraft(current => current?.id === kbId ? null : current);
            invalidateArchiveBucket(kbId);
            await loadKnowledgeBases();
            showToast('success', '知识库已删除');
            setPendingDeleteKbId(null);
        } catch (deleteError) {
            const message = deleteError instanceof Error ? deleteError.message : '删除知识库失败';
            showToast('error', message);
        } finally {
            setDeletingKbId(null);
        }
    }, [expandedKbId, invalidateArchiveBucket, loadKnowledgeBases, showToast]);

    const removeArchive = useCallback(async (archive: ArchivedSource) => {
        setRemovingArchiveId(archive.id);
        try {
            await removeKnowledgeBaseArchive(archive.id);
            if (expandedKbId) {
                invalidateArchiveBucket(expandedKbId);
                await loadArchives(expandedKbId);
            }
            showToast('success', '已移出知识库');
        } catch (removeError) {
            const message = removeError instanceof Error ? removeError.message : '取消归档失败';
            showToast('error', message);
        } finally {
            setRemovingArchiveId(null);
        }
    }, [expandedKbId, invalidateArchiveBucket, loadArchives, showToast]);

    // 选择文件时就按服务端同一规则校验，不把注定被拒的文件传上去。
    const selectUploadFile = useCallback((file: File | null) => {
        const fileError = file ? validateKnowledgeFile(file) : null;
        setUploadSuccess(null);
        setUploadError(fileError);
        setUploadFile(fileError ? null : file);
        if (fileError && fileInputRef.current) fileInputRef.current.value = '';
    }, []);

    const uploadKnowledgeFile = useCallback(async () => {
        if (!targetUploadKbId) {
            setUploadError('请选择知识库');
            return;
        }
        if (!uploadFile) {
            setUploadError('请选择文件');
            return;
        }
        setUploading(true);
        setUploadError(null);
        setUploadSuccess(null);
        try {
            await uploadKnowledgeBaseFile(targetUploadKbId, uploadFile);
            setUploadFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';

            setUploadSuccess(`已导入「${uploadFile.name}」`);
            // 展开目标知识库，直接看到刚导入的文件
            if (targetUploadKbId !== expandedKbId) {
                setExpandedKbId(targetUploadKbId);
            }
            invalidateArchiveBucket(targetUploadKbId);
            await loadArchives(targetUploadKbId);
            showToast('success', '文件上传成功');
        } catch (uploadFailure) {
            setUploadError(uploadFailure instanceof Error ? uploadFailure.message : '上传失败');
        } finally {
            setUploading(false);
        }
    }, [expandedKbId, invalidateArchiveBucket, loadArchives, showToast, targetUploadKbId, uploadFile]);

    if (!sessionLoading && !userId) {
        return <SettingsLoginRequired title="请先登录后使用知识库" />;
    }

    const renderArchives = (kb: KnowledgeBase) => {
        const archiveState = archives[kb.id] ?? EMPTY_ARCHIVE_BUCKET;
        const retryAppend = () => { void loadArchives(kb.id, { append: true, offset: archiveState.nextOffset ?? 0 }); };

        if (archiveState.loading && !archiveState.loaded) {
            return (
                <ul aria-hidden="true">
                    {[1, 2, 3].map(i => (
                        <li key={i} className="flex items-center gap-3 py-3 [&+li]:border-t [&+li]:border-border">
                            <span className="h-5 w-16 rounded-md bg-foreground/10 animate-pulse" />
                            <span className="h-4 flex-1 rounded bg-foreground/5 animate-pulse" />
                            <span className="h-4 w-10 rounded bg-foreground/5 animate-pulse" />
                        </li>
                    ))}
                </ul>
            );
        }

        if (archiveState.error && archiveState.items.length === 0) {
            return (
                <div role="alert" className="flex items-center justify-between gap-3 py-4 text-sm text-danger">
                    <span>{archiveState.error}</span>
                    <button type="button" onClick={() => { void loadArchives(kb.id); }} className="flex-shrink-0 font-medium text-foreground">
                        重试
                    </button>
                </div>
            );
        }

        if (archiveState.items.length === 0) {
            return (
                <div className="py-5 text-center">
                    <p className="text-sm text-foreground-secondary">暂无归档内容</p>
                    <p className="mt-1 text-xs text-foreground-tertiary">在对话或结果页点「加入知识库」，或在下方导入文件。</p>
                </div>
            );
        }

        return (
            <>
                <ul>
                    {archiveState.items.map(archive => {
                        const title = getArchiveTitle(archive);
                        return (
                            <li key={archive.id} className="flex items-center gap-3 py-1.5 [&+li]:border-t [&+li]:border-border">
                                <span className="min-w-16 flex-shrink-0 rounded-md bg-background-secondary px-2 py-0.5 text-center text-xs text-foreground-secondary">
                                    {sourceTypeLabel[archive.source_type] || archive.source_type}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={title}>{title}</span>
                                <span className="flex-shrink-0 text-xs tabular-nums text-foreground-tertiary">{formatShortDate(archive.created_at)}</span>
                                <button
                                    type="button"
                                    onClick={() => removeArchive(archive)}
                                    disabled={removingArchiveId === archive.id}
                                    className="settings-icon-button settings-icon-button-danger -mr-2"
                                    aria-label={`移出知识库：${title}`}
                                    title="移出知识库"
                                >
                                    {removingArchiveId === archive.id ? <SoundWaveLoader variant="inline" /> : <Unlink2 aria-hidden="true" className="h-4 w-4" />}
                                </button>
                            </li>
                        );
                    })}
                </ul>
                {archiveState.error ? (
                    <p role="alert" className="pt-2 text-xs text-danger">{archiveState.error}</p>
                ) : null}
                {archiveState.appendError ? (
                    <div role="alert" className="flex items-center justify-between gap-3 pt-2 text-xs text-danger">
                        <span>{archiveState.appendError}</span>
                        <button type="button" onClick={retryAppend} className="flex-shrink-0 font-medium text-foreground">
                            重试加载更多
                        </button>
                    </div>
                ) : null}
                {archiveState.hasMore && !archiveState.appendError ? (
                    <div ref={archiveLoadMoreRef} className="flex min-h-8 items-center pt-2 text-xs text-foreground-tertiary">
                        {archiveState.loading ? <SoundWaveLoader variant="inline" /> : '继续下滑加载更多'}
                    </div>
                ) : null}
            </>
        );
    };

    const renderKnowledgeBase = (kb: KnowledgeBase) => {
        const expanded = expandedKbId === kb.id;
        const editing = draft?.id === kb.id ? draft : null;
        const saving = savingKbId === kb.id;
        const searchEnabled = promptKbIds.includes(kb.id);
        const archivesId = `kb-archives-${kb.id}`;

        return (
            <li key={kb.id} className={`overflow-hidden ${CARD}`}>
                {/* 手机上操作图标与名称同行、优先级与检索换到第二行；桌面端全部排在一行。 */}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-3 py-4 pl-5 pr-3">
                    {editing ? (
                        <form onSubmit={saveDraft} className="order-1 flex min-w-0 basis-full flex-col gap-2 sm:mr-3.5 sm:flex-[1_1_280px]" aria-label={`编辑知识库 ${kb.name}`}>
                            <input
                                value={editing.name}
                                onChange={(event) => setDraft({ ...editing, name: event.target.value })}
                                className="settings-input"
                                aria-label="知识库名称"
                                placeholder="知识库名称"
                            />
                            <textarea
                                value={editing.description}
                                onChange={(event) => setDraft({ ...editing, description: event.target.value })}
                                className="settings-textarea"
                                rows={2}
                                aria-label="用途说明"
                                placeholder="用途说明（可选）"
                            />
                            <div className="flex gap-2">
                                <button type="submit" disabled={saving || !editing.name.trim() || !draftDirty} className="settings-button settings-button-primary">
                                    {saving ? '保存中…' : '保存'}
                                </button>
                                <button type="button" disabled={saving} onClick={() => setDraft(null)} className="settings-button">
                                    取消
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div className="order-1 mr-1.5 flex min-w-0 flex-1 flex-col gap-1 sm:mr-3.5 sm:flex-[1_1_280px]">
                            <h4 className="truncate text-base font-medium text-foreground">{kb.name}</h4>
                            {kb.description ? (
                                <p className="text-[13px] leading-relaxed text-foreground-secondary [overflow-wrap:anywhere]">{kb.description}</p>
                            ) : null}
                        </div>
                    )}

                    <div className="order-3 flex w-full flex-wrap items-center gap-1.5 sm:order-2 sm:w-auto">
                        <span className="relative">
                            <select
                                value={kb.weight}
                                onChange={(event) => { void changeWeight(kb, event.target.value as KnowledgeBaseWeight); }}
                                disabled={saving}
                                aria-label={`${kb.name} 的检索优先级`}
                                className="h-8 cursor-pointer appearance-none rounded-full border border-border-hover bg-surface pl-3 pr-8 text-[13px] text-foreground-secondary transition-colors duration-150 hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {WEIGHT_OPTIONS.map(option => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-tertiary" />
                        </span>
                        <button
                            type="button"
                            aria-pressed={searchEnabled}
                            onClick={() => togglePromptKb(kb.id)}
                            disabled={membershipLoading || membershipLocked || promptSavingId === kb.id}
                            title={membershipLocked ? '仅限 Plus 以上会员使用' : '对话时检索这个知识库'}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border-hover bg-surface px-3 text-[13px] text-foreground-secondary transition-colors duration-150 hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:border-transparent aria-pressed:bg-accent-soft aria-pressed:text-accent-strong"
                        >
                            <Search aria-hidden="true" className="h-3.5 w-3.5" />
                            {searchEnabled ? '已启用检索' : '启用检索'}
                        </button>
                    </div>
                    <div className="order-2 flex items-center gap-1.5 sm:order-3">
                        <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border sm:block" />
                        <button
                            type="button"
                            onClick={() => setDraft({ id: kb.id, name: kb.name, description: kb.description ?? '' })}
                            disabled={!!editing}
                            className="settings-icon-button"
                            aria-label={`编辑 ${kb.name} 的名称与说明`}
                            title="编辑名称与说明"
                        >
                            <PencilLine aria-hidden="true" className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => toggleExpand(kb.id)}
                            className="settings-icon-button"
                            aria-expanded={expanded}
                            aria-controls={archivesId}
                            aria-label={`查看 ${kb.name} 的归档`}
                            title={expanded ? '收起归档' : '查看归档'}
                        >
                            <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setPendingDeleteKbId(kb.id)}
                            disabled={deletingKbId === kb.id}
                            className="settings-icon-button settings-icon-button-danger"
                            aria-label={`删除知识库 ${kb.name}`}
                            title="删除知识库"
                        >
                            {deletingKbId === kb.id ? <SoundWaveLoader variant="inline" /> : <Trash2 aria-hidden="true" className="h-4 w-4" />}
                        </button>
                    </div>
                </div>

                {expanded ? (
                    <div id={archivesId} className="border-t border-border bg-background px-5 py-2">
                        {renderArchives(kb)}
                    </div>
                ) : null}
            </li>
        );
    };

    const pendingDeleteKb = kbs.find(kb => kb.id === pendingDeleteKbId) ?? null;

    return (
        <>
            <div className="flex flex-col gap-9">
                {membershipLocked ? (
                    <div className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${CARD}`}>
                        <p className="min-w-0 flex-[1_1_16rem] text-sm leading-relaxed text-foreground-secondary">
                            知识库需要 Plus 及以上会员。升级后可以新建知识库、导入资料，并在对话中检索引用。
                        </p>
                        <Link href="/settings/upgrade" className="settings-button">查看订阅</Link>
                    </div>
                ) : null}

                <section aria-labelledby="kb-list-heading" className="flex flex-col gap-3">
                    <div className="flex min-h-10 items-center justify-between gap-3">
                        <h3 id="kb-list-heading" className={SECTION_TITLE}>
                            我的知识库
                            {!loading ? <span className="ml-1.5 font-normal">{kbs.length}</span> : null}
                        </h3>
                        {!createOpen ? (
                            <button
                                type="button"
                                onClick={() => setCreateOpen(true)}
                                disabled={membershipLocked}
                                className="settings-button settings-button-primary"
                            >
                                <Plus aria-hidden="true" className="h-4 w-4" />
                                新建知识库
                            </button>
                        ) : null}
                    </div>

                    {createOpen ? (
                        <form onSubmit={createKb} className={`flex flex-col gap-4 p-5 ${CARD}`} aria-label="新建知识库">
                            <label className="settings-field-block">
                                <span className="settings-label">名称</span>
                                <input
                                    ref={createNameRef}
                                    value={newName}
                                    onChange={(event) => setNewName(event.target.value)}
                                    className="settings-input settings-input-lg"
                                    placeholder="例如：家人命盘"
                                />
                            </label>
                            <label className="settings-field-block">
                                <span className="settings-label">用途说明（可选）</span>
                                <textarea
                                    value={newDescription}
                                    onChange={(event) => setNewDescription(event.target.value)}
                                    className="settings-textarea"
                                    rows={2}
                                    placeholder="收录哪些内容，AI 检索时会参考这段说明"
                                />
                            </label>
                            {createError ? <p role="alert" className="text-sm text-danger">{createError}</p> : null}
                            <div className="flex gap-2">
                                <button type="submit" disabled={creating || !newName.trim()} className="settings-button settings-button-primary">
                                    {creating ? '创建中…' : '创建'}
                                </button>
                                <button type="button" disabled={creating} onClick={closeCreateForm} className="settings-button settings-button-ghost">
                                    取消
                                </button>
                            </div>
                        </form>
                    ) : null}

                    {listError ? (
                        <div role="alert" className="settings-alert">
                            <span className="min-w-0 flex-1">{listError}</span>
                            <button type="button" onClick={() => { void loadKnowledgeBases(); }}>重试</button>
                        </div>
                    ) : null}

                    {loading ? (
                        <ul aria-hidden="true" className="flex flex-col gap-3">
                            {[1, 2].map(i => (
                                <li key={i} className={`flex flex-wrap items-center gap-x-5 gap-y-3 py-4 pl-5 pr-3 ${CARD}`}>
                                    <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2">
                                        <span className="h-5 w-32 rounded bg-foreground/10 animate-pulse" />
                                        <span className="h-4 w-56 max-w-full rounded bg-foreground/5 animate-pulse" />
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="h-8 w-24 rounded-full bg-foreground/5 animate-pulse" />
                                        <span className="h-8 w-24 rounded-full bg-foreground/5 animate-pulse" />
                                        <span className="h-9 w-28 rounded-lg bg-foreground/5 animate-pulse" />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : kbs.length > 0 ? (
                        <ul className="flex flex-col gap-3">
                            {kbs.map(renderKnowledgeBase)}
                        </ul>
                    ) : listError ? null : (
                        <div className="rounded-[14px] border border-dashed border-border-hover px-6 py-9 text-center">
                            <p className="text-sm text-foreground-secondary">还没有知识库</p>
                            <p className="mt-1 text-xs text-foreground-tertiary">新建一个知识库，把命盘、解读和资料归档进来。</p>
                        </div>
                    )}

                    <p className="settings-help">
                        启用检索需 Plus 及以上会员。在对话、命理记录和各占术结果页点「加入知识库」，即可把内容归档到这里。
                    </p>
                </section>

                <section aria-labelledby="kb-import-heading" className="flex flex-col gap-3">
                    <h3 id="kb-import-heading" className={SECTION_TITLE}>导入外部资料</h3>
                    <div className={`grid gap-4 p-5 sm:grid-cols-2 ${CARD}`}>
                        <label className="settings-field-block">
                            <span className="settings-label">导入到</span>
                            <select
                                value={targetUploadKbId ?? ''}
                                onChange={(event) => setUploadKbId(event.target.value)}
                                disabled={kbs.length === 0 || membershipLocked}
                                className="settings-select w-full"
                            >
                                {kbs.length === 0 ? (
                                    <option value="">暂无知识库</option>
                                ) : (
                                    kbs.map(kb => (
                                        <option key={kb.id} value={kb.id}>{kb.name}</option>
                                    ))
                                )}
                            </select>
                        </label>
                        <div className="settings-field-block">
                            <span id="kb-file-label" className="settings-label">文件</span>
                            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-border-hover bg-background py-1.5 pl-3.5 pr-1.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
                                <FileText aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-foreground-tertiary" />
                                <span className={`min-w-0 flex-1 truncate text-sm ${uploadFile ? 'text-foreground' : 'text-foreground-tertiary'}`}>
                                    {uploadFile?.name ?? '选择要导入的文件'}
                                </span>
                                <span aria-hidden="true" className="flex-shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-foreground">
                                    {uploadFile ? '更换' : '选择'}
                                </span>
                                <input
                                    ref={fileInputRef}
                                    id="kb-file-upload"
                                    type="file"
                                    accept={KNOWLEDGE_FILE_ACCEPT}
                                    onChange={(event) => selectUploadFile(event.target.files?.[0] ?? null)}
                                    disabled={uploading || membershipLocked}
                                    aria-labelledby="kb-file-label"
                                    aria-describedby="kb-file-hint"
                                    className="sr-only"
                                />
                            </label>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
                            <p id="kb-file-hint" className="text-xs text-foreground-tertiary">{KNOWLEDGE_FILE_HINT}</p>
                            <button
                                type="button"
                                onClick={uploadKnowledgeFile}
                                disabled={uploading || !targetUploadKbId || !uploadFile || membershipLocked}
                                className="settings-button"
                            >
                                <Upload aria-hidden="true" className="h-4 w-4" />
                                {uploading ? '上传中…' : '开始上传'}
                            </button>
                        </div>
                        {uploadError ? <p role="alert" className="text-sm text-danger sm:col-span-2">{uploadError}</p> : null}
                        {uploadSuccess ? <p role="status" className="text-sm text-success sm:col-span-2">{uploadSuccess}</p> : null}
                    </div>
                </section>
            </div>
            <ConfirmDialog
                isOpen={!!pendingDeleteKbId}
                onClose={() => setPendingDeleteKbId(null)}
                onConfirm={() => pendingDeleteKbId ? deleteKb(pendingDeleteKbId) : undefined}
                title="确认删除"
                description={`确定删除${pendingDeleteKb ? `「${pendingDeleteKb.name}」` : '这个知识库'}吗？其中的归档和导入的文件会一并移除（原有的命盘、对话不受影响），此操作无法撤销。`}
                confirmText="确认删除"
                variant="danger"
                loading={!!deletingKbId}
            />
        </>
    );
}
