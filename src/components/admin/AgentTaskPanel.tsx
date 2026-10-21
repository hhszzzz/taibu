/**
 * Agent 任务排障面板
 *
 * 管理员查看进行中或最近的 Agent 任务，以及按 Pi Durable 提交日志重建的任务树：模型生成、工具与脚本调用、
 * 协作成员与后台子分析的会话，含已结束的任务、耗时、等待关系与失败原因。面板可见时，进行中的列表与任务树定时刷新。
 *
 * 'use client' 标记说明：
 * - 需要 useState / useEffect 加载并轮询列表与任务树，维护筛选、搜索与选中项
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import { isValidUUID } from '@/lib/validation';
import { AGENT_ACTIVE_STATUSES, type AgentRunStatus } from '@/lib/agent/types';
import type { AgentAdminRun, AgentTaskConversation, AgentTaskNode, AgentTaskSubmission, AgentTaskTree } from '@/lib/agent/admin-tasks';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';

type Scope = 'active' | 'recent';
type RunDetail = { run: AgentAdminRun; tree: AgentTaskTree };
type Tone = { label: string; tone: string };

const SCOPES: Array<{ id: Scope; label: string }> = [
    { id: 'active', label: '进行中' },
    { id: 'recent', label: '最近' },
];
const LIST_REFRESH_MS = 5000;
const TREE_REFRESH_MS = 3000;
const SUBMISSION_LIMIT = 8;
const CARD = 'rounded-2xl border border-border bg-surface';
const TH = 'px-3 py-3 text-left text-xs font-medium text-foreground-tertiary';
const BRANCH = 'ml-1.5 flex flex-col border-l border-border pl-3';
const TIME = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const RUN_STATUS: Record<AgentRunStatus, Tone> = {
    queued: { label: '排队中', tone: 'bg-background-secondary text-foreground-secondary' },
    running: { label: '执行中', tone: 'bg-accent/10 text-accent' },
    awaiting_input: { label: '等待用户', tone: 'bg-warning/10 text-warning' },
    cancelling: { label: '停止中', tone: 'bg-warning/10 text-warning' },
    completed: { label: '已完成', tone: 'bg-success/10 text-success' },
    failed: { label: '失败', tone: 'bg-danger/10 text-danger' },
    cancelled: { label: '已停止', tone: 'bg-background-secondary text-foreground-tertiary' },
};
const BILLING: Record<AgentAdminRun['billing'], string> = { charged: '已扣费', exempt: '免费', refunded: '已退款' };
const LIVE_TASK: Record<Exclude<AgentTaskNode['status'], 'terminal'>, Tone> = {
    pending: { label: '待执行', tone: 'text-foreground-secondary' },
    running: { label: '执行中', tone: 'text-accent' },
    waiting: { label: '等待', tone: 'text-warning' },
    completing: { label: '收尾', tone: 'text-accent' },
};
const OUTCOME: Record<NonNullable<AgentTaskNode['outcome']>, Tone> = {
    completed: { label: '完成', tone: 'text-success' },
    failed: { label: '失败', tone: 'text-danger' },
    faulted: { label: '异常', tone: 'text-danger' },
    orphaned: { label: '无法恢复', tone: 'text-danger' },
    aborted: { label: '已中止', tone: 'text-foreground-tertiary' },
};
const SUBMISSION_STATUS: Record<AgentTaskSubmission['status'], string> = { queued: '排队', placed: '处理中', done: '已答复', unanswered: '未答复' };

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function formatTime(value: string | number | null | undefined) {
    if (value === null || value === undefined) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : TIME.format(date);
}

function formatDuration(ms: number) {
    if (ms < 1000) return `${Math.max(0, Math.round(ms))} 毫秒`;
    if (ms < 10_000) return `${(ms / 1000).toFixed(1)} 秒`;
    const seconds = Math.floor(ms / 1000);
    return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
}

function runModes(run: AgentAdminRun) {
    const modes = [
        run.modes.compact ? '压缩上下文' : null,
        run.modes.codeMode ? '代码模式' : null,
        run.modes.planMode ? '计划模式' : null,
        run.modes.web ? '联网' : null,
        run.modes.collaborators ? `协作 ${run.modes.collaborators} 人` : null,
    ].filter(Boolean);
    return modes.length ? modes.join(' · ') : '默认';
}

function taskTitle(task: AgentTaskNode) {
    switch (task.role) {
        case 'generation': return task.attempt && task.attempt > 1 ? `模型生成 · 第 ${task.attempt} 次` : '模型生成';
        case 'tool': return task.nested ? `脚本调用 ${task.tool ?? ''}`.trim() : task.tool ? `工具 ${task.tool}` : '工具调用';
        case 'compaction': return '上下文压缩';
        case 'subagent': return '后台子分析';
        case 'report': return task.subagent ? `后台回报 · ${task.subagent}` : '后台回报';
        default: return task.kind;
    }
}

function taskState(task: AgentTaskNode): Tone {
    if (task.status === 'terminal') return OUTCOME[task.outcome ?? 'completed'];
    const { label, tone } = LIVE_TASK[task.status];
    if (task.status === 'completing') return { label: task.outcome ? `${label}（${OUTCOME[task.outcome].label}）` : label, tone };
    const waiting = task.status === 'waiting' && task.waitingOn?.length ? ` ${task.waitingOn.map(id => `#${id}`).join(' ')}` : '';
    return { label: `${label}${waiting}${task.phase ? ` · ${task.phase}` : ''}`, tone };
}

function taskDuration(task: AgentTaskNode, now: number) {
    if (task.startedAt === undefined) return null;
    return task.endedAt !== undefined ? formatDuration(task.endedAt - task.startedAt) : `已运行 ${formatDuration(now - task.startedAt)}`;
}

function conversationTitle(conversation: AgentTaskConversation) {
    switch (conversation.role) {
        case 'main': return '主会话';
        case 'member': return '协作成员会话';
        case 'subagent': return conversation.name ? `后台子分析「${conversation.name}」` : '后台子分析会话';
        case 'fork': return conversation.forkOf === undefined ? '分支会话' : `分支会话（自 #${conversation.forkOf}）`;
        default: return '子会话';
    }
}

/** Pi's live task graph: tasks that have not ended, and the ended ones above them. */
function liveTask(task: AgentTaskNode): AgentTaskNode | null {
    const tasks = task.tasks.flatMap(child => liveTask(child) ?? []);
    const conversations = task.conversations.flatMap(conversation => liveConversation(conversation) ?? []);
    return task.status !== 'terminal' || tasks.length || conversations.length ? { ...task, tasks, conversations } : null;
}

function liveConversation(conversation: AgentTaskConversation): AgentTaskConversation | null {
    const tasks = conversation.tasks.flatMap(task => liveTask(task) ?? []);
    return tasks.length ? { ...conversation, tasks } : null;
}

function Field({ label, mono = false, children }: { label: string; mono?: boolean; children: ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-foreground-tertiary">{label}</dt>
            <dd className={`mt-0.5 break-all text-foreground ${mono ? 'select-all font-mono text-xs' : ''}`}>{children}</dd>
        </div>
    );
}

function RunStatus({ status }: { status: AgentRunStatus }) {
    const { label, tone } = RUN_STATUS[status];
    return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${tone}`}>{label}</span>;
}

function Submissions({ submissions }: { submissions: AgentTaskSubmission[] }) {
    if (!submissions.length) return null;
    const shown = submissions.slice(-SUBMISSION_LIMIT);
    return (
        <p className="text-xs text-foreground-secondary">
            输入：
            {submissions.length > shown.length ? `较早 ${submissions.length - shown.length} 条略；` : null}
            {shown.map((submission, index) => (
                <span key={submission.id} className={submission.status === 'unanswered' ? 'text-danger' : undefined}>
                    {index ? '、' : null}
                    <span className="font-mono">{submission.requestId ?? `#${submission.id}`}</span>
                    {` ${SUBMISSION_STATUS[submission.status]}`}
                    {submission.reason ? `（${submission.reason}${submission.detail ? `：${submission.detail}` : ''}）` : null}
                </span>
            ))}
        </p>
    );
}

function TaskItem({ task, now }: { task: AgentTaskNode; now: number }) {
    const state = taskState(task);
    const duration = taskDuration(task, now);
    const flags = [task.background ? '后台' : null, task.abortRequested ? '已请求中止' : null, task.abandoned ? '重启后放弃' : null].filter(Boolean);
    return (
        <li data-agent-task={task.id}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1 text-[13px]">
                <span className="text-foreground">{taskTitle(task)}</span>
                <span className="font-mono text-xs text-foreground-tertiary">#{task.id}</span>
                <span className={state.tone}>{state.label}</span>
                {task.model ? <span className="text-xs text-foreground-secondary">{task.model}</span> : null}
                {duration ? <span className="text-xs tabular-nums text-foreground-tertiary">{duration}</span> : null}
                {flags.length ? <span className="text-xs text-warning">{flags.join(' · ')}</span> : null}
            </div>
            {task.reason ? <p className="whitespace-pre-wrap break-words pb-1 text-xs text-danger">{task.reason}</p> : null}
            {task.tasks.length || task.conversations.length ? (
                <ul className={BRANCH}>
                    {task.tasks.map(child => <TaskItem key={child.id} task={child} now={now} />)}
                    {task.conversations.map(conversation => <ConversationItem key={`c${conversation.id}`} conversation={conversation} now={now} />)}
                </ul>
            ) : null}
        </li>
    );
}

function ConversationItem({ conversation, now }: { conversation: AgentTaskConversation; now: number }) {
    return (
        <li data-agent-conversation={conversation.id} className="py-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="font-medium text-foreground">{conversationTitle(conversation)}</span>
                <span className="font-mono text-xs text-foreground-tertiary">会话 #{conversation.id}</span>
            </div>
            <Submissions submissions={conversation.submissions} />
            {conversation.tasks.length ? (
                <ul className={BRANCH}>
                    {conversation.tasks.map(task => <TaskItem key={task.id} task={task} now={now} />)}
                </ul>
            ) : <p className="text-xs text-foreground-tertiary">没有任务</p>}
        </li>
    );
}

function RunDetailView({ detail, now, onClose }: { detail: RunDetail; now: number; onClose: () => void }) {
    const { run, tree } = detail;
    const [liveOnly, setLiveOnly] = useState(false);
    const conversations = useMemo(
        () => (liveOnly ? tree.conversations.flatMap(conversation => liveConversation(conversation) ?? []) : tree.conversations),
        [liveOnly, tree.conversations],
    );
    return (
        <section aria-label="任务详情" className={`flex flex-col gap-4 p-5 ${CARD}`}>
            <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="break-words text-[15px] font-medium text-foreground">{run.title || '（无标题）'}</h3>
                    <p className="mt-1 text-xs text-foreground-secondary">
                        未结束 {tree.counts.live} · 完成 {tree.counts.completed} · 失败 {tree.counts.failed} · 中止 {tree.counts.aborted}
                    </p>
                </div>
                <div className="flex items-center gap-1">
                    <RunStatus status={run.status} />
                    <button type="button" onClick={onClose} aria-label="关闭任务详情" className="settings-icon-button">
                        <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                </div>
            </header>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-x-6 gap-y-3 text-[13px]">
                <Field label="任务 ID" mono>{run.id}</Field>
                <Field label="对话 ID" mono>{run.conversationId}</Field>
                <Field label="用户">{run.userEmail ?? <span className="select-all font-mono text-xs">{run.userId}</span>}</Field>
                <Field label="模型">{run.model || '—'}</Field>
                <Field label="配置">{runModes(run)}</Field>
                <Field label="Worker">{`${run.workerId ?? '无'} · fence ${run.fence}`}{run.cancelRequested ? ' · 已请求停止' : ''}</Field>
                <Field label="租约至">{formatTime(run.leaseUntil)}</Field>
                <Field label="计费">{BILLING[run.billing]}</Field>
                <Field label="创建 / 更新">{`${formatTime(run.createdAt)} / ${formatTime(run.updatedAt)}`}</Field>
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="settings-help">
                    {tree.commits} 次提交{tree.lastCommitAt ? ` · 最后一次 ${formatTime(tree.lastCommitAt)}` : ''}
                    {AGENT_ACTIVE_STATUSES.includes(run.status) ? ' · 每 3 秒刷新' : ''}
                    {tree.truncated ? ' · 日志较长，只显示前 10000 次提交' : ''}
                </p>
                <label className="flex items-center gap-2 text-[13px] text-foreground-secondary">
                    <input type="checkbox" checked={liveOnly} onChange={event => setLiveOnly(event.target.checked)} />
                    只看未结束
                </label>
            </div>
            {conversations.length ? (
                <ul aria-label="任务树" className="flex flex-col gap-2">
                    {conversations.map(conversation => <ConversationItem key={`c${conversation.id}`} conversation={conversation} now={now} />)}
                </ul>
            ) : (
                <p className="settings-help">{tree.commits ? '没有未结束的任务。' : '这个任务还没有执行记录。'}</p>
            )}
        </section>
    );
}

export function AgentTaskPanel({ active = true }: { active?: boolean }) {
    const [scope, setScope] = useState<Scope>('active');
    const [query, setQuery] = useState('');
    const [search, setSearch] = useState('');
    const [runs, setRuns] = useState<AgentAdminRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<RunDetail | null>(null);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());
    // 只采用最近一次请求的结果：切换筛选或任务后，较早发出的请求不能覆盖新结果。
    const listSeq = useRef(0);
    const detailSeq = useRef(0);

    const loadRuns = useCallback(async () => {
        const seq = ++listSeq.current;
        const params = new URLSearchParams({ scope, ...(search ? { q: search } : {}) });
        try {
            const data = await requestBrowserData<{ runs?: AgentAdminRun[] }>(
                `/api/admin/agent-runs?${params}`,
                { method: 'GET' },
                { fallbackMessage: '获取 Agent 任务失败' },
            );
            if (seq !== listSeq.current) return;
            setRuns(data.runs ?? []);
            setListError(null);
        } catch (error) {
            if (seq !== listSeq.current) return;
            setListError(getErrorMessage(error, '获取 Agent 任务失败'));
        } finally {
            if (seq === listSeq.current) setLoading(false);
        }
    }, [scope, search]);

    const loadDetail = useCallback(async (id: string) => {
        const seq = ++detailSeq.current;
        try {
            const data = await requestBrowserData<RunDetail>(
                `/api/admin/agent-runs/${encodeURIComponent(id)}`,
                { method: 'GET' },
                { fallbackMessage: '读取任务树失败' },
            );
            if (seq !== detailSeq.current) return;
            setDetail(data);
            setDetailError(null);
            setNow(Date.now());
        } catch (error) {
            if (seq !== detailSeq.current) return;
            setDetailError(getErrorMessage(error, '读取任务树失败'));
        }
    }, []);

    useEffect(() => {
        if (active) void loadRuns();
    }, [active, loadRuns]);

    useEffect(() => {
        if (active && selectedId) void loadDetail(selectedId);
    }, [active, selectedId, loadDetail]);

    // 面板不可见（切到其他子页或浏览器标签页隐藏）时不轮询。
    useEffect(() => {
        if (!active || scope !== 'active' || search) return;
        const timer = window.setInterval(() => { if (!document.hidden) void loadRuns(); }, LIST_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [active, scope, search, loadRuns]);

    const shown = detail && detail.run.id === selectedId ? detail : null;
    const liveRun = !!shown && AGENT_ACTIVE_STATUSES.includes(shown.run.status);
    useEffect(() => {
        if (!active || !selectedId || !liveRun) return;
        const timer = window.setInterval(() => { if (!document.hidden) void loadDetail(selectedId); }, TREE_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [active, selectedId, liveRun, loadDetail]);

    const select = (id: string | null) => {
        detailSeq.current++;
        setSelectedId(id);
        setDetailError(null);
    };

    const submitSearch = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const value = query.trim();
        if (value && !isValidUUID(value)) {
            setListError('请输入完整的任务、对话或用户 ID');
            return;
        }
        setSearch(value);
    };

    const clearSearch = () => {
        setQuery('');
        setSearch('');
    };

    const refresh = () => {
        void loadRuns();
        if (selectedId) void loadDetail(selectedId);
    };

    if (loading) {
        return <SoundWaveLoader variant="block" />;
    }

    return (
        <div className="flex flex-col gap-4">
            <p className="settings-help">
                查看 Agent 任务的执行过程：任务树按 Pi Durable 提交日志重建，包括模型生成、工具与脚本调用、协作成员与后台子分析，已结束的任务也保留耗时与失败原因。
            </p>

            {listError ? (
                <div role="alert" className="settings-alert">
                    {listError}
                    <button type="button" onClick={refresh}>重试</button>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="group" aria-label="任务范围" className="flex flex-wrap items-center gap-1.5">
                    {SCOPES.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            aria-pressed={!search && scope === id}
                            onClick={() => { clearSearch(); setScope(id); }}
                            className="settings-filter"
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <form role="search" onSubmit={submitSearch} className="flex items-center gap-1.5">
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="任务、对话或用户 ID"
                            aria-label="按任务、对话或用户 ID 查找"
                            className="settings-input w-[19rem] max-w-full font-mono text-xs"
                        />
                        <button type="submit" aria-label="查找" className="settings-icon-button">
                            <Search aria-hidden="true" className="h-4 w-4" />
                        </button>
                        {search ? (
                            <button type="button" onClick={clearSearch} aria-label="清除查找" className="settings-icon-button">
                                <X aria-hidden="true" className="h-4 w-4" />
                            </button>
                        ) : null}
                    </form>
                    <button type="button" onClick={refresh} className="settings-button settings-button-compact">
                        <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                        刷新
                    </button>
                </div>
            </div>

            {runs.length ? (
                // relative 让表头里 sr-only 的绝对定位文字也被滚动容器裁剪，否则手机上会撑宽整页。
                <div className={`relative overflow-x-auto ${CARD}`}>
                    <table className="w-full min-w-[40rem] border-collapse" aria-label="Agent 任务">
                        <thead>
                            <tr className="border-b border-border">
                                <th scope="col" className={`${TH} pl-5`}>任务</th>
                                <th scope="col" className={TH}>状态</th>
                                <th scope="col" className={TH}>模型</th>
                                <th scope="col" className={TH}>用户</th>
                                <th scope="col" className={`${TH} pr-5`}>更新</th>
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map(run => (
                                <tr key={run.id} className={`border-b border-border last:border-b-0 ${run.id === selectedId ? 'bg-background-secondary/60' : ''}`}>
                                    <th scope="row" className="max-w-[18rem] py-2.5 pl-5 pr-3 text-left font-normal">
                                        <button
                                            type="button"
                                            onClick={() => select(run.id === selectedId ? null : run.id)}
                                            aria-pressed={run.id === selectedId}
                                            className="flex max-w-full flex-col items-start text-left"
                                        >
                                            <span className="max-w-full truncate text-sm text-foreground">{run.title || '（无标题）'}</span>
                                            <span className="font-mono text-xs text-foreground-tertiary">{run.id.slice(0, 8)}</span>
                                        </button>
                                    </th>
                                    <td className="px-3 py-2.5"><RunStatus status={run.status} /></td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] text-foreground-secondary">{run.model || '—'}</td>
                                    <td className="max-w-[12rem] truncate px-3 py-2.5 text-[13px] text-foreground-secondary">{run.userEmail ?? run.userId.slice(0, 8)}</td>
                                    <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-[13px] tabular-nums text-foreground-secondary">{formatTime(run.updatedAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : listError ? null : (
                <div className={`flex flex-col items-center gap-1.5 px-6 py-12 text-center ${CARD}`}>
                    <p className="text-[15px] text-foreground">
                        {search ? '没有找到相关任务' : scope === 'active' ? '当前没有进行中的 Agent 任务' : '还没有 Agent 任务'}
                    </p>
                    {!search && scope === 'active' ? <p className="settings-help">列表每 5 秒刷新；已结束的任务在「最近」里。</p> : null}
                </div>
            )}

            {selectedId && detailError ? (
                <div role="alert" className="settings-alert">
                    {detailError}
                    <button type="button" onClick={() => { void loadDetail(selectedId); }}>重试</button>
                </div>
            ) : null}
            {selectedId && !shown && !detailError ? <SoundWaveLoader variant="block" /> : null}
            {shown ? <RunDetailView key={shown.run.id} detail={shown} now={now} onClose={() => select(null)} /> : null}
        </div>
    );
}
