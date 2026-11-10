/**
 * 记录详情相关组件：表单模态框、今日小记卡、小记行与导入导出
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState / useId)
 * - 有表单交互和文件上传
 */
'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUp, ChevronDown, Download, Trash2, Upload, X } from 'lucide-react';
import {
    createRecord,
    downloadExportData,
    exportData,
    groupNotesByDay,
    importData,
    MingRecord,
    MingNote,
    NoteMood,
    NOTE_MOOD_ICONS,
    NOTE_MOOD_LABELS,
    NOTE_MOODS,
    RecordCategory,
    RECORD_CATEGORIES,
    readImportFile,
    toLocalDateKey,
    updateRecord,
    getMonthDayLabel,
    getNoteTimeLabel,
    getRecordDateLabel,
    getWeekdayChar,
    getWeekdayLabel,
    parseDateKey,
    shiftDateKey,
    type ExportData,
} from '@/lib/records';
import type { DatePillars } from '@/lib/divination/calendar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { IconButton } from '@/components/ui/IconButton';
import { Dialog } from '@/components/ui/Dialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { FilterChip } from '@/components/ui/FilterChip';
import { GanZhi, PillarColumns } from './RecordDisplay';
import { cn } from '@/lib/utils';

const FIELD_CLASS = 'w-full rounded-xl border-[0.5px] border-border-hover bg-surface px-3.5 text-[15px] text-foreground placeholder:text-foreground-tertiary focus:border-accent focus:outline-none';
const LABEL_CLASS = 'mb-1.5 block text-sm text-foreground-secondary';
const SECONDARY_BUTTON_CLASS = 'inline-flex h-10 items-center justify-center rounded-xl border-[0.5px] border-border-hover bg-surface px-5 text-sm text-foreground transition-colors hover:bg-background-secondary disabled:opacity-50';

export function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** 中文输入法选词时的回车不算提交。 */
function isPlainEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}

export function FormError({ message }: { message: string }) {
    if (!message) return null;
    return (
        <div role="alert" className="rounded-xl border-[0.5px] border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
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
            <IconButton
                label="关闭"
                onClick={onClose}
                disabled={closeDisabled}
                className="-mt-1 -mr-2 text-foreground-tertiary"
            >
                <X className="h-[18px] w-[18px]" aria-hidden="true" />
            </IconButton>
        </div>
    );
}

// =====================================================
// 记录表单模态框
// =====================================================
export function RecordFormModal({
    userId,
    record,
    pillarsOf,
    onClose,
    onSave
}: {
    userId: string | null;
    record?: MingRecord | null;
    /** 日期下方显示干支；模块未加载时退回空。 */
    pillarsOf?: (key: string | null | undefined) => DatePillars | null;
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
    const dateLabel = getRecordDateLabel({ category });
    const datePillars = pillarsOf?.(eventDate) ?? null;

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
        <Dialog bare open onClose={onClose} busy={loading} labelledBy={`${id}-title`} initialFocusRef={titleInputRef} className="max-w-lg">
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
                    <Input
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
                            <FilterChip key={cat.value} pressed={category === cat.value} onClick={() => setCategory(cat.value)}>
                                {cat.label}
                            </FilterChip>
                        ))}
                    </div>
                </fieldset>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label htmlFor={`${id}-event-date`} className={LABEL_CLASS}>{dateLabel}</label>
                        <Input
                            id={`${id}-event-date`}
                            type="date"
                            value={eventDate}
                            onChange={(e) => setEventDate(e.target.value)}
                            aria-describedby={datePillars ? `${id}-event-date-pillars` : undefined}
                            className={`${FIELD_CLASS} h-11`}
                        />
                        {datePillars ? (
                            <p id={`${id}-event-date-pillars`} className="mt-1 text-xs text-foreground-tertiary">
                                <GanZhi value={datePillars.year} />年 <GanZhi value={datePillars.month} />月 <GanZhi value={datePillars.day} />日 · 农历{datePillars.lunarMonthDay}
                            </p>
                        ) : null}
                    </div>
                    <div>
                        <label htmlFor={`${id}-tags`} className={LABEL_CLASS}>标签</label>
                        <Input
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
                    <Textarea
                        id={`${id}-content`}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={6}
                        className={`${FIELD_CLASS} resize-y py-3 leading-relaxed`}
                        placeholder="断语、排盘结果、实际应验或心得体会"
                    />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="secondary" size="lg" onClick={onClose} disabled={loading}>取消</Button>
                    <Button type="submit" size="lg" loading={loading} loadingText="保存中…" disabled={loading}>保存记录</Button>
                </div>
            </form>
        </Dialog>
    );
}

// =====================================================
// 小记
// =====================================================

/** 小记行：时间、心情、正文；删除按钮在桌面端悬停才出现。 */
export function RecordNoteList({ notes, onDelete, empty }: {
    notes: MingNote[];
    onDelete: (note: MingNote) => void;
    empty?: ReactNode;
}) {
    if (!notes.length) return empty ? <>{empty}</> : null;
    return (
        <ul className="flex flex-col">
            {notes.map(note => {
                const time = getNoteTimeLabel(note);
                return (
                    <li key={note.id} className="group flex items-start gap-3 rounded-lg py-1.5">
                        <time dateTime={note.created_at} className="w-10 shrink-0 pt-px text-xs leading-6 text-foreground-tertiary tabular-nums">{time}</time>
                        {note.mood ? (
                            <span role="img" aria-label={NOTE_MOOD_LABELS[note.mood]} title={NOTE_MOOD_LABELS[note.mood]} className="shrink-0 text-[15px] leading-6">
                                {NOTE_MOOD_ICONS[note.mood]}
                            </span>
                        ) : null}
                        <p className="min-w-0 flex-1 text-[15px] leading-6 break-words whitespace-pre-wrap text-foreground">{note.content}</p>
                        <IconButton label="删除小记" title="删除" size="sm" expand="none"
                            onClick={() => onDelete(note)}
                            className="-my-0.5 shrink-0 text-foreground-tertiary opacity-100 transition-opacity hover:bg-fill-ghost-hover hover:text-danger md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                        >
                            <Trash2 aria-hidden="true" />
                        </IconButton>
                    </li>
                );
            })}
        </ul>
    );
}

/** 一格一天：星期、日期、当天最近一条小记的心情；点选看那天的往日小记。 */
function DayCells({ days, notesByDay, todayKey, selected, onSelect }: {
    days: string[];
    notesByDay: Map<string, MingNote[]>;
    todayKey: string;
    selected: string;
    onSelect: (key: string) => void;
}) {
    return (
        <div role="group" aria-label="往日小记" className="grid grid-cols-7 gap-1">
            {days.map(key => {
                const dayNotes = notesByDay.get(key) ?? [];
                const mood = dayNotes[0]?.mood;
                const isToday = key === todayKey;
                return (
                    <Button key={key} unstyled aria-pressed={key === selected}
                        aria-label={`${getMonthDayLabel(key)} ${getWeekdayLabel(key)}，${dayNotes.length ? `${dayNotes.length} 条小记` : '没有小记'}`}
                        onClick={() => onSelect(key)}
                        className="flex flex-col items-center gap-1 rounded-xl py-2 transition-colors hover:bg-fill-ghost-hover aria-pressed:bg-fill-ghost-selected"
                    >
                        <span className="text-[11px] leading-none text-foreground-tertiary">{isToday ? '今天' : getWeekdayChar(key)}</span>
                        <span className={cn('text-[13px] leading-none tabular-nums', isToday ? 'font-medium text-accent' : 'text-foreground-secondary')}>{parseDateKey(key).getDate()}</span>
                        <span className="flex h-5 items-center text-[15px] leading-none" aria-hidden="true">
                            {mood ? NOTE_MOOD_ICONS[mood] : <span className={cn('rounded-full', dayNotes.length ? 'h-1.5 w-1.5 bg-foreground-tertiary' : 'h-1 w-1 bg-border-hover')} />}
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}

/**
 * 今日卡：大号日期、农历与三柱；心情下拉的小记输入框；当天小记；底部近 7 天的心情条。
 * 往日只读，选中的那天同样列在卡里。
 */
export function DailyNotes({
    notes,
    todayKey,
    loading,
    pillarsOf,
    onAddNote,
    onDeleteNote,
}: {
    notes: MingNote[];
    todayKey: string;
    loading: boolean;
    pillarsOf: (key: string | null | undefined) => DatePillars | null;
    /** 写成功返回 true，输入框才清空。 */
    onAddNote: (content: string, mood: NoteMood) => Promise<boolean>;
    onDeleteNote: (note: MingNote) => void;
}) {
    const [content, setContent] = useState('');
    const [mood, setMood] = useState<NoteMood>('neutral');
    const [saving, setSaving] = useState(false);
    const [selected, setSelected] = useState(todayKey);
    const id = useId();
    const notesByDay = useMemo(() => groupNotesByDay(notes), [notes]);
    const week = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftDateKey(todayKey, index - 6)), [todayKey]);
    const today = parseDateKey(todayKey);
    const pillars = pillarsOf(todayKey);
    const isToday = selected === todayKey;
    const selectedPillars = pillarsOf(selected);
    const dayNotes = notesByDay.get(selected) ?? [];

    const submit = async () => {
        const text = content.trim();
        if (!text || saving) return;
        setSaving(true);
        const saved = await onAddNote(text, mood);
        setSaving(false);
        if (saved) {
            setContent('');
            setSelected(todayKey);
        }
    };

    return (
        <section aria-label="今日" className="overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface">
            <div className="flex items-start justify-between gap-4 px-5 pt-5 md:px-6 md:pt-6">
                <div className="flex items-end gap-3.5">
                    <span className="font-display text-[3.5rem] leading-[0.82] text-foreground tabular-nums">{today.getDate()}</span>
                    <div className="flex flex-col gap-1">
                        <span className="text-[15px] leading-none text-foreground">{today.getMonth() + 1}月 · {getWeekdayLabel(todayKey)}</span>
                        <span className="text-[13px] leading-none text-foreground-tertiary">{pillars ? `农历${pillars.lunarMonthDay}` : ' '}</span>
                    </div>
                </div>
                {pillars ? <PillarColumns pillars={pillars} /> : <div className="h-[4.25rem]" aria-hidden="true" />}
            </div>

            <div className="px-5 pt-5 pb-3 md:px-6">
                {isToday ? (
                    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}
                        className="flex items-end gap-1 rounded-xl border-[0.5px] border-border-hover bg-surface p-1 transition-colors focus-within:border-foreground-tertiary">
                        <Menu>
                            <MenuTrigger aria-label={`心情：${NOTE_MOOD_LABELS[mood]}`} title="心情"
                                className="flex h-9 shrink-0 items-center gap-0.5 rounded-lg pr-1 pl-2 text-[17px] leading-none transition-colors hover:bg-fill-ghost-hover data-popup-open:bg-fill-ghost-hover">
                                <span aria-hidden="true">{NOTE_MOOD_ICONS[mood]}</span>
                                <ChevronDown className="h-3.5 w-3.5 text-foreground-tertiary" aria-hidden="true" />
                            </MenuTrigger>
                            <MenuContent className="w-36">
                                <MenuRadioGroup value={mood} onValueChange={(value) => setMood(value as NoteMood)}>
                                    {NOTE_MOODS.map(item => (
                                        <MenuRadioItem key={item.value} value={item.value}>
                                            <span aria-hidden="true" className="text-base">{item.icon}</span>{item.label}
                                        </MenuRadioItem>
                                    ))}
                                </MenuRadioGroup>
                            </MenuContent>
                        </Menu>
                        <label className="sr-only" htmlFor={`${id}-note`}>今日小记内容</label>
                        <Textarea id={`${id}-note`} value={content} rows={1}
                            onChange={(event) => setContent(event.target.value)}
                            onKeyDown={(event) => {
                                if (!isPlainEnter(event)) return;
                                event.preventDefault();
                                void submit();
                            }}
                            placeholder="此刻在想什么？"
                            className="max-h-40 min-h-9 min-w-0 flex-1 resize-none rounded-lg border-0 bg-transparent px-1.5 py-[7px] text-[15px] leading-[22px] [field-sizing:content] focus-visible:outline-none" />
                        <Button unstyled type="submit" aria-label="保存小记" title="保存小记 (Enter)" disabled={saving || !content.trim()}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:bg-transparent disabled:text-foreground-tertiary">
                            {saving ? <SoundWaveLoader variant="inline" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
                        </Button>
                    </form>
                ) : (
                    <div className="flex min-h-11 items-center justify-between gap-3">
                        <p className="text-sm text-foreground">
                            {getMonthDayLabel(selected)} {getWeekdayLabel(selected)}
                            {selectedPillars ? <span className="ml-2 text-[13px] text-foreground-tertiary">{selectedPillars.year}年 {selectedPillars.month}月 {selectedPillars.day}日</span> : null}
                        </p>
                        <Button variant="ghost" size="xs" onClick={() => setSelected(todayKey)} className="shrink-0 text-[13px] text-accent hover:text-accent-strong">回到今天</Button>
                    </div>
                )}
                {loading ? (
                    <div className="py-4"><SoundWaveLoader variant="inline" text="加载小记中" /></div>
                ) : (
                    <RecordNoteList notes={dayNotes} onDelete={onDeleteNote}
                        empty={<p className="py-2 text-[13px] text-foreground-tertiary">{isToday ? '今天还没有小记，写点什么吧。' : '这天没有小记。'}</p>} />
                )}
            </div>

            <div className="border-t-[0.5px] border-border px-2 py-1.5 md:px-3">
                <DayCells days={week} notesByDay={notesByDay} todayKey={todayKey} selected={selected} onSelect={setSelected} />
            </div>
        </section>
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
        <Dialog bare open onClose={onClose} busy={busy} labelledBy={`${id}-title`}>
            <DialogHeader titleId={`${id}-title`} title="导入 / 导出" onClose={onClose} closeDisabled={busy} />
            <div className="flex flex-col gap-5 p-5 sm:p-6">
                <FormError message={error} />
                {success ? (
                    <p role="status" className="rounded-xl bg-success/10 px-3.5 py-2.5 text-sm text-success">{success}</p>
                ) : null}

                <section aria-labelledby={`${id}-export`} className="flex flex-col gap-2">
                    <h3 id={`${id}-export`} className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Download className="h-4 w-4" aria-hidden="true" />导出数据
                    </h3>
                    <p className="text-sm text-foreground-secondary">把全部记录和小记保存为 JSON 文件。</p>
                    <Button variant="secondary" size="lg" className="self-start" onClick={handleExport} loading={exporting} loadingText="导出中…" disabled={busy}>
                        导出 JSON
                    </Button>
                </section>

                <section aria-labelledby={`${id}-import`} className="flex flex-col gap-2 border-t-[0.5px] border-border pt-5">
                    <h3 id={`${id}-import`} className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Upload className="h-4 w-4" aria-hidden="true" />导入数据
                    </h3>
                    {pendingImport ? (
                        <div role="alert" className="flex flex-col gap-3 rounded-xl border-[0.5px] border-danger/30 bg-danger/5 p-3.5">
                            <p className="text-sm text-foreground">
                                将用「{pendingImport.fileName}」中的 {pendingImport.data.records.length} 条记录和 {pendingImport.data.notes.length} 条小记
                                <strong className="font-medium text-danger">替换现有的全部记录和小记</strong>，此操作无法撤销。
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="danger"
                                    size="lg"
                                    onClick={() => { void confirmImport(); }}
                                    loading={importing}
                                    loadingText="导入中…"
                                    disabled={importing}
                                >
                                    确认覆盖导入
                                </Button>
                                <Button variant="secondary" size="lg" onClick={() => setPendingImport(null)} disabled={importing}>
                                    取消
                                </Button>
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
        </Dialog>
    );
}
