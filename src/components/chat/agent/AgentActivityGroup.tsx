'use client';
// 需要折叠状态与工作区上下文：点击步骤在工作区打开对应视图

import { useId, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, CircleHelp, LoaderCircle, Pause, Sparkles, X } from 'lucide-react';
import type { AgentMessageData } from '@/lib/agent/types';
import { getAgentToolFamily } from '@/lib/agent/tool-catalog';
import { getAgentToolQuestionIds } from '@/lib/agent/workspace';
import { deduplicateChartResults } from '@/lib/agent/chart-interaction';
import { useIsDesktopLayout } from '@/lib/hooks/useIsDesktopLayout';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ThinkingBlock } from '../ThinkingBlock';
import { AgentToolDetails } from './AgentToolCard';
import { AgentToolResult } from './AgentToolResult';
import { AGENT_TOOL_FAMILY_LABELS, describeAgentStep, getAgentLiveLine, getAgentStepNumbers, summarizeAgentProcess, type AgentProcessPart, type AgentTool } from './presentation';
import { useAgentResultWorkspace } from './AgentResultContext';
import { StoppedGlyph } from './AgentStatus';

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

function StepMarker({ status, index }: { status: ReturnType<typeof describeAgentStep>['status']; index: number }) {
    switch (status) {
        case 'completed': return <Check size={13} strokeWidth={2.6} />;
        case 'running': return <LoaderCircle size={13} strokeWidth={2.6} className="animate-spin motion-reduce:animate-none" />;
        case 'awaiting_input': return <Pause size={13} strokeWidth={2.6} />;
        case 'failed': return <X size={13} strokeWidth={2.6} />;
        case 'interrupted': return <StoppedGlyph />;
        default: return <>{index}</>;
    }
}

function ToolStep({ tool, index, data, current }: { tool: AgentTool; index: number; data: AgentMessageData; current: boolean }) {
    const id = useId();
    const workspace = useAgentResultWorkspace();
    const step = describeAgentStep(tool, data.status);
    // Failures show their call details right away; without a workspace the row itself discloses them.
    const [disclosed, setDisclosed] = useState(false);
    const details = step.status === 'failed' || (!workspace && disclosed);
    return <li className="agent-step" data-state={step.status}>
        <button type="button" className="agent-step-row" aria-current={current || undefined} title={workspace ? '在工作区查看' : undefined}
            aria-expanded={workspace ? undefined : details} aria-controls={workspace || !details ? undefined : id}
            onClick={() => workspace ? workspace.openResource(`tool:${tool.id}`) : setDisclosed(!disclosed)}>
            <span className="agent-step-marker" aria-hidden="true"><StepMarker status={step.status} index={index} /></span>
            <span className="agent-step-text">
                <span className="agent-step-title">{tool.title}</span>
                {(step.summary || step.note) && <span className="agent-step-detail">
                    {step.summary}{step.summary && step.note ? ' · ' : ''}{step.note && <span className="agent-step-note">{step.note}</span>}
                </span>}
            </span>
            {step.duration && <span className="agent-step-time" title="本次工具调用的实际执行用时">{step.duration}</span>}
            <span className="agent-step-tag">{AGENT_TOOL_FAMILY_LABELS[getAgentToolFamily(tool.name)]}</span>
        </button>
        {details && <AgentToolDetails id={id} tool={tool} runStatus={data.status} />}
    </li>;
}

/** Reasoning between calls and questions asked without the question tool: rows that disclose their text in place. */
function NoteStep({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children: ReactNode }) {
    const id = useId();
    const [open, setOpen] = useState(false);
    return <li className="agent-step agent-step--note">
        <button type="button" className="agent-step-row" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
            <span className="agent-step-marker" aria-hidden="true">{icon}</span>
            <span className="agent-step-text"><span className="agent-step-title">{title}</span><span className="agent-step-detail">{text}</span></span>
            <ChevronRight size={14} aria-hidden="true" className={`agent-step-chevron${open ? ' rotate-90' : ''}`} />
        </button>
        {open && <div id={id} className="agent-step-note-body">{children}</div>}
    </li>;
}

const firstLine = (text: string) => text.trim().split('\n', 1)[0].slice(0, 120);

/** 任务过程: one row per tool call; a row opens that call's view in the workspace. Results follow the card. */
export function AgentActivityGroup({ parts, data, active = false }: { parts: AgentProcessPart[]; data: AgentMessageData; active?: boolean }) {
    const id = useId();
    const workspace = useAgentResultWorkspace();
    const [disclosed, setDisclosed] = useState<boolean | null>(null);
    const wide = useIsDesktopLayout();
    const answered = new Set(getAgentToolQuestionIds(parts).values());
    // Plan updates already show as the task list bar; their questions are answered in the question panel.
    const rows = parts.filter(part => part.type === 'tool' ? getAgentToolFamily(part.name) !== 'plan' : part.type === 'reasoning' ? part.text.trim() : !answered.has(part.id));
    const tools = rows.filter((part): part is AgentTool => part.type === 'tool');
    const resultIds = new Set(deduplicateChartResults(data.parts.filter(part => part.type === 'tool')).map(tool => tool.id));
    const results = parts.filter((part): part is AgentTool => part.type === 'tool' && (resultIds.has(part.id) || part.name === 'parallel_analysis'))
        .map(tool => <AgentToolResult key={tool.id} tool={tool} runStatus={data.status} />);
    const streaming = active && data.status === 'running';
    // Reasoning alone is not a process: it shows as the thinking line, as in plain chat.
    if (!tools.length && rows.every(part => part.type === 'reasoning')) return <>
        {rows.map(part => part.type === 'reasoning' && <ThinkingBlock key={part.id} variant="chat" content={part.text} isStreaming={streaming && data.parts.at(-1)?.id === part.id} />)}
        {results}
    </>;
    const states = tools.map(tool => describeAgentStep(tool, data.status).status);
    const completed = states.filter(status => status === 'completed').length;
    const failed = states.filter(status => status === 'failed').length;
    // Beside the workspace the live process stays open; narrower screens keep it to two lines,
    // the second saying what runs now (design board "手机 · 任务对话").
    const open = disclosed ?? ((active && wide) || failed > 0);
    const live = !open && streaming ? getAgentLiveLine(data) : null;
    const count = !tools.length ? '向你确认信息'
        // Folded while it runs, the card reads 任务过程 · 4 / 5 完成 over that line.
        : live ? `· ${completed} / ${tools.length} 完成`
        : `${tools.length} 个步骤 · ${completed === tools.length ? '全部完成' : `${completed} 个已完成`}${failed ? ` · ${failed} 处失败` : ''}`;
    const summary = open || live ? '' : summarizeAgentProcess(tools);
    // Numbered across the task so a step reads the same here and as 第 N 步 in the workspace.
    const numbers = getAgentStepNumbers(data.parts);
    return <div className="agent-activity-group">
        <section className={`agent-process${open ? ' is-open' : ''}`} aria-label="任务过程">
            <button type="button" className={`agent-process-heading${live ? ' is-live' : ''}`} aria-expanded={open} aria-controls={id} onClick={() => setDisclosed(!open)}>
                {open ? null : live ? <LoaderCircle size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ChevronRight size={15} aria-hidden="true" />}
                <span className="agent-process-label">
                    <span className="agent-process-title">任务过程</span>
                    <span className="agent-process-count" data-failed={failed > 0 || undefined}>{count}{summary ? ` · ${summary}` : ''}</span>
                    {live && <span className="agent-process-now">{live}</span>}
                </span>
                {open && workspace && tools.length > 0 && <span className="agent-process-hint">点击步骤，在工作区查看</span>}
                {(open || live) && <ChevronDown size={15} aria-hidden="true" className="agent-process-chevron" />}
            </button>
            <ol id={id} className="agent-process-steps" hidden={!open}>
                {open && rows.map(part => {
                    if (part.type === 'tool') return <ToolStep key={part.id} tool={part} index={numbers.get(part.id) ?? 0} data={data} current={workspace?.shown?.toolId === part.id} />;
                    if (part.type === 'reasoning') return <NoteStep key={part.id} icon={<Sparkles size={13} />} title="思考" text={firstLine(part.text)}>
                        <p className="agent-step-reasoning">{part.text}</p>
                    </NoteStep>;
                    return <NoteStep key={part.id} icon={<CircleHelp size={13} />} title="向你确认信息" text={firstLine(part.question)}>
                        <MarkdownContent content={part.question} className="text-sm" />
                    </NoteStep>;
                })}
            </ol>
        </section>
        {results}
    </div>;
}
