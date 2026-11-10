'use client';

/**
 * 记录页共用的小部件：干支与三柱、印证状态、应验按钮和行内菜单。
 */
import { BookOpenText, Check, Ellipsis, Hourglass, Pencil, Pin, Trash2, X } from 'lucide-react';
import type { MingRecord, PredictionStatus, PredictionVerdict } from '@/lib/records';
import { getPredictionStatusText } from '@/lib/records';
import type { DatePillars } from '@/lib/divination/calendar';
import { ganZhiTextClass } from '@/components/bazi/element-classes';
import { Button } from '@/components/ui/Button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { cn } from '@/lib/utils';

export function GanZhi({ value, colored = false, className }: { value: string; colored?: boolean; className?: string }) {
    return (
        <span className={cn('inline-flex tracking-[0.02em]', className)}>
            {[...value].map((char, index) => <span key={index} className={colored ? ganZhiTextClass(char) : undefined}>{char}</span>)}
        </span>
    );
}

/** 年、月、日三柱竖排，天干在上、地支在下。 */
export function PillarColumns({ pillars, className }: { pillars: DatePillars; className?: string }) {
    const columns: [string, string][] = [['年', pillars.year], ['月', pillars.month], ['日', pillars.day]];
    return (
        <dl className={cn('flex gap-3.5', className)} aria-label={`${pillars.year}年 ${pillars.month}月 ${pillars.day}日`}>
            {columns.map(([label, value]) => (
                <div key={label} className="flex flex-col items-center gap-1.5">
                    <dt className="text-[11px] leading-none text-foreground-tertiary">{label}</dt>
                    <dd className="flex flex-col items-center font-display text-[1.25rem] leading-[1.15]">
                        {[...value].map((char, index) => <span key={index} className={ganZhiTextClass(char)}>{char}</span>)}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

const STATUS_CLASS: Record<PredictionStatus['kind'], string> = {
    upcoming: 'bg-background-secondary text-foreground-secondary',
    due: 'bg-accent-soft text-accent-strong',
    hit: 'bg-success/10 text-success',
    miss: 'bg-background-secondary text-foreground-tertiary',
    open: 'bg-background-secondary text-foreground-tertiary',
};

export function StatusPill({ status, className }: { status: PredictionStatus; className?: string }) {
    const Icon = status.kind === 'hit' ? Check : status.kind === 'miss' ? X : Hourglass;
    return (
        <span className={cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs', STATUS_CLASS[status.kind], className)}>
            <Icon className="h-3 w-3" aria-hidden="true" />{getPredictionStatusText(status)}
        </span>
    );
}

/** 应验日到了（或过了）时给的两个结果按钮。 */
export function VerdictButtons({ record, onVerdict, size = 'md' }: {
    record: MingRecord;
    onVerdict: (record: MingRecord, verdict: PredictionVerdict) => void;
    size?: 'sm' | 'md';
}) {
    return (
        <div className="flex shrink-0 gap-1.5">
            <Button variant="secondary" size={size} onClick={(event) => { event.stopPropagation(); onVerdict(record, 'miss'); }}>没应验</Button>
            <Button variant="secondary" size={size} className="text-success" onClick={(event) => { event.stopPropagation(); onVerdict(record, 'hit'); }}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />应验了
            </Button>
        </div>
    );
}

export function RecordMenu({ record, onTogglePin, onEdit, onAddToKnowledgeBase, onDelete, showKnowledgeBase, className }: {
    record: MingRecord;
    onTogglePin: (record: MingRecord) => void;
    onEdit: (record: MingRecord) => void;
    onAddToKnowledgeBase: (record: MingRecord) => void;
    onDelete: (record: MingRecord) => void;
    showKnowledgeBase: boolean;
    className?: string;
}) {
    return (
        <Menu>
            <MenuTrigger
                aria-label="记录操作"
                onClick={(event) => event.stopPropagation()}
                className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-tertiary transition-colors hover:bg-fill-ghost-hover hover:text-foreground data-popup-open:bg-fill-ghost-hover data-popup-open:text-foreground', className)}
            >
                <Ellipsis className="h-4 w-4" aria-hidden="true" />
            </MenuTrigger>
            <MenuContent align="end" className="w-40">
                <MenuItem onClick={() => onTogglePin(record)}>
                    <Pin aria-hidden="true" />{record.is_pinned ? '取消置顶' : '置顶'}
                </MenuItem>
                <MenuItem onClick={() => onEdit(record)}>
                    <Pencil aria-hidden="true" />编辑
                </MenuItem>
                {showKnowledgeBase ? (
                    <MenuItem onClick={() => onAddToKnowledgeBase(record)}>
                        <BookOpenText aria-hidden="true" />加入知识库
                    </MenuItem>
                ) : null}
                <MenuSeparator />
                <MenuItem tone="danger" onClick={() => onDelete(record)}>
                    <Trash2 aria-hidden="true" />删除
                </MenuItem>
            </MenuContent>
        </Menu>
    );
}
