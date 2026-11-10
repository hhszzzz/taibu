'use client';

/**
 * 记录详情弹窗：全文、日期与干支、可点的标签、到期预测的印证按钮、关联资料与 Agent 来源。
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Link2, Pin, X } from 'lucide-react';
import {
    getPlainTags,
    getPredictionStatus,
    getRecordCategoryLabel,
    getRecordDateLabel,
    getShortDateLabel,
    getWeekdayLabel,
    isDateKey,
    toLocalDateKey,
    type MingRecord,
    type PredictionVerdict,
} from '@/lib/records';
import type { DatePillars } from '@/lib/divination/calendar';
import type { HistoryType } from '@/lib/history/registry';
import { applyHistoryRestorePayload, loadHistoryRestore } from '@/lib/history/client';
import { AGENT_ARCHIVE_CHART_LABELS } from '@/lib/agent/archive';
import { getSavedChartHref } from '@/lib/agent/chart-save';
import { AgentIcon } from '@/lib/navigation/nav-icons';
import { conversationHref } from '@/lib/chat/conversation-href';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { useToast } from '@/components/ui/Toast';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { cn } from '@/lib/utils';
import { GanZhi, RecordMenu, StatusPill, VerdictButtons } from './RecordDisplay';

/** 关联资料里非八字/紫微的占术：按历史恢复打开结果页。 */
const HISTORY_CHART_TYPES: Record<string, HistoryType> = {
    tarot_reading: 'tarot',
    liuyao_divination: 'liuyao',
    mbti_reading: 'mbti',
    hepan_chart: 'hepan',
    palm_reading: 'palm',
    face_reading: 'face',
    qimen_chart: 'qimen',
    daliuren_divination: 'daliuren',
    meihua_divination: 'meihua',
    xiaoliuren_divination: 'xiaoliuren',
};

function LinkedRow({ label, value, href, onClick, busy, staticRow }: {
    label: string;
    value: ReactNode;
    href?: string | null;
    onClick?: () => void;
    busy?: boolean;
    staticRow?: boolean;
}) {
    const body = (
        <>
            <span className="w-16 shrink-0 text-foreground-tertiary">{label}</span>
            <span className="min-w-0 flex-1 truncate text-foreground">{value}</span>
            {staticRow ? null : busy ? <SoundWaveLoader variant="inline" /> : <ChevronRight className="h-4 w-4 shrink-0 text-foreground-tertiary" aria-hidden="true" />}
        </>
    );
    const rowClass = 'flex h-11 w-full items-center gap-3 px-3.5 text-left text-sm transition-colors';
    if (staticRow) return <div className={rowClass}>{body}</div>;
    return href
        ? <Link href={href} className={cn(rowClass, 'hover:bg-fill-ghost-hover')}>{body}</Link>
        : <Button unstyled className={cn(rowClass, 'hover:bg-fill-ghost-hover')} disabled={busy} onClick={onClick}>{body}</Button>;
}

export function RecordViewDialog({
    record, todayKey, pillarsOf, onClose, onTag, onEdit, onTogglePin, onAddToKnowledgeBase, onDelete, onVerdict, onClearVerdict, showKnowledgeBase,
}: {
    record: MingRecord;
    todayKey: string;
    pillarsOf: (key: string | null | undefined) => DatePillars | null;
    onClose: () => void;
    onTag: (tag: string) => void;
    onEdit: (record: MingRecord) => void;
    onTogglePin: (record: MingRecord) => void;
    onAddToKnowledgeBase: (record: MingRecord) => void;
    onDelete: (record: MingRecord) => void;
    onVerdict: (record: MingRecord, verdict: PredictionVerdict) => void;
    onClearVerdict: (record: MingRecord) => void;
    showKnowledgeBase: boolean;
}) {
    const id = useId();
    const router = useRouter();
    const { showToast } = useToast();
    const [relatedBusy, setRelatedBusy] = useState(false);
    const closeRef = useRef<HTMLButtonElement>(null);
    const status = getPredictionStatus(record, todayKey);
    const tags = getPlainTags(record);
    const datePillars = isDateKey(record.event_date) ? pillarsOf(record.event_date) : null;
    const created = new Date(record.created_at);
    const updated = new Date(record.updated_at);
    const edited = updated.getTime() - created.getTime() > 60_000;
    const createdAtKey = toLocalDateKey(created);
    const updatedAtKey = toLocalDateKey(updated);
    const chartLabel = record.related_chart_type
        ? AGENT_ARCHIVE_CHART_LABELS[record.related_chart_type as keyof typeof AGENT_ARCHIVE_CHART_LABELS] ?? '关联资料'
        : null;
    const historyType = record.related_chart_type ? HISTORY_CHART_TYPES[record.related_chart_type] : undefined;

    const openRelated = async () => {
        if (!record.related_chart_id || !historyType || relatedBusy) return;
        setRelatedBusy(true);
        try {
            const payload = await loadHistoryRestore(historyType, record.related_chart_id);
            if (!payload) {
                showToast('error', '找不到这份资料，可能已被删除');
                return;
            }
            router.push(applyHistoryRestorePayload(payload));
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : '打开关联资料失败');
        } finally {
            setRelatedBusy(false);
        }
    };

    return (
        <Dialog bare open onClose={onClose} labelledBy={`${id}-title`} initialFocusRef={closeRef} className="dialog-lg dialog-sheet max-h-[min(88dvh,52rem)] overflow-y-auto">
            <div className="p-5 sm:p-7">
                <article className="flex flex-col gap-5">
                    <header className="flex flex-col gap-2.5">
                        <div className="flex items-start justify-between gap-3">
                            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1 text-[13px] text-foreground-tertiary">
                                {record.is_pinned ? <Pin className="h-3.5 w-3.5 text-accent" aria-label="已置顶" /> : null}
                                <span className="text-foreground-secondary">{getRecordCategoryLabel(record)}</span>
                                {isDateKey(record.event_date) ? (
                                    <>
                                        <span aria-hidden="true">·</span>
                                        <span>{getRecordDateLabel(record)} {getShortDateLabel(record.event_date, todayKey)} {getWeekdayLabel(record.event_date)}</span>
                                    </>
                                ) : null}
                            </p>
                            <div className="-mt-1.5 -mr-2 flex shrink-0 items-center gap-0.5">
                                <RecordMenu record={record} onTogglePin={onTogglePin} onEdit={onEdit}
                                    onAddToKnowledgeBase={onAddToKnowledgeBase} onDelete={onDelete} showKnowledgeBase={showKnowledgeBase} />
                                <IconButton ref={closeRef} label="关闭" onClick={onClose} className="text-foreground-tertiary">
                                    <X className="h-[18px] w-[18px]" aria-hidden="true" />
                                </IconButton>
                            </div>
                        </div>
                        <h2 id={`${id}-title`} className="font-display text-[1.625rem] leading-snug text-foreground">{record.title}</h2>
                        {datePillars ? (
                            <p className="text-[13px] text-foreground-tertiary">
                                <GanZhi value={datePillars.year} />年 <GanZhi value={datePillars.month} />月 <GanZhi value={datePillars.day} colored />日
                                <span className="mx-1.5" aria-hidden="true">·</span>农历{datePillars.lunarMonthDay}
                            </p>
                        ) : null}
                    </header>

                    {status?.kind === 'due' ? (
                        <div className="flex flex-col gap-3 rounded-xl bg-accent-soft/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-accent-strong">{status.days === 0 ? '今天是应验日' : `应验日已过 ${status.days} 天`}，结果如何？</p>
                            <VerdictButtons record={record} onVerdict={onVerdict} />
                        </div>
                    ) : status ? (
                        <div className="flex items-center gap-2">
                            <StatusPill status={status} />
                            {status.kind === 'hit' || status.kind === 'miss' ? (
                                <Button variant="ghost" size="xs" className="text-xs text-foreground-tertiary" onClick={() => onClearVerdict(record)}>撤销</Button>
                            ) : null}
                        </div>
                    ) : null}

                    {record.content ? (
                        <div className="text-[15px] leading-7 break-words whitespace-pre-wrap text-foreground">{record.content}</div>
                    ) : (
                        <p className="text-sm text-foreground-tertiary">没有正文。</p>
                    )}

                    {tags.length ? (
                        <ul aria-label="标签" className="flex flex-wrap gap-1.5">
                            {tags.map(tag => (
                                <li key={tag}>
                                    <Button unstyled onClick={() => onTag(tag)} title={`筛选「${tag}」`}
                                        className="inline-flex h-7 items-center rounded-full bg-background-secondary px-2.5 text-[13px] text-foreground-secondary transition-colors hover:bg-fill-ghost-hover hover:text-foreground">
                                        #{tag}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    ) : null}

                    {chartLabel || record.source_run_id ? (
                        <div className="flex flex-col divide-y-[0.5px] divide-border overflow-hidden rounded-xl border-[0.5px] border-border">
                            {chartLabel ? (
                                record.related_chart_type === 'bazi_chart' || record.related_chart_type === 'ziwei_chart' ? (
                                    <LinkedRow label="关联资料" value={<span className="inline-flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-foreground-tertiary" aria-hidden="true" />{chartLabel}</span>}
                                        href={record.related_chart_id ? getSavedChartHref(record.related_chart_type === 'bazi_chart' ? 'bazi' : 'ziwei', record.related_chart_id) : null} />
                                ) : (
                                    <LinkedRow label="关联资料" value={<span className="inline-flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-foreground-tertiary" aria-hidden="true" />{chartLabel}</span>}
                                        onClick={() => { void openRelated(); }} busy={relatedBusy} />
                                )
                            ) : null}
                            {record.source_run_id ? (
                                record.source_conversation_id ? (
                                    <LinkedRow label="来源" value={<span className="inline-flex items-center gap-1.5"><AgentIcon size={14} className="text-foreground-tertiary" />Agent 在对话中记入</span>}
                                        href={conversationHref({ id: record.source_conversation_id, hasAgentRun: true })} />
                                ) : (
                                    <LinkedRow staticRow label="来源" value={<span className="inline-flex items-center gap-1.5"><AgentIcon size={14} className="text-foreground-tertiary" />Agent 在对话中记入</span>} />
                                )
                            ) : null}
                        </div>
                    ) : null}

                    <footer className="text-xs text-foreground-tertiary">
                        记于 {getShortDateLabel(createdAtKey, todayKey)}{edited ? ` · 修改于 ${getShortDateLabel(updatedAtKey, todayKey)}` : ''}
                    </footer>
                </article>
            </div>
        </Dialog>
    );
}
