/**
 * 用量日志上方的合计与按模型汇总：只算模型调用与退回；会员的用量日志与管理端共用。
 */
'use client';

import { ChevronDown } from 'lucide-react';
import { LedgerModel } from '@/components/billing/LedgerEntryRow';
import { Button } from '@/components/ui/Button';
import type { UsageByModel, UsageTotals } from '@/lib/billing/config';
import { formatCount } from '@/lib/billing/format';
import { formatUsd } from '@/lib/billing/money';

const CARD = 'rounded-2xl border border-border bg-surface';
const TH = 'px-3 py-2.5 text-left text-xs font-medium text-foreground-tertiary';
const TD = 'px-3 py-2.5 text-[13px] text-foreground-secondary tabular-nums';

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

/** Spending per model, folded by default; clicking a model filters the log to it. */
export function UsageByModelSection({ rows, onModel }: { rows: readonly UsageByModel[]; onModel: (model: string) => void }) {
    if (!rows.length) return null;
    return (
        <details className="group">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-[13px] font-medium text-foreground-tertiary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                按模型汇总<span className="tabular-nums">（{rows.length}）</span>
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 transition-transform duration-[var(--duration-base)] ease-[var(--ease-snap)] group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            {/* relative 让表头里的绝对定位文字也被滚动容器裁剪，否则手机上会撑宽整页。 */}
            <div className={`relative mt-2 max-h-80 overflow-auto ${CARD}`}>
                <table className="w-full min-w-[40rem] border-collapse" aria-label="按模型汇总">
                    <thead>
                        <tr className="border-b border-border">
                            <th scope="col" className={`${TH} pl-5`}>模型</th>
                            <th scope="col" className={TH}>调用</th>
                            <th scope="col" className={TH}>输入</th>
                            <th scope="col" className={TH}>输出</th>
                            <th scope="col" className={TH}>缓存读 / 写</th>
                            <th scope="col" className={`${TH} pr-5 text-right`}>消费</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr key={row.model} className="border-b border-border last:border-b-0">
                                <th scope="row" className="py-2.5 pl-5 pr-3 text-left text-xs font-normal">
                                    <Button unstyled type="button" title={`只看 ${row.model}`} onClick={() => onModel(row.model)}
                                        className="flex max-w-[16rem] items-center text-foreground hover:underline">
                                        <LedgerModel entry={{ modelKey: row.model, modelLabel: row.modelLabel }} size={14} />
                                    </Button>
                                </th>
                                <td className={TD}>{formatCount(row.calls)}{row.images ? ` · ${formatCount(row.images)} 张` : ''}</td>
                                <td className={TD}>{formatCount(row.input)}</td>
                                <td className={TD}>{formatCount(row.output)}</td>
                                <td className={TD}>{formatCount(row.cacheRead)} / {formatCount(row.cacheWrite)}</td>
                                <td className={`${TD} pr-5 text-right text-foreground`}>{formatUsd(row.spentMicros, { precise: true })}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </details>
    );
}
