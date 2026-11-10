'use client';

/**
 * 全部记录：按日期排开的编年时间线。将来的日子虚线在上，今天之后往下按年、日排开；
 * 同一天的小记折成一行。置顶记录在时间线上方单独一条。
 */
import { useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, FileText, Pin, SearchX } from 'lucide-react';
import type { DatePillars } from '@/lib/divination/calendar';
import {
    getMonthDayLabel,
    getPredictionStatus,
    getRecordCategory,
    getRecordCategoryLabel,
    getRecordDateKey,
    getPlainTags,
    NOTE_MOOD_ICONS,
    getWeekdayLabel,
    isDateKey,
    type MingNote,
    type MingRecord,
    type PredictionVerdict,
    type RecordCategory,
} from '@/lib/records';
import { useListMotion } from '@/lib/motion/list';
import { AgentIcon } from '@/lib/navigation/nav-icons';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { StatePanel, STATE_PRIMARY_ACTION_CLASS, STATE_SECONDARY_ACTION_CLASS } from '@/components/ui/StatePanel';
import { cn } from '@/lib/utils';
import { GanZhi, RecordMenu, StatusPill, VerdictButtons } from './RecordDisplay';
import { RecordNoteList } from './RecordDetail';

const NODE_CLASS: Record<RecordCategory | 'note', string> = {
    prediction: 'h-[11px] w-[11px] left-[-5px] border-2 border-accent bg-background',
    event: 'h-[9px] w-[9px] left-[-4px] bg-foreground',
    reflection: 'h-[9px] w-[9px] left-[-4px] border-[1.5px] border-foreground bg-background',
    general: 'h-[7px] w-[7px] left-[-3px] bg-foreground-tertiary',
    note: 'h-[5px] w-[5px] left-[-2px] bg-border-hover',
};
const NODE_RANK: (RecordCategory | 'note')[] = ['prediction', 'event', 'reflection', 'general', 'note'];

type TimelineRecordActions = {
    onOpen: (record: MingRecord) => void;
    onEdit: (record: MingRecord) => void;
    onDelete: (record: MingRecord) => void;
    onTogglePin: (record: MingRecord) => void;
    onAddToKnowledgeBase: (record: MingRecord) => void;
    onVerdict: (record: MingRecord, verdict: PredictionVerdict) => void;
    onTag: (tag: string) => void;
    onDeleteNote: (note: MingNote) => void;
    showKnowledgeBase: boolean;
};

type DayRow = { kind: 'day'; key: string; dayKey: string | null; label?: string; records: MingRecord[]; notes: MingNote[]; future: boolean };
type YearRow = { kind: 'year'; key: string; year: string; count: number; future: boolean };
type LeadRow = { kind: 'lead'; key: string; label: string; count: number };
type Row = DayRow | YearRow | LeadRow;

function nodeOf(day: DayRow): RecordCategory | 'note' {
    const kinds = new Set<RecordCategory | 'note'>(day.records.map(getRecordCategory));
    if (day.notes.length) kinds.add('note');
    return NODE_RANK.find(kind => kinds.has(kind)) ?? 'note';
}

function RailRow({ date, children, dashed, node, className }: { date: React.ReactNode; children: React.ReactNode; dashed?: boolean; node?: React.ReactNode; className?: string }) {
    return (
        <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 md:grid-cols-[4.25rem_minmax(0,1fr)] md:gap-x-3">
            <div className="pt-px text-right">{date}</div>
            <div className={cn('relative flex flex-col gap-2.5 border-l pb-4 pl-4 md:pl-5', dashed ? 'border-dashed border-border-hover' : 'border-border', className)}>
                {node}
                {children}
            </div>
        </div>
    );
}

function TimelineRecord({ record, todayKey, actions }: { record: MingRecord; todayKey: string; actions: TimelineRecordActions }) {
    const status = getPredictionStatus(record, todayKey);
    const tags = getPlainTags(record);
    return (
        <div className="group relative pr-8">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <h3 className="min-w-0 text-[14px] leading-snug font-medium text-foreground">
                    <Button unstyled onClick={() => actions.onOpen(record)}
                        className="text-left decoration-border-hover underline-offset-4 after:absolute after:inset-0 hover:underline">
                        {record.title}
                    </Button>
                </h3>
                {record.is_pinned ? <Pin className="h-3 w-3 text-accent" aria-label="已置顶" /> : null}
                <span className="text-[11.5px] text-foreground-tertiary">{getRecordCategoryLabel(record)}</span>
                {status ? <StatusPill status={status} className="h-5" /> : null}
                {record.source_run_id ? <span role="img" aria-label="Agent 记录" title="Agent 记录" className="inline-flex"><AgentIcon size={12} /></span> : null}
                {status?.kind === 'due' ? <div className="relative z-10 ml-auto shrink-0"><VerdictButtons record={record} onVerdict={actions.onVerdict} size="xs" /></div> : null}
                <div className="absolute -top-1 right-0 z-10 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:has-[[data-popup-open]]:opacity-100">
                    <RecordMenu record={record} onTogglePin={actions.onTogglePin} onEdit={actions.onEdit}
                        onAddToKnowledgeBase={actions.onAddToKnowledgeBase} onDelete={actions.onDelete} showKnowledgeBase={actions.showKnowledgeBase} />
                </div>
            </div>
            {record.content ? <p className="mt-0.5 line-clamp-1 text-[12.5px] leading-relaxed text-foreground-secondary">{record.content}</p> : null}
            {tags.length ? (
                <div className="relative z-10 mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-foreground-tertiary">
                    {tags.map(tag => <Button key={tag} unstyled onClick={() => actions.onTag(tag)} className="hover:text-foreground">#{tag}</Button>)}
                </div>
            ) : null}
        </div>
    );
}

function FoldedNotes({ notes, onDelete }: { notes: MingNote[]; onDelete: (note: MingNote) => void }) {
    const moods = notes.map(note => note.mood ? NOTE_MOOD_ICONS[note.mood] : '·').join('');
    return (
        <details className="group/notes -my-1">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-1 text-[13px] text-foreground-tertiary hover:text-foreground-secondary [&::-webkit-details-marker]:hidden">
                <span className="shrink-0">小记</span>
                <span className="shrink-0" aria-hidden="true">{moods}</span>
                <span className="min-w-0 truncate group-open/notes:hidden">{notes[0].content}</span>
                {notes.length > 1 ? <span className="shrink-0 group-open/notes:hidden">+{notes.length - 1}</span> : null}
            </summary>
            <div className="pt-1"><RecordNoteList notes={notes} onDelete={onDelete} /></div>
        </details>
    );
}

function DayRowView({ row, todayKey, pillarsOf, actions }: { row: DayRow; todayKey: string; pillarsOf: (key: string | null | undefined) => DatePillars | null; actions: TimelineRecordActions }) {
    const kind = nodeOf(row);
    const isToday = row.dayKey === todayKey;
    const datePillars = row.dayKey ? pillarsOf(row.dayKey) : null;
    const date = row.label ? (
        <span className="text-[13px] leading-5 text-foreground-tertiary">{row.label}</span>
    ) : isToday ? (
        <>
            <span className="block font-display text-[12px] leading-5 text-accent">今天</span>
            <span className="block text-[10.5px] leading-4 text-foreground-tertiary">{getWeekdayLabel(row.dayKey!)}</span>
        </>
    ) : row.dayKey ? (
        <>
            <span className="block text-[12.5px] leading-5 text-foreground tabular-nums">
                <span className="md:hidden">{getMonthDayLabel(row.dayKey).replace('月', '/').replace('日', '')}</span>
                <span className="hidden md:inline">{getMonthDayLabel(row.dayKey)}</span>
            </span>
            <span className="block text-[10.5px] leading-4 text-foreground-tertiary">
                {getWeekdayLabel(row.dayKey)}{datePillars ? <span className="hidden md:inline"> · <GanZhi value={datePillars.day} /></span> : null}
            </span>
        </>
    ) : null;
    return (
        <RailRow dashed={row.future} date={date}
            node={<span aria-hidden="true" className={cn('absolute top-[6px] rounded-full', NODE_CLASS[kind])} />}>
            {row.records.map(record => <TimelineRecord key={record.id} record={record} todayKey={todayKey} actions={actions} />)}
            {row.notes.length ? <FoldedNotes notes={row.notes} onDelete={actions.onDeleteNote} /> : null}
        </RailRow>
    );
}

function YearRowView({ row, pillarsOf, paged }: { row: YearRow; pillarsOf: (key: string | null | undefined) => DatePillars | null; paged: boolean }) {
    const pillars = pillarsOf(`${row.year}-06-01`);
    return (
        <RailRow dashed={row.future} className="pb-3" date={<span className="font-display text-[1.25rem] leading-none text-foreground tabular-nums">{row.year}</span>}>
            <span className="pt-0.5 text-[13px] text-foreground-tertiary">{pillars ? `${pillars.year}年 · ` : ''}{paged ? '本页 ' : ''}{row.count} 条</span>
        </RailRow>
    );
}

function buildRows(records: MingRecord[], notesByDay: Map<string, MingNote[]>, showNotes: boolean, todayKey: string): Row[] {
    const undated = records.filter(record => getRecordCategory(record) === 'prediction' && !isDateKey(record.event_date));
    const byDay = new Map<string, MingRecord[]>();
    for (const record of records) {
        if (undated.includes(record)) continue;
        const key = getRecordDateKey(record);
        byDay.set(key, [...(byDay.get(key) ?? []), record]);
    }
    if (showNotes) {
        for (const key of notesByDay.keys()) {
            if (!byDay.has(key) && key <= todayKey && key !== todayKey) byDay.set(key, []);
        }
    }
    const dayRows: DayRow[] = [...byDay.entries()].map(([key, dayRecords]): DayRow => ({
        kind: 'day', key: `day-${key}`, dayKey: key,
        // 今天的小记就在上方的今日卡里，时间线上不再重复。
        records: dayRecords, notes: showNotes && key !== todayKey ? notesByDay.get(key) ?? [] : [],
        future: key > todayKey,
    })).sort((a, b) => (b.dayKey ?? '').localeCompare(a.dayKey ?? ''));
    const future = dayRows.filter(row => row.future);
    const past = dayRows.filter(row => !row.future && row.dayKey !== todayKey);
    const today = dayRows.find(row => row.dayKey === todayKey);
    const undatedIds = new Set(undated.map(record => record.id));
    const countInYear = (year: string) => records.filter(record => !undatedIds.has(record.id) && getRecordDateKey(record).startsWith(year)).length;

    const rows: Row[] = [];
    const pushWithYears = (days: DayRow[], dashed: boolean) => {
        let lastYear = todayKey.slice(0, 4);
        for (const day of days) {
            const year = day.dayKey!.slice(0, 4);
            if (year !== lastYear) {
                rows.push({ kind: 'year', key: `year-${dashed ? 'future-' : ''}${year}`, year, count: countInYear(year), future: dashed });
                lastYear = year;
            }
            rows.push(day);
        }
    };
    if (future.length) {
        rows.push({ kind: 'lead', key: 'lead-future', label: '将来', count: future.reduce((sum, day) => sum + day.records.length, 0) });
        pushWithYears(future, true);
    }
    if (undated.length) {
        rows.push({ kind: 'day', key: 'day-undated', dayKey: null, label: '未定日', records: undated, notes: [], future: true });
    }
    if (today) rows.push(today);
    pushWithYears(past, false);
    return rows;
}

function PinnedStrip({ records, actions }: { records: MingRecord[]; actions: TimelineRecordActions }) {
    return (
        <section aria-label="置顶" className="-mx-4 flex items-center gap-2 overflow-x-auto border-y-[0.5px] border-border bg-background-secondary px-3 py-1.5 md:mx-0 md:rounded-lg md:border">
            <span className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-background-secondary pr-1 text-[11.5px] text-accent">
                <Pin className="h-3 w-3" aria-hidden="true" />置顶
            </span>
            <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
            <div className="flex min-w-0 items-center gap-3">
                {records.map((record, index) => (
                    <span key={record.id} className="flex shrink-0 items-center gap-3">
                        {index > 0 ? <span aria-hidden="true" className="text-border-hover">·</span> : null}
                        <Button unstyled onClick={() => actions.onOpen(record)}
                            className="max-w-[18rem] truncate text-[13px] font-medium text-foreground decoration-border-hover underline-offset-4 hover:underline">
                            {record.title}
                        </Button>
                    </span>
                ))}
            </div>
        </section>
    );
}

export function RecordsTimeline({
    records, notesByDay, showNotes, todayKey, pillarsOf,
    loading, page, totalPages, onPageChange,
    filtered, onClearFilters, onCreateNew,
    actions,
}: {
    records: MingRecord[];
    notesByDay: Map<string, MingNote[]>;
    /** 有筛选时不把往日小记混进结果。 */
    showNotes: boolean;
    todayKey: string;
    pillarsOf: (key: string | null | undefined) => DatePillars | null;
    loading: boolean;
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    filtered: boolean;
    onClearFilters: () => void;
    onCreateNew: () => void;
    actions: TimelineRecordActions;
}) {
    const rows = useMemo(() => buildRows(records, notesByDay, showNotes, todayKey), [records, notesByDay, showNotes, todayKey]);
    const listRef = useRef<HTMLOListElement>(null);
    const motionRows = useListMotion(listRef, rows, row => row.key);
    const pinned = records.filter(record => record.is_pinned);

    const pagination = totalPages > 1 ? (
        <nav aria-label="分页" className="mt-2 flex items-center justify-center gap-3">
            <IconButton label="上一页" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1}>
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </IconButton>
            <span className="min-w-14 text-center text-sm text-foreground-secondary tabular-nums">{page} / {totalPages}</span>
            <IconButton label="下一页" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </IconButton>
        </nav>
    ) : null;

    if (loading) {
        return (
            <div className="rounded-2xl border-[0.5px] border-border bg-surface p-6">
                <SoundWaveLoader variant="block" text="加载记录中" />
            </div>
        );
    }

    // 只有过去几天的小记、没有记录时，时间线仍要显示这些小记。
    if (!rows.length) {
        const pageEmptied = totalPages > 1;
        return (
            <>
                {pageEmptied ? (
                    <StatePanel icon={FileText} title="这一页已经空了" description="可以切换到上一页继续查看。" />
                ) : filtered ? (
                    <StatePanel
                        icon={SearchX}
                        title="没有符合条件的记录"
                        description="换个关键词或分类，或清除筛选查看全部。"
                        action={<Button unstyled type="button" onClick={onClearFilters} className={STATE_SECONDARY_ACTION_CLASS}>清除筛选</Button>}
                    />
                ) : (
                    <StatePanel
                        icon={FileText}
                        title="还没有记录"
                        description="记下第一条断语或感悟，日后对照印证。"
                        action={<Button unstyled type="button" onClick={onCreateNew} className={STATE_PRIMARY_ACTION_CLASS}>新建记录</Button>}
                    />
                )}
                {pagination}
            </>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {pinned.length ? <PinnedStrip records={pinned} actions={actions} /> : null}
            <ol ref={listRef} aria-label="时间线" className="flex flex-col">
                {motionRows.map(({ key, item: row }) => (
                    <li key={key} data-motion-key={key}>
                        {row.kind === 'year' ? <YearRowView row={row} pillarsOf={pillarsOf} paged={totalPages > 1} /> : row.kind === 'lead' ? (
                            <RailRow dashed date={<span className="text-[13px] leading-5 text-foreground-tertiary">{row.label}</span>}>
                                <span className="pt-px text-[13px] text-foreground-tertiary">{totalPages > 1 ? '本页 ' : ''}{row.count} 条</span>
                            </RailRow>
                        ) : <DayRowView row={row} todayKey={todayKey} pillarsOf={pillarsOf} actions={actions} />}
                    </li>
                ))}
            </ol>
            {pagination}
        </div>
    );
}
