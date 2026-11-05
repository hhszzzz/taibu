/**
 * 流水详情：概览、用量、按单价逐项的计费明细与资金来源。
 * 会员的用量日志、管理端的用量日志与用户账户共用；管理端多出用户一行，Agent 任务可跳到任务日志。
 */
'use client';

import Link from 'next/link';
import { LedgerAmount } from '@/components/billing/LedgerEntryRow';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CollapsibleDetailSection, DetailRow, DetailSection, DetailStack } from '@/components/ui/DetailLayout';
import { Dialog } from '@/components/ui/Dialog';
import { ModelIcon } from '@/components/ui/ModelIcon';
import { LEDGER_KIND_LABELS, LEDGER_KIND_TONES, type LedgerEntryWithUser } from '@/lib/billing/config';
import { billingSourceLabel, formatBillingSecond, formatCostLine, formatCount, ledgerAmount, ledgerCostBreakdown, ledgerEntryTitle, windowLabel } from '@/lib/billing/format';
import { formatUsd } from '@/lib/billing/money';

const REFERENCE_LABELS: Record<string, string> = {
    conversation: '对话', agent_run: 'Agent 任务', billing_ledger: '原扣费流水', payment_order: '支付订单',
    redemption_code: '兑换码', user_subscription: '订阅',
};
const LINK = 'text-accent hover:underline';

/** What the entry belongs to; a member opens their own conversation, an administrator jumps to the task log. */
function ReferenceRow({ entry, admin, onNavigate }: { entry: LedgerEntryWithUser; admin: boolean; onNavigate: () => void }) {
    const { referenceType: type, referenceId: id } = entry;
    if (!type || !id) return null;
    // 管理员调整余额时关联的是操作的管理员本人；早先的流水记的是系统账号，没有可显示的操作人。
    if (type === 'user') {
        if (entry.kind !== 'adjust' || !entry.operatorEmail) return null;
        return <DetailRow label="操作人" copy={entry.operatorEmail}>{entry.operatorEmail}</DetailRow>;
    }
    const action = type === 'conversation' && !admin
        ? <Link href={`/chat?id=${encodeURIComponent(id)}`} className={LINK} onClick={onNavigate}>打开对话</Link>
        : type === 'agent_run' && admin
            ? <Link href={`/settings/admin-logs/agent-tasks?q=${encodeURIComponent(id)}`} className={LINK} onClick={onNavigate}>查看任务</Link>
            : null;
    return <DetailRow label={REFERENCE_LABELS[type] ?? '关联'} mono copy={id} action={action}>{REFERENCE_LABELS[type] ? id : `${type} · ${id}`}</DetailRow>;
}

export function LedgerDetailDialog({ entry, admin = false, onClose, onModel, onUser }: {
    entry: LedgerEntryWithUser | null;
    /** The administrator's view: shows the account and links to the task log instead of the conversation. */
    admin?: boolean;
    onClose: () => void;
    onModel?: (model: string) => void;
    onUser?: (email: string) => void;
}) {
    if (!entry) return null;
    const usage = entry.usage;
    const lines = entry.kind === 'usage' ? ledgerCostBreakdown(usage) : null;
    const exact = lines?.reduce((sum, line) => sum + line.micros, 0) ?? 0;
    const counts = usage ? [
        { label: '输入', value: usage.input },
        { label: '缓存读', value: usage.cacheRead },
        { label: '缓存写', value: usage.cacheWrite },
        { label: '输出', value: usage.output, note: usage.reasoning ? `其中推理 ${formatCount(usage.reasoning)}` : null },
        { label: '图片', value: usage.images, unit: '张' },
    ].filter(item => item.value) : [];
    // 余额单独承担时不重复：合计里已经写了金额。
    const subscriptionParts = entry.subscriptionParts.filter(part => part.micros);
    const funding = [
        ...subscriptionParts.map(part => ({
            key: `${part.id}:${part.period ?? ''}`,
            label: `订阅「${part.title || '套餐'}」${part.period ? ` · ${windowLabel(part.period)}` : ''}`,
            micros: part.micros,
        })),
        ...(subscriptionParts.length && entry.walletMicros ? [{ key: 'wallet', label: '余额', micros: entry.walletMicros }] : []),
    ];
    const fundingTitle = entry.kind === 'usage' ? '扣费来源' : entry.kind === 'refund' ? '退回去向' : '资金变动';
    return <Dialog open onClose={onClose} className="detail-dialog"
        title={<span className="flex flex-wrap items-center gap-2">流水详情<Badge variant={LEDGER_KIND_TONES[entry.kind]}>{LEDGER_KIND_LABELS[entry.kind]}</Badge></span>}
        description={ledgerEntryTitle(entry)}>
        <DetailStack>
            <DetailSection title="概览">
                <DetailRow label="金额"><LedgerAmount {...ledgerAmount(entry)} /></DetailRow>
                <DetailRow label="时间">{formatBillingSecond(entry.createdAt)}</DetailRow>
                {entry.source ? <DetailRow label="来源">{billingSourceLabel(entry.source)}</DetailRow> : null}
                {entry.modelKey ? <DetailRow label="模型" copy={entry.modelKey}
                    action={onModel ? <Button variant="ghost" size="xs" onClick={() => onModel(entry.modelKey as string)}>只看这个模型</Button> : null}>
                    <span className="inline-flex flex-wrap items-center gap-x-1.5">
                        {entry.modelLabel ? <ModelIcon icon={entry.modelLabel.icon} vendor={entry.modelLabel.vendor} size={14} /> : null}
                        {entry.modelLabel ? <span>{entry.modelLabel.name}</span> : null}
                        <span className="font-mono text-foreground-tertiary">{entry.modelKey}</span>
                    </span>
                </DetailRow> : null}
                {admin && entry.userId ? <DetailRow label="用户" copy={entry.userEmail ?? entry.userId}
                    action={onUser && entry.userEmail ? <Button variant="ghost" size="xs" onClick={() => onUser(entry.userEmail as string)}>只看这个用户</Button> : null}>
                    {entry.userEmail ?? <span className="font-mono">{entry.userId}</span>}
                </DetailRow> : null}
                <ReferenceRow entry={entry} admin={admin} onNavigate={onClose} />
                <DetailRow label="变动后余额">{formatUsd(entry.walletAfterMicros, { precise: true })}</DetailRow>
                <DetailRow label="流水 ID" mono copy={entry.id}>{entry.id}</DetailRow>
            </DetailSection>

            {counts.length ? <DetailSection title="用量"
                aside={usage?.estimated ? <Badge variant="warning" title="上游没有返回用量，按提示词与输出估算">估算</Badge> : null}>
                {counts.map(item => <DetailRow key={item.label} label={item.label}>
                    {formatCount(item.value as number)}{item.unit ?? ' token'}{item.note ? <span className="text-foreground-tertiary">（{item.note}）</span> : null}
                </DetailRow>)}
            </DetailSection> : null}

            {entry.kind === 'usage' ? <DetailSection title="计费">
                {usage?.byok ? <DetailRow label="计费方式">自带密钥，本站不扣费</DetailRow> : <>
                    {lines ? lines.map(line => <DetailRow key={line.label} label={line.inputPrice ? `${line.label}（按输入价）` : line.label}>
                        {formatCostLine(line)} = {formatUsd(line.micros, { precise: true })}
                    </DetailRow>) : <DetailRow label="单价"><span className="text-foreground-tertiary">这条记录未保存单价</span></DetailRow>}
                    <DetailRow label="合计" total>
                        {entry.amountMicros ? formatUsd(-entry.amountMicros, { precise: true }) : '免费'}
                        {Math.abs(exact - Math.round(exact)) > 1e-6 ? <span className="font-normal text-foreground-tertiary">（按 $0.000001 向上取整）</span> : null}
                    </DetailRow>
                </>}
            </DetailSection> : null}

            {funding.length ? <CollapsibleDetailSection title={fundingTitle} count={funding.length}>
                {funding.map(part => <DetailRow key={part.key} label={part.label}>{formatUsd(part.micros, { precise: true, signed: true })}</DetailRow>)}
            </CollapsibleDetailSection> : null}
        </DetailStack>
    </Dialog>;
}
