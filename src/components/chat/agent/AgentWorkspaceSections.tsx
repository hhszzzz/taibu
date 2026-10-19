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
import type { NavIcon } from '@/lib/navigation/registry';
import { AgentContextOverview } from './AgentContextUsage';
import { ChartThumb } from './chart-preview';
import { getChartKindMeta } from './chart-registry';
import {
    describeOverviewFacts, getAgentArtifactHref, getAgentLocatedPositions, getAgentReadingState,
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

/** 计算结果行：缩略区画能一眼认出的形（大运三步、运限三层），第二行给缩略图之外的结论。 */
function calculationRow(card: CalculationCard): { thumb: ReactNode; facts: string } {
    const fallback = summarizeAgentTool(card.tool) ?? '';
    switch (card.value.kind) {
        case 'bazi_dayun': {
            const year = new Date().getFullYear();
            return {
                thumb: <span className="chart-thumb-glyphs" aria-hidden="true">{getDayunWindow(card.value.data.大运列表, year).map(period =>
                    <b key={period.起运年份} data-current={period.current || undefined}>{period.干支}</b>)}</span>,
                facts: [card.value.data.起运信息.顺逆, card.value.data.起运信息.起运详情].filter(Boolean).join(' · ') || fallback,
            };
        }
        case 'ziwei_horoscope':
            return {
                thumb: <span className="chart-thumb-glyphs" aria-hidden="true">{card.value.data.运限叠宫.slice(0, 3).map(layer => <b key={layer.层次}>{layer.干支}</b>)}</span>,
                facts: card.value.data.运限叠宫.slice(0, 3).map(layer => `${layer.层次}${layer.落入本命宫位}`).join(' · ') || fallback,
            };
        case 'ziwei_flying_star': {
            const rows = card.value.data.查询结果.slice(0, 2);
            return { thumb: null, facts: rows.map(row => [row.查询类型, row.判断目标, row.结果].filter(Boolean).join(' ')).join('；') || fallback };
        }
        case 'bazi_pillars_resolve': {
            const [first] = card.value.data.候选列表;
            return { thumb: null, facts: first ? `${card.value.data.候选列表.length} 个候选 · 首个 ${first.公历} ${first.出生时间}` : '没有匹配的出生时间' };
        }
        case 'almanac_select': {
            const [first] = card.value.data.候选日;
            return { thumb: null, facts: first ? `${card.value.data.查询.起止日期} · 候选 ${card.value.data.候选日.length} 天 · 首个 ${first.日期}` : `${card.value.data.查询.起止日期} · 没有符合条件的日期` };
        }
        default:
            return { thumb: null, facts: fallback };
    }
}

/**
 * 概览的一行：左侧固定 96×72 缩略区，右侧三层——名称与状态、缩略图之外的事实、这件成果上发生过什么。
 * 所有行同高，缩略区里不写说明文字，避免与第二行重复。
 */
function OverviewRow({ thumb, icon: Icon, title, badge, facts, tags, onOpen, label, ...data }: {
    thumb: ReactNode; icon: LucideIcon | NavIcon; title: string; badge?: { text: string; state?: string };
    facts: string; tags: ReactNode; onOpen?: () => void; label?: string;
    'data-overview-result'?: string; 'data-overview-card'?: string;
}) {
    const body = <>
        <span className="agent-ws-row-thumb">{thumb ?? <Icon size={22} aria-hidden="true" />}</span>
        <span className="agent-ws-row-body">
            <span className="agent-ws-row-head"><strong>{title}</strong>{badge && <span data-state={badge.state}>{badge.text}</span>}</span>
            <span className="agent-ws-row-facts">{facts}</span>
            <span className="agent-ws-row-tags">{tags}</span>
        </span>
    </>;
    return onOpen
        ? <button type="button" className="agent-ws-row" onClick={onOpen} aria-label={label} {...data}>{body}</button>
        : <div className="agent-ws-row" {...data}>{body}</div>;
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
 * calculations, and the evidence and chart positions answers rest on, one equal-height
 * row each. The task summary and export live in the header, not here.
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
    const located = (resource: AgentWorkspaceResource) => model.evidence.filter(item => item.kind === 'chart' && model.chartResources.get(item.focus.reference) === resource.id).length;
    const others = model.resources.filter(resource => !['chart', 'saved', 'calculation', 'evidence', 'attachment'].includes(resource.view));
    const attachments = model.resources.filter(resource => resource.view === 'attachment');
    const grounded = Boolean(evidence) || positions.toolIds.length > 0;
    const count = readings.length + calculations.length + savedOnly.length + (grounded ? 1 : 0);
    return <section className="agent-ws-view agent-ws-overview" aria-labelledby={id}>
        <header className="agent-ws-heading agent-ws-overview-heading">
            <h2 id={id}>本对话的成果</h2>
            {count > 0 && <span>{count} 项</span>}
        </header>
        {count === 0 ? <p className="agent-ws-overview-empty"><Files size={16} aria-hidden="true" />Agent 排盘、计算或检索后，成果会汇总在这里。</p>
            : <div className="agent-ws-rows">
                {readings.map(({ resource, value, state, source, drilldowns }) => {
                    const meta = getChartKindMeta(value.kind);
                    const facts = describeOverviewFacts(source, value);
                    const marks = located(resource);
                    const tags = [drilldowns > 0 && `详查 ${drilldowns}`, marks > 0 && `定位 ${marks}`].filter((tag): tag is string => Boolean(tag));
                    return <OverviewRow key={resource.id} data-overview-result="reading" icon={meta.icon} thumb={<ChartThumb value={value} />}
                        title={value.title} badge={{ text: READING_BADGES[state][0], state: READING_BADGES[state][1] }} facts={facts}
                        tags={tags.length ? tags.map(tag => <em key={tag}>{tag}</em>) : <span>查看完整盘面</span>}
                        label={`${value.title}：${facts}${tags.length ? `，${tags.join('，')}` : ''}，${READING_BADGES[state][0]}`}
                        onOpen={() => onOpen(resource.id)} />;
                })}
                {calculations.map(card => {
                    const row = calculationRow(card);
                    return <OverviewRow key={card.resource.id} data-overview-result="calculation" icon={Sigma} thumb={row.thumb}
                        title={card.resource.title} badge={{ text: '未另存', state: 'cached' }} facts={row.facts}
                        tags={<span>计算结果 · 查看明细</span>} label={`${card.resource.title}：${row.facts}`} onOpen={() => onOpen(card.resource.id)} />;
                })}
                {savedOnly.map(artifact => <OverviewRow key={artifact.id} data-overview-result="saved" icon={Files} thumb={null}
                    title={artifact.title} badge={{ text: '已保存', state: 'saved' }} facts={artifact.recordId ? '分析记录' : '命盘'}
                    tags={<>
                        {!artifact.recordId && <button type="button" onClick={() => onOpen(`chart:${artifact.id}`)}>预览命盘</button>}
                        <Link href={getAgentArtifactHref(artifact)!}>打开<ArrowUpRight size={12} aria-hidden="true" /></Link>
                    </>} />)}
                {grounded && <OverviewRow data-overview-card="evidence" icon={BookOpen} thumb={null} title="依据与定位"
                    facts={[...(evidence ? AGENT_EVIDENCE_KINDS.filter(kind => kind !== 'chart').map(kind => `${AGENT_EVIDENCE_LABELS[kind]} ${evidence[kind]}`) : []), `盘面定位 ${positions.toolIds.length}`].join(' · ')}
                    tags={<span>{sources.length ? `${sources.slice(0, 2).join('、')}${sources.length > 2 ? ` 等 ${sources.length} 个来源` : ''}`
                        : positions.labels.length ? `${positions.labels.slice(0, OVERVIEW_LABELS).join(' · ')}${positions.labels.length > OVERVIEW_LABELS ? ' 等' : ''}` : '检索没有返回可引用的内容'}</span>}
                    onOpen={() => onOpen(evidence ? 'evidence' : `tool:${positions.toolIds.at(-1)}`)} />}
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
