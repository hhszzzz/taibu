/**
 * 记录列表组件：记录卡片、空状态和分页
 *
 * 'use client' 标记说明：
 * - 使用交互回调（onClick）
 */
'use client';

import {
    Pin,
    Pencil,
    Trash2,
    Calendar,
    FileText,
    BookOpenText,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { MingRecord, RECORD_CATEGORIES } from '@/lib/records';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';

const VISIBLE_TAG_COUNT = 3;
const ICON_BUTTON_CLASS = 'flex h-10 w-10 items-center justify-center rounded-lg text-foreground-tertiary transition-colors hover:bg-background-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent md:h-8 md:w-8';
const META_CHIP_CLASS = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs';

function getArchiveTitle(record: MingRecord) {
    const count = Array.isArray(record.archived_kb_ids) ? record.archived_kb_ids.length : 0;
    return count > 0 ? `已归档到 ${count} 个知识库` : '已归档到知识库';
}

// =====================================================
// 记录卡片组件
// =====================================================
function RecordCard({
    record,
    onEdit,
    onDelete,
    onTogglePin,
    onAddToKnowledgeBase,
    showKnowledgeBaseAction,
}: {
    record: MingRecord;
    onEdit: () => void;
    onDelete: () => void;
    onTogglePin: () => void;
    onAddToKnowledgeBase: () => void;
    showKnowledgeBaseAction: boolean;
}) {
    const categoryLabel = RECORD_CATEGORIES.find(c => c.value === record.category)?.label;
    const pinLabel = record.is_pinned ? '取消置顶' : '置顶';

    return (
        <article className={`flex flex-col gap-2 rounded-[14px] border-[0.5px] bg-surface p-4 md:flex-row md:items-start md:gap-4 md:p-5 ${record.is_pinned ? 'border-accent/40' : 'border-border'}`}>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    {record.is_pinned ? (
                        <span className={`${META_CHIP_CLASS} bg-accent-soft text-accent-strong`}>
                            <Pin className="h-3 w-3" aria-hidden="true" />置顶
                        </span>
                    ) : null}
                    {categoryLabel ? (
                        <span className={`${META_CHIP_CLASS} bg-background-secondary text-foreground-secondary`}>{categoryLabel}</span>
                    ) : null}
                    {record.is_archived ? (
                        <span className={`${META_CHIP_CLASS} bg-success/10 text-success`} title={getArchiveTitle(record)}>已归档</span>
                    ) : null}
                    {record.event_date ? (
                        <span className="inline-flex items-center gap-1 text-xs text-foreground-tertiary">
                            <Calendar className="h-3 w-3" aria-hidden="true" />
                            <time dateTime={record.event_date}>{record.event_date}</time>
                        </span>
                    ) : null}
                </div>

                <h3 className="line-clamp-1 text-base font-medium text-foreground md:text-[17px]">{record.title}</h3>

                {record.content ? (
                    <p className="line-clamp-2 text-sm leading-relaxed text-foreground-secondary">{record.content}</p>
                ) : null}

                {record.tags.length > 0 ? (
                    <ul aria-label="标签" className="flex flex-wrap gap-1.5">
                        {record.tags.slice(0, VISIBLE_TAG_COUNT).map((tag, index) => (
                            <li key={`${index}-${tag}`} className="text-xs text-accent-strong">#{tag}</li>
                        ))}
                        {record.tags.length > VISIBLE_TAG_COUNT ? (
                            <li className="text-xs text-foreground-tertiary">+{record.tags.length - VISIBLE_TAG_COUNT}</li>
                        ) : null}
                    </ul>
                ) : null}
            </div>

            {/* 操作始终可见：手机端排在卡片底部，桌面端排在右上角。 */}
            <div className="-mr-2 -mb-2 flex shrink-0 justify-end gap-0.5 md:-mt-1.5 md:mb-0 md:-mr-1.5">
                <button
                    type="button"
                    onClick={onTogglePin}
                    aria-label={pinLabel}
                    aria-pressed={!!record.is_pinned}
                    title={pinLabel}
                    className={`${ICON_BUTTON_CLASS} aria-pressed:text-accent`}
                >
                    <Pin className="h-4 w-4" aria-hidden="true" />
                </button>
                {showKnowledgeBaseAction ? (
                    <button type="button" onClick={onAddToKnowledgeBase} aria-label="加入知识库" title="加入知识库" className={ICON_BUTTON_CLASS}>
                        <BookOpenText className="h-4 w-4" aria-hidden="true" />
                    </button>
                ) : null}
                <button type="button" onClick={onEdit} aria-label="编辑记录" title="编辑" className={ICON_BUTTON_CLASS}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={onDelete} aria-label="删除记录" title="删除" className={`${ICON_BUTTON_CLASS} hover:bg-danger/10 hover:text-danger`}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>
        </article>
    );
}

// =====================================================
// 记录列表（含分页）
// =====================================================
interface RecordsListProps {
    loading: boolean;
    records: MingRecord[];
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onEdit: (record: MingRecord) => void;
    onDelete: (id: string) => void;
    onTogglePin: (id: string) => void;
    onAddToKnowledgeBase: (record: MingRecord) => void;
    onCreateNew: () => void;
}

export function RecordsList({
    loading,
    records,
    page,
    totalPages,
    onPageChange,
    onEdit,
    onDelete,
    onTogglePin,
    onAddToKnowledgeBase,
    onCreateNew,
}: RecordsListProps) {
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();

    const pagination = totalPages > 1 ? (
        <nav aria-label="分页" className="mt-6 flex items-center justify-center gap-3">
            <button
                type="button"
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page === 1}
                aria-label="上一页"
                className={ICON_BUTTON_CLASS}
            >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <span className="min-w-14 text-center text-sm text-foreground-secondary tabular-nums">
                {page} / {totalPages}
            </span>
            <button
                type="button"
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                aria-label="下一页"
                className={ICON_BUTTON_CLASS}
            >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
        </nav>
    ) : null;

    if (loading) {
        return (
            <div className="rounded-[14px] border-[0.5px] border-border bg-surface p-6">
                <SoundWaveLoader variant="block" text="加载记录中" />
            </div>
        );
    }

    if (records.length === 0) {
        return (
            <>
                <div className="flex flex-col items-center rounded-[14px] border-[0.5px] border-dashed border-border-hover px-6 py-14 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-background-secondary">
                        <FileText className="h-6 w-6 text-foreground-tertiary" aria-hidden="true" />
                    </div>
                    <p className="font-display text-lg text-foreground">
                        {totalPages > 1 ? '当前页暂无记录' : '暂无记录'}
                    </p>
                    <p className="mt-1.5 max-w-xs text-sm text-foreground-secondary">
                        {totalPages > 1
                            ? '这一页已经空了，可以切换到上一页继续查看。'
                            : '记下第一条断语或感悟，日后对照印证。'}
                    </p>
                    {totalPages > 1 ? null : (
                        <button
                            type="button"
                            onClick={onCreateNew}
                            className="mt-6 inline-flex h-10 items-center rounded-[10px] border-[0.5px] border-border-hover bg-surface px-5 text-sm text-foreground transition-colors hover:bg-background-secondary"
                        >
                            新建记录
                        </button>
                    )}
                </div>
                {pagination}
            </>
        );
    }

    return (
        <>
            <ul className="flex flex-col gap-3">
                {records.map(record => (
                    <li key={record.id}>
                        <RecordCard
                            record={record}
                            onEdit={() => onEdit(record)}
                            onDelete={() => onDelete(record.id)}
                            onTogglePin={() => onTogglePin(record.id)}
                            onAddToKnowledgeBase={() => onAddToKnowledgeBase(record)}
                            showKnowledgeBaseAction={knowledgeBaseEnabled}
                        />
                    </li>
                ))}
            </ul>

            {pagination}
        </>
    );
}
