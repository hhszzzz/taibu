/**
 * 记录详情相关组件：表单模态框、小记、导入导出
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState / useId)
 * - 有表单交互和文件上传
 */
'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Download, Trash2, Upload, X } from 'lucide-react';
import {
    createNote,
    createRecord,
    deleteNote,
    downloadExportData,
    exportData,
    importData,
    MingRecord,
    MingNote,
    RecordCategory,
    RECORD_CATEGORIES,
    readImportFile,
    NOTE_MOODS,
    NoteMood,
    toLocalDateKey,
    updateRecord,
    type ExportData,
} from '@/lib/records';
import { Modal } from '@/components/ui/Modal';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { FILTER_CHIP_CLASS, FilterChip } from '@/components/ui/FilterChip';

const FIELD_CLASS = 'w-full rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3.5 text-[15px] text-foreground placeholder:text-foreground-tertiary focus:border-accent focus:outline-none';
const LABEL_CLASS = 'mb-1.5 block text-sm text-foreground-secondary';
const PRIMARY_BUTTON_CLASS = 'inline-flex h-10 items-center justify-center rounded-[10px] bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:opacity-50';
const SECONDARY_BUTTON_CLASS = 'inline-flex h-10 items-center justify-center rounded-[10px] border-[0.5px] border-border-hover bg-surface px-5 text-sm text-foreground transition-colors hover:bg-background-secondary disabled:opacity-50';
const NOTE_TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function formatNoteTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : NOTE_TIME_FORMAT.format(date);
}

/** 中文输入法选词时的回车不算提交。 */
function isPlainEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}

function FormError({ message }: { message: string }) {
    if (!message) return null;
    return (
        <div role="alert" className="rounded-[10px] border-[0.5px] border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
            {message}
        </div>
    );
}

function DialogHeader({ titleId, title, description, onClose, closeDisabled }: {
    titleId: string;
    title: string;
    description?: string;
    onClose: () => void;
    closeDisabled?: boolean;
}) {
    return (
        <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
            <div className="min-w-0">
                <h2 id={titleId} className="font-display text-xl text-foreground">{title}</h2>
                {description ? <p className="mt-1 text-sm text-foreground-secondary">{description}</p> : null}
            </div>
            <button
                type="button"
                onClick={onClose}
                disabled={closeDisabled}
                aria-label="关闭"
                className="-mt-1 -mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-tertiary transition-colors hover:bg-background-secondary hover:text-foreground disabled:opacity-40"
            >
                <X className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
        </div>
    );
}

// =====================================================
// 记录表单模态框
// =====================================================
export function RecordFormModal({
    userId,
    record,
    onClose,
    onSave
}: {
    userId: string | null;
    record?: MingRecord | null;
    onClose: () => void;
    onSave: () => void | Promise<void>;
}) {
    const [title, setTitle] = useState(record?.title || '');
    const [content, setContent] = useState(record?.content || '');
    const [category, setCategory] = useState<RecordCategory>(record?.category || 'general');
    const [eventDate, setEventDate] = useState(record?.event_date || toLocalDateKey());
    const [tagsInput, setTagsInput] = useState(record?.tags.join(', ') || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { showToast } = useToast();
    const id = useId();
    const titleInputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userId) {
            setError('请先登录后再保存记录');
            return;
        }
        if (!title.trim()) {
            setError('标题不能为空');
            titleInputRef.current?.focus();
            return;
        }

        setLoading(true);
        setError('');

        try {
            const tags = tagsInput.split(/[,，]/).map(t => t.trim()).filter(Boolean);
            const data = {
                title: title.trim(),
                content: content.trim() || undefined,
                category,
                event_date: eventDate || undefined,
                tags,
            };

            if (record) {
                await updateRecord(record.id, data);
            } else {
                await createRecord(data);
            }

            await Promise.resolve(onSave());
        } catch (saveError) {
            const message = getErrorMessage(saveError, '保存失败，请重试');
            setError(message);
            showToast('error', message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal open onClose={onClose} busy={loading} labelledBy={`${id}-title`} initialFocusRef={titleInputRef} className="max-w-lg">
            <DialogHeader
                titleId={`${id}-title`}
                title={record ? '编辑记录' : '新建记录'}
                description="记下断语、应验与感悟，日后对照印证。"
                onClose={onClose}
                closeDisabled={loading}
            />

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 p-5 sm:p-6">
                <FormError message={error} />

                <div>
                    <label htmlFor={`${id}-record-title`} className={LABEL_CLASS}>标题</label>
                    <input
                        ref={titleInputRef}
                        id={`${id}-record-title`}
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        aria-invalid={error === '标题不能为空' || undefined}
                        className={`${FIELD_CLASS} h-11`}
                        placeholder="例如：九月面试结果与卦象一致"
                    />
                </div>

                <fieldset>
                    <legend className={LABEL_CLASS}>分类</legend>
                    <div className="flex flex-wrap gap-2">
                        {RECORD_CATEGORIES.map(cat => (
                            <label key={cat.value} className="cursor-pointer">
                                <input
                                    type="radio"
                                    name={`${id}-category`}
                                    value={cat.value}
                                    checked={category === cat.value}
                                    onChange={() => setCategory(cat.value)}
                                    className="peer sr-only"
                                />
                                <span className={`${FILTER_CHIP_CLASS} peer-checked:border-transparent peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent`}>
                                    {cat.label}
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label htmlFor={`${id}-event-date`} className={LABEL_CLASS}>事件日期</label>
                        <input
                            id={`${id}-event-date`}
                            type="date"
                            value={eventDate}
                            onChange={(e) => setEventDate(e.target.value)}
                            className={`${FIELD_CLASS} h-11`}
                        />
                    </div>
                    <div>
                        <label htmlFor={`${id}-tags`} className={LABEL_CLASS}>标签</label>
                        <input
                            id={`${id}-tags`}
                            type="text"
                            value={tagsInput}
                            onChange={(e) => setTagsInput(e.target.value)}
                            aria-describedby={`${id}-tags-help`}
                            className={`${FIELD_CLASS} h-11`}
                            placeholder="事业, 六爻"
                        />
                        <p id={`${id}-tags-help`} className="mt-1 text-xs text-foreground-tertiary">用逗号分隔多个标签</p>
                    </div>
                </div>

                <div>
                    <label htmlFor={`${id}-content`} className={LABEL_CLASS}>内容</label>
                    <textarea
                        id={`${id}-content`}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={6}
                        className={`${FIELD_CLASS} resize-y py-3 leading-relaxed`}
                        placeholder="断语、排盘结果、实际应验或心得体会"
                    />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={onClose} disabled={loading} className={SECONDARY_BUTTON_CLASS}>取消</button>
                    <button type="submit" disabled={loading} className={PRIMARY_BUTTON_CLASS}>
                        {loading ? '保存中…' : '保存记录'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}

// =====================================================
// 小记组件
// =====================================================
export function DailyNotes({
    userId,
    notes,
    onRefresh
}: {
    userId: string | null;
    notes: MingNote[];
    onRefresh: () => void | Promise<void>;
}) {
    const [content, setContent] = useState('');
    const [mood, setMood] = useState<NoteMood>('neutral');
    const [loading, setLoading] = useState(false);
    const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const { showToast } = useToast();
    const id = useId();

    const submit = async () => {
        if (loading || !content.trim()) return;
        if (!userId) {
            const message = '请先登录后再记录小记';
            setError(message);
            showToast('error', message);
            return;
        }

        setLoading(true);
        setError('');
        try {
            // 带上用户本地日期，避免服务端按 UTC 把凌晨的小记归到前一天。
            await createNote({ content: content.trim(), mood, note_date: toLocalDateKey() });
            setContent('');
            await Promise.resolve(onRefresh());
        } catch (submitError) {
            const message = getErrorMessage(submitError, '创建小记失败');
            setError(message);
            showToast('error', message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (noteId: string) => {
        try {
            setError('');
            await deleteNote(noteId);
            await Promise.resolve(onRefresh());
        } catch (deleteError) {
            const message = getErrorMessage(deleteError, '删除小记失败');
            setError(message);
            showToast('error', message);
        } finally {
            setDeleteNoteId(null);
        }
    };

    return (
        <div className="flex flex-col gap-4 p-4 md:p-5">
            <FormError message={error} />

            <form
                onSubmit={(e) => { e.preventDefault(); void submit(); }}
                className="flex flex-col gap-3"
            >
                <div role="group" aria-label="心情" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 md:mx-0 md:flex-wrap md:px-0">
                    {NOTE_MOODS.map(m => (
                        <FilterChip key={m.value} pressed={mood === m.value} onClick={() => setMood(m.value)}>
                            <span aria-hidden="true">{m.icon}</span>{m.label}
                        </FilterChip>
                    ))}
                </div>

                <div className="relative">
                    <label htmlFor={`${id}-note`} className="sr-only">今日小记内容</label>
                    <textarea
                        id={`${id}-note`}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="写下此刻的想法，Enter 发送，Shift+Enter 换行"
                        rows={2}
                        onKeyDown={(e) => {
                            if (!isPlainEnter(e)) return;
                            e.preventDefault();
                            void submit();
                        }}
                        className={`${FIELD_CLASS} resize-none py-3 pr-14 text-sm leading-relaxed`}
                    />
                    <button
                        type="submit"
                        disabled={loading || !content.trim()}
                        aria-label="保存小记"
                        title="保存小记 (Enter)"
                        className="absolute right-2.5 bottom-2.5 flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-on-accent transition-colors hover:bg-accent/90 disabled:bg-background-tertiary disabled:text-foreground-tertiary"
                    >
                        {loading ? <SoundWaveLoader variant="inline" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
                    </button>
                </div>
            </form>

            {notes.length === 0 ? (
                <p className="rounded-[10px] bg-background-secondary px-4 py-5 text-center text-sm text-foreground-tertiary">
                    今天还没有小记，写点什么吧。
                </p>
            ) : (
                <ul className="flex max-h-72 flex-col divide-y-[0.5px] divide-border overflow-y-auto">
                    {notes.map(note => {
                        const moodInfo = NOTE_MOODS.find(m => m.value === note.mood);
                        const time = formatNoteTime(note.created_at);
                        return (
                            <li key={note.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                                {time ? (
                                    <time dateTime={note.created_at} className="w-11 shrink-0 pt-0.5 text-xs text-foreground-tertiary tabular-nums">{time}</time>
                                ) : null}
                                {moodInfo ? (
                                    <span role="img" aria-label={moodInfo.label} title={moodInfo.label} className="shrink-0 text-base leading-6">
                                        {moodInfo.icon}
                                    </span>
                                ) : null}
                                <p className="min-w-0 flex-1 text-sm leading-6 break-words whitespace-pre-wrap text-foreground">{note.content}</p>
                                <button
                                    type="button"
                                    onClick={() => setDeleteNoteId(note.id)}
                                    aria-label="删除小记"
                                    title="删除"
                                    className="-my-1.5 -mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-tertiary transition-colors hover:bg-danger/10 hover:text-danger md:h-8 md:w-8"
                                >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <ConfirmDialog
                isOpen={!!deleteNoteId}
                onClose={() => setDeleteNoteId(null)}
                onConfirm={() => deleteNoteId ? handleDelete(deleteNoteId) : undefined}
                title="确认删除"
                description="确定要删除这条小记吗？此操作无法撤销。"
                confirmText="确认删除"
                variant="danger"
            />
        </div>
    );
}

// =====================================================
// 导入导出模态框
// =====================================================
type PendingImport = { fileName: string; data: ExportData };

export function ImportExportModal({
    userId,
    onClose,
    onImport
}: {
    userId: string | null;
    onClose: () => void;
    onImport: () => void | Promise<void>;
}) {
    const [importing, setImporting] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    // 导入会覆盖全部数据：先读取并校验文件，用户确认后才提交。
    const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
    const id = useId();
    const busy = importing || exporting;

    const handleExport = async () => {
        if (!userId) {
            setError('请先登录后再导出数据');
            return;
        }
        setExporting(true);
        setError('');
        setSuccess('');
        try {
            const data = await exportData();
            downloadExportData(data);
            setSuccess('导出成功，文件已开始下载。');
        } catch (exportError) {
            setError(getErrorMessage(exportError, '导出失败'));
        } finally {
            setExporting(false);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        setError('');
        setSuccess('');
        if (!userId) {
            setError('请先登录后再导入数据');
            return;
        }
        try {
            setPendingImport({ fileName: file.name, data: await readImportFile(file) });
        } catch (readError) {
            setPendingImport(null);
            setError(getErrorMessage(readError, '文件读取失败'));
        }
    };

    const confirmImport = async () => {
        if (!pendingImport) return;
        setImporting(true);
        setError('');
        try {
            const result = await importData(pendingImport.data);
            setPendingImport(null);
            setSuccess(`成功导入 ${result.recordsImported} 条记录和 ${result.notesImported} 条小记`);
            await Promise.resolve(onImport());
        } catch (importError) {
            setError(getErrorMessage(importError, '导入失败'));
        } finally {
            setImporting(false);
        }
    };

    return (
        <Modal open onClose={onClose} busy={busy} labelledBy={`${id}-title`}>
            <DialogHeader titleId={`${id}-title`} title="导入 / 导出" onClose={onClose} closeDisabled={busy} />
            <div className="flex flex-col gap-5 p-5 sm:p-6">
                <FormError message={error} />
                {success ? (
                    <p role="status" className="rounded-[10px] bg-success/10 px-3.5 py-2.5 text-sm text-success">{success}</p>
                ) : null}

                <section aria-labelledby={`${id}-export`} className="flex flex-col gap-2">
                    <h3 id={`${id}-export`} className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Download className="h-4 w-4" aria-hidden="true" />导出数据
                    </h3>
                    <p className="text-sm text-foreground-secondary">把全部记录和小记保存为 JSON 文件。</p>
                    <button type="button" onClick={handleExport} disabled={busy} className={`${SECONDARY_BUTTON_CLASS} self-start`}>
                        {exporting ? '导出中…' : '导出 JSON'}
                    </button>
                </section>

                <section aria-labelledby={`${id}-import`} className="flex flex-col gap-2 border-t-[0.5px] border-border pt-5">
                    <h3 id={`${id}-import`} className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Upload className="h-4 w-4" aria-hidden="true" />导入数据
                    </h3>
                    {pendingImport ? (
                        <div role="alert" className="flex flex-col gap-3 rounded-[10px] border-[0.5px] border-danger/30 bg-danger/5 p-3.5">
                            <p className="text-sm text-foreground">
                                将用「{pendingImport.fileName}」中的 {pendingImport.data.records.length} 条记录和 {pendingImport.data.notes.length} 条小记
                                <strong className="font-medium text-danger">替换现有的全部记录和小记</strong>，此操作无法撤销。
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => { void confirmImport(); }}
                                    disabled={importing}
                                    className="inline-flex h-10 items-center justify-center rounded-[10px] bg-danger px-4 text-sm font-medium text-white transition-colors hover:bg-danger/90 disabled:opacity-50"
                                >
                                    {importing ? '导入中…' : '确认覆盖导入'}
                                </button>
                                <button type="button" onClick={() => setPendingImport(null)} disabled={importing} className={SECONDARY_BUTTON_CLASS}>
                                    取消
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <p className="text-sm text-foreground-secondary">从导出的 JSON 文件恢复。导入会覆盖现有的全部记录和小记，确认前会再次提示。</p>
                            <label className={`${SECONDARY_BUTTON_CLASS} cursor-pointer self-start focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent`}>
                                选择 JSON 文件
                                <input
                                    type="file"
                                    accept=".json,application/json"
                                    onChange={(e) => { void handleFileChange(e); }}
                                    disabled={busy}
                                    className="sr-only"
                                />
                            </label>
                        </>
                    )}
                </section>
            </div>
        </Modal>
    );
}
