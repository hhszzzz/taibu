/**
 * 流水表：时间、用户（管理端）、类型、模型、用量、金额、详情各占一列；点「查看」打开流水详情。
 * 会员的用量日志与管理端的用量日志共用，列只有「用户」一处差别。
 */
'use client';

import { SubscriptionIcon, WalletIcon } from '@/lib/navigation/nav-icons';
import { LedgerAmount, LedgerMarks, LedgerModel } from '@/components/billing/LedgerEntryRow';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LEDGER_KIND_LABELS, LEDGER_KIND_TONES, type LedgerEntryView, type LedgerUsage } from '@/lib/billing/config';
import { billingSourceLabel, formatBillingTime, formatCount } from '@/lib/billing/format';

const TH = 'px-3 py-2.5 text-left text-xs font-medium text-foreground-tertiary';
const TD = 'px-3 py-2.5 text-[13px] text-foreground-secondary';
const CELL_LINK = 'max-w-full truncate text-left hover:text-foreground hover:underline';

/** 用量：输入 / 输出两个数；缓存有量时在下面补一行「缓存↓ 读 ↑ 写」。 */
function UsageCell({ usage }: { usage: LedgerUsage | null }) {
    if (!usage) return <span className="text-foreground-tertiary">—</span>;
    if (usage.images) return <span className="tabular-nums">{formatCount(usage.images)} 张</span>;
    const input = usage.input ?? 0;
    const output = usage.output ?? 0;
    const cacheRead = usage.cacheRead ?? 0;
    const cacheWrite = usage.cacheWrite ?? 0;
    if (!input && !output && !cacheRead && !cacheWrite) return <span className="text-foreground-tertiary">—</span>;
    return (
        <span className="flex flex-col gap-0.5">
            <span className="font-mono text-xs font-medium tabular-nums">{formatCount(input)} / {formatCount(output)}</span>
            {cacheRead || cacheWrite ? (
                <span className="flex items-center gap-1.5 text-[11px] text-foreground-tertiary">
                    {cacheRead ? <span>缓存↓ {formatCount(cacheRead)}</span> : null}
                    {cacheWrite ? <span>↑ {formatCount(cacheWrite)}</span> : null}
                </span>
            ) : null}
        </span>
    );
}

/** 这笔钱从哪来：订阅额度用卡、余额用钱包，两个都用就并排两个。 */
function FundingIcons({ entry }: { entry: LedgerEntryView }) {
    const subscription = entry.subscriptionParts.some(part => part.micros);
    const wallet = entry.walletMicros !== 0;
    if (!subscription && !wallet) return null;
    return (
        <span className="inline-flex items-center gap-1 text-foreground-tertiary">
            {subscription ? <span role="img" aria-label="订阅额度"><SubscriptionIcon size={14} /></span> : null}
            {wallet ? <span role="img" aria-label="余额"><WalletIcon size={14} /></span> : null}
        </span>
    );
}

function UserMark({ email }: { email: string }) {
    return <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill-field text-[11px] font-semibold text-foreground-secondary">
        {email.trim().charAt(0).toUpperCase()}
    </span>;
}

export type LedgerTableEntry = LedgerEntryView & { userId?: string; userEmail?: string | null };

export function LedgerTable({ entries, label, showUser = false, onOpen, onModel, onUser }: {
    entries: readonly LedgerTableEntry[];
    /** The table's accessible name, e.g. 用量日志. */
    label: string;
    showUser?: boolean;
    onOpen: (entry: LedgerTableEntry) => void;
    onModel?: (model: string) => void;
    onUser?: (email: string) => void;
}) {
    return (
        // relative 让表头里 sr-only 的绝对定位文字也被滚动容器裁剪，否则手机上会撑宽整页。
        <div className="relative overflow-x-auto">
            <table className={`w-full border-collapse ${showUser ? 'min-w-[52rem]' : 'min-w-[42rem]'}`} aria-label={label}>
                <thead>
                    <tr className="border-b border-border bg-background-secondary/60">
                        <th scope="col" className={`${TH} pl-5`}>时间</th>
                        {showUser ? <th scope="col" className={TH}>用户</th> : null}
                        <th scope="col" className={TH}>类型</th>
                        <th scope="col" className={TH}>模型</th>
                        <th scope="col" className={TH}>用量</th>
                        <th scope="col" className={`${TH} text-right`}>金额</th>
                        <th scope="col" className={`${TH} pr-5 text-right`}>详情</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.map(entry => (
                        <tr key={entry.id} className="border-b border-border transition-colors last:border-b-0 hover:bg-background-secondary/50">
                            <td className={`${TD} whitespace-nowrap pl-5 font-mono text-xs tabular-nums`}>{formatBillingTime(entry.createdAt)}</td>
                            {showUser ? <td className={`${TD} whitespace-nowrap`}>
                                {entry.userEmail && onUser ? (
                                    <Button unstyled type="button" title={`只看 ${entry.userEmail}`} onClick={() => onUser(entry.userEmail as string)}
                                        className={`flex items-center gap-2 ${CELL_LINK}`}>
                                        <UserMark email={entry.userEmail} />
                                        <span className="max-w-[10rem] truncate">{entry.userEmail}</span>
                                    </Button>
                                ) : <span className="font-mono text-xs" title={entry.userId}>{entry.userId?.slice(0, 8) ?? '—'}</span>}
                            </td> : null}
                            <td className={`${TD} whitespace-nowrap`}>
                                <Badge variant={LEDGER_KIND_TONES[entry.kind]}>{LEDGER_KIND_LABELS[entry.kind]}</Badge>
                                {entry.kind === 'usage' && entry.source ? <span className="ml-1.5 text-xs text-foreground-tertiary">{billingSourceLabel(entry.source)}</span> : null}
                                {entry.usage?.byok ? <span className="ml-1.5 rounded-md bg-fill-field px-1 py-px text-[11px] text-foreground-tertiary" title="用会员自己的 API Key 调用，本站不扣费">自带密钥</span> : null}
                            </td>
                            <td className={TD}>
                                {entry.modelKey ? (
                                    <Button unstyled type="button" title={onModel ? `只看 ${entry.modelKey}` : entry.modelKey} onClick={() => onModel?.(entry.modelKey as string)}
                                        className={`inline-flex max-w-[13rem] items-center gap-1.5 rounded-md bg-fill-field px-1.5 py-0.5 text-xs text-foreground ${onModel ? 'hover:text-accent' : ''}`}>
                                        <LedgerModel entry={entry} size={14} />
                                    </Button>
                                ) : <span className="text-foreground-tertiary">—</span>}
                            </td>
                            <td className={`${TD} whitespace-nowrap`}>
                                <span className="flex items-center gap-1.5">
                                    <UsageCell usage={entry.usage} />
                                    <LedgerMarks entry={entry} />
                                </span>
                            </td>
                            {/* 消费不写符号：这一列就是花掉多少。 */}
                            <td className="whitespace-nowrap py-2.5 pl-3 pr-3 text-right">
                                <span className="inline-flex items-center gap-1.5">
                                    <FundingIcons entry={entry} />
                                    <LedgerAmount micros={entry.kind === 'usage' ? Math.abs(entry.amountMicros) : entry.amountMicros} signed={entry.kind !== 'usage'} />
                                </span>
                            </td>
                            <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-right">
                                <Button variant="ghost" size="xs" aria-haspopup="dialog" onClick={() => onOpen(entry)}>查看</Button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
