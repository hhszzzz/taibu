'use client';
// 需要折叠状态与工作区上下文：步骤在转录内展开参数与结果，也可在工作区打开

import { useId, useState, type ReactNode } from 'react';
import { ChevronRight, LoaderCircle, Pause, PanelRight } from 'lucide-react';
import type { AgentMessageData } from '@/lib/agent/types';
import { getAgentToolFamily } from '@/lib/agent/tool-catalog';
import { getAgentToolQuestionIds } from '@/lib/agent/workspace';
import { getAgentToolText } from '@/lib/agent/tool-presentation';
import { useIsDesktopLayout } from '@/lib/hooks/useIsDesktopLayout';
import { useTranscriptRecordView } from '@/lib/chat/chat-record-view';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ThinkingBlock } from '../ThinkingBlock';
import { CopyButton } from './AgentToolCard';
import { describeAgentStep, formatAgentValue, getAgentLiveLine, getAgentToolTitle, summarizeAgentActivity, type AgentProcessPart, type AgentTool } from './presentation';
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

/** A step's parameters and result, disclosed as claude's key/value lines plus the raw result. */
function AgentStepCall({ tool, runStatus }: { tool: AgentTool; runStatus: AgentMessageData['status'] }) {
    const workspace = useAgentResultWorkspace();
    const input = tool.input === undefined ? null : formatAgentValue(tool.input);
    const canonical = tool.canonicalText?.trim() ? tool.canonicalText : null;
    const result = canonical ?? getAgentToolText(tool) ?? (tool.output === undefined ? null : formatAgentValue(tool.output));
    const state = describeAgentStep(tool, runStatus).status;
    const entries = tool.input && typeof tool.input === 'object' && !Array.isArray(tool.input)
        ? Object.entries(tool.input as Record<string, unknown>)
        : null;
    return <div className="agent-step-call">
        {/* claude 工具详情 = 逐行 key/value（键等宽半透明）+ 原始结果；工具名已在步骤行里。 */}
        <div className="agent-step-command" tabIndex={0} aria-label="调用参数">
            {entries ? entries.map(([key, value]) => <div key={key} className="agent-step-detail-line">
                <span className="agent-step-detail-key">{key}:</span> <span className="agent-step-detail-value">{formatAgentValue(value)}</span>
            </div>) : tool.input !== undefined && <div className="agent-step-detail-line"><span className="agent-step-detail-key">input:</span> <span>{input}</span></div>}
        </div>
        {result !== null
            ? <div className="agent-step-output" tabIndex={0} aria-label="工具结果">{result}</div>
            : <p className="agent-step-empty">{state === 'running' ? '正在等待工具返回结果…' : '该步骤没有返回详情。'}</p>}
        <div className="agent-step-actions">
            {input !== null && <CopyButton text={input} label="复制调用参数" name="复制调用参数" iconOnly className="agent-step-copy" />}
            {result !== null && <CopyButton text={result} label={canonical ? '复制规范文本' : '复制工具结果'} name={canonical ? '复制规范文本' : '复制工具结果'} iconOnly className="agent-step-copy" />}
            {workspace && <button type="button" className="agent-step-workspace" onClick={() => workspace.openResource(`tool:${tool.id}`)}>
                <PanelRight size={13} aria-hidden="true" />在工作区查看
            </button>}
        </div>
    </div>;
}

function ToolStep({ tool, data, current }: { tool: AgentTool; data: AgentMessageData; current: boolean }) {
    const id = useId();
    const detailed = useTranscriptRecordView() === 'detailed';
    const step = describeAgentStep(tool, data.status);
    const [disclosed, setDisclosed] = useState<boolean | null>(null);
    // 详细视图默认展开每一步的调用参数与结果；普通视图点击行才展开。
    const details = disclosed ?? (detailed || step.status === 'failed');
    return <li className="agent-step" data-state={step.status}>
        <button type="button" className="agent-step-row" aria-current={current || undefined}
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
            <AgentStepCall tool={tool} runStatus={data.status} />
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
    // Plan updates already show as the task list bar; their questions are answered in the question panel.
    const rows = parts.filter(part => part.type === 'tool' ? getAgentToolFamily(part.name) !== 'plan' : part.type === 'reasoning' ? part.text.trim() : !answered.has(part.id));
    const tools = rows.filter((part): part is AgentTool => part.type === 'tool');
    const streaming = active && data.status === 'running';
    // Reasoning alone is not a process: it shows as the thinking line, as in plain chat.
    if (!tools.length && rows.every(part => part.type === 'reasoning')) return <>
        {rows.map(part => part.type === 'reasoning' && <ThinkingBlock key={part.id} variant="chat" content={part.text} isStreaming={streaming && data.parts.at(-1)?.id === part.id} />)}
    </>;
    const states = tools.map(tool => describeAgentStep(tool, data.status).status);
    const completed = states.filter(status => status === 'completed').length;
    const failed = states.filter(status => status === 'failed').length;
    const questions = rows.filter(part => part.type === 'question').length;
    // Beside the workspace the live process stays open; narrower screens keep it to two lines.
    // 详细记录视图默认展开每一步（参数与结果）。
    const open = disclosed ?? (detailed || (active && wide) || failed > 0);
    const live = !open && streaming ? getAgentLiveLine(data) : null;
    const count = !tools.length ? '向你确认信息'
        : live ? `· ${completed} / ${tools.length} 完成`
        : summarizeAgentActivity(tools, questions, failed);
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
                    if (part.type === 'tool') return <ToolStep key={part.id} tool={part} data={data} current={workspace?.shown?.toolId === part.id} />;
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
