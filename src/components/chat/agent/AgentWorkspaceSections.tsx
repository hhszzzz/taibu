'use client';
// 需要点击事件在工作区内切换标签，并在概览中直接导出对话

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, BookOpen, Calculator, ChevronDown, ChevronRight, CircleHelp, Cpu, Database, Files, FileText, Globe, GripVertical, ListChecks, ScanSearch, Search, Sigma, Users, Wrench, type LucideIcon } from 'lucide-react';
import { type AgentMessageData, type AgentRunView } from '@/lib/agent/types';
import { getAgentCalculation, getAgentChart, getAgentUnrepresentedArtifacts, type AgentCalculation, type AgentChart, type AgentToolPart } from '@/lib/agent/tool-presentation';
import { getAgentToolFamily } from '@/lib/agent/tool-catalog';
import { AGENT_EVIDENCE_KINDS, AGENT_EVIDENCE_LABELS, countAgentEvidence } from '@/lib/agent/evidence';
import type { AgentWorkspaceModel, AgentWorkspaceResource } from '@/lib/agent/workspace';
import { resolveClientModelName } from '@/lib/ai/model-name-cache';
import { AgentContextOverview } from './AgentContextUsage';
import { ChartMiniPreview } from './chart-preview';
import { getChartKindMeta } from './chart-registry';
import {
    describeAgentChartSubject, getAgentArtifactHref, getAgentLocatedPositions, getAgentReadingState,
    getDayunWindow, summarizeAgentTool, type AgentArtifact,
} from './presentation';

export const WORKSPACE_ICONS: Record<AgentWorkspaceResource['family'], LucideIcon> = {
    chart: Calculator, calculation: Sigma, drilldown: ScanSearch, search: Search, data: Database, method: BookOpen, plan: ListChecks,
    question: CircleHelp, collaboration: Users, memory: Database, artifacts: ListChecks, external: Globe, other: Wrench,
    saved: Files, attachment: FileText,
};

/** How a reading card names what became of it, and the state its badge is styled by. */
const READING_BADGES = { 已保存: ['已保存', 'saved'], 暂存成果: ['未另存', 'cached'], 已存资料: ['已存资料', 'record'] } as const;
const OVERVIEW_LABELS = 4;

export type WorkspaceRunInfo = Partial<Pick<AgentRunView, 'billing' | 'configuration' | 'createdAt'>>;

type ReadingCard = { resource: AgentWorkspaceResource; value: AgentChart; state: keyof typeof READING_BADGES; source: AgentToolPart; drilldowns: number };
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
            const drilldowns = tools.filter(tool => getAgentToolFamily(tool.name) === 'drilldown' && tool.status === 'completed').length;
            if (value && source) readings.push({ resource, value, state: getAgentReadingState(source, saved), source, drilldowns });
        } else if (resource.view === 'calculation') {
            const tool = tools.findLast(item => getAgentCalculation(item));
            const value = tool && getAgentCalculation(tool);
            if (tool && value) calculations.push({ resource, tool, value });
        }
    }
    return { readings, calculations };
}

/** 计算结果的小图：大运取当前前后三步，运限列各层干支，飞星列查询结论，反推列候选时间。 */
function CalculationPreview({ card }: { card: CalculationCard }) {
    const fallback = <span className="agent-ws-overview-note">{summarizeAgentTool(card.tool) ?? card.resource.title}</span>;
    switch (card.value.kind) {
        case 'bazi_dayun': {
            const year = new Date().getFullYear();
            return <span className="agent-ws-overview-periods" aria-hidden="true">{getDayunWindow(card.value.data.大运列表, year).map(period =>
                <span key={period.起运年份} data-current={period.current || undefined}><b>{period.干支}</b>{period.起运年份}{period.current ? ' 当前' : ''}</span>)}</span>;
        }
        case 'ziwei_horoscope':
            return <span className="agent-ws-overview-periods" aria-hidden="true">{card.value.data.运限叠宫.slice(0, 3).map(layer =>
                <span key={layer.层次}><b>{layer.干支}</b>{layer.层次} · {layer.落入本命宫位}</span>)}</span>;
        case 'ziwei_flying_star': {
            const rows = card.value.data.查询结果.slice(0, 2);
            return rows.length ? <span className="agent-ws-overview-note">{rows.map(row => [row.查询类型, row.判断目标, row.结果].filter(Boolean).join(' ')).join('；')}</span> : fallback;
        }
        case 'bazi_pillars_resolve': {
            const [first] = card.value.data.候选列表;
            return <span className="agent-ws-overview-note">{first ? `${card.value.data.候选列表.length} 个候选 · 首个 ${first.公历} ${first.出生时间}` : '没有匹配的出生时间'}</span>;
        }
        case 'almanac_select': {
            const [first] = card.value.data.候选日;
            return <span className="agent-ws-overview-note">{first ? `${card.value.data.查询.起止日期} · 候选 ${card.value.data.候选日.length} 天 · 首个 ${first.日期}` : `${card.value.data.查询.起止日期} · 没有符合条件的日期`}</span>;
        }
        default:
            return fallback;
    }
}

/** 会话栏的模型卡：只展示多模型协作成员（单模型不占右栏空间）。 */
function ModelsCard({ data, run, grip }: { data?: AgentMessageData; run?: WorkspaceRunInfo; grip?: ReactNode }) {
    const [open, setOpen] = useState(true);
    const main = data?.runtime?.model.name ?? '尚未调用模型';
    const members = run?.configuration?.collaborators ?? [];
    if (members.length === 0) return null;
    return <section className="agent-ws-status-card" aria-label="多模型协作">
        <div className="agent-ws-status-head">
            <button type="button" className="agent-ws-status-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
                <span>多模型协作</span>
                {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
            </button>
            {grip}
            <span className="agent-ws-status-count">{members.length}</span>
        </div>
        {open && <div className="agent-rail-body">
            <div className="agent-rail-row"><Cpu size={16} aria-hidden="true" /><span>{main}</span><span className="agent-rail-meta">主模型</span></div>
            {members.map(member => <div key={member.id} className="agent-rail-row">
                <Cpu size={16} aria-hidden="true" />
                <span>{member.name || '未命名成员'}</span>
                <span className="agent-rail-meta">{resolveClientModelName(member.model)}</span>
            </div>)}
        </div>}
    </section>;
}

type RailCardKind = 'models' | 'context' | 'results';
const RAIL_CARD_LABELS: Record<RailCardKind, string> = { models: '多模型协作', context: '上下文', results: '成果' };

/** 会话状态卡：模型（仅协作时）/ 上下文 / 成果；手柄可拖动排序，Alt+↑↓ 同效。 */
export function WorkspaceStatusCards({ data, run, afterContext }: { data?: AgentMessageData; run?: WorkspaceRunInfo; afterContext?: (grip: ReactNode) => ReactNode }) {
    const [order, setOrder] = useState<RailCardKind[]>(['models', 'context', 'results']);
    if (!data) return null;
    const available = order.filter(kind => kind === 'models' ? (run?.configuration?.collaborators.length ?? 0) > 0 : kind === 'results' ? afterContext !== undefined : true);
    const move = (from: RailCardKind, to: RailCardKind) => setOrder(current => {
        const next = current.filter(kind => kind !== from);
        next.splice(Math.max(0, next.indexOf(to)), 0, from);
        return next;
    });
    const nudge = (kind: RailCardKind, delta: number) => setOrder(current => {
        const visible = current.filter(item => item === 'models' ? (run?.configuration?.collaborators.length ?? 0) > 0 : item === 'results' ? afterContext !== undefined : true);
        const target = visible[visible.indexOf(kind) + delta];
        if (!target) return current;
        const next = current.filter(item => item !== kind);
        next.splice(next.indexOf(target) + (delta > 0 ? 1 : 0), 0, kind);
        return next;
    });
    // 拖动把手 = claude tile 头行的「移动」钮：紧跟标题、悬停显形，拖动排序，Alt+↑↓ 同效。
    const grip = (kind: RailCardKind) => <button type="button" className="agent-rail-card-grip" aria-label={`移动${RAIL_CARD_LABELS[kind]}卡片`} draggable
        onDragStart={event => { event.dataTransfer.setData('application/x-taibu-rail-card', kind); event.dataTransfer.effectAllowed = 'move'; }}
        onKeyDown={event => {
            if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
            event.preventDefault();
            nudge(kind, event.key === 'ArrowUp' ? -1 : 1);
        }}><GripVertical size={12} aria-hidden="true" /></button>;
    return <div className="agent-ws-status-cards">
        {available.map(kind => <div key={kind} className="agent-rail-card" onDragOver={event => event.preventDefault()} onDrop={event => {
            event.preventDefault();
            const from = event.dataTransfer.getData('application/x-taibu-rail-card') as RailCardKind;
            if (RAIL_CARD_LABELS[from] && from !== kind) move(from, kind);
        }}>
            {kind === 'models' ? <ModelsCard data={data} run={run} grip={grip(kind)} />
                : kind === 'context' ? <AgentContextOverview runtime={data.runtime} working={data.status === 'running'} grip={grip(kind)} />
                : afterContext?.(grip(kind))}
        </div>)}
    </div>;
}

/**
 * 概览: what the conversation produced — readings with whether they were saved,
 * calculations, the evidence answers can cite and the positions the model
 * located. The task summary and export live in the header, not here.
 */
export function WorkspaceOverview({ model, artifacts, saved, onOpen }: {
    model: AgentWorkspaceModel; artifacts: AgentArtifact[];
    /** Artifact IDs saved as final results. */
    saved: ReadonlySet<string>;
    onOpen: (id: string) => void;
}) {
    const id = useId();
    const { readings, calculations } = overviewCards(model, saved);
    const savedOnly = getAgentUnrepresentedArtifacts(model.tools, artifacts).filter(artifact => getAgentArtifactHref(artifact));
    const evidence = model.resources.some(resource => resource.id === 'evidence') ? countAgentEvidence(model.evidence) : null;
    const sources = [...new Set(model.evidence.flatMap(item => item.kind === 'chart' ? [] : [item.result.title]))];
    const positions = getAgentLocatedPositions(model);
    const others = model.resources.filter(resource => !['chart', 'saved', 'calculation', 'evidence', 'attachment'].includes(resource.view));
    const attachments = model.resources.filter(resource => resource.view === 'attachment');
    const empty = !readings.length && !calculations.length && !savedOnly.length && !evidence && !positions.toolIds.length;
    return <section className="agent-ws-view agent-ws-overview" aria-labelledby={id}>
        <header className="agent-ws-heading">
            <h2 id={id}>本对话的成果</h2>
            <p>任务生成的命盘、计算结果与回答依据会显示在这里。</p>
        </header>
        {empty ? <div className="agent-panel-empty"><Files size={28} aria-hidden="true" /><h3>还没有成果</h3><p>Agent 排盘、计算或检索后，结果会汇总在这里。</p></div>
            : <div className="agent-ws-overview-grid">
                {readings.map(({ resource, value, state, source, drilldowns }) => {
                    const meta = getChartKindMeta(value.kind);
                    const subject = describeAgentChartSubject(source, value);
                    return <button key={resource.id} type="button" className="agent-ws-overview-card" data-overview-result="reading" onClick={() => onOpen(resource.id)}
                        aria-label={`${value.title}：${subject}${drilldowns ? `，详查 ${drilldowns} 条` : ''}，${READING_BADGES[state][0]}`}>
                        <span className="agent-ws-overview-kicker"><meta.icon size={14} aria-hidden="true" />{value.title}
                            {drilldowns > 0 && <em>详查 {drilldowns}</em>}
                            <span data-state={READING_BADGES[state][1]}>{READING_BADGES[state][0]}</span></span>
                        <ChartMiniPreview value={value} />
                        <span className="agent-ws-overview-note agent-ws-overview-subject">{subject}</span>
                    </button>;
                })}
                {savedOnly.map(artifact => <div key={artifact.id} className="agent-ws-overview-card" data-overview-result="saved">
                    <span className="agent-ws-overview-kicker">{artifact.recordId ? '分析记录' : '命盘'}<span data-state="saved">已保存</span></span>
                    <span className="agent-ws-overview-title">{artifact.title}</span>
                    <span className="agent-ws-overview-actions">
                        {!artifact.recordId && <button type="button" className="agent-secondary-button" onClick={() => onOpen(`chart:${artifact.id}`)}>预览命盘</button>}
                        <Link className="agent-secondary-button" href={getAgentArtifactHref(artifact)!}>打开<ArrowUpRight size={12} aria-hidden="true" /></Link>
                    </span>
                </div>)}
                {calculations.map(card => <button key={card.resource.id} type="button" className="agent-ws-overview-card" data-overview-result="calculation" onClick={() => onOpen(card.resource.id)}>
                    <span className="agent-ws-overview-kicker"><Sigma size={14} aria-hidden="true" />计算结果<span>未另存</span></span>
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
    </section>;
}
