'use client';
// 需要点击事件在工作区内切换标签，并在概览中直接导出对话

import { useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';
import { ArrowUpRight, BookOpen, BookmarkPlus, Calculator, ChevronDown, ChevronRight, CircleHelp, Database, Files, FileCode2, FileText, Globe, GripVertical, ImagePlus, ListChecks, ScanSearch, Search, Sigma, Sparkles, Users, Wrench, type LucideIcon } from 'lucide-react';
import { type AgentMessageData, type AgentRunView } from '@/lib/agent/types';
import { getAgentCalculation, getAgentChart, getAgentPlan, getAgentUnrepresentedArtifacts, type AgentCalculation, type AgentChart, type AgentToolPart } from '@/lib/agent/tool-presentation';
import { getAgentToolFamily } from '@/lib/agent/tool-catalog';
import type { AgentWorkspaceModel, AgentWorkspaceResource } from '@/lib/agent/workspace';
import { resolveClientModelName } from '@/lib/ai/model-name-cache';
import type { NavIcon } from '@/lib/navigation/registry';
import { AgentContextOverview, type ContextSkills } from './AgentContextUsage';
import { ChartThumb } from './chart-preview';
import { ModelAvatar } from './ModelAvatar';
import { getChartKindMeta } from './chart-registry';
import {
    describeOverviewFacts, getAgentArtifactHref, getAgentReadingState,
    getDayunWindow, summarizeAgentTool, type AgentArtifact,
} from './presentation';

export const WORKSPACE_ICONS: Record<AgentWorkspaceResource['family'], LucideIcon> = {
    chart: Calculator, calculation: Sigma, drilldown: ScanSearch, search: Search, data: Database, method: BookOpen, skill: Sparkles, plan: ListChecks, todo: ListChecks,
    question: CircleHelp, collaboration: Users, memory: Database, archive: BookmarkPlus, code: FileCode2, external: Globe, image: ImagePlus, other: Wrench,
    saved: Files, attachment: FileText,
};

/** How a reading card names what became of it, and the state its badge is styled by. */
const READING_BADGES = { 已保存: ['已保存', 'saved'], 暂存成果: ['未另存', 'cached'], 已存资料: ['已存资料', 'record'] } as const;

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
        case 'bazi_hepan': {
            const { 双方: people, 日柱之间: day, 年柱之间: year, 其余关系: other } = card.value.data;
            return {
                thumb: <span className="chart-thumb-glyphs" aria-hidden="true">{people.map(person => <b key={person.称呼}>{person.四柱[2].干支}</b>)}</span>,
                facts: `${people.map(person => `${person.称呼}属${person.生肖}`).join('、')} · 日柱之间 ${day.length} 项 · 年柱之间 ${year.length} 项 · 其余 ${other.length} 项`,
            };
        }
        case 'bazi_hour_candidates': {
            const { 出生日期: birth, 候选: candidates, 前事年份: events } = card.value.data;
            return {
                thumb: <span className="chart-thumb-glyphs" aria-hidden="true">{candidates.slice(0, 3).map(candidate => <b key={candidate.序号}>{candidate.时柱.干支}</b>)}</span>,
                facts: `${birth.公历} · 候选 ${candidates.length} 个时辰${events ? ` · 比对前事 ${events.map(event => event.年份).join('、')}` : ''}`,
            };
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
        ? <Button unstyled type="button" className="agent-ws-row" onClick={onOpen} aria-label={label} {...data}>{body}</Button>
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
            <Button unstyled type="button" className="agent-ws-status-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
                <span>多模型协作</span>
                {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
            </Button>
            {grip}
            <span className="agent-ws-status-count">{members.length}</span>
        </div>
        {open && <div className="agent-rail-body">
            <div className="agent-rail-row"><ModelAvatar member={{ model: data?.runtime?.model.id }} size={15} /><span>{main}</span><span className="agent-rail-meta">主模型</span></div>
            {members.map(member => <div key={member.id} className="agent-rail-row">
                <ModelAvatar member={{ model: member.model }} size={15} />
                <span>{member.name || '未命名成员'}</span>
                <span className="agent-rail-meta">{resolveClientModelName(member.model)}</span>
            </div>)}
        </div>}
    </section>;
}

type RailCardKind = 'models' | 'context' | 'results';
const RAIL_CARD_LABELS: Record<RailCardKind, string> = { models: '多模型协作', context: '上下文', results: '成果' };

type CardDrag = { kind: RailCardKind; pointer: number; startY: number; dy: number; from: number; to: number; tops: number[]; heights: number[] };

/**
 * 会话状态卡：模型（仅协作时）/ 上下文 / 成果；按住手柄拖动排序，整张卡跟着指针走，
 * 其余卡片实时让位，松手落位；Alt+↑↓ 同效。
 */
export function WorkspaceStatusCards({ data, run, afterContext, skills, onOpen }: {
    data?: AgentMessageData; run?: WorkspaceRunInfo; afterContext?: (grip: ReactNode) => ReactNode;
    /** 本任务用过的方法，列在上下文卡的「技能」一行下。 */
    skills?: ContextSkills;
    onOpen?: (id: string) => void;
}) {
    const [order, setOrder] = useState<RailCardKind[]>(['models', 'context', 'results']);
    const [drag, setDrag] = useState<CardDrag | null>(null);
    const cards = useRef(new Map<RailCardKind, HTMLDivElement>());
    if (!data) return null;
    const shown = (kind: RailCardKind) => kind === 'models' ? (run?.configuration?.collaborators.length ?? 0) > 0 : kind === 'results' ? afterContext !== undefined : true;
    const available = order.filter(shown);
    const nudge = (kind: RailCardKind, delta: number) => setOrder(current => {
        const visible = current.filter(shown);
        const target = visible[visible.indexOf(kind) + delta];
        if (!target) return current;
        const next = current.filter(item => item !== kind);
        next.splice(next.indexOf(target) + (delta > 0 ? 1 : 0), 0, kind);
        return next;
    });
    const start = (kind: RailCardKind, event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const rects = available.map(item => cards.current.get(item)?.getBoundingClientRect());
        if (rects.some(rect => !rect)) return;
        const from = available.indexOf(kind);
        setDrag({ kind, pointer: event.pointerId, startY: event.clientY, dy: 0, from, to: from, tops: rects.map(rect => rect!.top), heights: rects.map(rect => rect!.height) });
    };
    const move = (event: ReactPointerEvent<HTMLButtonElement>) => setDrag(current => {
        if (!current || current.pointer !== event.pointerId) return current;
        const dy = event.clientY - current.startY;
        // 被拖的卡中线越过哪张卡的中线，就落到那张卡的位置。
        const middle = current.tops[current.from] + current.heights[current.from] / 2 + dy;
        const to = current.tops.filter((top, index) => index !== current.from && top + current.heights[index] / 2 < middle).length;
        return { ...current, dy, to };
    });
    const end = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!drag || drag.pointer !== event.pointerId) return;
        if (drag.to !== drag.from) setOrder(current => {
            const visible = current.filter(shown).filter(item => item !== drag.kind);
            visible.splice(drag.to, 0, drag.kind);
            return [...visible, ...current.filter(item => !shown(item))];
        });
        setDrag(null);
    };
    /** 拖动时其余卡片让出被拖卡片的高度（含间距）。 */
    const shift = (index: number) => {
        if (!drag || index === drag.from) return 0;
        const room = drag.heights[drag.from] + RAIL_CARD_GAP;
        if (drag.from < index && index <= drag.to) return -room;
        if (drag.to <= index && index < drag.from) return room;
        return 0;
    };
    // 拖动把手 = claude tile 头行的「移动」钮：紧跟标题、悬停显形。
    const grip = (kind: RailCardKind) => <Button unstyled type="button" className="agent-rail-card-grip" aria-label={`移动${RAIL_CARD_LABELS[kind]}卡片`}
        onPointerDown={event => start(kind, event)} onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}
        onKeyDown={event => {
            if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
            event.preventDefault();
            nudge(kind, event.key === 'ArrowUp' ? -1 : 1);
        }}><GripVertical size={12} aria-hidden="true" /></Button>;
    return <div className="agent-ws-status-cards" data-dragging={drag ? 'true' : undefined}>
        {available.map((kind, index) => <div key={kind} ref={node => { if (node) cards.current.set(kind, node); else cards.current.delete(kind); }}
            className="agent-rail-card" data-dragged={drag?.kind === kind || undefined}
            style={drag ? { transform: `translateY(${drag.kind === kind ? drag.dy : shift(index)}px)` } : undefined}>
            {kind === 'models' ? <ModelsCard data={data} run={run} grip={grip(kind)} />
                : kind === 'context' ? <AgentContextOverview runtime={data.runtime} working={data.status === 'running'} grip={grip(kind)} skills={skills} onOpen={onOpen} />
                : afterContext?.(grip(kind))}
        </div>)}
    </div>;
}
/** 与 .agent-ws-status-cards 的 gap 一致。 */
const RAIL_CARD_GAP = 8;

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
    const located = (resource: AgentWorkspaceResource) => model.evidence.filter(item => item.kind === 'chart' && model.chartResources.get(item.focus.reference) === resource.id).length;
    // 过程资料不再单列：读过、问过、写过的每一步都在聊天里的工具调用过程块中，重复一遍只会让人以为是另一份东西。
    const attachments = model.resources.filter(resource => resource.view === 'attachment');
    // 计划是任务的纲领，超出「成果」的范围，因此在概览顶部单独一行；读过的技能在「上下文」卡里。
    const plan = model.resources.find(resource => resource.view === 'plan');
    const PlanIcon = plan ? WORKSPACE_ICONS[plan.family] : null;
    const planTool = plan && [...plan.toolIds].reverse().map(toolId => model.toolsById.get(toolId)).find(Boolean);
    const planState = planTool ? summarizeAgentTool(planTool) : null;
    const planPreview = planTool && (() => {
        const value = getAgentPlan(planTool);
        // 预览取第一行正文，去掉 Markdown 标题、引用、列表记号。
        const line = value?.plan.split('\n').map(text => text.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)、]\s*)/u, '').trim()).find(Boolean);
        return line ? (line.length > 40 ? `${line.slice(0, 40)}…` : line) : null;
    })();
    const count = readings.length + calculations.length + savedOnly.length;
    return <section className="agent-ws-view agent-ws-overview" aria-labelledby={id}>
        <header className="agent-ws-heading agent-ws-overview-heading">
            <h2 id={id}>本对话的成果</h2>
            {count > 0 && <span>{count} 项</span>}
        </header>
        {plan && <section className="agent-ws-overview-links" aria-label="分析计划">
            <h3>分析计划{planState && <span> {planState}</span>}</h3>
            <div className="agent-ws-links"><Button unstyled type="button" className="agent-secondary-button" onClick={() => onOpen(plan.id)}>
                {PlanIcon && <PlanIcon size={12} aria-hidden="true" />}{planPreview ?? '查看计划'}
            </Button></div>
        </section>}
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
                        {!artifact.recordId && <Button unstyled type="button" onClick={() => onOpen(`chart:${artifact.id}`)}>预览命盘</Button>}
                        <Link href={getAgentArtifactHref(artifact)!}>打开<ArrowUpRight size={12} aria-hidden="true" /></Link>
                    </>} />)}
            </div>}
        {attachments.length > 0 && <section className="agent-ws-overview-links" aria-label="对话资料">
            <h3>对话资料 <span>{attachments.length}</span></h3>
            <div className="agent-ws-links">{attachments.map(resource => <Button unstyled key={resource.id} type="button" className="agent-secondary-button" onClick={() => onOpen(resource.id)}><FileText size={12} aria-hidden="true" />{resource.title}</Button>)}</div>
        </section>}
    </section>;
}
