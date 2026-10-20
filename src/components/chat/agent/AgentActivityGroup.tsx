'use client';
// 需要折叠状态与工作区上下文：步骤在转录内展开结果（详细视图另含参数），也可在工作区打开

import { useId, useState, type ReactNode } from 'react';
import { ChevronRight, LoaderCircle, PanelRight, Pause } from 'lucide-react';
import type { AgentMessageData, AgentPart } from '@/lib/agent/types';
import { AGENT_SUBMIT_PLAN_TOOL, getAgentToolFamily } from '@/lib/agent/tool-catalog';
import { getAgentToolQuestionIds } from '@/lib/agent/workspace';
import { getAgentAttachmentRead, getAgentChart, getAgentDataResults, getAgentMemories, getAgentMethod, getAgentMethodCatalog, getAgentProfile, getAgentScript, getAgentToolQuestions, getAgentToolText } from '@/lib/agent/tool-presentation';
import { useIsDesktopLayout } from '@/lib/hooks/useIsDesktopLayout';
import { useTranscriptRecordView } from '@/lib/chat/chat-record-view';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ThinkingBlock } from '../ThinkingBlock';
import { describeAgentStep, formatAgentValue, getAgentLiveLine, getAgentScriptCalls, getAgentToolTitle, getParallelMemberState, summarizeAgentActivity, type AgentProcessPart, type AgentTool } from './presentation';
import { memberAnswerText, parallelAnalysisResults } from '@/lib/agent/parallel-results';
import { ModelAvatar } from './ModelAvatar';
import { getChartFocus, getChartTargets, getAgentChartReference, parseChartReference } from '@/lib/agent/chart-interaction';
import { useAgentResultWorkspace } from './AgentResultContext';

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
            {data.items.length > 0 && <ul className="agent-step-structured-list">{data.items.slice(0, 6).map(item => <li key={item.type + item.id}><strong>{item.name}</strong><span>{item.type}</span></li>)}</ul>}
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
        const label = typeof input.type === 'string' ? input.type : '资料';
        return <div className="agent-step-structured">
            <p className="agent-step-structured-fact">读取了 1 份{label}</p>
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
    return null;
}

/**
 * A step's result, disclosed in place. Collaboration shows its members and the final selection shows the chosen
 * artifacts, each opening its own workspace page; other calls show the Core canonical text, and the raw JSON only in
 * the 「详细」 record view.
 */
function AgentStepCall({ tool, runStatus, parts }: { tool: AgentTool; runStatus: AgentMessageData['status']; parts: AgentPart[] }) {
    const workspace = useAgentResultWorkspace();
    const detailed = useTranscriptRecordView() === 'detailed';
    const script = getAgentScript(tool);
    // 脚本即调用参数：普通视图也给出脚本与它打印给模型的输出；脚本的各次调用在下方逐条列出。
    if (script) return <div className="agent-step-call">
        <pre className="agent-step-script" tabIndex={0} aria-label="脚本"><code>{script.code}</code></pre>
        {script.output?.trim()
            ? <div className="agent-step-output" tabIndex={0} aria-label="脚本输出">{script.output}</div>
            : <p className="agent-step-empty">{describeAgentStep(tool, runStatus).status === 'running' ? '脚本运行中…' : '脚本没有输出。'}</p>}
        {workspace && <div className="agent-step-actions">
            <button type="button" className="agent-step-workspace" onClick={() => workspace.openResource(`tool:${tool.id}`)}>
                <PanelRight size={13} aria-hidden="true" />在工作区查看
            </button>
        </div>}
    </div>;
    // 计划模式：计划正文按 Markdown 展示，决定写在下面；工作区仍是这个调用的详情页。
    if (tool.name === AGENT_SUBMIT_PLAN_TOOL) {
        const plan = tool.input && typeof tool.input === 'object' ? (tool.input as { plan?: unknown }).plan : undefined;
        const summary = describeAgentStep(tool, runStatus).summary;
        return <div className="agent-step-call">
            {typeof plan === 'string' && <div className="agent-step-output agent-step-markdown" tabIndex={0} aria-label="计划">
                <MarkdownContent content={plan} className="chat-prose" />
            </div>}
            <p className="agent-step-empty">{summary === '等待你批准' ? '等待你批准后继续。'
                : summary === '已批准' ? '你已批准，Agent 继续执行。'
                : summary === '要求修改' ? '你要求修改，Agent 会修订后再次提交。' : '计划已提交。'}</p>
            {workspace && <div className="agent-step-actions">
                <button type="button" className="agent-step-workspace" onClick={() => workspace.openResource(`tool:${tool.id}`)}>
                    <PanelRight size={13} aria-hidden="true" />在工作区查看
                </button>
            </div>}
        </div>;
    }
    const input = tool.input === undefined ? null : formatAgentValue(tool.input);
    const canonical = tool.canonicalText?.trim() ? tool.canonicalText : null;
    const text = canonical ?? getAgentToolText(tool);
    const raw = tool.output === undefined ? null : formatAgentValue(tool.output);
    const result = text ?? (detailed ? raw : null);
    const state = describeAgentStep(tool, runStatus).status;
    const entries = tool.input && typeof tool.input === 'object' && !Array.isArray(tool.input)
        ? Object.entries(tool.input as Record<string, unknown>)
        : null;
    const members = tool.name === 'parallel_analysis' ? parallelAnalysisResults(tool.output) : [];
    // 结构化结果（定位、提问、记忆、资料…）自己带「查看…」入口，不再重复「在工作区查看」。
    const structured = members.length === 0 && state !== 'running' ? StepStructured({ tool, parts, workspace }) : null;
    const selfContained = members.length > 0 || structured !== null;
    const family = getAgentToolFamily(tool.name);
    const openLabel = family === 'chart' ? '查看盘面' : family === 'drilldown' ? '查看详查' : '在工作区查看';
    return <div className="agent-step-call">
        {/* 详细视图 = claude 工具详情：逐行 key/value（键等宽半透明）；普通视图不露参数键名。 */}
        {detailed && tool.input !== undefined && <div className="agent-step-command" tabIndex={0} aria-label="调用参数">
            {entries ? entries.map(([key, value]) => <div key={key} className="agent-step-detail-line">
                <span className="agent-step-detail-key">{key}:</span> <span className="agent-step-detail-value">{formatAgentValue(value)}</span>
            </div>) : <div className="agent-step-detail-line"><span className="agent-step-detail-key">input:</span> <span>{input}</span></div>}
        </div>}
        {members.length > 0 && <ul className="agent-step-entities" aria-label="协作成员">
            {members.map(member => {
                const status = getParallelMemberState(member, state);
                const name = member.name ?? member.system;
                const preview = member.answer ? previewLine(memberAnswerText(member.answer)) : member.focus ?? null;
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
        {result !== null && members.length === 0
            ? text ? <div className="agent-step-output agent-step-markdown" tabIndex={0} aria-label="规范文本"><MarkdownContent content={result} className="chat-prose" /></div>
                : <div className="agent-step-output" tabIndex={0} aria-label="工具结果">{result}</div>
            : members.length === 0 && (state === 'running'
                ? <p className="agent-step-empty">正在等待工具返回结果…</p>
                : structured ?? (raw !== null ? <p className="agent-step-empty">已返回结构化结果</p> : <p className="agent-step-empty">该步骤没有返回详情。</p>))}
        {workspace && !selfContained && <div className="agent-step-actions">
            <button type="button" className="agent-step-workspace" onClick={() => workspace.openResource(`tool:${tool.id}`)}>
                <PanelRight size={13} aria-hidden="true" />{openLabel}
            </button>
        </div>}
    </div>;
}

function ToolStep({ tool, data, shownId, calls = [] }: { tool: AgentTool; data: AgentMessageData; shownId?: string; calls?: AgentTool[] }) {
    const id = useId();
    const detailed = useTranscriptRecordView() === 'detailed';
    const step = describeAgentStep(tool, data.status);
    const [disclosed, setDisclosed] = useState<boolean | null>(null);
    // 详细视图默认展开每一步的调用参数与结果；普通视图点击行才展开。
    const details = disclosed ?? (detailed || step.status === 'failed');
    return <li className="agent-step" data-state={step.status}>
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
        {details && <div id={id} className="agent-step-body" data-tool-id={tool.id}>
            <AgentStepCall tool={tool} runStatus={data.status} parts={data.parts} />
            {calls.length > 0 && <ol className="agent-step-children" aria-label="脚本调用">
                {calls.map(call => <ToolStep key={call.id} tool={call} data={data} shownId={shownId} />)}
            </ol>}
        </div>}
    </li>;
}

/** Reasoning between calls and questions asked without the question tool: rows that disclose their text in place. */
function NoteStep({ title, text, children }: { title: string; text: string; children: ReactNode }) {
    const id = useId();
    const [open, setOpen] = useState(false);
    return <li className="agent-step agent-step--note">
        <button type="button" className="agent-step-row" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
            <span className="agent-step-text"><span className="agent-step-title">{title}</span><span className="agent-step-detail">{text}</span>
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
    const wide = useIsDesktopLayout();
    const answered = new Set(getAgentToolQuestionIds(parts).values());
    // A code mode script's calls are listed under the script's step, read from the whole message so a call whose
    // part has not moved under its script yet still shows there.
    const scriptCalls = getAgentScriptCalls(data.parts);
    // Plan updates already show as the task list bar; their questions are answered in the question panel.
    const rows = parts.filter(part => part.type === 'tool' ? !part.parentId && getAgentToolFamily(part.name) !== 'plan' : part.type === 'reasoning' ? part.text.trim() : !answered.has(part.id));
    const tools = rows.filter((part): part is AgentTool => part.type === 'tool');
    const streaming = active && data.status === 'running';
    // Reasoning alone is not a process: it shows as the thinking line, as in plain chat.
    if (!tools.length && rows.every(part => part.type === 'reasoning')) return <>
        {rows.map(part => part.type === 'reasoning' && <ThinkingBlock key={part.id} variant="chat" content={part.text} isStreaming={streaming && data.parts.at(-1)?.id === part.id} />)}
    </>;
    const states = tools.map(tool => describeAgentStep(tool, data.status).status);
    const completed = states.filter(status => status === 'completed').length;
    // The summary counts what scripts did too: the charts a script computed are charts the task looked at.
    const done = [...tools, ...tools.flatMap(tool => scriptCalls.get(tool.id) ?? [])];
    const failed = done.filter(tool => describeAgentStep(tool, data.status).status === 'failed').length;
    const questions = rows.filter(part => part.type === 'question').length;
    // Beside the workspace the live process stays open; narrower screens keep it to two lines.
    // 详细记录视图默认展开每一步（参数与结果）。
    const open = disclosed ?? (detailed || (active && wide) || failed > 0);
    const live = !open && streaming ? getAgentLiveLine(data) : null;
    const count = !tools.length ? '向你确认信息'
        : live ? `· ${completed} / ${tools.length} 完成`
        : summarizeAgentActivity(done, questions, failed);
    return <div className="agent-activity-group">
        <section className={`agent-process${open ? ' is-open' : ''}`} aria-label="任务过程">
            <button type="button" className={`agent-process-heading${live ? ' is-live' : ''}`} aria-expanded={open} aria-controls={id} onClick={() => setDisclosed(!open)}>
                {live && <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
                <span className="agent-process-label">
                    <span className="sr-only">任务过程</span>
                    <span className="agent-process-count" data-failed={failed > 0 || undefined}>{count}</span>
                    {live && <span className="agent-process-now">{live}</span>}
                    <ChevronRight size={12} aria-hidden="true" className={`agent-process-chevron${open ? ' rotate-90' : ''}`} />
                </span>
            </button>
            <ol id={id} className="agent-process-steps" hidden={!open}>
                {open && rows.map(part => {
                    if (part.type === 'tool') return <ToolStep key={part.id} tool={part} data={data} shownId={workspace?.shown?.toolId ?? undefined} calls={scriptCalls.get(part.id)} />;
                    if (part.type === 'reasoning') return <NoteStep key={part.id} title="思考" text={firstLine(part.text)}>
                        <p className="agent-step-reasoning">{part.text}</p>
                    </NoteStep>;
                    return <NoteStep key={part.id} title="向你确认信息" text={firstLine(part.question)}>
                        <MarkdownContent content={part.question} className="text-sm" />
                    </NoteStep>;
                })}
            </ol>
        </section>
    </div>;
}
