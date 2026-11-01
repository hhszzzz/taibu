/**
 * 账单流水的一行：标题、时间、模型、用量与资金来源，右侧是金额；免费调用和按估算计费的调用带标记。
 * 整行可点，打开流水详情。会员的用量日志与管理端的用户账户共用。
 */
'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ModelIcon } from '@/components/ui/ModelIcon';
import type { LedgerEntryView } from '@/lib/billing/config';
import { describeFunding, describeUsage, formatBillingTime, ledgerEntryTitle } from '@/lib/billing/format';
import { formatUsd } from '@/lib/billing/money';

export function LedgerMarks({ entry }: { entry: Pick<LedgerEntryView, 'kind' | 'amountMicros' | 'usage'> }) {
    return <>
        {entry.kind === 'usage' && entry.amountMicros === 0 && !entry.usage?.byok ? <Badge variant="success">免费</Badge> : null}
        {entry.usage?.estimated ? <Badge variant="warning" title="上游没有返回用量，按提示词与输出估算">估算</Badge> : null}
    </>;
}

/** `signed` false for a charge: the column already says it was spent. */
export function LedgerAmount({ micros, signed = true }: { micros: number; signed?: boolean }) {
    return (
        <span className={`shrink-0 text-sm font-medium tabular-nums ${micros > 0 ? 'text-success' : 'text-foreground'}`}>
            {formatUsd(micros, { precise: true, signed })}
        </span>
    );
}

/** The charged model: its catalog icon and name, or the bare ID once the model is deleted. */
export function LedgerModel({ entry, size = 12 }: { entry: Pick<LedgerEntryView, 'modelKey' | 'modelLabel'>; size?: number }) {
    if (!entry.modelKey) return null;
    return entry.modelLabel ? (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1" title={entry.modelKey}>
            <ModelIcon icon={entry.modelLabel.icon} vendor={entry.modelLabel.vendor} size={size} />
            <span className="truncate">{entry.modelLabel.name}</span>
        </span>
    ) : <span className="max-w-full truncate font-mono">{entry.modelKey}</span>;
}

export function LedgerEntryRow({ entry, onOpen, meta }: { entry: LedgerEntryView; onOpen: (entry: LedgerEntryView) => void; meta?: ReactNode }) {
    const usage = describeUsage(entry.usage);
    // 金额已经在右侧；只有订阅与余额分摊时，来源才有信息量。
    const funding = entry.subscriptionParts.some(part => part.micros) ? describeFunding(entry) : null;
    return (
        <li className="border-t border-border first:border-t-0">
            <Button unstyled type="button" aria-haspopup="dialog" onClick={() => onOpen(entry)}
                className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition-colors duration-150 hover:bg-background-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
                <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm text-foreground">{ledgerEntryTitle(entry)}</span>
                        <LedgerMarks entry={entry} />
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-foreground-tertiary">
                        <span className="tabular-nums">{formatBillingTime(entry.createdAt)}</span>
                        <LedgerModel entry={entry} />
                        {usage ? <span>{usage}</span> : null}
                        {meta}
                    </span>
                    {funding ? <span className="text-xs text-foreground-tertiary">{funding}</span> : null}
                </span>
                <LedgerAmount micros={entry.amountMicros} />
            </Button>
        </li>
    );
}
