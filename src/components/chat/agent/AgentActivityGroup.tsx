'use client';
// 需要折叠状态与工作区上下文：步骤在转录内展开结果（详细视图另含参数），也可在工作区打开

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle, PanelRight, Pause } from 'lucide-react';
import type { AgentMessageData, AgentPart } from '@/lib/agent/types';
import { AGENT_SUBMIT_PLAN_TOOL, AGENT_TOOL_SEARCH_TOOL, getAgentToolFamily, isAgentMemberTool } from '@/lib/agent/tool-catalog';
import { getAgentToolQuestionIds } from '@/lib/agent/workspace';
import { getAgentAttachmentRead, getAgentChart, getAgentConversationHits, getAgentDataResults, getAgentMemories, getAgentMethod, getAgentMethodCatalog, getAgentNotes, getAgentPlan, getAgentProfile, getAgentScript, getAgentSearchResults, getAgentToolQuestions, getAgentToolSearchLoaded, getAgentToolText } from '@/lib/agent/tool-presentation';
import { useIsDesktopLayout } from '@/lib/hooks/useIsDesktopLayout';
import { useTranscriptRecordView } from '@/lib/chat/chat-record-view';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { describeAgentStep, describeOverviewFacts, formatAgentValue, getAgentDataTypeLabel, getAgentLiveLine, getAgentMemberBrief, getAgentScriptCalls, getAgentToolTitle, getParallelMemberState, summarizeAgentActivity, summarizeThinkingTime, type AgentProcessPart, type AgentTool } from './presentation';
import { memberAnswerText, parallelAnalysisResults } from '@/lib/agent/parallel-results';
import { ModelAvatar } from './ModelAvatar';
import { getChartFocus, getChartTargets, getAgentChartReference, parseChartReference } from '@/lib/agent/chart-interaction';
import { useAgentResultWorkspace } from './AgentResultContext';
import { ChartMiniPreview } from './chart-preview';
import { CopyButton } from './CopyButton';
import { JsonCode, ToolCommand } from './ToolCode';
import { formatStepMarkdown } from '@/lib/agent/tool-display';
import { useEntranceMotion } from '@/lib/motion/entrance';
// 小盘缩略图的样式在工作区样式表里；分享页只加载对话样式，这里一并引入。
import './agent-workspace.css';

/** One live line under the answer: what the task is doing and, while a tool runs, what that tool is working on. */
export function AgentActivityIndicator({ data }: { data: AgentMessageData }) {
    if (!['queued', 'running', 'awaiting_input', 'cancelling'].includes(data.status)) return null;
    const waiting = data.status === 'awaiting_input';
    const retrying = data.status === 'running' && data.runtime?.activity?.phase === 'retrying';
    return <div className="agent-live-activity" role="status" data-tone={retrying ? 'warning' : undefined}>
        {waiting ? <Pause size={14} aria-hidden="true" /> : <LoaderCircle size={14} strokeWidth={2.4} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
        <span>{getAgentLiveLine(data)}</span>
    </div>;
}

/** 成员结论的第一句，作为成员行的预览。 */
const previewLine = (text: string) => text.trim().split('\n', 1)[0].replace(/^#+\s*/u, '');

/** 把只返回结构化数据的工具读成一句话或几行事实，不再统一写「已返回结构化结果」。 */
function StepStructured({ tool, parts, workspace }: { tool: AgentTool; parts: AgentPart[]; workspace: ReturnType<typeof useAgentResultWorkspace> }): ReactNode {
    const open = (id: string) => workspace?.openResource(id);
    if (tool.name === 'focus_chart') {
        const focus = getChartFocus(tool);
        if (!focus) return null;
        const parsed = parseChartReference(focus.reference);
        const chart = parsed ? parts.flatMap(part => part.type === 'tool' ? [part] : [])
            .map(part => ({ part, value: getAgentChart(part), reference: getAgentChartReference(part) }))
            .find(item => item.value && parseChartReference(item.reference ?? '')?.id === parsed.id)?.value ?? null : null;
        const labels = chart ? getChartTargets(chart).filter(target => focus.targetIds.includes(target.id)).map(target => target.label) : [];
        return <div className="agent-step-structured">
            {focus.caption && <p className="agent-step-structured-lead">{focus.caption}</p>}
            <p className="agent-step-structured-fact">定位 {focus.targetIds.length} 处{focus.includeRelated ? ' · 含三方四正' : ''}</p>
            {labels.length > 0 && <ul className="agent-step-chips" aria-label="定位的位置">{labels.slice(0, 6).map(label => <li key={label}>{label}</li>)}{labels.length > 6 && <li>等 {labels.length} 处</li>}</ul>}
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open(`tool:${tool.id}`)}>查看盘面</button>}
        </div>;
    }
    if (tool.name === 'ask_user') {
        const questions = getAgentToolQuestions(tool);
        return questions.length ? <div className="agent-step-structured">
            <p className="agent-step-structured-fact">向你确认 {questions.length} 项信息</p>
            <ul className="agent-step-structured-list">{questions.map(question => <li key={question.id}>{question.header ?? question.question}</li>)}</ul>
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open(`tool:${tool.id}`)}>查看问题</button>}
        </div> : null;
    }
    if (tool.name === 'remember_user_fact' || tool.name === 'read_user_memory') {
        const memories = getAgentMemories(tool);
        return memories?.length ? <div className="agent-step-structured">
            <ul className="agent-step-structured-list">{memories.map(memory => <li key={memory.id}><strong>{memory.title}</strong><span>{memory.content}</span></li>)}</ul>
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open(`tool:${tool.id}`)}>查看记忆</button>}
        </div> : null;
    }
    if (tool.name === 'list_user_data') {
        const data = getAgentDataResults(tool);
        return data ? <div className="agent-step-structured">
            <p className="agent-step-structured-fact">找到 {data.items.length} 份资料{data.errors.length ? ` · ${data.errors.length} 项暂不可读` : ''}</p>
            {data.items.length > 0 && <ul className="agent-step-structured-list">{data.items.slice(0, 6).map(item => <li key={item.type + item.id}><strong>{item.name}</strong><span>{getAgentDataTypeLabel(item.type)}</span></li>)}</ul>}
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open('data')}>查看资料</button>}
        </div> : null;
    }
    if (tool.name === 'read_user_profile') {
        const profile = getAgentProfile(tool);
        return profile ? <div className="agent-step-structured">
            <p className="agent-step-structured-fact">{profile.identity ? `已读取个性化档案 · ${profile.identity}` : '已读取个性化档案'}</p>
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open('profile')}>查看档案</button>}
        </div> : null;
    }
    if (tool.name === 'read_attachment') {
        const read = getAgentAttachmentRead(tool);
        return read ? <div className="agent-step-structured">
            <p className="agent-step-structured-fact">读取了 {read.name}{read.readUntil !== null && read.total !== null ? ` · ${read.readUntil} / ${read.total} 字` : ''}</p>
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open(`tool:${tool.id}`)}>查看资料</button>}
        </div> : null;
    }
    if (tool.name === 'list_analysis_methods') {
        const catalog = getAgentMethodCatalog(tool);
        return catalog?.length ? <div className="agent-step-structured">
            <p className="agent-step-structured-fact">可用的解读方法 {catalog.length} 套</p>
            <ul className="agent-step-structured-list">{catalog.slice(0, 6).map(item => <li key={item.id}><strong>{item.title}</strong><span>版本 {item.version}</span></li>)}</ul>
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open('methods')}>查看方法</button>}
        </div> : null;
    }
    if (tool.name === 'read_user_data') {
        const input = tool.input && typeof tool.input === 'object' ? tool.input as Record<string, unknown> : {};
        return <div className="agent-step-structured">
            <p className="agent-step-structured-fact">读取了 1 份{getAgentDataTypeLabel(input.type)}</p>
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open(`tool:${tool.id}`)}>查看资料</button>}
        </div>;
    }
    if (tool.name === 'load_analysis_method') {
        const method = getAgentMethod(tool);
        return method ? <div className="agent-step-structured">
            <p className="agent-step-structured-fact">{method.title} · 版本 {method.version}</p>
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open(`tool:${tool.id}`)}>查看指引</button>}
        </div> : null;
    }
    // 检索的来源直接列在调用框里：标题、编号与站点，点击打开原页；完整摘录在工作区「回答依据」。
    if (tool.name === 'web_search' || tool.name === 'search_knowledge') {
        const web = tool.name === 'web_search';
        const results = getAgentSearchResults(tool);
        if (!results) return null;
        return <div className="agent-step-structured">
            <p className="agent-step-structured-fact">{results.length ? `找到 ${results.length} 个${web ? '公开来源' : '相关段落'}` : web ? '没有可引用的公开来源' : '没有匹配的段落'}</p>
            {results.length > 0 && <ul className="agent-step-structured-sources">
                {results.slice(0, 4).map(result => <li key={result.id}>
                    {result.cite !== null && <span className="agent-step-cite">[{result.cite}]</span>}
                    {result.url ? <a href={result.url} target="_blank" rel="noopener noreferrer">{result.title}</a> : <span>{result.title}</span>}
                    {result.source && result.source !== result.title && <small>{result.source}</small>}
                </li>)}
                {results.length > 4 && <li className="agent-step-more">等 {results.length} 条</li>}
            </ul>}
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open('evidence')}>查看依据</button>}
        </div>;
    }
    // 工具搜索加载了哪些工具：写中文名，点名它们从下一次模型调用起可用。
    if (tool.name === AGENT_TOOL_SEARCH_TOOL) {
        const loaded = getAgentToolSearchLoaded(tool);
        if (!loaded) return null;
        return <div className="agent-step-structured">
            <p className="agent-step-structured-fact">{loaded.names.length ? `加载 ${loaded.names.length} 个工具` : '没有匹配的工具'}</p>
            {loaded.names.length > 0 && <ul className="agent-step-chips" aria-label="加载的工具">{loaded.labels.map(label => <li key={label}>{label}</li>)}</ul>}
        </div>;
    }
    // 「过程资料」不再单列，读过的笔记与对话在这里给出具体内容。
    if (tool.name === 'read_user_notes') {
        const notes = getAgentNotes(tool);
        return notes ? <div className="agent-step-structured">
            <p className="agent-step-structured-fact">读到 {notes.notes.length} 条笔记{notes.more ? '（还有更早的）' : ''}</p>
            {notes.notes.length > 0 && <ul className="agent-step-structured-list">{notes.notes.slice(0, 3).map((note, index) =>
                // 同一天可以有多条笔记，日期不能单独作 key。
                <li key={`${note.date}:${index}`}><strong>{note.date}{note.mood ? ` · ${note.mood}` : ''}</strong><span>{note.content}</span></li>)}</ul>}
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open('notes')}>查看笔记</button>}
        </div> : null;
    }
    if (tool.name === 'search_conversations') {
        const hits = getAgentConversationHits(tool);
        return hits ? <div className="agent-step-structured">
            <p className="agent-step-structured-fact">{hits.length ? `找到 ${hits.length} 条以往对话` : '没有找到以往的对话'}</p>
            {hits.length > 0 && <ul className="agent-step-structured-list">{hits.slice(0, 3).map(hit =>
                <li key={`${hit.conversationId}:${hit.messageId ?? ''}`}><strong>{hit.title}</strong><span>{hit.excerpt}</span></li>)}</ul>}
            {workspace && <button type="button" className="agent-step-structured-open" onClick={() => open('history')}>查看对话</button>}
        </div> : null;
    }
    return null;
}

/** 展开后的一块面板：左上写名称，右上放复制等操作；正文过长时先收起，可展开全部。 */
function StepPanel({ title, kind, actions, children }: { title: string; kind: string; actions?: ReactNode; children: ReactNode }) {
    // 面板名是可见的小标题；正文自己带 aria-label，面板不再重复命名。
    return <div className="agent-step-panel" data-kind={kind}>
        <div className="agent-step-panel-head"><span className="agent-step-panel-title">{title}</span>{actions}</div>
        {children}
    </div>;
}

/** 收起时限高并淡出底边；内容确实超出时才给「展开全部」。 */
function StepFold({ children }: { children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [overflowing, setOverflowing] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 4);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        if (element.firstElementChild) observer.observe(element.firstElementChild);
        return () => observer.disconnect();
    }, []);
    return <>
        <div ref={ref} className="agent-step-fold" data-expanded={expanded || undefined} data-overflowing={overflowing || undefined}>{children}</div>
        {(overflowing || expanded) && <button type="button" className="agent-step-fold-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            <ChevronDown size={12} aria-hidden="true" />{expanded ? '收起' : '展开全部'}
        </button>}
    </>;
}

const copyAction = (text: string, label: string) => <CopyButton text={text} label={label} iconOnly className="agent-step-copy" />;

/** 排盘步骤：先给一眼认得出的小盘与要点，规范全文收在下面的面板里。 */
function ChartStepSummary({ tool, value }: { tool: AgentTool; value: NonNullable<ReturnType<typeof getAgentChart>> }) {
    const facts = describeOverviewFacts(tool, value);
    return <div className="agent-step-chart">
        <span className="agent-step-chart-thumb"><ChartMiniPreview value={value} /></span>
        <span className="agent-step-chart-text">
            <strong>{value.title}</strong>
            {facts && <span>{facts}</span>}
        </span>
    </div>;
}

/**
 * A step's result, disclosed in place. Collaboration shows its members and the final selection shows the chosen
 * artifacts, each opening its own workspace page; a chart shows its thumbnail; other calls show the Core canonical
 * text in a result panel. The 「详细」 record view adds the call as a colored command line and raw JSON results.
 */
function AgentStepCall({ tool, runStatus, parts }: { tool: AgentTool; runStatus: AgentMessageData['status']; parts: AgentPart[] }) {
    const workspace = useAgentResultWorkspace();
    const detailed = useTranscriptRecordView() === 'detailed';
    const state = describeAgentStep(tool, runStatus).status;
    const openButton = (label: string) => workspace && <div className="agent-step-foot">
        <button type="button" className="agent-step-workspace" onClick={() => workspace.openResource(`tool:${tool.id}`)}>
            <PanelRight size={13} aria-hidden="true" />{label}
        </button>
    </div>;
    const script = getAgentScript(tool);
    // 脚本即调用参数：普通视图也给出脚本与它打印给模型的输出；脚本的各次调用在下方逐条列出。
    if (script) return <div className="agent-step-call">
        <StepPanel title="脚本" kind="script" actions={copyAction(script.code, '复制脚本')}>
            <StepFold><pre className="agent-step-script" tabIndex={0} aria-label="脚本"><code>{script.code}</code></pre></StepFold>
        </StepPanel>
        {script.output?.trim()
            ? <StepPanel title="输出" kind="output" actions={copyAction(script.output, '复制输出')}>
                <StepFold><div className="agent-step-output agent-code" tabIndex={0} aria-label="脚本输出">{script.output}</div></StepFold>
            </StepPanel>
            : <p className="agent-step-empty">{state === 'running' ? '脚本运行中…' : '脚本没有输出。'}</p>}
        {openButton('在工作区查看')}
    </div>;
    // 计划模式：计划正文按 Markdown 展示，决定只由行上的状态说明；工作区里是这一任务的全部计划版本。
    if (tool.name === AGENT_SUBMIT_PLAN_TOOL) {
        const draft = getAgentPlan(tool);
        return <div className="agent-step-call">
            {draft && <StepPanel title="计划" kind="plan" actions={copyAction(draft.plan, '复制计划')}>
                <div className="agent-step-output agent-step-markdown" tabIndex={0} aria-label="计划"><MarkdownContent content={draft.plan} className="chat-prose" /></div>
            </StepPanel>}
            {draft?.feedback && <p className="agent-step-empty">你的意见：{draft.feedback}</p>}
            {openButton('查看计划')}
        </div>;
    }
    const canonical = tool.canonicalText?.trim() ? tool.canonicalText : null;
    const text = canonical ?? getAgentToolText(tool);
    const raw = tool.output === undefined ? null : tool.output;
    const members = isAgentMemberTool(tool.name) ? parallelAnalysisResults(tool.output) : [];
    // 结构化结果（定位、提问、记忆、资料…）自己带「查看…」入口，不再重复「在工作区查看」。
    const structured = members.length === 0 && state !== 'running' ? StepStructured({ tool, parts, workspace }) : null;
    // 有规范文本时显示文本面板而不是结构化摘要，「查看…」入口改由正文底部给出。
    const selfContained = members.length > 0 || (structured !== null && text === null);
    const family = getAgentToolFamily(tool.name);
    const chart = family === 'chart' && state === 'completed' ? getAgentChart(tool) : null;
    const openLabel = family === 'chart' ? '查看盘面' : family === 'drilldown' ? '查看详查' : '在工作区查看';
    return <div className="agent-step-call">
        {/* 详细视图 = 命令行：工具名是命令，参数是选项，按类别着色；普通视图不露参数键名。 */}
        {detailed && tool.input !== undefined && <StepPanel title="调用" kind="command" actions={copyAction(formatAgentValue(tool.input), '复制参数')}>
            <ToolCommand name={tool.name} input={tool.input} className="agent-step-command" />
        </StepPanel>}
        {members.length > 0 && <ul className="agent-step-entities" aria-label="协作成员">
            {members.map(member => {
                const status = getParallelMemberState(member, state);
                const name = member.name ?? member.system;
                const brief = getAgentMemberBrief(tool, member);
                const preview = member.answer ? previewLine(memberAnswerText(member.answer)) : brief && previewLine(brief);
                const content = <>
                    <ModelAvatar member={member} size={16} className="agent-step-entity-icon" />
                    <span className="agent-step-entity-main">
                        <span className="agent-step-entity-line">
                            <span className="agent-step-entity-name">{name}</span>
                            <span className="agent-step-entity-meta" data-state={status.state}>{[member.modelName ?? member.model, status.label].filter(Boolean).join(' · ')}</span>
                        </span>
                        {preview && <span className="agent-step-entity-preview">{preview}</span>}
                    </span>
                </>;
                return <li key={member.conversationId} data-state={status.state}>
                    {workspace ? <button type="button" className="agent-step-entity" aria-label={`打开${name}的分析`} onClick={() => workspace.openResource(`member:${tool.id}:${member.conversationId}`)}>
                        {content}<ChevronRight size={14} aria-hidden="true" className="agent-step-entity-go" />
                    </button> : <span className="agent-step-entity">{content}</span>}
                </li>;
            })}
        </ul>}
        {chart && <ChartStepSummary tool={tool} value={chart} />}
        {members.length === 0 && (text !== null
            ? <StepPanel title={chart ? '盘面全文' : '结果'} kind="result" actions={copyAction(text, '复制结果')}>
                <StepFold><div className="agent-step-output agent-step-markdown" tabIndex={0} aria-label="规范文本"><MarkdownContent content={formatStepMarkdown(text)} className="chat-prose" /></div></StepFold>
            </StepPanel>
            : detailed && raw !== null
                ? <StepPanel title="原始结果" kind="json" actions={copyAction(formatAgentValue(raw), '复制结果')}>
                    <StepFold><JsonCode value={raw} label="工具结果" className="agent-step-output" /></StepFold>
                </StepPanel>
                : state === 'running'
                    ? <p className="agent-step-empty">正在等待工具返回结果…</p>
                    : structured ?? <p className="agent-step-empty">{raw !== null ? '已返回结构化结果' : '该步骤没有返回详情。'}</p>)}
        {!selfContained && openButton(openLabel)}
    </div>;
}

function ToolStep({ tool, data, shownId, calls = [] }: { tool: AgentTool; data: AgentMessageData; shownId?: string; calls?: AgentTool[] }) {
    const id = useId();
    const detailed = useTranscriptRecordView() === 'detailed';
    const step = describeAgentStep(tool, data.status);
    const [disclosed, setDisclosed] = useState<boolean | null>(null);
    // 详细视图默认展开每一步的调用参数与结果；普通视图点击行才展开，等用户批准的计划例外——要批的就是这段正文。
    const awaitingPlan = tool.name === AGENT_SUBMIT_PLAN_TOOL && step.status === 'running';
    const details = disclosed ?? (detailed || step.status === 'failed' || awaitingPlan);
    return <li className="agent-step" data-state={step.status} data-motion-key={tool.id}>
        <button type="button" className="agent-step-row" aria-current={shownId === tool.id || undefined}
            aria-expanded={details} aria-controls={details ? id : undefined}
            onClick={() => setDisclosed(!details)}>
            <span className="agent-step-text">
                <span className="agent-step-title">{getAgentToolTitle(tool)}</span>
                {(step.summary || step.note) && <span className="agent-step-detail">
                    {step.summary}{step.summary && step.note ? ' · ' : ''}{step.note && <span className="agent-step-note">{step.note}</span>}
                </span>}
                <ChevronRight size={12} aria-hidden="true" className={`agent-step-chevron${details ? ' rotate-90' : ''}`} />
            </span>
        </button>
        {/* 只有用户点开的正文才滑出；默认展开（详细视图、失败、待批计划）的正文随页面直接出现，不在每次挂载时重放。 */}
        {details && <div id={id} className="agent-step-body" data-tool-id={tool.id} data-disclosed={disclosed !== null || undefined}>
            <AgentStepCall tool={tool} runStatus={data.status} parts={data.parts} />
            {calls.length > 0 && <ol className="agent-step-children" aria-label="脚本调用">
                {calls.map(call => <ToolStep key={call.id} tool={call} data={data} shownId={shownId} />)}
            </ol>}
        </div>}
    </li>;
}

/** Reasoning between calls and questions asked without the question tool: rows that disclose their text in place. */
function NoteStep({ id: motionKey, title, text, children }: { id: string; title: string; text?: string; children: ReactNode }) {
    const id = useId();
    const [open, setOpen] = useState(false);
    return <li className="agent-step agent-step--note" data-motion-key={motionKey}>
        <button type="button" className="agent-step-row" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
            <span className="agent-step-text"><span className="agent-step-title">{title}</span>{text && <span className="agent-step-detail">{text}</span>}
                <ChevronRight size={12} aria-hidden="true" className={`agent-step-chevron${open ? ' rotate-90' : ''}`} /></span>
        </button>
        {open && <div id={id} className="agent-step-note-body">{children}</div>}
    </li>;
}

const firstLine = (text: string) => text.trim().split('\n', 1)[0].slice(0, 120);

/** 任务过程: a claude-style status line with plain step rows; rows disclose calls and results in place. */
export function AgentActivityGroup({ parts, data, active = false }: { parts: AgentProcessPart[]; data: AgentMessageData; active?: boolean }) {
    const id = useId();
    const workspace = useAgentResultWorkspace();
    const detailed = useTranscriptRecordView() === 'detailed';
    const [disclosed, setDisclosed] = useState<boolean | null>(null);
    // 只有读者点开时才播放揭开动画；默认展开（详细视图、桌面上进行中的任务）随页面直接出现。
    const [revealed, setRevealed] = useState(false);
    const stepsRef = useRef<HTMLOListElement>(null);
    const wide = useIsDesktopLayout();
    const answered = new Set(getAgentToolQuestionIds(parts).values());
    // A code mode script's calls are listed under the script's step, read from the whole message so a call whose
    // part has not moved under its script yet still shows there.
    const scriptCalls = getAgentScriptCalls(data.parts);
    // Plan updates already show as the task list bar; their questions are answered in the question panel.
    const rows = parts.filter(part => part.type === 'tool' ? !part.parentId && getAgentToolFamily(part.name) !== 'todo' : part.type === 'reasoning' ? part.text.trim() : !answered.has(part.id));
    const tools = rows.filter((part): part is AgentTool => part.type === 'tool');
    const streaming = active && data.status === 'running';
    const states = tools.map(tool => describeAgentStep(tool, data.status).status);
    const completed = states.filter(status => status === 'completed').length;
    // The summary counts what scripts did too: the charts a script computed are charts the task looked at.
    const done = [...tools, ...tools.flatMap(tool => scriptCalls.get(tool.id) ?? [])];
    const failed = done.filter(tool => describeAgentStep(tool, data.status).status === 'failed').length;
    const questions = rows.filter(part => part.type === 'question').length;
    // Beside the workspace the live process stays open; narrower screens keep it to two lines.
    // 详细记录视图默认展开每一步（参数与结果）。
    const open = disclosed ?? (detailed || (active && wide) || failed > 0);
    // 任务进行中新加的步骤淡入；展开时已有的步骤、重新挂载的步骤不重放。
    useEntranceMotion(stepsRef, { selector: ':scope > .agent-step', preset: 'fade', scope: `${data.runId}:${tools.length > 0}`, ready: open });
    const live = !open && streaming ? getAgentLiveLine(data) : null;
    const thinking = summarizeThinkingTime(parts);
    const count = !tools.length && !questions
        ? (thinking ?? (streaming ? '思考中' : '已思考'))
        : live ? `· ${completed} / ${tools.length} 完成`
        : `${thinking ? `${thinking} · ` : ''}${summarizeAgentActivity(done, questions, failed)}`;
    return <div className="agent-activity-group">
        <section className={`agent-process${open ? ' is-open' : ''}`} aria-label="任务过程">
            <button type="button" className={`agent-process-heading${live ? ' is-live' : ''}`} aria-expanded={open} aria-controls={id} onClick={() => { setDisclosed(!open); if (!open) setRevealed(true); }}>
                {live && <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
                <span className="agent-process-label">
                    <span className="sr-only">任务过程</span>
                    <span className="agent-process-count" data-failed={failed > 0 || undefined}>{count}</span>
                    {live && <span className="agent-process-now">{live}</span>}
                    <ChevronRight size={12} aria-hidden="true" className={`agent-process-chevron${open ? ' rotate-90' : ''}`} />
                </span>
            </button>
            <ol ref={stepsRef} id={id} className="agent-process-steps" hidden={!open} data-reveal={revealed || undefined}>
                {open && rows.map(part => {
                    if (part.type === 'tool') return <ToolStep key={part.id} tool={part} data={data} shownId={workspace?.shown?.toolId ?? undefined} calls={scriptCalls.get(part.id)} />;
                    // 思考只在展开后给出内容：折叠时只剩「思考」一行，避免把草稿当成过程结论。
                    if (part.type === 'reasoning') return <NoteStep key={part.id} id={part.id} title="思考">
                        <p className="agent-step-reasoning">{part.text}</p>
                    </NoteStep>;
                    return <NoteStep key={part.id} id={part.id} title="向你确认信息" text={firstLine(part.question)}>
                        <MarkdownContent content={part.question} className="text-sm" />
                    </NoteStep>;
                })}
            </ol>
        </section>
    </div>;
}
