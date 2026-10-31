/**
 * Agent 测评面板
 *
 * 题库管理、发起测评（参赛模型、评审模型、题目与重复次数）、进度与取消、按模型的排行榜（硬检查与质量通过率、
 * 平均与 P95 耗时、首字延迟、token）以及逐题两模型并排对比（未通过断言与工具轨迹）。测评在独立队列中串行执行，
 * 不写 `agent_runs`，也不扣用户积分。
 *
 * 'use client' 标记说明：
 * - 需要 useState / useEffect 维护表单、轮询运行进度并按需读取结果
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import { formatAgentDuration } from '@/lib/agent/admin-metrics';
import type {
    AgentEvalCase, AgentEvalLeaderboardEntry, AgentEvalOverview,
    AgentEvalRunResults, AgentEvalRunStatus, AgentEvalRunView, AgentEvalToolCall,
} from '@/lib/agent/eval/types';
import { AGENT_EVAL_CALL_LIMIT, AGENT_EVAL_REPEAT_LIMIT } from '@/lib/agent/eval/types';
import { Button } from '@/components/ui/Button';
import { FilterChip } from '@/components/ui/FilterChip';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Select';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

type View = 'launch' | 'cases' | 'runs';

const VIEWS: Array<{ id: View; label: string }> = [
    { id: 'launch', label: '发起测评' },
    { id: 'cases', label: '题库' },
    { id: 'runs', label: '记录与排行' },
];
const RUN_STATUS: Record<AgentEvalRunStatus, { label: string; tone: string }> = {
    queued: { label: '排队中', tone: 'text-foreground-secondary' },
    running: { label: '运行中', tone: 'text-accent' },
    completed: { label: '已完成', tone: 'text-success' },
    failed: { label: '失败', tone: 'text-danger' },
    cancelled: { label: '已取消', tone: 'text-foreground-tertiary' },
};
const CARD = 'rounded-2xl border border-border bg-surface';
const TH = 'px-3 py-3 text-left text-xs font-medium text-foreground-tertiary';
const TIME = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const RUN_REFRESH_MS = 3000;

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function percent(value: number | null) {
    if (value === null) return '—';
    const shown = Math.min(1, Math.max(0, value)) * 100;
    return shown === 0 ? '0%' : `${shown < 10 ? shown.toFixed(1) : Math.round(shown)}%`;
}

function duration(value: number | null) {
    return value === null ? '—' : formatAgentDuration(value);
}

function formatTime(value: string | null) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : TIME.format(date);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-foreground-tertiary">{label}</dt>
            <dd className="mt-0.5 break-words text-foreground">{children}</dd>
        </div>
    );
}

function ToolTrace({ trace }: { trace: AgentEvalToolCall[] }) {
    if (!trace.length) return <p className="settings-help">没有工具调用。</p>;
    return (
        <ol className="flex flex-col gap-1.5">
            {trace.map((call, index) => (
                <li key={`${index}:${call.name}`} className="rounded-lg border border-border bg-background-secondary px-2.5 py-1.5 text-[13px]">
                    <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-xs text-foreground">{call.name}</span>
                        <span className={call.status === 'error' ? 'text-xs text-danger' : 'text-xs text-success'}>
                            {call.status === 'error' ? '失败' : '成功'}
                        </span>
                        {call.durationMs === undefined ? null : <span className="text-xs tabular-nums text-foreground-tertiary">{formatAgentDuration(call.durationMs)}</span>}
                    </div>
                    {call.arguments === undefined ? null : (
                        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs text-foreground-secondary">{JSON.stringify(call.arguments, null, 2)}</pre>
                    )}
                    {call.error ? <p className="mt-1 text-xs text-danger">{call.error}</p> : null}
                </li>
            ))}
        </ol>
    );
}

interface CaseDraft {
    mode: 'new' | 'edit';
    id: string;
    originalId: string | null;
    tool: string;
    guide: string;
    prompt: string;
    assertions: string;
    argumentsText: string;
    chartText: string;
    visual: boolean;
    enabled: boolean;
    builtin: boolean;
}

function draftOf(item?: AgentEvalCase): CaseDraft {
    return item ? {
        mode: 'edit', id: item.id, originalId: item.id, tool: item.tool, guide: item.guide, prompt: item.prompt,
        assertions: item.assertions.join('\n'), argumentsText: JSON.stringify(item.arguments, null, 2),
        chartText: item.chart ? JSON.stringify(item.chart, null, 2) : '', visual: item.visual === true,
        enabled: item.enabled !== false, builtin: item.builtin === true,
    } : {
        mode: 'new', id: '', originalId: null, tool: '', guide: '', prompt: '', assertions: '',
        argumentsText: '{}', chartText: '', visual: false, enabled: true, builtin: false,
    };
}

function parseDraft(draft: CaseDraft) {
    const assertions = draft.assertions.split('\n').map(line => line.trim()).filter(Boolean);
    let args: unknown, chart: unknown;
    try { args = JSON.parse(draft.argumentsText || '{}'); } catch { throw new Error('工具参数不是有效 JSON'); }
    try { chart = draft.chartText.trim() ? JSON.parse(draft.chartText) : null; } catch { throw new Error('先排盘的配置不是有效 JSON'); }
    return {
        ...(draft.mode === 'new' && draft.id.trim() ? { id: draft.id.trim() } : {}),
        tool: draft.tool.trim(),
        guide: draft.guide.trim(),
        prompt: draft.prompt.trim(),
        assertions,
        arguments: args,
        chart,
        visual: draft.visual,
        enabled: draft.enabled,
    };
}

export function AgentEvalPanel({ active = true }: { active?: boolean }) {
    const [view, setView] = useState<View>('launch');
    const [overview, setOverview] = useState<AgentEvalOverview | null>(null);
    const [cases, setCases] = useState<AgentEvalCase[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedModels, setSelectedModels] = useState<string[]>([]);
    const [judgeModel, setJudgeModel] = useState('');
    const [selectedCases, setSelectedCases] = useState<string[]>([]);
    const [repeats, setRepeats] = useState(1);
    const [launching, setLaunching] = useState(false);
    const [launchError, setLaunchError] = useState<string | null>(null);

    const [draft, setDraft] = useState<CaseDraft | null>(null);
    const [draftError, setDraftError] = useState<string | null>(null);
    const [savingCase, setSavingCase] = useState(false);

    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [run, setRun] = useState<AgentEvalRunView | null>(null);
    const [results, setResults] = useState<AgentEvalRunResults | null>(null);
    const [runError, setRunError] = useState<string | null>(null);
    const [compareCase, setCompareCase] = useState('');
    const [leftModel, setLeftModel] = useState('');
    const [rightModel, setRightModel] = useState('');
    const runSeq = useRef(0);
    const resultsSeq = useRef(0);

    const loadCases = useCallback(async () => {
        try {
            const data = await requestBrowserData<{ cases: AgentEvalCase[] }>(
                '/api/admin/agent-evals/cases', { method: 'GET' }, { fallbackMessage: '读取测评题库失败' },
            );
            setCases(data.cases);
            // A case disabled or deleted here can no longer be launched; drop it from the selection instead of
            // leaving an invisible choice the server would refuse.
            setSelectedCases(current => {
                const enabled = new Set(data.cases.filter(item => item.enabled !== false).map(item => item.id));
                const next = current.filter(id => enabled.has(id));
                return next.length === current.length ? current : next;
            });
            return data.cases;
        } catch (reason) {
            setError(getErrorMessage(reason, '读取测评题库失败'));
            return [];
        }
    }, []);

    const loadOverview = useCallback(async () => {
        try {
            const data = await requestBrowserData<AgentEvalOverview>(
                '/api/admin/agent-evals', { method: 'GET' }, { fallbackMessage: '读取测评记录失败' },
            );
            setOverview(data);
            setError(null);
            return data;
        } catch (reason) {
            setError(getErrorMessage(reason, '读取测评记录失败'));
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    const loadRun = useCallback(async (id: string) => {
        const seq = ++runSeq.current;
        try {
            const data = await requestBrowserData<{ run: AgentEvalRunView }>(
                `/api/admin/agent-evals/${encodeURIComponent(id)}`, { method: 'GET' }, { fallbackMessage: '读取测评进度失败' },
            );
            if (seq !== runSeq.current) return;
            setRun(data.run);
            setRunError(null);
        } catch (reason) {
            if (seq !== runSeq.current) return;
            setRunError(getErrorMessage(reason, '读取测评进度失败'));
        }
    }, []);

    const loadResults = useCallback(async (id: string) => {
        const seq = ++resultsSeq.current;
        try {
            const data = await requestBrowserData<AgentEvalRunResults>(
                `/api/admin/agent-evals/${encodeURIComponent(id)}/results`, { method: 'GET' }, { fallbackMessage: '读取测评结果失败' },
            );
            if (seq !== resultsSeq.current) return;
            setResults(data);
        } catch (reason) {
            if (seq !== resultsSeq.current) return;
            setRunError(getErrorMessage(reason, '读取测评结果失败'));
        }
    }, []);

    useEffect(() => {
        if (!active) return;
        void Promise.resolve().then(() => Promise.all([loadOverview(), loadCases()]));
    }, [active, loadCases, loadOverview]);

    useEffect(() => {
        if (!active || !selectedRunId) return;
        void Promise.resolve().then(() => {
            setRunError(null);
            return Promise.all([loadRun(selectedRunId), loadResults(selectedRunId)]);
        });
    }, [active, loadResults, loadRun, selectedRunId]);

    useEffect(() => {
        if (!active || !selectedRunId || !run || (run.status !== 'queued' && run.status !== 'running')) return;
        const timer = window.setInterval(() => {
            if (document.hidden) return;
            void loadRun(selectedRunId);
            void loadResults(selectedRunId);
            // The runs table reads its progress and status from the overview; keep the open run's row in step.
            void loadOverview();
        }, RUN_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [active, loadOverview, loadResults, loadRun, run, selectedRunId]);

    const [prevCompareRun, setPrevCompareRun] = useState<typeof run | undefined>(undefined);
    if (prevCompareRun !== run) {
        setPrevCompareRun(run);
        if (run) {
            setCompareCase(current => current && run.caseIds.includes(current) ? current : (run.caseIds[0] ?? ''));
            setLeftModel(current => current && run.models.includes(current) ? current : (run.models[0] ?? ''));
            setRightModel(current => current && run.models.includes(current) ? current : (run.models[1] ?? run.models[0] ?? ''));
        }
    }

    const calls = selectedCases.length * selectedModels.length * repeats;
    const tooMany = calls > AGENT_EVAL_CALL_LIMIT;

    const toggleModel = (id: string) => setSelectedModels(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    const toggleCase = (id: string) => setSelectedCases(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);

    const launch = async () => {
        setLaunching(true);
        setLaunchError(null);
        try {
            const data = await requestBrowserData<{ run: AgentEvalRunView }>(
                '/api/admin/agent-evals',
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ models: selectedModels, judgeModel, caseIds: selectedCases, repeats }) },
                { fallbackMessage: '发起测评失败' },
            );
            setSelectedRunId(data.run.id);
            setView('runs');
            await loadOverview();
        } catch (reason) {
            setLaunchError(getErrorMessage(reason, '发起测评失败'));
        } finally {
            setLaunching(false);
        }
    };

    const cancelRun = async (id: string) => {
        try {
            const data = await requestBrowserData<{ run: AgentEvalRunView }>(
                `/api/admin/agent-evals/${encodeURIComponent(id)}/cancel`, { method: 'POST' }, { fallbackMessage: '取消测评失败' },
            );
            // Cancelling a row that is not open must not replace the open run's detail.
            setRun(current => current?.id === id ? data.run : current);
            await loadOverview();
        } catch (reason) {
            setRunError(getErrorMessage(reason, '取消测评失败'));
        }
    };

    const saveCase = async () => {
        if (!draft) return;
        setSavingCase(true);
        setDraftError(null);
        try {
            const body = parseDraft(draft);
            if (draft.mode === 'new') {
                await requestBrowserData<{ case: AgentEvalCase }>(
                    '/api/admin/agent-evals/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { fallbackMessage: '保存题目失败' },
                );
            } else if (draft.originalId) {
                await requestBrowserData<{ case: AgentEvalCase }>(
                    `/api/admin/agent-evals/cases/${encodeURIComponent(draft.originalId)}`,
                    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                        tool: body.tool, guide: body.guide, prompt: body.prompt, assertions: body.assertions,
                        arguments: body.arguments, chart: body.chart, visual: body.visual, enabled: body.enabled,
                    }) },
                    { fallbackMessage: '保存题目失败' },
                );
            }
            setDraft(null);
            await loadCases();
        } catch (reason) {
            setDraftError(getErrorMessage(reason, '保存题目失败'));
        } finally {
            setSavingCase(false);
        }
    };

    const removeCase = async (item: AgentEvalCase) => {
        try {
            await requestBrowserData<{ deleted: boolean }>(
                `/api/admin/agent-evals/cases/${encodeURIComponent(item.id)}`, { method: 'DELETE' }, { fallbackMessage: '删除题目失败' },
            );
            await loadCases();
        } catch (reason) {
            setError(getErrorMessage(reason, '删除题目失败'));
        }
    };

    const enabledCases = useMemo(() => (cases ?? []).filter(item => item.enabled !== false), [cases]);
    const selectedRun = run && run.id === selectedRunId ? run : null;
    const shownCases = selectedRun ? selectedRun.caseIds : [];
    const caseResults = results?.results.filter(item => item.caseId === compareCase) ?? [];
    const leftResults = selectedRun ? caseResults.filter(item => item.modelId === leftModel) : [];
    const rightResults = selectedRun ? caseResults.filter(item => item.modelId === rightModel) : [];
    const compareModelResults = [...new Set([leftModel, rightModel])];

    return (
        <div data-testid="agent-evals" className="flex flex-col gap-4">
            <p className="settings-help">
                用题库里的题目让多个模型各自走真实的 Agent 运行，再按断言自动评分：硬检查复算 Core 结果并核对是否调对工具，质量检查由评审模型判定。题目 × 模型 × 重复次数最多 {AGENT_EVAL_CALL_LIMIT} 次，测评队列并发为 1，不占用用户任务。
            </p>

            {error ? (
                <div role="alert" className="settings-alert">
                    {error}
                    <Button variant="ghost" size="xs" onClick={() => { void loadOverview(); void loadCases(); }}>重试</Button>
                </div>
            ) : null}

            <div role="group" aria-label="测评视图" className="flex flex-wrap items-center gap-1.5">
                {VIEWS.map(({ id, label }) => (
                    <FilterChip key={id} pressed={view === id} onClick={() => setView(id)} className="settings-filter">{label}</FilterChip>
                ))}
                <Button variant="secondary" size="sm" className="ml-auto" onClick={() => { void loadOverview(); void loadCases(); void (selectedRunId ? loadRun(selectedRunId) : Promise.resolve()); }}>
                    <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                    刷新
                </Button>
            </div>

            {loading && !overview ? <SoundWaveLoader variant="block" /> : null}

            {view === 'launch' ? (
                <div className="flex flex-col gap-4">
                    <section aria-label="选择参赛模型" className={`flex flex-col gap-2 p-4 ${CARD}`}>
                        <h3 className="text-sm font-medium text-foreground">参赛模型</h3>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                            {(overview?.models ?? []).map(model => (
                                <label key={model.id} className="flex items-center gap-2 text-[13px] text-foreground-secondary">
                                    <Checkbox checked={selectedModels.includes(model.id)} onCheckedChange={() => toggleModel(model.id)} />
                                    <span className="truncate">{model.name}</span>
                                    <span className="truncate font-mono text-xs text-foreground-tertiary">{model.id}</span>
                                </label>
                            ))}
                        </div>
                        {!overview?.models.length ? <p className="settings-help">还没有可用于聊天与 Agent 的模型。</p> : null}
                    </section>

                    <section aria-label="评审与重复" className={`grid gap-4 p-4 sm:grid-cols-2 ${CARD}`}>
                        <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                            评审模型
                            <Select
                                value={judgeModel || null}
                                onChange={setJudgeModel}
                                placeholder="请选择"
                                options={(overview?.models ?? []).map(model => ({ value: model.id, label: model.name }))}
                                className="w-full"
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                            每题重复次数（1–{AGENT_EVAL_REPEAT_LIMIT}）
                            <Input
                                type="number" min={1} max={AGENT_EVAL_REPEAT_LIMIT} value={repeats}
                                onChange={event => setRepeats(Math.max(1, Math.min(AGENT_EVAL_REPEAT_LIMIT, Number(event.target.value) || 1)))}
                                className="w-20" />
                        </label>
                    </section>

                    <section aria-label="选择题目" className={`flex flex-col gap-2 p-4 ${CARD}`}>
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="text-sm font-medium text-foreground">题目</h3>
                            <Button variant="secondary" size="sm" onClick={() => setSelectedCases(enabledCases.map(item => item.id))}>
                                全选启用题目
                            </Button>
                        </div>
                        <div className="grid gap-1.5">
                            {enabledCases.map(item => (
                                <label key={item.id} className="flex items-start gap-2 text-[13px] text-foreground-secondary">
                                    <Checkbox className="mt-0.5" checked={selectedCases.includes(item.id)} onCheckedChange={() => toggleCase(item.id)} />
                                    <span>
                                        <span className="font-mono text-xs text-foreground">{item.id}</span>
                                        <span className="ml-2 text-foreground-tertiary">{item.tool} · {item.guide}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        {!enabledCases.length && !loading ? <p className="settings-help">题库为空或全部停用。</p> : null}
                    </section>

                    {launchError ? <div role="alert" className="settings-alert">{launchError}</div> : null}

                    <div className="flex flex-wrap items-center gap-3">
                        <Button
                            loading={launching}
                            loadingText="正在发起…"
                            disabled={!selectedModels.length || !judgeModel || !selectedCases.length || tooMany}
                            onClick={() => { void launch(); }}
                        >
                            开始测评
                        </Button>
                        <p className={tooMany ? 'text-[13px] text-danger' : 'text-[13px] text-foreground-secondary'}>
                            预计 {calls} 次 Agent 运行{tooMany ? `，超过上限 ${AGENT_EVAL_CALL_LIMIT}` : ''}，另加最多 {calls} 次质量评审调用。
                        </p>
                    </div>
                </div>
            ) : null}

            {view === 'cases' ? (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="settings-help">内置题来自 `scripts/evals/agent-cases.json`，首次读取时导入；可修改或停用，内置题不能删除。</p>
                        <Button variant="secondary" size="sm" onClick={() => { setDraft(draftOf()); setDraftError(null); }}>
                            添加题目
                        </Button>
                    </div>
                    <div className={`relative overflow-x-auto ${CARD}`}>
                        <table className="w-full min-w-[46rem] border-collapse" aria-label="测评题库">
                            <thead>
                                <tr className="border-b border-border">
                                    <th scope="col" className={`${TH} pl-5`}>题目</th>
                                    <th scope="col" className={TH}>工具 / 体系</th>
                                    <th scope="col" className={TH}>断言</th>
                                    <th scope="col" className={TH}>来源</th>
                                    <th scope="col" className={`${TH} pr-5`}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(cases ?? []).map(item => (
                                    <tr key={item.id} className="border-b border-border last:border-b-0">
                                        <th scope="row" className="max-w-[20rem] py-2.5 pl-5 pr-3 text-left font-normal">
                                            <span className="block truncate font-mono text-xs text-foreground">{item.id}</span>
                                            <span className="mt-0.5 block truncate text-xs text-foreground-tertiary">{item.prompt}</span>
                                        </th>
                                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] text-foreground-secondary">{item.tool} · {item.guide}</td>
                                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{item.assertions.length} 条</td>
                                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] text-foreground-secondary">
                                            {item.builtin ? '内置' : '自定义'} · {item.enabled === false ? '已停用' : '启用'}
                                        </td>
                                        <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-[13px]">
                                            <Button unstyled type="button" className="settings-link" onClick={() => { setDraft(draftOf(item)); setDraftError(null); }}>编辑</Button>
                                            {!item.builtin ? (
                                                <Button unstyled type="button" className="settings-link ml-3" aria-label={`删除题目 ${item.id}`} onClick={() => { void removeCase(item); }}>
                                                    <Trash2 aria-hidden="true" className="inline h-3.5 w-3.5" />
                                                </Button>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : null}

            {view === 'runs' ? (
                <div className="flex flex-col gap-4">
                    <div className={`relative overflow-x-auto ${CARD}`}>
                        <table className="w-full min-w-[48rem] border-collapse" aria-label="测评记录">
                            <thead>
                                <tr className="border-b border-border">
                                    <th scope="col" className={`${TH} pl-5`}>发起时间</th>
                                    <th scope="col" className={TH}>模型 / 评审</th>
                                    <th scope="col" className={TH}>进度</th>
                                    <th scope="col" className={TH}>状态</th>
                                    <th scope="col" className={`${TH} pr-5`}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(overview?.runs ?? []).map(item => {
                                    const status = RUN_STATUS[item.status];
                                    return (
                                        <tr key={item.id} className="border-b border-border last:border-b-0">
                                            <td className="whitespace-nowrap py-2.5 pl-5 pr-3 text-[13px] tabular-nums text-foreground-secondary">{formatTime(item.createdAt)}</td>
                                            <td className="max-w-[18rem] px-3 py-2.5 text-[13px] text-foreground-secondary">
                                                <span className="block truncate">{item.models.join('、')}</span>
                                                <span className="block truncate text-xs text-foreground-tertiary">评审 {item.judgeModel}</span>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{item.completedCalls} / {item.totalCalls}</td>
                                            <td className={`whitespace-nowrap px-3 py-2.5 text-[13px] ${status.tone}`}>{status.label}</td>
                                            <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-[13px]">
                                                <Button unstyled type="button" className="settings-link" onClick={() => setSelectedRunId(item.id)}>查看</Button>
                                                {item.status === 'queued' || item.status === 'running' ? (
                                                    <Button unstyled type="button" className="settings-link ml-3" onClick={() => { void cancelRun(item.id); }}>取消</Button>
                                                ) : null}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {runError ? <div role="alert" className="settings-alert">{runError}</div> : null}
                    {!overview?.runs.length && !loading ? <p className="settings-help">还没有测评记录。</p> : null}

                    {selectedRun ? (
                        <div className="flex flex-col gap-4">
                            <section aria-label="测评进度" className={`flex flex-col gap-2 p-4 ${CARD}`}>
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <h3 className="text-sm font-medium text-foreground">进度 · {RUN_STATUS[selectedRun.status].label}</h3>
                                    <span className="text-xs text-foreground-tertiary">{formatTime(selectedRun.startedAt)} → {formatTime(selectedRun.endedAt)}</span>
                                </div>
                                <progress
                                    aria-label="测评完成进度"
                                    className="h-2 w-full overflow-hidden rounded-full"
                                    max={Math.max(1, selectedRun.totalCalls)}
                                    value={selectedRun.completedCalls}
                                />
                                <p className="text-[13px] text-foreground-secondary">
                                    {selectedRun.completedCalls} / {selectedRun.totalCalls} 次；{selectedRun.caseIds.length} 题 × {selectedRun.models.length} 个模型 × {selectedRun.repeats} 次
                                </p>
                                {selectedRun.error ? <p className="text-[13px] text-danger">{selectedRun.error}</p> : null}
                                {selectedRun.status === 'queued' || selectedRun.status === 'running' ? (
                                    <div><Button variant="secondary" size="sm" onClick={() => { void cancelRun(selectedRun.id); }}>取消测评</Button></div>
                                ) : null}
                            </section>

                            {results?.leaderboard.length ? (
                                <div className={`relative overflow-x-auto ${CARD}`}>
                                    <table className="w-full min-w-[54rem] border-collapse" aria-label="测评排行榜">
                                        <thead>
                                            <tr className="border-b border-border">
                                                <th scope="col" className={`${TH} pl-5`}>模型</th>
                                                <th scope="col" className={TH}>结果</th>
                                                <th scope="col" className={TH}>硬检查通过率</th>
                                                <th scope="col" className={TH}>质量通过率</th>
                                                <th scope="col" className={TH}>平均 / P95 耗时</th>
                                                <th scope="col" className={TH}>首字延迟</th>
                                                <th scope="col" className={`${TH} pr-5`}>平均 token</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {results.leaderboard.map((entry: AgentEvalLeaderboardEntry) => (
                                                <tr key={entry.modelId} className="border-b border-border last:border-b-0">
                                                    <th scope="row" className="max-w-[16rem] truncate py-2.5 pl-5 pr-3 text-left font-normal text-sm text-foreground">{entry.modelId}</th>
                                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{entry.results}</td>
                                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{`${percent(entry.hardPassRate)}（${entry.hardPassed}）`}</td>
                                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">
                                                        {entry.qualityJudged ? `${percent(entry.qualityPassRate)}（${entry.qualityPassed}/${entry.qualityJudged}）` : '未评审'}
                                                    </td>
                                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{`${duration(entry.meanDurationMs)} / ${duration(entry.p95DurationMs)}`}</td>
                                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{`${duration(entry.meanFirstTokenMs)} / ${duration(entry.p95FirstTokenMs)}`}</td>
                                                    <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-[13px] tabular-nums text-foreground-secondary">{entry.meanTokens.toLocaleString('zh-CN')}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : null}

                            {shownCases.length ? (
                                <section aria-label="逐题对比" className={`flex flex-col gap-3 p-4 ${CARD}`}>
                                    <h3 className="text-sm font-medium text-foreground">逐题对比</h3>
                                    <div className="flex flex-wrap items-end gap-3">
                                        <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                                            题目
                                            <Select
                                                value={compareCase}
                                                onChange={setCompareCase}
                                                options={shownCases.map(id => ({ value: id, label: id }))}
                                                className="w-auto min-w-40"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                                            左侧模型
                                            <Select
                                                value={leftModel}
                                                onChange={setLeftModel}
                                                options={selectedRun.models.map(id => ({ value: id, label: id }))}
                                                className="w-auto min-w-40"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                                            右侧模型
                                            <Select
                                                value={rightModel}
                                                onChange={setRightModel}
                                                options={selectedRun.models.map(id => ({ value: id, label: id }))}
                                                className="w-auto min-w-40"
                                            />
                                        </label>
                                    </div>
                                    <div className="grid gap-3 lg:grid-cols-2">
                                        {compareModelResults.map(modelId => {
                                            const items = modelId === leftModel ? leftResults : rightResults;
                                            const first = items[0];
                                            return (
                                                <div key={modelId} role="region" aria-label={`${modelId} 的结果`} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                                        <span className="font-mono text-xs text-foreground">{modelId}</span>
                                                        <span className={first?.hardPassed ? 'text-xs text-success' : 'text-xs text-danger'}>{first ? (first.hardPassed ? '硬检查通过' : '硬检查未通过') : '没有结果'}</span>
                                                    </div>
                                                    {first?.failedAssertions.length ? (
                                                        <div>
                                                            <p className="text-xs text-foreground-tertiary">未通过的断言</p>
                                                            <ul className="mt-1 list-disc pl-5 text-[13px] text-danger">
                                                                {first.failedAssertions.map((item, index) => <li key={index}>{item}</li>)}
                                                            </ul>
                                                        </div>
                                                    ) : null}
                                                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                                                        <Field label="耗时">{formatAgentDuration(first?.durationMs ?? 0)}</Field>
                                                        <Field label="首字">{duration(first?.firstTokenMs ?? null)}</Field>
                                                        <Field label="Token">{`${(first?.inputTokens ?? 0).toLocaleString('zh-CN')} / ${(first?.outputTokens ?? 0).toLocaleString('zh-CN')}`}</Field>
                                                        <Field label="工具调用">{first?.toolCalls ?? 0}</Field>
                                                    </dl>
                                                    {first?.error ? <p className="text-[13px] text-danger">{first.error}</p> : null}
                                                    <div>
                                                        <p className="mb-1 text-xs text-foreground-tertiary">答案</p>
                                                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[13px] text-foreground-secondary">{first?.answer || '（无答案）'}</pre>
                                                    </div>
                                                    <details>
                                                        <summary className="cursor-pointer text-xs text-foreground-tertiary">工具轨迹（{first?.toolCalls ?? 0} 次）</summary>
                                                        <div className="mt-2"><ToolTrace trace={first?.toolTrace ?? []} /></div>
                                                    </details>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </section>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {draft ? (
                <Dialog bare open onClose={() => { if (!savingCase) setDraft(null); }} labelledBy="agent-eval-draft-title" className="dialog-plain dialog-lg">
                    <div className={`max-h-[90vh] w-full overflow-auto p-5 ${CARD}`}>
                        <h2 id="agent-eval-draft-title" className="text-base font-medium text-foreground">{draft.mode === 'new' ? '添加题目' : `编辑题目 ${draft.originalId}`}</h2>
                        <div className="mt-3 flex flex-col gap-3">
                            <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                                标识（小写字母、数字、下划线、连字符）
                                <Input value={draft.id} disabled={draft.mode === 'edit'} onChange={event => setDraft({ ...draft, id: event.target.value })} className="font-mono text-xs"/>
                            </label>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                                    工具
                                    <Input value={draft.tool} onChange={event => setDraft({ ...draft, tool: event.target.value })} className="font-mono text-xs"/>
                                </label>
                                <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                                    体系
                                    <Input value={draft.guide} onChange={event => setDraft({ ...draft, guide: event.target.value })} className="font-mono text-xs"/>
                                </label>
                            </div>
                            <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                                题目
                                <Textarea value={draft.prompt} rows={4} onChange={event => setDraft({ ...draft, prompt: event.target.value })} />
                            </label>
                            <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                                断言（每行一条）
                                <Textarea value={draft.assertions} rows={4} onChange={event => setDraft({ ...draft, assertions: event.target.value })} />
                            </label>
                            <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                                工具参数（JSON）
                                <Textarea value={draft.argumentsText} rows={4} onChange={event => setDraft({ ...draft, argumentsText: event.target.value })} className="font-mono text-xs"/>
                            </label>
                            <label className="flex flex-col gap-1 text-[13px] text-foreground-secondary">
                                先排盘的配置（JSON，可留空）
                                <Textarea value={draft.chartText} rows={3} onChange={event => setDraft({ ...draft, chartText: event.target.value })} className="font-mono text-xs"/>
                            </label>
                            <div className="flex flex-wrap items-center gap-4 text-[13px] text-foreground-secondary">
                                <label className="flex items-center gap-2"><Checkbox checked={draft.visual} onCheckedChange={checked => setDraft({ ...draft, visual: checked })} />视觉题</label>
                                <label className="flex items-center gap-2"><Checkbox checked={draft.enabled} onCheckedChange={checked => setDraft({ ...draft, enabled: checked })} />启用</label>
                            </div>
                            {draftError ? <div role="alert" className="settings-alert">{draftError}</div> : null}
                            <div className="flex justify-end gap-2">
                                <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>取消</Button>
                                <Button size="sm" loading={savingCase} loadingText="保存中…" disabled={savingCase} onClick={() => { void saveCase(); }}>
                                    保存
                                </Button>
                            </div>
                        </div>
                    </div>
                </Dialog>
            ) : null}
        </div>
    );
}
