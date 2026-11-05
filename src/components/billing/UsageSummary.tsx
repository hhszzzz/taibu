/**
 * 用量日志上方的合计：只算模型调用与退回；会员的用量日志与管理端共用。
 */
'use client';

import type { UsageTotals } from '@/lib/billing/config';
import { formatCount } from '@/lib/billing/format';
import { formatUsd } from '@/lib/billing/money';

const CARD = 'rounded-2xl border border-border bg-surface';

export function UsageTotalsCard({ totals }: { totals: UsageTotals }) {
    const items = [
        { label: '消费', value: formatUsd(totals.spentMicros, { precise: true }) },
        { label: '调用', value: formatCount(totals.calls) },
        { label: '输入 token', value: formatCount(totals.input) },
        { label: '输出 token', value: formatCount(totals.output) },
        ...(totals.reasoning ? [{ label: '其中推理', value: formatCount(totals.reasoning) }] : []),
        { label: '缓存读 / 写', value: `${formatCount(totals.cacheRead)} / ${formatCount(totals.cacheWrite)}` },
        ...(totals.images ? [{ label: '图片', value: formatCount(totals.images) }] : []),
    ];
    return (
        <dl aria-label="筛选范围合计" className={`grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-6 gap-y-3 p-5 ${CARD}`}>
            {items.map(item => (
                <div key={item.label} className="min-w-0">
                    <dt className="text-xs text-foreground-tertiary">{item.label}</dt>
                    <dd className="mt-0.5 text-[15px] font-medium tabular-nums text-foreground">{item.value}</dd>
                </div>
            ))}
        </dl>
    );
}
