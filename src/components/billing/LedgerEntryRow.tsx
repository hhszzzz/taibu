/**
 * 账单流水的一行：标题、时间、模型、用量与资金来源，右侧是金额；免费调用和按估算计费的调用带标记。
 * 设置中心的账单明细与管理端的用户账户共用。
 */
'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { LedgerEntryView } from '@/lib/billing/config';
import { describeFunding, describeUsage, formatBillingTime, ledgerEntryTitle } from '@/lib/billing/format';
import { formatUsd } from '@/lib/billing/money';

export function LedgerMarks({ entry }: { entry: Pick<LedgerEntryView, 'kind' | 'amountMicros' | 'usage'> }) {
    return <>
        {entry.kind === 'usage' && entry.amountMicros === 0 ? <Badge variant="success">免费</Badge> : null}
        {entry.usage?.estimated ? <Badge variant="warning" title="上游没有返回用量，按提示词与输出估算">估算</Badge> : null}
    </>;
}

export function LedgerAmount({ micros }: { micros: number }) {
    return (
        <span className={`shrink-0 text-sm font-medium tabular-nums ${micros > 0 ? 'text-success' : 'text-foreground'}`}>
            {formatUsd(micros, { precise: true, signed: true })}
        </span>
    );
}

/** `onModel` makes the model name a filter: clicking it shows only that model's entries. */
export function LedgerEntryRow({ entry, onModel, meta }: { entry: LedgerEntryView; onModel?: (model: string) => void; meta?: ReactNode }) {
    const usage = describeUsage(entry.usage);
    const funding = describeFunding(entry);
    return (
        <li className="flex items-start justify-between gap-4 border-t border-border px-4 py-3 first:border-t-0">
            <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm text-foreground">{ledgerEntryTitle(entry)}</span>
                    <LedgerMarks entry={entry} />
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-foreground-tertiary">
                    <span className="tabular-nums">{formatBillingTime(entry.createdAt)}</span>
                    {entry.modelKey ? (onModel ? (
                        <Button unstyled type="button" title="只看这个模型" onClick={() => onModel(entry.modelKey as string)}
                            className="max-w-full truncate font-mono hover:text-foreground hover:underline">{entry.modelKey}</Button>
                    ) : <span className="max-w-full truncate font-mono">{entry.modelKey}</span>) : null}
                    {usage ? <span>{usage}</span> : null}
                    {meta}
                </div>
                {funding ? <span className="text-xs text-foreground-tertiary">{funding}</span> : null}
            </div>
            <LedgerAmount micros={entry.amountMicros} />
        </li>
    );
}
