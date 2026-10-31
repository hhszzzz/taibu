/**
 * Agent 运行性能面板
 *
 * 按模型查看近 1 / 7 / 30 天的运行指标：总耗时与首字延迟的 P50/P95、工具耗时占比、失败率与挂起率；点开一次
 * 运行可看它的阶段时间线。指标由 worker 在任务结束时写入 `agent_run_metrics`，不包含消息正文、工具参数或结果。
 *
 * 'use client' 标记说明：
 * - 需要 useState / useEffect 读取指标与单次运行明细，并维护统计范围与选中项
 */
'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import {
    AGENT_METRICS_DAYS,
    formatAgentDuration,
    type AgentRunMetricStatus,
    type AgentRunMetricsReport,
    type AgentRunMetricsRow,
    type AgentRunPhase,
} from '@/lib/agent/admin-metrics';
import { Button } from '@/components/ui/Button';
import { FilterChip } from '@/components/ui/FilterChip';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';

const CARD = 'rounded-2xl border border-border bg-surface';
const TH = 'px-3 py-3 text-left text-xs font-medium text-foreground-tertiary';
const TIME = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const RANGE_LABEL: Record<number, string> = { 1: '近 1 天', 7: '近 7 天', 30: '近 30 天' };
const STATUS: Record<AgentRunMetricStatus, { label: string; tone: string }> = {
    completed: { label: '已完成', tone: 'text-success' },
    failed: { label: '失败', tone: 'text-danger' },
    cancelled: { label: '已停止', tone: 'text-foreground-tertiary' },
};
const TASK: Record<string, string> = { 'pi.generation': '模型生成', 'pi.tool': '工具调用', 'pi.compaction': '上下文压缩' };
const OUTCOME: Record<string, string> = { done: '完成', waiting: '等待', sleeping: '休眠', faulted: '异常', aborted: '中止' };
const SUBMISSION: Record<string, string> = { queued: '排队', placed: '处理中', done: '已答复' };

function formatTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : TIME.format(date);
}

function formatRate(value: number) {
    const percent = Math.min(1, Math.max(0, value)) * 100;
    return percent === 0 ? '0%' : `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

function formatTokens(value: number) {
    return value.toLocaleString('zh-CN');
}

function phaseTitle(phase: AgentRunPhase) {
    if (phase.name === 'pi.durable.submit') {
        return `提交输入${phase.result ? ` · ${SUBMISSION[phase.result] ?? phase.result}` : ''}`;
    }
    if (phase.name === 'pi.durable.submission') {
        return `提交结果 · ${phase.submissionStatus === 'unanswered' ? '未答复' : '已答复'}`;
    }
    return [TASK[phase.task ?? ''] ?? phase.task ?? '任务', phase.phase, phase.attempt && phase.attempt > 1 ? `第 ${phase.attempt} 次` : null]
        .filter(Boolean).join(' · ');
}

function outcomeText(phase: AgentRunPhase) {
    if (phase.outcome?.startsWith('next=')) return `下一步：${phase.outcome.slice(5)}`;
    return phase.outcome ? OUTCOME[phase.outcome] ?? phase.outcome : null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-foreground-tertiary">{label}</dt>
            <dd className="mt-0.5 break-words text-foreground">{children}</dd>
        </div>
    );
}

function PhaseTimeline({ metrics }: { metrics: AgentRunMetricsRow }) {
    return (
        <section aria-label="运行阶段时间线" className="flex flex-col gap-2">
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-6 gap-y-3 text-[13px]">
                <Field label="任务 ID"><span className="select-all font-mono text-xs">{metrics.runId}</span></Field>
                <Field label="模型">{metrics.modelId}</Field>
                <Field label="状态"><span className={STATUS[metrics.status].tone}>{STATUS[metrics.status].label}</span></Field>
                <Field label="开始 / 结束">{`${formatTime(metrics.startedAt)} / ${formatTime(metrics.endedAt)}`}</Field>
                <Field label="排队耗时">{formatAgentDuration(metrics.queuedMs)}</Field>
                <Field label="总耗时">{formatAgentDuration(metrics.totalMs)}</Field>
                <Field label="首字延迟">{metrics.firstTokenMs === null ? '—' : formatAgentDuration(metrics.firstTokenMs)}</Field>
                <Field label="生成">{`${metrics.generationCount} 次 · ${formatAgentDuration(metrics.generationMs)}`}</Field>
                <Field label="工具">{`${metrics.toolCount} 次 · ${formatAgentDuration(metrics.toolMs)}`}</Field>
                <Field label="压缩">{`${metrics.compactionCount} 次 · ${formatAgentDuration(metrics.compactionMs)}`}</Field>
                <Field label="重试 / 故障 / 挂起">{`${metrics.retries} / ${metrics.faults} / ${metrics.hangs}`}</Field>
                <Field label="Token（输入 / 输出 / 缓存读 / 缓存写）">
                    {`${formatTokens(metrics.inputTokens)} / ${formatTokens(metrics.outputTokens)} / ${formatTokens(metrics.cacheReadTokens)} / ${formatTokens(metrics.cacheWriteTokens)}`}
                </Field>
            </dl>
            {metrics.phases.length ? (
                <ol className="flex flex-col gap-1">
                    {metrics.phases.map((phase, index) => {
                        const outcome = outcomeText(phase);
                        return (
                            <li key={`${index}:${phase.name}:${phase.startMs}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
                                <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-foreground-tertiary">
                                    +{formatAgentDuration(phase.startMs)}
                                </span>
                                <span className="tabular-nums text-foreground-secondary">{formatAgentDuration(phase.durationMs)}</span>
                                <span className="text-foreground">{phaseTitle(phase)}</span>
                                {outcome ? <span className="text-xs text-foreground-secondary">{outcome}</span> : null}
                                {phase.status === 'error' ? <span className="text-xs text-danger">失败</span> : null}
                            </li>
                        );
                    })}
                </ol>
            ) : <p className="settings-help">这次运行没有阶段记录。</p>}
        </section>
    );
}

export function AgentPerformancePanel({ active = true }: { active?: boolean }) {
    const [days, setDays] = useState(7);
    const [report, setReport] = useState<AgentRunMetricsReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [metrics, setMetrics] = useState<AgentRunMetricsRow | null>(null);
    const [detailError, setDetailError] = useState<string | null>(null);
    // 只采用最近一次请求的结果：切换范围或运行后，较早发出的请求不能覆盖新结果。
    const reportSeq = useRef(0);
    const detailSeq = useRef(0);

    const loadReport = useCallback(async () => {
        const seq = ++reportSeq.current;
        try {
            const data = await requestBrowserData<AgentRunMetricsReport>(
                `/api/admin/agent-metrics?days=${days}`,
                { method: 'GET' },
                { fallbackMessage: '获取 Agent 运行指标失败' },
            );
            if (seq !== reportSeq.current) return;
            setReport(data);
            setError(null);
        } catch (reason) {
            if (seq !== reportSeq.current) return;
            setError(reason instanceof Error && reason.message ? reason.message : '获取 Agent 运行指标失败');
        } finally {
            if (seq === reportSeq.current) setLoading(false);
        }
    }, [days]);

    const loadMetrics = useCallback(async (id: string) => {
        const seq = ++detailSeq.current;
        try {
            const data = await requestBrowserData<{ metrics: AgentRunMetricsRow }>(
                `/api/admin/agent-metrics/${encodeURIComponent(id)}`,
                { method: 'GET' },
                { fallbackMessage: '读取运行指标失败' },
            );
            if (seq !== detailSeq.current) return;
            setMetrics(data.metrics);
            setDetailError(null);
        } catch (reason) {
            if (seq !== detailSeq.current) return;
            setDetailError(reason instanceof Error && reason.message ? reason.message : '读取运行指标失败');
        }
    }, []);

    useEffect(() => {
        if (active) void Promise.resolve().then(loadReport);
    }, [active, loadReport]);

    useEffect(() => {
        if (active && selectedId) void Promise.resolve().then(() => loadMetrics(selectedId));
    }, [active, selectedId, loadMetrics]);

    const select = (id: string | null) => {
        detailSeq.current++;
        setSelectedId(id);
        setDetailError(null);
        setMetrics(null);
    };

    const shown = metrics && metrics.runId === selectedId ? metrics : null;

    return (
        <div data-testid="agent-metrics" className="flex flex-col gap-4">
            <p className="settings-help">
                运行指标由 worker 在任务结束时写入，只记阶段、耗时、重试、故障与 token，不含消息正文、工具参数或结果；保留 30 天。总耗时与首字延迟看 P50/P95，工具占比是工具阶段耗时占运行总耗时，挂起指 Pi 把任务停放在半途（task_parked）。
            </p>

            {error ? (
                <div role="alert" className="settings-alert">
                    {error}
                    <Button variant="ghost" size="xs" onClick={() => { void loadReport(); }}>重试</Button>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="group" aria-label="统计范围" className="flex flex-wrap items-center gap-1.5">
                    {AGENT_METRICS_DAYS.map(value => (
                        <FilterChip key={value} pressed={days === value} onClick={() => { setDays(value); setLoading(true); }} className="settings-filter">{RANGE_LABEL[value]}</FilterChip>
                    ))}
                </div>
                <Button variant="secondary" size="sm" onClick={() => { void loadReport(); }}>
                    <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                    刷新
                </Button>
            </div>

            {loading && !report ? <SoundWaveLoader variant="block" /> : null}

            {report && !report.models.length ? (
                <div className={`flex flex-col items-center gap-1.5 px-6 py-12 text-center ${CARD}`}>
                    <p className="text-[15px] text-foreground">{RANGE_LABEL[days]}还没有已结束运行的指标</p>
                    <p className="settings-help">任务完成后在这里出现；旧任务没有遥测数据。</p>
                </div>
            ) : null}

            {report && report.models.length ? (
                <div className={`relative overflow-x-auto ${CARD}`}>
                    <table className="w-full min-w-[52rem] border-collapse" aria-label="按模型统计的 Agent 运行指标">
                        <thead>
                            <tr className="border-b border-border">
                                <th scope="col" className={`${TH} pl-5`}>模型</th>
                                <th scope="col" className={TH}>运行</th>
                                <th scope="col" className={TH}>总耗时 P50 / P95</th>
                                <th scope="col" className={TH}>首字 P50 / P95</th>
                                <th scope="col" className={TH}>工具占比</th>
                                <th scope="col" className={TH}>失败率</th>
                                <th scope="col" className={`${TH} pr-5`}>挂起率</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.models.map(model => (
                                <tr key={model.modelId} className="border-b border-border last:border-b-0">
                                    <th scope="row" className="max-w-[16rem] truncate py-2.5 pl-5 pr-3 text-left font-normal text-sm text-foreground">{model.modelId}</th>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{model.runs}</td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{`${formatAgentDuration(model.p50TotalMs)} / ${formatAgentDuration(model.p95TotalMs)}`}</td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">
                                        {model.p50FirstTokenMs === null ? '—' : `${formatAgentDuration(model.p50FirstTokenMs)} / ${model.p95FirstTokenMs === null ? '—' : formatAgentDuration(model.p95FirstTokenMs)}`}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{formatRate(model.toolShare)}</td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{formatRate(model.failureRate)}</td>
                                    <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-[13px] tabular-nums text-foreground-secondary">{formatRate(model.hangRate)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}

            {report && report.runs.length ? (
                <div className={`relative overflow-x-auto ${CARD}`}>
                    <table className="w-full min-w-[46rem] border-collapse" aria-label="最近的 Agent 运行">
                        <thead>
                            <tr className="border-b border-border">
                                <th scope="col" className={`${TH} pl-5`}>运行</th>
                                <th scope="col" className={TH}>状态</th>
                                <th scope="col" className={TH}>模型</th>
                                <th scope="col" className={TH}>总耗时</th>
                                <th scope="col" className={TH}>首字</th>
                                <th scope="col" className={TH}>重试 / 故障 / 挂起</th>
                                <th scope="col" className={`${TH} pr-5`}>结束</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.runs.map(run => (
                                <tr key={run.runId} className={`border-b border-border last:border-b-0 ${run.runId === selectedId ? 'bg-background-secondary/60' : ''}`}>
                                    <th scope="row" className="max-w-[14rem] py-2.5 pl-5 pr-3 text-left font-normal">
                                        <Button unstyled
                                            type="button"
                                            onClick={() => select(run.runId === selectedId ? null : run.runId)}
                                            aria-pressed={run.runId === selectedId}
                                            className="font-mono text-xs text-foreground-secondary underline-offset-2 hover:underline"
                                        >
                                            {run.runId.slice(0, 8)}
                                        </Button>
                                    </th>
                                    <td className={`whitespace-nowrap px-3 py-2.5 text-[13px] ${STATUS[run.status].tone}`}>{STATUS[run.status].label}</td>
                                    <td className="max-w-[12rem] truncate px-3 py-2.5 text-[13px] text-foreground-secondary">{run.modelId}</td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{formatAgentDuration(run.totalMs)}</td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{run.firstTokenMs === null ? '—' : formatAgentDuration(run.firstTokenMs)}</td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums text-foreground-secondary">{`${run.retries} / ${run.faults} / ${run.hangs}`}</td>
                                    <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-[13px] tabular-nums text-foreground-secondary">{formatTime(run.endedAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}

            {selectedId && detailError ? (
                <div role="alert" className="settings-alert">
                    {detailError}
                    <Button variant="ghost" size="xs" onClick={() => { void loadMetrics(selectedId); }}>重试</Button>
                </div>
            ) : null}
            {selectedId && !shown && !detailError ? <SoundWaveLoader variant="block" /> : null}
            {shown ? <div className={`p-5 ${CARD}`}><PhaseTimeline metrics={shown} /></div> : null}
        </div>
    );
}
