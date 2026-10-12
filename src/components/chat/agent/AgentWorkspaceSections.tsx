'use client';
// 需要点击事件在工作区内切换标签，并在概览中直接导出对话

import { useId } from 'react';
import Link from 'next/link';
import { ArrowUpRight, BookOpen, Calculator, CircleHelp, Database, Files, FileText, Globe, ListChecks, Search, Users, Wrench, type LucideIcon } from 'lucide-react';
import { isAgentRunTerminal, type AgentMessageData, type AgentPart, type AgentRunView } from '@/lib/agent/types';
import { getAgentToolFamily } from '@/lib/agent/tool-catalog';
import { getAgentCalculation, getAgentChart, getAgentUnrepresentedArtifacts, type AgentCalculation, type AgentChart, type AgentToolPart } from '@/lib/agent/tool-presentation';
import { AGENT_EVIDENCE_KINDS, AGENT_EVIDENCE_LABELS, countAgentEvidence } from '@/lib/agent/evidence';
import type { AgentWorkspaceModel, AgentWorkspaceResource } from '@/lib/agent/workspace';
import { REASONING_EFFORT_LABELS } from '@/lib/chat/model-settings';
import { useConversationExport } from '@/components/chat/ConversationExportDialog';
import { AgentStatus } from './AgentStatus';
import { AgentActivityIndicator } from './AgentActivityGroup';
import { AgentContextDetails, describeAgentContext } from './AgentContextUsage';
import { formatAgentElapsed, useAgentElapsed } from './AgentHeaderStatus';
import { AgentToolDetails } from './AgentToolCard';
import { BaziPillars, CHART_GLYPHS } from './AgentToolResult';
import {
    describeAgentCallNote, describeAgentStep, formatAgentToolDuration, getAgentArtifactHref, getAgentLocatedPositions, getAgentReadingState, getAgentResponseTiming,
    getAgentStepNumbers, getAgentSteps, getAgentTaskDuration, getAgentToolState, getDayunWindow, summarizeAgentTool, type AgentArtifact,
} from './presentation';

export const WORKSPACE_ICONS: Record<AgentWorkspaceResource['family'], LucideIcon> = {
    chart: Calculator, calculation: Calculator, search: Search, data: Database, method: BookOpen, plan: ListChecks,
    question: CircleHelp, collaboration: Users, memory: Database, artifacts: ListChecks, external: Globe, other: Wrench,
    saved: Files, attachment: FileText,
};

const BILLING_LABELS: Record<NonNullable<AgentRunView['billing']>, string> = {
    charged: '本任务计费 1 次，补充与续问不再扣费',
    exempt: '使用自定义模型，不扣平台积分',
    refunded: '未产生内容，已退还积分',
};
/** How a reading card names what became of it, and the state its badge is styled by. */
const READING_BADGES = { 已保存: ['已保存', 'saved'], 暂存成果: ['未另存', 'cached'], 已存资料: ['已存资料', 'record'] } as const;
const OVERVIEW_LABELS = 4;

export type WorkspaceRunInfo = Partial<Pick<AgentRunView, 'billing' | 'configuration' | 'createdAt'>>;

type ReadingCard = { resource: AgentWorkspaceResource; value: AgentChart; state: keyof typeof READING_BADGES };
type CalculationCard = { resource: AgentWorkspaceResource; tool: AgentToolPart; value: AgentCalculation };

/** Readings and calculations of the conversation, one card per tab, from the latest completed call of each. */
function overviewCards(model: AgentWorkspaceModel, saved: ReadonlySet<string>) {
    const readings: ReadingCard[] = [];
    const calculations: CalculationCard[] = [];
    for (const resource of model.resources) {
        const tools = resource.toolIds.flatMap(id => model.toolsById.get(id) ?? []);
        if (resource.view === 'chart') {
            const reading = tools.findLast(tool => getAgentChart(tool));
            const value = reading && getAgentChart(reading);
            const source = tools.find(tool => getAgentChart(tool) && tool.name !== 'inspect_chart') ?? reading;
            if (value && source) readings.push({ resource, value, state: getAgentReadingState(source, saved) });
        } else if (resource.view === 'calculation') {
            const tool = tools.findLast(item => getAgentCalculation(item));
            const value = tool && getAgentCalculation(tool);
            if (tool && value) calculations.push({ resource, tool, value });
        }
    }
    return { readings, calculations };
}

function CalculationPreview({ card }: { card: CalculationCard }) {
    if (card.value.kind !== 'bazi_dayun') return <span className="agent-ws-overview-note">{summarizeAgentTool(card.tool) ?? card.resource.title}</span>;
    const year = new Date().getFullYear();
    return <span className="agent-ws-overview-periods" aria-hidden="true">{getDayunWindow(card.value.data.大运列表, year).map(period =>
        <span key={period.起运年份} data-current={period.current || undefined}><b>{period.干支}</b>{period.起运年份}{period.current ? ' 当前' : ''}</span>)}</span>;
}

function OverviewExport({ conversationId }: { conversationId: string }) {
    const id = useId();
    const { tools, setTools, busy, download } = useConversationExport(conversationId);
    return <section className="agent-ws-overview-export" aria-labelledby={id}>
        <h3 id={id}>导出对话</h3>
        <label><input type="checkbox" checked={tools} disabled={busy !== null} onChange={event => setTools(event.target.checked)} />包含工具调用参数与原始结果</label>
        <div>
            <button type="button" className="agent-secondary-button" disabled={busy !== null} onClick={() => void download('md')}>{busy === 'md' ? '正在导出…' : 'Markdown'}</button>
            <button type="button" className="agent-secondary-button" disabled={busy !== null} onClick={() => void download('html')}>{busy === 'html' ? '正在导出…' : '可打印 HTML'}</button>
        </div>
    </section>;
}

/** Time since a working task was created, or how long an ended one took; null when neither was measured. */
function useAgentRunTime(createdAt: string | undefined, data: AgentMessageData | undefined) {
    const ended = !data || isAgentRunTerminal(data.status);
    const elapsed = useAgentElapsed(createdAt, !ended);
    const duration = ended ? getAgentTaskDuration(createdAt, data) : null;
    return elapsed ?? (duration === null ? null : formatAgentElapsed(duration));
}

/** 任务摘要: measured times only, the calls made, the latest context reading and how the task was billed. */
function TaskSummary({ data, run }: { data: AgentMessageData; run?: WorkspaceRunInfo }) {
    const id = useId();
    const elapsed = useAgentRunTime(run?.createdAt, data);
    const timing = getAgentResponseTiming(data.runtime?.responses);
    const steps = getAgentSteps(data.parts);
    const failed = steps.filter(tool => getAgentToolState(tool, data.status).status === 'failed').length;
    const time = [elapsed, timing && `模型响应 ${formatAgentToolDuration(timing.durationMs)} · ${timing.count} 次`].filter(Boolean).join(' · ');
    const context = describeAgentContext(data.runtime);
    return <section className="agent-ws-overview-summary" aria-labelledby={id}>
        <h3 id={id}>任务摘要</h3>
        <dl>
            {time && <><dt>用时</dt><dd>{time}</dd></>}
            <dt>工具</dt><dd>{steps.length} 次调用 · {failed} 次失败</dd>
            {context && <><dt>上下文</dt><dd>{context}</dd></>}
            {run?.billing && <><dt>计费</dt><dd>{BILLING_LABELS[run.billing]}</dd></>}
        </dl>
    </section>;
}

/**
 * 概览: what the conversation produced — readings with whether they were saved,
 * calculations, the evidence answers can cite and the positions the model
 * located — then the latest task's summary and the export.
 */
export function WorkspaceOverview({ model, artifacts, saved, data, run, onOpen, conversationId }: {
    model: AgentWorkspaceModel; artifacts: AgentArtifact[];
    /** Artifact IDs saved as final results. */
    saved: ReadonlySet<string>;
    data?: AgentMessageData; run?: WorkspaceRunInfo;
    onOpen: (id: string) => void; conversationId: string | null;
}) {
    const id = useId();
    const { readings, calculations } = overviewCards(model, saved);
    const savedOnly = getAgentUnrepresentedArtifacts(model.tools, artifacts).filter(artifact => getAgentArtifactHref(artifact));
    const evidence = model.resources.some(resource => resource.id === 'evidence') ? countAgentEvidence(model.evidence) : null;
    const sources = [...new Set(model.evidence.flatMap(item => item.kind === 'chart' ? [] : [item.result.title]))];
    const positions = getAgentLocatedPositions(model);
    const others = model.resources.filter(resource => !['chart', 'saved', 'calculation', 'evidence', 'attachment'].includes(resource.view));
    const attachments = model.resources.filter(resource => resource.view === 'attachment');
    const toolResults = readings.filter(card => card.state === '暂存成果').length + calculations.length;
    const readBack = readings.filter(card => card.state === '已存资料').length;
    const counts = [
        artifacts.length && `${artifacts.length} 份已保存`,
        toolResults && `${toolResults} 份工具结果`,
        readBack && `${readBack} 份已存资料`,
        evidence?.total && `${evidence.total} 条回答依据`,
    ].filter(Boolean).join(' · ');
    const empty = !readings.length && !calculations.length && !savedOnly.length && !evidence && !positions.toolIds.length;
    return <section className="agent-ws-view agent-ws-overview" aria-labelledby={id}>
        <header className="agent-ws-heading">
            <h2 id={id}>本对话的成果</h2>
            <p>{counts ? `${counts}。关闭标签不会删除成果。` : '任务生成的命盘、计算结果与回答依据会显示在这里。'}</p>
        </header>
        {empty ? <div className="agent-panel-empty"><Files size={28} aria-hidden="true" /><h3>还没有成果</h3><p>Agent 排盘、计算或检索后，结果会汇总在这里。</p></div>
            : <div className="agent-ws-overview-grid">
                {readings.map(({ resource, value, state }) => <button key={resource.id} type="button" className="agent-ws-overview-card" data-overview-result="reading" onClick={() => onOpen(resource.id)}>
                    <span className="agent-ws-overview-kicker">命盘<span data-state={READING_BADGES[state][1]}>{READING_BADGES[state][0]}</span></span>
                    {value.kind === 'bazi' ? <BaziPillars chart={value.chart} size="overview" /> : <span className="agent-ws-overview-glyph" aria-hidden="true">{CHART_GLYPHS[value.kind]}</span>}
                    <span className="agent-ws-overview-title">{value.title}{value.kind !== 'bazi' && <small>{value.summary}</small>}</span>
                </button>)}
                {savedOnly.map(artifact => <div key={artifact.id} className="agent-ws-overview-card" data-overview-result="saved">
                    <span className="agent-ws-overview-kicker">{artifact.recordId ? '分析记录' : '命盘'}<span data-state="saved">已保存</span></span>
                    <span className="agent-ws-overview-title">{artifact.title}</span>
                    <span className="agent-ws-overview-actions">
                        {!artifact.recordId && <button type="button" className="agent-secondary-button" onClick={() => onOpen(`chart:${artifact.id}`)}>预览命盘</button>}
                        <Link className="agent-secondary-button" href={getAgentArtifactHref(artifact)!}>打开<ArrowUpRight size={12} aria-hidden="true" /></Link>
                    </span>
                </div>)}
                {calculations.map(card => <button key={card.resource.id} type="button" className="agent-ws-overview-card" data-overview-result="calculation" onClick={() => onOpen(card.resource.id)}>
                    <span className="agent-ws-overview-kicker">计算结果<span>未另存</span></span>
                    <CalculationPreview card={card} />
                    <span className="agent-ws-overview-title">{card.resource.title}
                        {card.value.kind === 'bazi_dayun' && <small>{[card.value.data.起运信息.顺逆, card.value.data.起运信息.起运详情].filter(Boolean).join(' · ')}</small>}</span>
                </button>)}
                {evidence && <button type="button" className="agent-ws-overview-card" data-overview-card="evidence" onClick={() => onOpen('evidence')}>
                    <span className="agent-ws-overview-kicker">回答依据</span>
                    <span className="agent-ws-overview-title">{AGENT_EVIDENCE_KINDS.map(kind => `${AGENT_EVIDENCE_LABELS[kind]} ${evidence[kind]}`).join(' · ')}</span>
                    <span className="agent-ws-overview-note">{sources.length ? `${sources.slice(0, 3).join('、')}${sources.length > 3 ? ` 等 ${sources.length} 个来源` : ''}` : '检索没有返回可引用的内容'}</span>
                </button>}
                {positions.toolIds.length > 0 && <button type="button" className="agent-ws-overview-card" data-overview-card="positions" onClick={() => onOpen(`tool:${positions.toolIds.at(-1)}`)}>
                    <span className="agent-ws-overview-kicker">模型定位</span>
                    <span className="agent-ws-overview-title">{positions.toolIds.length} 个分析位置</span>
                    {positions.labels.length > 0 && <span className="agent-ws-overview-note">{positions.labels.slice(0, OVERVIEW_LABELS).join(' · ')}{positions.labels.length > OVERVIEW_LABELS ? ' 等' : ''}</span>}
                </button>}
            </div>}
        {others.length > 0 && <section className="agent-ws-overview-links" aria-label="过程资料">
            <h3>过程资料 <span>{others.length}</span></h3>
            <div className="agent-ws-links">{others.map(resource => {
                const Icon = WORKSPACE_ICONS[resource.family];
                return <button key={resource.id} type="button" className="agent-secondary-button" onClick={() => onOpen(resource.id)}><Icon size={12} aria-hidden="true" />{resource.title}</button>;
            })}</div>
        </section>}
        {attachments.length > 0 && <section className="agent-ws-overview-links" aria-label="对话资料">
            <h3>对话资料 <span>{attachments.length}</span></h3>
            <div className="agent-ws-links">{attachments.map(resource => <button key={resource.id} type="button" className="agent-secondary-button" onClick={() => onOpen(resource.id)}><FileText size={12} aria-hidden="true" />{resource.title}</button>)}</div>
        </section>}
        {data && <TaskSummary data={data} run={run} />}
        {conversationId && <OverviewExport conversationId={conversationId} />}
    </section>;
}

const TODO_GLYPHS = { completed: '✓', in_progress: '●', pending: '○' } as const;

/** 过程: live status, the task list, the call details of the step being looked at, and every step, each opening its view. */
export function WorkspaceProcessSection({ model, data, run, stepId, onOpen }: {
    model: AgentWorkspaceModel; data?: AgentMessageData; run?: WorkspaceRunInfo;
    /** The step last shown in a view; the latest step when none was. */
    stepId: string | null; onOpen: (id: string) => void;
}) {
    const callHeading = useId();
    const todoHeading = useId();
    const elapsed = useAgentRunTime(run?.createdAt, data);
    if (!data) return <div className="agent-panel-empty"><ListChecks size={28} aria-hidden="true" /><h3>尚未开始任务</h3><p>Agent 会根据问题决定需要哪些步骤。</p></div>;
    const steps: AgentToolPart[] = getAgentSteps(data.parts);
    const numbers = getAgentStepNumbers(data.parts);
    const step = steps.find(tool => tool.id === stepId) ?? steps.at(-1);
    const stepDuration = step && describeAgentStep(step, data.status).duration;
    const note = step && describeAgentCallNote(step);
    const todo = data.parts.findLast((part): part is Extract<AgentPart, { type: 'todo' }> => part.type === 'todo');
    const done = todo?.items.filter(item => item.status === 'completed').length ?? 0;
    const effort = run?.configuration && (run.configuration.reasoning ? run.configuration.reasoningEffort ? `推理 ${REASONING_EFFORT_LABELS[run.configuration.reasoningEffort]}` : '推理 默认' : '不推理');
    return <div className="agent-ws-view agent-ws-process">
        <section className="agent-ws-status" aria-label="任务状态">
            <span className="agent-ws-status-main"><AgentStatus status={data.status} detail={elapsed} /></span>
            <span>{data.runtime?.model.name ?? '尚未调用模型'}{effort ? ` · ${effort}` : ''}</span>
            <AgentContextDetails runtime={data.runtime} />
            {run?.billing && <span>{BILLING_LABELS[run.billing]}</span>}
        </section>
        {todo && <section className="agent-ws-todo" aria-labelledby={todoHeading}>
            <h3 id={todoHeading}>任务清单 <span>{done} / {todo.items.length}</span></h3>
            <ol>{todo.items.map(item => <li key={item.id} data-state={item.status}><span aria-hidden="true">{TODO_GLYPHS[item.status]}</span><span>{item.title}</span></li>)}</ol>
        </section>}
        {step && <section className="agent-ws-call" aria-labelledby={callHeading} data-tool-id={step.id}>
            <h3 id={callHeading}>第 {numbers.get(step.id)} 步 · {step.title}<code>{[step.name, stepDuration].filter(Boolean).join(' · ')}</code></h3>
            <AgentToolDetails tool={step} runStatus={data.status} heading={false} />
            {note && <p className="agent-ws-note">{note}</p>}
        </section>}
        <section className="agent-ws-group" aria-label="任务步骤">
            <h3>步骤 <span>{steps.length}</span></h3>
            {steps.length ? <ol className="agent-ws-steps">
                {steps.map(tool => {
                    const state = getAgentToolState(tool, data.status);
                    const location = model.locations.get(tool.id);
                    const Icon = WORKSPACE_ICONS[getAgentToolFamily(tool.name)];
                    const summary = summarizeAgentTool(tool);
                    return <li key={tool.id} data-state={state.status}>
                        <button type="button" disabled={!location} aria-current={tool.id === step?.id ? 'step' : undefined} onClick={() => location && onOpen(`tool:${tool.id}`)}>
                            <span className="agent-ws-step-number" aria-hidden="true">{numbers.get(tool.id)}</span>
                            <Icon size={13} aria-hidden="true" />
                            <span className="agent-ws-step-label"><span>{tool.title}</span>{summary && <small>{summary}</small>}</span>
                            {typeof tool.durationMs === 'number' && Number.isFinite(tool.durationMs) && tool.durationMs >= 0 && <small>{formatAgentToolDuration(tool.durationMs)}</small>}
                            <small>{state.label}</small>
                        </button>
                    </li>;
                })}
            </ol> : <p className="agent-ws-note">尚未调用工具。</p>}
        </section>
        {data.error && <p className="agent-error" role="alert">{data.error}</p>}
        <AgentActivityIndicator data={data} />
    </div>;
}
