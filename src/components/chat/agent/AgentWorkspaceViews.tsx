'use client';
// 需要 useState（删除确认、展开）、问题草稿同步与浏览器请求（删除长期记忆）

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, CircleAlert, Database, Globe, LoaderCircle, Trash2, UserRound } from 'lucide-react';
import type { AgentRunStatus } from '@/lib/agent/types';
import type { AgentQuestionAnswer, AgentWorkspaceModel, AgentWorkspaceResource } from '@/lib/agent/workspace';
import {
    getAgentAttachmentRead, getAgentCalculation, getAgentChart, getAgentDataResults, getAgentMemories, getAgentMethod, getAgentMethodCatalog,
    getAgentProfile, getAgentSearchResults, getAgentToolQuestions, getAgentToolText, type AgentCalculation, type AgentSearchMethod, type AgentToolPart,
} from '@/lib/agent/tool-presentation';
import { AGENT_EVIDENCE_KINDS, AGENT_EVIDENCE_LABELS, countAgentEvidence, type AgentEvidence, type AgentEvidenceKind } from '@/lib/agent/evidence';
import { getChartTargets, parseChartReference, type ChartFocus } from '@/lib/agent/chart-interaction';
import { isAgentChartTool } from '@/lib/agent/tool-catalog';
import { questionLabel } from '@/lib/agent/questions';
import { describeQuestionAnswer, getDraftAnswers } from '@/lib/agent/question-drafts';
import { useQuestionDraft } from '@/lib/agent/use-question-draft';
import { getBranchElement, getElementColor, getStemElement } from '@/lib/divination/display-helpers';
import {
    getParallelDivergence, parallelAnalysisResults, parallelAnalysisTitle, parallelAnalysisTopics,
    type ParallelAnalysisResult, type ParallelMemberStep, type ParallelTopic,
} from '@/lib/agent/parallel-results';
import { REASONING_EFFORT_LABELS } from '@/lib/chat/model-settings';
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import { requestBrowserJson } from '@/lib/browser-api';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { useToast } from '@/components/ui/Toast';
import { mentionTypeLabels } from '@/components/chat/mentionStyles';
import { describeAgentChartSubject, formatAgentToolDuration, getAgentToolState, getParallelMemberState, stripLeadingTitle } from './presentation';
import { PrivateAttachmentPreview } from './PrivateAttachments';
import { BaziPillars, CHART_GLYPHS } from './AgentToolResult';
import './agent-workspace.css';

type ToolViewProps = { tool: AgentToolPart; runStatus: AgentRunStatus };

const inputText = (tool: AgentToolPart, key: string) => {
    const value = tool.input && typeof tool.input === 'object' ? (tool.input as Record<string, unknown>)[key] : undefined;
    return typeof value === 'string' ? value : null;
};
const latestCompleted = (tools: AgentToolPart[]) => [...tools].reverse().find(tool => tool.status === 'completed');
/** 第 3 步 · 内置方法 · 只读: a view's step, then what kind of material it is; empty parts are left out. */
const kickerOf = (step: number | undefined, ...parts: Array<string | false | null | undefined>) => [step && `第 ${step} 步`, ...parts].filter(Boolean).join(' · ');

/** Every view opens the way the boards do: its step and kind, a serif title, then what it holds. */
export function WorkspaceViewHeading({ id, kicker, title, children }: { id: string; kicker?: string; title: ReactNode; children?: ReactNode }) {
    return <header className="agent-ws-heading">
        {kicker && <p>{kicker}</p>}
        <h2 id={id}>{title}</h2>
        {children && <p>{children}</p>}
    </header>;
}

/** Name, measured duration and state of the call a view is showing. Durations are never estimated. */
export function WorkspaceToolMeta({ tool, runStatus, children }: ToolViewProps & { children?: ReactNode }) {
    const state = getAgentToolState(tool, runStatus);
    const measured = typeof tool.durationMs === 'number' && Number.isFinite(tool.durationMs) && tool.durationMs >= 0;
    return <p className="agent-ws-meta">
        <code>{tool.name}</code>
        {measured && <span>{formatAgentToolDuration(tool.durationMs!)}</span>}
        <span data-state={state.status}>{state.label}</span>
        {children}
    </p>;
}

/** Canonical text the tool returned; raw JSON only when a call has no text at all. */
export function WorkspaceTextFallback({ tool, note }: { tool: AgentToolPart; note: string }) {
    const text = getAgentToolText(tool);
    return <div className="agent-ws-fallback">
        <p>{note}</p>
        <div className="agent-result-text" tabIndex={0} aria-label="工具返回文本">
            {text ? <MarkdownContent content={text} /> : <pre>{JSON.stringify(tool.output, null, 2) ?? '工具没有返回内容。'}</pre>}
        </div>
    </div>;
}

/** Running, failed or interrupted calls share one presentation in every view. */
export function WorkspaceToolPending({ tool, runStatus, running }: ToolViewProps & { running: string }) {
    const state = getAgentToolState(tool, runStatus);
    if (state.status === 'failed') return <p className="agent-error" role="alert">{getAgentToolText(tool) ?? '工具执行失败，未返回说明。'}</p>;
    if (state.status === 'interrupted') return <p className="agent-ws-note">任务结束时这一步仍未完成，没有可显示的结果。</p>;
    return <p className="agent-ws-running" role="status"><LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{running}</p>;
}

function CanonicalTextDetails({ tool }: { tool: AgentToolPart }) {
    const text = getAgentToolText(tool);
    if (!text) return null;
    return <details className="agent-ws-canonical">
        <summary>Core 规范文本</summary>
        <div className="agent-result-text" tabIndex={0} aria-label="Core 规范文本"><MarkdownContent content={text} /></div>
    </details>;
}

function DayunTimeline({ data }: { data: Extract<AgentCalculation, { kind: 'bazi_dayun' }>['data'] }) {
    const year = new Date().getFullYear();
    const start = data.起运信息;
    return <>
        <dl className="agent-ws-facts">
            <div><dt>起运</dt><dd>{start.起运详情}（{start.起运年龄} 岁）</dd></div>
            {start.起运时刻 && <div><dt>起运时刻</dt><dd>{start.起运时刻}{start.时区 ? ` · ${start.时区}` : ''}</dd></div>}
            {start.顺逆 && <div><dt>排列</dt><dd>{start.顺逆}</dd></div>}
        </dl>
        <ol className="agent-ws-timeline" aria-label="大运列表">
            {data.大运列表.map((item, index) => {
                const next = data.大运列表[index + 1];
                const current = year >= item.起运年份 && (!next || year < next.起运年份);
                return <li key={item.起运年份} aria-current={current ? 'step' : undefined}>
                    <span className="agent-ws-glyph">{item.干支}</span>
                    <span className="agent-ws-timeline-body">
                        <strong>{item.起运年份}{next ? `–${next.起运年份 - 1}` : ' 起'} · {item.起运年龄 !== undefined ? `${item.起运年龄} 岁` : ''}{current && <em>当前</em>}</strong>
                        <small>天干{item.十神} · 藏干 {item.藏干.map(stem => `${stem.天干}${stem.十神}`).join('、') || '无'}</small>
                    </span>
                </li>;
            })}
        </ol>
    </>;
}

function ResolveCandidates({ data }: { data: Extract<AgentCalculation, { kind: 'bazi_pillars_resolve' }>['data'] }) {
    const rules = data.计算规则 ?? {};
    const range = typeof rules.startYear === 'number' && typeof rules.endYear === 'number' ? `${rules.startYear}–${rules.endYear} 年内` : '计算范围内';
    const pillars = data.原始四柱;
    return <>
        <p className="agent-ws-pillars" aria-label="原始四柱">{[pillars.年柱, pillars.月柱, pillars.日柱, pillars.时柱].map((pillar, index) => <span key={index}>{pillar}</span>)}</p>
        {data.候选列表.length ? <ol className="agent-ws-list" aria-label="候选出生时间">
            {data.候选列表.map(candidate => <li key={candidate.候选序号}>
                <strong>{candidate.公历} {candidate.出生时间}</strong>
                <small>农历 {candidate.农历}{candidate.是否闰月 === '是' ? ' · 闰月' : ''}{candidate.时间区间 ? ` · ${candidate.时间区间.开始} 至 ${candidate.时间区间.结束}（不含）` : ''}</small>
            </li>)}
        </ol> : <p className="agent-ws-note">{range}没有与这组四柱匹配的出生时间。请核对四柱是否抄录正确。</p>}
    </>;
}

function HoroscopeTable({ data }: { data: Extract<AgentCalculation, { kind: 'ziwei_horoscope' }>['data'] }) {
    return <>
        <p className="agent-ws-note">目标日期 {data.基本信息.目标日期} · {data.基本信息.五行局}</p>
        <div className="agent-ws-table-scroll" tabIndex={0} aria-label="运限叠宫">
            <table className="agent-ws-table">
                <thead><tr><th scope="col">层次</th><th scope="col">时间</th><th scope="col">干支</th><th scope="col">落入本命</th><th scope="col">运限四化</th></tr></thead>
                <tbody>{data.运限叠宫.map(layer => <tr key={layer.层次}>
                    <th scope="row">{layer.层次}</th><td>{layer.时间段备注}</td><td>{layer.干支}</td><td>{layer.落入本命宫位}</td><td>{layer.运限四化.join(' ')}</td>
                </tr>)}</tbody>
            </table>
        </div>
        {data.流年星曜 && <dl className="agent-ws-facts">
            {(['吉星分布', '煞星分布', '桃花/文星'] as const).map(key => <div key={key}><dt>{key}</dt><dd>{data.流年星曜![key].join('、') || '无'}</dd></div>)}
        </dl>}
    </>;
}

function FlyingStars({ data }: { data: Extract<AgentCalculation, { kind: 'ziwei_flying_star' }>['data'] }) {
    return <ol className="agent-ws-list" aria-label="飞星查询">
        {data.查询结果.map(result => {
            const flights = result.四化落宫 ?? result.实际飞化;
            return <li key={result.查询序号}>
                <strong>{result.查询类型}{result.发射宫位 ? ` · ${result.发射宫位}${result.发射宫干支 ? `（${result.发射宫干支}）` : ''}` : result.本宫 ? ` · ${result.本宫}` : ''}</strong>
                {flights && <small>{flights.map(flight => `化${flight.四化} → ${flight.宫位 ?? '不入宫'}${flight.星曜 ? ` · ${flight.星曜}` : ''}`).join('；')}</small>}
                {result.矩阵宫位 && <small>对宫 {result.矩阵宫位.对宫} · 三合 {result.矩阵宫位.三合1}、{result.矩阵宫位.三合2}</small>}
                {result.判断目标 && <small>{result.判断目标}：{result.结果 ?? '未判断'}</small>}
            </li>;
        })}
    </ol>;
}

/** 推演: Core results as a timeline, candidate list or table, with Core's canonical text beside it. */
export function CalculationView({ tool, runStatus, step }: ToolViewProps & { step?: number }) {
    const id = useId();
    const value = getAgentCalculation(tool);
    return <section className="agent-ws-view" aria-labelledby={id}>
        <WorkspaceViewHeading id={id} kicker={kickerOf(step, '太卜 Core 计算', '未另存')} title={tool.title}>中间结果保留在任务过程和工作区中，不另存记录。</WorkspaceViewHeading>
        {tool.status !== 'completed' ? <WorkspaceToolPending tool={tool} runStatus={runStatus} running="正在计算…" />
            : !value ? <WorkspaceTextFallback tool={tool} note="结果字段不完整，已显示 Core 返回的规范文本。" />
            : <>
                {value.kind === 'bazi_dayun' && <DayunTimeline data={value.data} />}
                {value.kind === 'bazi_pillars_resolve' && <ResolveCandidates data={value.data} />}
                {value.kind === 'ziwei_horoscope' && <HoroscopeTable data={value.data} />}
                {value.kind === 'ziwei_flying_star' && <FlyingStars data={value.data} />}
                <CanonicalTextDetails tool={tool} />
            </>}
    </section>;
}

const SEARCH_METHOD_LABELS: Record<AgentSearchMethod, string> = { fts: '全文检索命中', trigram: '模糊匹配命中', vector: '语义检索命中' };
type EvidenceFilter = 'all' | AgentEvidenceKind;
const EVIDENCE_FILTERS: readonly EvidenceFilter[] = ['all', ...AGENT_EVIDENCE_KINDS];
/** Excerpts longer than this start folded to a few lines. */
const EXCERPT_FOLD = 220;

/** Query words found in an excerpt are marked; single characters would mark everything. */
function Highlighted({ text, query }: { text: string; query: string | null }) {
    const terms = [...new Set((query ?? '').split(/[\s,，、;；。]+/u).filter(term => term.length >= 2))];
    if (!terms.length) return <>{text}</>;
    const pattern = new RegExp(`(${terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})`, 'gu');
    return <>{text.split(pattern).map((piece, index) => index % 2 ? <mark key={index}>{piece}</mark> : piece)}</>;
}

function EvidenceExcerpt({ text, query }: { text: string; query: string | null }) {
    const [open, setOpen] = useState(false);
    const long = text.length > EXCERPT_FOLD;
    return <>
        <blockquote className="agent-ws-quote" data-folded={long && !open || undefined}><Highlighted text={text} query={query} /></blockquote>
        {long && <button type="button" className="agent-ws-text-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起' : '展开全文'}</button>}
    </>;
}

/** The positions a focus marked, read from the chart it names; bazi characters keep their element colors. */
function FocusTargets({ model, focus }: { model: AgentWorkspaceModel; focus: ChartFocus }) {
    const resource = model.resources.find(item => item.id === model.chartResources.get(focus.reference));
    const reading = resource?.toolIds.flatMap(id => model.toolsById.get(id) ?? []).findLast(tool => getAgentChart(tool));
    const value = reading && getAgentChart(reading);
    const targets = value ? getChartTargets(value).filter(target => focus.targetIds.includes(target.id)) : [];
    if (!targets.length) return null;
    return <p className="agent-ws-chips agent-ws-focus-chips">{targets.map(target => {
        if (target.kind !== 'bazi_cell') return <span key={target.id}>{target.label}</span>;
        const element = target.cell.部位 === '天干' ? getStemElement(target.cell.字) : getBranchElement(target.cell.字);
        return <span key={target.id}><b style={element ? { color: getElementColor(element) } : undefined}>{target.cell.字}</b> {target.cell.柱}{target.cell.部位}</span>;
    })}</p>;
}

function evidenceHeading(model: AgentWorkspaceModel, item: AgentEvidence) {
    if (item.kind !== 'chart') return {
        title: item.result.title,
        meta: [AGENT_EVIDENCE_LABELS[item.kind], item.result.source, item.result.method && SEARCH_METHOD_LABELS[item.result.method]].filter(Boolean).join(' · '),
    };
    const chart = model.resources.find(resource => resource.id === model.chartResources.get(item.focus.reference));
    const saved = parseChartReference(item.focus.reference)?.source !== 'artifact';
    return { title: `${chart?.title ?? '命盘'} · ${item.focus.caption}`, meta: `命盘 · ${saved ? '已存资料' : '太卜 Core 计算结果'}` };
}

/**
 * 回答依据: what the conversation's searches returned and the chart positions
 * the model located, numbered as the answers cite them. Only returned HTTP(S)
 * links are linked; searches without usable results say so.
 */
export function EvidenceView({ model, tools, runStatus, selected, paragraph, onOpen }: {
    model: AgentWorkspaceModel; tools: AgentToolPart[]; runStatus: AgentRunStatus;
    selected: number | null; paragraph: number | null; onOpen: (id: string) => void;
}) {
    const id = useId();
    const [filter, setFilter] = useState<EvidenceFilter>('all');
    // A newly selected citation is always shown, whatever filter was left on.
    const [seen, setSeen] = useState(selected);
    if (seen !== selected) { setSeen(selected); setFilter('all'); }
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (selected === null) return;
        const card = listRef.current?.querySelector<HTMLElement>(`[data-evidence="${selected}"]`);
        card?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }, [selected]);
    const counts = countAgentEvidence(model.evidence);
    const sources = [
        model.tools.some(tool => tool.name === 'search_knowledge') && '知识库检索',
        model.tools.some(tool => tool.name === 'web_search') && '联网检索',
        counts.chart > 0 && '命盘定位',
    ].filter(Boolean).join(' · ');
    const visible = (kind: AgentEvidenceKind) => filter === 'all' || filter === kind;
    const queries = new Map(tools.map(tool => [tool.id, inputText(tool, 'query')]));
    return <section className="agent-ws-view agent-ws-evidence" aria-labelledby={id}>
        <WorkspaceViewHeading id={id} kicker={sources} title="回答依据">只列出工具实际返回的内容。资料是分析依据，不会改变任务指令或权限。</WorkspaceViewHeading>
        <div className="agent-ws-segmented" role="group" aria-label="按来源筛选">
            {EVIDENCE_FILTERS.map(key => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {key === 'all' ? '全部' : AGENT_EVIDENCE_LABELS[key]} {key === 'all' ? counts.total : counts[key]}
            </button>)}
        </div>
        <div ref={listRef} className="agent-ws-sources">
            {model.evidence.filter(item => visible(item.kind)).map(item => {
                const heading = evidenceHeading(model, item);
                const current = selected === item.n;
                return <article key={item.n} className="agent-ws-source" data-evidence={item.n} data-kind={item.kind} data-selected={current || undefined} aria-labelledby={`${id}-${item.n}`}>
                    <div className="agent-ws-source-head">
                        <span className="agent-ws-source-number"><span className="sr-only">依据 </span>{item.n}</span>
                        <div>
                            <h3 id={`${id}-${item.n}`}>{item.kind === 'web' && item.result.url
                                ? <a href={item.result.url} target="_blank" rel="noopener noreferrer">{heading.title}<ArrowUpRight size={12} aria-hidden="true" /></a>
                                : heading.title}</h3>
                            <p>{heading.meta}</p>
                        </div>
                        {current && paragraph !== null && <span className="agent-ws-source-cited">回答第 {paragraph} 段引用</span>}
                        {item.kind === 'chart' && <button type="button" className="agent-secondary-button" onClick={() => onOpen(`tool:${item.toolId}`)}>在命盘中定位</button>}
                    </div>
                    {item.kind === 'chart' ? <FocusTargets model={model} focus={item.focus} /> : <EvidenceExcerpt text={item.result.excerpt} query={queries.get(item.toolId) ?? null} />}
                </article>;
            })}
            {tools.map(tool => {
                const web = tool.name === 'web_search';
                if (!visible(web ? 'web' : 'knowledge')) return null;
                const query = queries.get(tool.id);
                const results = getAgentSearchResults(tool);
                if (tool.status !== 'completed') return <div key={tool.id} className="agent-ws-source-status" data-search-tool={tool.id}>
                    <WorkspaceToolPending tool={tool} runStatus={runStatus} running={`正在${web ? '联网' : '知识库'}检索${query ? `「${query}」` : ''}…`} />
                </div>;
                if (!results) return <div key={tool.id} className="agent-ws-source-status" data-search-tool={tool.id}><WorkspaceTextFallback tool={tool} note="检索结果格式无法识别，已显示原始返回。" /></div>;
                if (results.length) return null;
                return <div key={tool.id} className="agent-ws-source-empty" data-search-tool={tool.id}>
                    {web ? <Globe size={18} aria-hidden="true" /> : <Database size={18} aria-hidden="true" />}
                    <div>
                        <h3>{web ? '联网检索没有可引用的公开来源' : '知识库没有匹配的段落'}</h3>
                        <p>检索{query ? `「${query}」` : ''}{web ? '未返回可用的 HTTP(S) 来源' : '没有找到相关段落'}，回答不会引用这次检索。</p>
                    </div>
                </div>;
            })}
        </div>
    </section>;
}

/** A saved record's mark and short kind, as 八 · 八字; unknown kinds use the generic label. */
const RECORD_KINDS: Partial<Record<string, readonly [string, string]>> = {
    bazi_chart: ['八', '八字'], ziwei_chart: ['紫', '紫微'], tarot_reading: ['塔', '塔罗'], liuyao_divination: ['爻', '六爻'], mbti_reading: ['M', 'MBTI'],
    hepan_chart: ['合', '合盘'], face_reading: ['面', '面相'], palm_reading: ['掌', '手相'], ming_record: ['录', '命理记录'], daily_fortune: ['日', '每日运势'],
    monthly_fortune: ['月', '每月运势'], qimen_chart: ['奇', '奇门'], daliuren_divination: ['课', '大六壬'], meihua_divination: ['梅', '梅花'], xiaoliuren_divination: ['壬', '小六壬'],
};
const recordKind = (type: string | null) => (type && RECORD_KINDS[type]) || ['资', type && mentionTypeLabels[type as keyof typeof mentionTypeLabels] || mentionTypeLabels.default] as const;

/** 资料 (Main board): the latest listing of saved charts and records; a failed source never hides the others. */
export function DataListView({ tools, runStatus, step }: { tools: AgentToolPart[]; runStatus: AgentRunStatus; step?: number }) {
    const id = useId();
    const tool = latestCompleted(tools) ?? tools.at(-1)!;
    const data = getAgentDataResults(tool);
    return <section className="agent-ws-view" aria-labelledby={id}>
        <WorkspaceViewHeading id={id} kicker={kickerOf(step, '只读')} title="个人资料">当前账号已保存的命盘与占卜记录。每次读取前都会重新核对功能开关和会员权限。</WorkspaceViewHeading>
        {tool.status !== 'completed' ? <WorkspaceToolPending tool={tool} runStatus={runStatus} running="正在读取资料列表…" />
            : !data ? <WorkspaceTextFallback tool={tool} note="资料列表格式无法识别，已显示原始返回。" />
            : <>
                {data.items.length ? <ul className="agent-ws-records" aria-label="已保存资料">
                    {data.items.map(item => {
                        const [glyph, kind] = recordKind(item.type);
                        return <li key={`${item.type}:${item.id}`}>
                            <span className="agent-ws-record-glyph" aria-hidden="true">{glyph}</span>
                            <span className="agent-ws-record-text"><strong>{item.name}</strong><small>{item.preview}</small></span>
                            <span className="agent-ws-badge">{kind}</span>
                        </li>;
                    })}
                </ul> : <p className="agent-ws-note">当前账号还没有已保存的资料。</p>}
                {data.errors.map((error, index) => <p key={index} role="note" className="agent-ws-warning" title={error.message}>
                    <CircleAlert size={15} aria-hidden="true" />{error.type ? recordKind(error.type)[1] : '部分资料'}暂时无法读取，其余资料不受影响。
                </p>)}
            </>}
    </section>;
}

export function RecordView({ tools, runStatus, title, step, onOpenChart }: { tools: AgentToolPart[]; runStatus: AgentRunStatus; title: string; step?: number; onOpenChart?: () => void }) {
    const id = useId();
    const tool = latestCompleted(tools) ?? tools.at(-1)!;
    const type = inputText(tool, 'type');
    return <section className="agent-ws-view" aria-labelledby={id}>
        <WorkspaceViewHeading id={id} kicker={kickerOf(step, type && recordKind(type)[1], '只读')} title={title}>资料提供方返回的规范文本，Agent 按原文分析。</WorkspaceViewHeading>
        {tool.status !== 'completed' ? <WorkspaceToolPending tool={tool} runStatus={runStatus} running="正在读取资料…" />
            : <WorkspaceTextFallback tool={tool} note="资料提供方返回的规范文本：" />}
        {onOpenChart && <button type="button" className="agent-secondary-button" onClick={onOpenChart}>在命盘中查看</button>}
    </section>;
}

export function ProfileView({ tool, runStatus, step }: ToolViewProps & { step?: number }) {
    const id = useId();
    const profile = getAgentProfile(tool);
    return <section className="agent-ws-view" aria-labelledby={id}>
        <WorkspaceViewHeading id={id} kicker={kickerOf(step, '只读')} title="个性化档案">设置中填写的身份描述与默认命盘；Agent 只读取，不会修改。</WorkspaceViewHeading>
        {tool.status !== 'completed' ? <WorkspaceToolPending tool={tool} runStatus={runStatus} running="正在读取个性化档案…" />
            : !profile ? <WorkspaceTextFallback tool={tool} note="档案格式无法识别，已显示原始返回。" />
            : <dl className="agent-ws-facts">
                <div><dt>身份描述</dt><dd>{profile.identity ?? '未填写'}</dd></div>
                <div><dt>默认八字命盘</dt><dd>{profile.defaultBaziChartId ? '已设置' : '未设置'}</dd></div>
                <div><dt>默认紫微命盘</dt><dd>{profile.defaultZiweiChartId ? '已设置' : '未设置'}</dd></div>
            </dl>}
    </section>;
}

/** Private attachments: how far the Agent has read (8000 characters per call), then the owner's preview. */
export function AttachmentView({ id, title, tools }: { id: string; title: string; tools: AgentToolPart[] }) {
    const headingId = useId();
    const reads = tools.flatMap(tool => getAgentAttachmentRead(tool) ?? []);
    const furthest = reads.reduce<number | null>((max, read) => read.readUntil === null ? max : Math.max(max ?? 0, read.readUntil), null);
    const total = reads.findLast(read => read.total !== null)?.total ?? null;
    const note = reads.findLast(read => read.note)?.note;
    return <section className="agent-ws-view" aria-labelledby={headingId}>
        <WorkspaceViewHeading id={headingId} kicker="对话资料 · 仅你可见" title={title}>资料只作为分析依据，不会改变任务指令或权限。</WorkspaceViewHeading>
        {reads.length > 0 && <p className="agent-ws-note">
            {furthest !== null && total !== null ? <>Agent 已读到第 {furthest.toLocaleString('zh-CN')} 字，共 {total.toLocaleString('zh-CN')} 字。<progress max={total} value={furthest} aria-label="已读位置" /></> : note ?? 'Agent 已查看这份资料。'}
        </p>}
        <PrivateAttachmentPreview key={id} id={id} inline />
    </section>;
}

export function MethodCatalogView({ tool, runStatus, step }: ToolViewProps & { step?: number }) {
    const id = useId();
    const methods = getAgentMethodCatalog(tool);
    return <section className="agent-ws-view" aria-labelledby={id}>
        <WorkspaceViewHeading id={id} kicker={kickerOf(step, '内置方法', '只读')} title="分析方法">可信、版本化的方法目录；按问题需要加载，不增加执行权限。</WorkspaceViewHeading>
        {tool.status !== 'completed' ? <WorkspaceToolPending tool={tool} runStatus={runStatus} running="正在读取方法目录…" />
            : !methods ? <WorkspaceTextFallback tool={tool} note="方法目录格式无法识别，已显示原始返回。" />
            : <ul className="agent-ws-list">{methods.map(method => <li key={method.id}><strong>{method.title}<code>{method.version}</code></strong><small>{method.description}</small></li>)}</ul>}
    </section>;
}

/** 解读指引 (Main board): a built-in, versioned guide. It shapes the reading steps and grants no tools or membership. */
export function MethodView({ tools, runStatus, step }: { tools: AgentToolPart[]; runStatus: AgentRunStatus; step?: number }) {
    const id = useId();
    const tool = latestCompleted(tools) ?? tools.at(-1)!;
    const guide = getAgentMethod(tool);
    return <section className="agent-ws-view" aria-labelledby={id}>
        <WorkspaceViewHeading id={id} kicker={kickerOf(step, '内置方法', guide && `版本 ${guide.version}`, '只读')} title={guide?.title ?? inputText(tool, 'id') ?? '解读指引'}>
            方法只规定解读步骤；排盘仍由太卜 Core 计算，不增加任何执行权限。
        </WorkspaceViewHeading>
        {tool.status !== 'completed' ? <WorkspaceToolPending tool={tool} runStatus={runStatus} running="正在加载解读指引…" />
            : !guide ? <WorkspaceTextFallback tool={tool} note="指引格式无法识别，已显示原始返回。" />
            : <>
                {guide.whenToUse && <p className="agent-ws-note">适用：{guide.whenToUse}</p>}
                {guide.tools.length > 0 && <p className="agent-ws-chips" aria-label="对应工具">{guide.tools.map(name => <code key={name}>{name}</code>)}</p>}
                <div className="agent-ws-document agent-ws-document-card"><MarkdownContent content={stripLeadingTitle(guide.instructions, guide.title)} /></div>
            </>}
    </section>;
}

const KNOWN_READINGS = 3;
/** Readings the model already had when it asked: the latest of each chart tab from earlier calls. */
function knownReadings(model: AgentWorkspaceModel, asked: AgentToolPart) {
    const position = model.tools.findIndex(tool => tool.id === asked.id);
    const earlier = new Set(model.tools.slice(0, Math.max(position, 0)).map(tool => tool.id));
    return model.resources.flatMap((resource: AgentWorkspaceResource) => {
        if (resource.view !== 'chart') return [];
        const tools = resource.toolIds.filter(id => earlier.has(id)).flatMap(id => model.toolsById.get(id) ?? []);
        const reading = tools.findLast(tool => getAgentChart(tool));
        const value = reading && getAgentChart(reading);
        // The calculation names whom the reading is about; a saved chart read back does not.
        const source = tools.find(tool => isAgentChartTool(tool.name) && getAgentChart(tool)) ?? reading;
        return reading && value && source ? [{ resource, reading, value, subject: describeAgentChartSubject(source, value) }] : [];
    }).slice(-KNOWN_READINGS);
}

type QuestionState = 'answered' | 'replied' | 'skipped' | 'required' | 'optional' | 'missing';
const QUESTION_BADGES: Record<QuestionState, string> = { answered: '已填写', replied: '已回答', skipped: '已跳过', required: '必填', optional: '可跳过', missing: '未回答' };

/**
 * 补充信息 (AgentQuestion board): what the model already has, then each needed
 * item with the draft being typed in the answer panel, or the stored reply.
 */
export function QuestionView({ tool, runStatus, step, model, answer, draftKey }: ToolViewProps & {
    step?: number; model: AgentWorkspaceModel; answer?: AgentQuestionAnswer;
    /** The answer panel's draft, mirrored while the task waits for it. */
    draftKey: string | null;
}) {
    const id = useId();
    const questions = useMemo(() => getAgentToolQuestions(tool), [tool]);
    const waiting = getAgentToolState(tool, runStatus).status === 'awaiting_input' && !answer;
    const { draft } = useQuestionDraft(waiting ? draftKey : null, questions);
    // Older replies are free text without per-question answers.
    const structured = !answer || answer.answers !== undefined;
    const replies = answer?.answers ?? (waiting ? getDraftAnswers(questions, draft) : null);
    const filled = questions.filter(question => replies?.[question.id] === null || !!replies?.[question.id]?.length);
    const known = knownReadings(model, tool);
    return <section className="agent-ws-view agent-ws-question" aria-labelledby={id}>
        <WorkspaceViewHeading id={id} kicker={kickerOf(step, tool.title)} title={waiting ? `还需要 ${questions.length} 项信息` : answer ? '已补充的信息' : '补充信息'}>
            {waiting ? '对话中填写的回答会实时同步到这里。任务已暂停，提交后从这一步继续。' : answer ? '已收到回答，任务按这些信息继续。' : 'Agent 在这一步向你确认信息。'}
        </WorkspaceViewHeading>
        {(known.length > 0 || waiting) && <div className="agent-ws-known">
            {known.map(({ resource, reading, value, subject }) => <article key={resource.id} className="agent-ws-known-card" aria-label={`${resource.title}（已就绪）`}>
                <span className="agent-ws-overview-kicker">{resource.title} · {reading.name === 'inspect_chart' ? '已读取' : '已计算'}<span data-state="ready">已就绪</span></span>
                {value.kind === 'bazi' ? <BaziPillars chart={value.chart} size="overview" /> : <span className="agent-ws-overview-glyph" aria-hidden="true">{CHART_GLYPHS[value.kind]}</span>}
                <small>{subject}</small>
            </article>)}
            {waiting && <div className="agent-ws-known-pending">
                <span aria-hidden="true"><UserRound size={18} /></span>
                <strong>{filled.length === questions.length ? '已填写，等待提交' : `待补充 · ${questions.length - filled.length} 项`}</strong>
                <small>{filled.flatMap(question => replies?.[question.id]?.length ? [describeQuestionAnswer(question, replies[question.id])] : []).slice(0, 2).join(' · ') || '在问题面板中填写'}</small>
            </div>}
        </div>}
        <section className="agent-ws-needs" aria-labelledby={`${id}-needs`}>
            <h3 id={`${id}-needs`}>需要的信息</h3>
            <ul className="agent-ws-questions">
                {questions.map(question => {
                    const reply = replies?.[question.id];
                    const text = describeQuestionAnswer(question, reply);
                    const state: QuestionState = !structured ? 'replied' : reply === null ? 'skipped' : text ? answer ? 'replied' : 'answered'
                        : waiting ? question.allowSkip ? 'optional' : 'required' : 'missing';
                    // A missing answer is said by its badge alone.
                    const value = !structured ? '见下方回答' : text ?? (waiting ? '尚未填写' : null);
                    return <li key={question.id} data-state={state}>
                        <span>
                            <strong title={question.question}>{questionLabel(question)}</strong>
                            {value && <small>{value}</small>}
                        </span>
                        <span className="agent-ws-badge" data-state={state}>{QUESTION_BADGES[state]}</span>
                    </li>;
                })}
            </ul>
        </section>
        {!structured && answer && <div className="agent-ws-document agent-ws-document-card"><MarkdownContent content={answer.content} /></div>}
        {waiting && <p className="agent-ws-footnote">提交后任务从这一步继续，补充信息不会再次扣费。</p>}
    </section>;
}

const effortLabel = (value?: string) => value === 'off' ? '不推理' : value && (AI_REASONING_EFFORTS as readonly string[]).includes(value) ? `推理 ${REASONING_EFFORT_LABELS[value as AIReasoningEffort]}` : null;

/** The first character of a member's name marks its card, as 子 for 子平. */
const memberInitial = (name: string) => Array.from(name.trim())[0] ?? '协';
/** A configured division of work this short reads as the card's subtitle, as 子平 · 格局与用神. */
const FOCUS_IN_TITLE = 16;
const STEP_GLYPHS: Record<ParallelMemberStep['status'], string> = { completed: '✓', running: '●', failed: '×' };
const STEP_LABELS: Record<ParallelMemberStep['status'], string> = { completed: '已完成', running: '进行中', failed: '失败' };

function MemberSteps({ steps }: { steps: ParallelMemberStep[] }) {
    return <ul className="agent-ws-member-steps" aria-label="成员的工具调用">{steps.map((step, index) => <li key={index} data-state={step.status}>
        <span aria-hidden="true">{STEP_GLYPHS[step.status]}</span>{step.title}<span className="sr-only">（{STEP_LABELS[step.status]}）</span>
    </li>)}</ul>;
}

/**
 * 分歧对照: each member's stance on the topics the task named, before the main
 * model reconciles them. Rows where finished members chose different options are marked.
 */
function DivergenceTable({ topics, members, call }: { topics: ParallelTopic[]; members: ParallelAnalysisResult[]; call: ReturnType<typeof getAgentToolState>['status'] }) {
    const id = useId();
    const rows = getParallelDivergence(topics, members);
    const states = members.map(member => getParallelMemberState(member, call).state);
    return <section className="agent-ws-divergence" aria-labelledby={id}>
        <h3 id={id}>分歧对照 <span>主模型汇总前</span></h3>
        <div className="agent-ws-table-scroll" tabIndex={0} aria-label="各成员对议题的立场">
            <table className="agent-ws-table">
                <thead><tr><th scope="col">议题</th>{members.map(member => <th key={member.conversationId} scope="col">{member.name ?? member.system}</th>)}</tr></thead>
                <tbody>{rows.map(row => <tr key={row.topic.title} data-divergent={row.divergent || undefined}>
                    <th scope="row">{row.topic.title}{row.divergent && <span className="sr-only">（成员有分歧）</span>}</th>
                    {row.stances.map((stance, index) => <td key={members[index].conversationId} data-empty={stance === null || undefined}>
                        {stance ?? (states[index] === 'running' ? '分析中' : states[index] === 'failed' ? '未完成' : '未表态')}
                    </td>)}
                </tr>)}</tbody>
            </table>
        </div>
        {topics.some(topic => topic.options) && <p>高亮行为成员结论不一致的议题，主模型会说明分歧与各自依据，不把任何一方当作已核对的事实。</p>}
    </section>;
}

/**
 * 协作: each member's actual model, effort and progress, its conclusion once it
 * finishes, and where members disagree. Only finished analyses reach the answer.
 */
export function CollaborationView({ tool, runStatus, step }: ToolViewProps & { step?: number }) {
    const id = useId();
    const members = parallelAnalysisResults(tool.output);
    const topics = parallelAnalysisTopics(tool.output);
    const call = getAgentToolState(tool, runStatus).status;
    const stances = members.some(member => member.positions && Object.keys(member.positions).length);
    return <section className="agent-ws-view agent-ws-collaboration" aria-labelledby={id}>
        <WorkspaceViewHeading id={id} kicker={kickerOf(step, '协作分析', '子分析只能计算和读取方法')} title={parallelAnalysisTitle(tool.output) ?? '协作分析'}>
            成员不能追问、联网或写记忆。只有完整结束的分析会汇入主回答。
        </WorkspaceViewHeading>
        {!members.length ? <WorkspaceToolPending tool={tool} runStatus={runStatus} running="正在分派协作成员…" />
            : members.map(member => {
                const name = member.name ?? member.system;
                const state = getParallelMemberState(member, call);
                const titled = member.focus && member.focus.length <= FOCUS_IN_TITLE;
                const meta = [member.modelName ?? member.model ?? '主模型', effortLabel(member.reasoningEffort),
                    member.toolCalls !== undefined && `${member.toolCalls} 次工具`,
                    member.durationMs !== undefined ? formatAgentToolDuration(member.durationMs) : state.state === 'running' && '进行中'].filter(Boolean).join(' · ');
                return <article key={member.conversationId} className="agent-ws-member" data-state={state.state} aria-labelledby={`${id}-${member.conversationId}`}>
                    <div className="agent-ws-member-head">
                        <span className="agent-ws-member-avatar" aria-hidden="true">{memberInitial(name)}</span>
                        <div>
                            <h3 id={`${id}-${member.conversationId}`}>{titled ? `${name} · ${member.focus}` : name}</h3>
                            <p>{meta}</p>
                        </div>
                        <span className="agent-member-status" data-state={state.state}>
                            {state.state === 'completed' ? <Check size={13} strokeWidth={2.4} aria-hidden="true" /> : state.state === 'running' ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}
                            {state.label}
                        </span>
                    </div>
                    {member.focus && !titled && <p className="agent-ws-note">分工：{member.focus}</p>}
                    {member.answer ? <div className="agent-ws-member-answer"><MarkdownContent content={member.answer} className="chat-prose" /></div>
                        : state.state === 'running' ? member.steps?.length ? <MemberSteps steps={member.steps} />
                            : <p className="agent-ws-running" role="status"><LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />正在分析</p>
                        : state.state === 'failed' && <p className="agent-ws-note">这位成员没有完成分析，它的结论不会汇入主回答。</p>}
                </article>;
            })}
        {/* Stances fill in as members finish; a finished call without any stance has nothing to compare. */}
        {topics.length > 0 && members.length > 0 && (stances || call === 'running' || call === 'pending') && <DivergenceTable topics={topics} members={members} call={call} />}
        {tool.status === 'failed' && <p className="agent-error" role="alert">{getAgentToolText(tool) ?? '协作分析未完成。'}</p>}
    </section>;
}

/** 长期记忆: facts saved from the user's own words, deletable by the owner. */
export function MemoryView({ tools, runStatus, userId, step }: { tools: AgentToolPart[]; runStatus: AgentRunStatus; userId: string | null; step?: number }) {
    const id = useId();
    const { showToast } = useToast();
    const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
    const [confirming, setConfirming] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const entries = new Map<string, { memory: NonNullable<ReturnType<typeof getAgentMemories>>[number]; written: boolean }>();
    for (const tool of tools) for (const memory of getAgentMemories(tool) ?? [])
        entries.set(memory.id, { memory, written: tool.name === 'remember_user_fact' || entries.get(memory.id)?.written === true });
    const remove = async (id: string) => {
        if (!userId) return;
        setBusy(id);
        try {
            const result = await requestBrowserJson('/api/user/agent-memory', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Expected-User-Id': userId }, body: JSON.stringify({ id }) });
            // A memory deleted elsewhere is already gone; both outcomes leave it deleted here.
            if (result.error && result.status !== 404) showToast('error', result.error.message || '删除记忆失败');
            else setDeleted(current => new Set(current).add(id));
        } finally {
            setBusy(null);
            setConfirming(null);
        }
    };
    const failed = tools.filter(tool => getAgentToolState(tool, runStatus).status === 'failed');
    const running = tools.find(tool => ['pending', 'running'].includes(getAgentToolState(tool, runStatus).status));
    return <section className="agent-ws-view" aria-labelledby={id}>
        <WorkspaceViewHeading id={id} kicker={kickerOf(step, '原话依据', '可删除')} title="长期记忆">只保存你明确说过的原话，不保存推断。删除后，之后的任务不会再读取它。</WorkspaceViewHeading>
        {running && <WorkspaceToolPending tool={running} runStatus={runStatus} running="正在读取或保存记忆…" />}
        {entries.size ? <ul className="agent-ws-list" aria-label="记忆">
            {[...entries.values()].map(({ memory, written }) => <li key={memory.id} data-deleted={deleted.has(memory.id) ? 'true' : undefined}>
                <strong>{memory.title}<small>{memory.kind === 'preference' ? '偏好' : '背景'} · {written ? '本任务记住' : '已读取'}</small></strong>
                <blockquote>{memory.content}</blockquote>
                {deleted.has(memory.id) ? <small>已删除</small> : userId && (confirming === memory.id
                    ? <span className="agent-ws-actions">
                        <button type="button" className="agent-secondary-button" disabled={busy !== null} onClick={() => void remove(memory.id)}>{busy === memory.id ? '正在删除' : '确认删除'}</button>
                        <button type="button" className="agent-secondary-button" disabled={busy !== null} onClick={() => setConfirming(null)}>取消</button>
                    </span>
                    : <button type="button" className="agent-secondary-button" aria-label={`删除记忆：${memory.title}`} onClick={() => setConfirming(memory.id)}><Trash2 size={12} aria-hidden="true" />删除</button>)}
            </li>)}
        </ul> : !running && !failed.length && <p className="agent-ws-note">没有已保存的记忆。</p>}
        {failed.map(tool => <p key={tool.id} className="agent-error" role="alert">{getAgentToolText(tool) ?? '记忆操作失败。'}</p>)}
    </section>;
}

