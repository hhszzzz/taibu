/**
 * 定时任务运行记录：全站每次到点的运行，按状态、用户邮箱、时间筛选；表格列出计划时间、用户、任务、状态、耗时与费用，
 * 「详情」看跳过原因、错误与关联的 Agent 任务。邮箱点一下即按它筛选。
 *
 * 'use client' 标记说明：
 * - 需要 useState / useEffect 维护筛选、分页、请求顺序与详情弹窗
 */
'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { RefreshCw, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DetailRow, DetailSection, DetailStack } from '@/components/ui/DetailLayout';
import { Dialog } from '@/components/ui/Dialog';
import { FilterChip } from '@/components/ui/FilterChip';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { TablePagination } from '@/components/ui/TablePagination';
import { requestBrowserData } from '@/lib/browser-api';
import { formatAgentDuration } from '@/lib/agent/admin-metrics';
import { AGENT_SCHEDULE_RUN_STATUSES, type AgentScheduleRunAdminPage, type AgentScheduleRunAdminView } from '@/lib/agent/admin-schedule-runs';
import {
    AGENT_SCHEDULE_RUN_STATUS_LABELS, AGENT_SCHEDULE_SKIP_REASON_LABELS, describeAgentScheduleCadence, type AgentScheduleRunStatus,
} from '@/lib/agent/schedules/config';
import { formatBillingSecond, formatBillingTime, formatCount } from '@/lib/billing/format';
import { formatUsd } from '@/lib/billing/money';

type Range = 'all' | 'today' | '7d' | '30d';

const PAGE_SIZE = 50;
const RANGES: ReadonlyArray<{ value: Range; label: string }> = [
    { value: 'all', label: '全部时间' }, { value: 'today', label: '今天' }, { value: '7d', label: '近 7 天' }, { value: '30d', label: '近 30 天' },
];
const STATUS_TONE: Record<AgentScheduleRunStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
    pending: 'neutral', running: 'accent', completed: 'success', failed: 'danger', skipped: 'warning',
};
const CARD = 'rounded-2xl border border-border bg-surface';
const TH = 'px-3 py-2.5 text-left text-xs font-medium text-foreground-tertiary';
const TD = 'px-3 py-2.5 text-[13px] text-foreground-secondary';

/** The start of a range, counted from the moment it is asked for. */
function rangeStart(range: Range, now = new Date()): string | null {
    if (range === 'all') return null;
    const from = new Date(now);
    if (range === 'today') from.setHours(0, 0, 0, 0);
    else from.setDate(from.getDate() - (range === '7d' ? 7 : 30));
    return from.toISOString();
}

const durationOf = (run: AgentScheduleRunAdminView) => (run.startedAt && run.finishedAt
    ? formatAgentDuration(Date.parse(run.finishedAt) - Date.parse(run.startedAt)) : null);
const skipLabel = (reason: string) => AGENT_SCHEDULE_SKIP_REASON_LABELS[reason] ?? reason;
const taskHref = (id: string) => `/settings/admin-logs/agent-tasks?q=${encodeURIComponent(id)}`;

function RunDetailDialog({ run, onClose }: { run: AgentScheduleRunAdminView; onClose: () => void }) {
    const duration = durationOf(run);
    return <Dialog open onClose={onClose} className="detail-dialog" description={run.scheduleName}
        title={<span className="flex flex-wrap items-center gap-2">运行详情<Badge variant={STATUS_TONE[run.status]}>{AGENT_SCHEDULE_RUN_STATUS_LABELS[run.status]}</Badge></span>}>
        <DetailStack>
            <DetailSection title="本次运行">
                <DetailRow label="计划时间">{formatBillingSecond(run.scheduledFor)}</DetailRow>
                <DetailRow label="开始 / 结束">{`${formatBillingSecond(run.startedAt)} / ${formatBillingSecond(run.finishedAt)}`}</DetailRow>
                {duration ? <DetailRow label="耗时">{duration}</DetailRow> : null}
                {run.skipReason ? <DetailRow label="跳过原因">{skipLabel(run.skipReason)}</DetailRow> : null}
                {run.error ? <DetailRow label="错误"><span className="text-danger">{run.error}</span></DetailRow> : null}
                {run.agentRunId ? <DetailRow label="Agent 任务" mono copy={run.agentRunId}
                    action={<Link href={taskHref(run.agentRunId)} className="text-accent hover:underline" onClick={onClose}>查看任务</Link>}>{run.agentRunId}</DetailRow> : null}
                {run.conversationId ? <DetailRow label="对话" mono copy={run.conversationId}>{run.conversationId}</DetailRow> : null}
                {run.cost ? <DetailRow label="费用">{`${formatUsd(run.cost.spentMicros, { precise: true })}（${formatCount(run.cost.calls)} 次调用）`}</DetailRow> : null}
                <DetailRow label="记录 ID" mono copy={run.id}>{run.id}</DetailRow>
            </DetailSection>
            <DetailSection title="定时任务">
                <DetailRow label="名称">{run.scheduleName}{run.scheduleEnabled ? null : <span className="text-foreground-tertiary">（已停用）</span>}</DetailRow>
                <DetailRow label="模板">{run.template === 'daily_briefing' ? '每日早报' : '自定义'}</DetailRow>
                {run.cadence ? <DetailRow label="频率">{describeAgentScheduleCadence(run.cadence)}</DetailRow> : null}
                <DetailRow label="时区">{run.timezone}</DetailRow>
                <DetailRow label="用户" copy={run.userEmail ?? run.userId}>{run.userEmail ?? <span className="font-mono">{run.userId}</span>}</DetailRow>
                <DetailRow label="任务 ID" mono copy={run.scheduleId}>{run.scheduleId}</DetailRow>
            </DetailSection>
        </DetailStack>
    </Dialog>;
}

export function AgentScheduleRunsPanel({ active = true }: { active?: boolean }) {
    const [status, setStatus] = useState<AgentScheduleRunStatus | 'all'>('all');
    const [range, setRange] = useState<Range>('all');
    const [emailInput, setEmailInput] = useState('');
    const [email, setEmail] = useState('');
    const [page, setPage] = useState<AgentScheduleRunAdminPage | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detail, setDetail] = useState<AgentScheduleRunAdminView | null>(null);
    // 只采用最近一次请求的结果：改了筛选后，较早发出的请求不能覆盖新列表。
    const seq = useRef(0);

    const load = useCallback(async (target: number) => {
        const current = ++seq.current;
        setLoading(true);
        const query = new URLSearchParams({ offset: String((target - 1) * PAGE_SIZE), limit: String(PAGE_SIZE) });
        if (status !== 'all') query.set('status', status);
        if (email) query.set('email', email);
        const from = rangeStart(range);
        if (from) query.set('from', from);
        try {
            const next = await requestBrowserData<AgentScheduleRunAdminPage>(
                `/api/admin/agent-schedules/runs?${query}`, { method: 'GET' }, { fallbackMessage: '读取定时任务记录失败' });
            if (current !== seq.current) return;
            setPage(next);
            setError(null);
        } catch (failure) {
            if (current === seq.current) setError(failure instanceof Error ? failure.message : '读取定时任务记录失败');
        } finally {
            if (current === seq.current) setLoading(false);
        }
    }, [status, range, email]);

    useEffect(() => {
        if (active) void Promise.resolve().then(() => load(1));
    }, [active, load]);

    const search = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setCurrentPage(1);
        setEmail(emailInput.trim().toLowerCase());
    };
    const filterUser = (address: string) => {
        setCurrentPage(1);
        setEmail(address.toLowerCase());
        setEmailInput(address);
    };
    const total = page ? Object.values(page.counts).reduce((sum, count) => sum + count, 0) : 0;

    return (
        <div className="flex flex-col gap-4">
            <p className="settings-help">
                定时任务每次到点记一条：完成、失败、跳过（余额不足、对话忙、上一次未结束等）都在这里；费用是关联 Agent 任务的模型调用合计。
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <form role="search" onSubmit={search} className="flex items-center gap-1.5">
                    <Input type="search" value={emailInput} onChange={event => setEmailInput(event.target.value)} placeholder="用户邮箱（前缀）"
                        aria-label="按用户邮箱筛选" className="w-56" size="sm" />
                    <IconButton type="submit" label="按邮箱筛选" size="sm"><Search aria-hidden="true" className="h-4 w-4" /></IconButton>
                    {email ? (
                        <IconButton label="清除邮箱筛选" size="sm" onClick={() => { setEmail(''); setEmailInput(''); }}>
                            <X aria-hidden="true" className="h-4 w-4" />
                        </IconButton>
                    ) : null}
                </form>
                <Select ariaLabel="时间范围" value={range} options={RANGES} onChange={setRange} className="w-32" />
                <Button variant="secondary" size="sm" onClick={() => void load(currentPage)} className="ml-auto">
                    <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />刷新
                </Button>
            </div>
            <div role="group" aria-label="运行状态" className="flex flex-wrap items-center gap-1.5">
                <FilterChip pressed={status === 'all'} onClick={() => { setCurrentPage(1); setStatus('all'); }} className="settings-filter">
                    全部{page ? <span className="tabular-nums"> {formatCount(total)}</span> : null}
                </FilterChip>
                {AGENT_SCHEDULE_RUN_STATUSES.map(item => (
                    <FilterChip key={item} pressed={status === item} onClick={() => { setCurrentPage(1); setStatus(item); }} className="settings-filter">
                        {AGENT_SCHEDULE_RUN_STATUS_LABELS[item]}{page ? <span className="tabular-nums"> {formatCount(page.counts[item])}</span> : null}
                    </FilterChip>
                ))}
            </div>

            {error ? (
                <div role="alert" className="settings-alert">
                    <span className="min-w-0 flex-1">{error}</span>
                    <Button variant="ghost" size="xs" onClick={() => void load(currentPage)}>重试</Button>
                </div>
            ) : null}

            {!page ? (loading ? <SoundWaveLoader variant="block" /> : null) : page.runs.length ? (
                // relative 让表头里 sr-only 的绝对定位文字也被滚动容器裁剪，否则手机上会撑宽整页。
                <div className={`relative overflow-x-auto ${CARD}`}>
                    <table className="w-full min-w-[46rem] border-collapse" aria-label="定时任务运行记录">
                        <thead>
                            <tr className="border-b border-border">
                                <th scope="col" className={`${TH} pl-5`}>计划时间</th>
                                <th scope="col" className={TH}>用户</th>
                                <th scope="col" className={TH}>任务</th>
                                <th scope="col" className={TH}>状态</th>
                                <th scope="col" className={TH}>耗时</th>
                                <th scope="col" className={`${TH} text-right`}>费用</th>
                                <th scope="col" className={`${TH} pr-5`}><span className="sr-only">详情</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {page.runs.map(run => (
                                <tr key={run.id} className="border-b border-border align-top last:border-b-0">
                                    <td className={`${TD} whitespace-nowrap pl-5 tabular-nums`}>{formatBillingTime(run.scheduledFor)}</td>
                                    <td className={TD}>
                                        {run.userEmail ? (
                                            <Button unstyled type="button" title={`只看 ${run.userEmail}`} onClick={() => filterUser(run.userEmail as string)}
                                                className="block max-w-[11rem] truncate text-left hover:text-foreground hover:underline">{run.userEmail}</Button>
                                        ) : <span className="font-mono text-xs" title={run.userId}>{run.userId.slice(0, 8)}</span>}
                                    </td>
                                    <td className={TD}>
                                        <span className="block max-w-[14rem] truncate text-foreground">{run.scheduleName}</span>
                                        {run.cadence ? <span className="block max-w-[14rem] truncate text-xs text-foreground-tertiary">{describeAgentScheduleCadence(run.cadence)}</span> : null}
                                    </td>
                                    <td className={TD}>
                                        <Badge variant={STATUS_TONE[run.status]}>{AGENT_SCHEDULE_RUN_STATUS_LABELS[run.status]}</Badge>
                                        {run.skipReason || run.error ? (
                                            <span className="mt-1 block max-w-[12rem] truncate text-xs text-foreground-tertiary" title={run.error ?? undefined}>
                                                {run.skipReason ? skipLabel(run.skipReason) : run.error}
                                            </span>
                                        ) : null}
                                    </td>
                                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{durationOf(run) ?? '—'}</td>
                                    <td className={`${TD} whitespace-nowrap text-right tabular-nums text-foreground`}>
                                        {run.cost ? formatUsd(run.cost.spentMicros, { precise: true }) : '—'}
                                    </td>
                                    <td className="py-2 pl-3 pr-5 text-right">
                                        <Button variant="ghost" size="xs" aria-haspopup="dialog" onClick={() => setDetail(run)}>详情</Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="border-t border-border">
                        <TablePagination page={currentPage} pageSize={PAGE_SIZE} hasNext={page.nextOffset !== null} loading={loading}
                            onPage={next => { setCurrentPage(next); void load(next); }} />
                    </div>
                </div>
            ) : (
                <div className={`px-6 py-10 text-center text-sm text-foreground-secondary ${CARD}`}>
                    {loading ? '加载中…' : status !== 'all' || email || range !== 'all' ? '没有符合筛选条件的运行记录。' : '还没有定时任务运行过。'}
                </div>
            )}
            {detail ? <RunDetailDialog run={detail} onClose={() => setDetail(null)} /> : null}
        </div>
    );
}
