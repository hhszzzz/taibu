'use client';
// 调用详情：参数、结果与复制按钮

import type { AgentRunStatus } from '@/lib/agent/types';
import { getAgentToolText } from '@/lib/agent/tool-presentation';
import { useTranscriptRecordView } from '@/lib/chat/chat-record-view';
import { CopyButton } from './CopyButton';
import { formatAgentValue, getAgentToolState, type AgentTool } from './presentation';
import { AgentToolResult } from './AgentToolResult';
import { JsonCode, ToolCommand } from './ToolCode';

export { CopyButton };

/** 调用详情: the call's arguments and its stored result as returned, each copyable; nothing is restructured. */
export function AgentToolDetails({ tool, runStatus, id, heading = true }: {
    tool: AgentTool; runStatus: AgentRunStatus; id?: string;
    /** False when the surrounding view already names the step and its timing. */
    heading?: boolean;
}) {
    const state = getAgentToolState(tool, runStatus);
    const detailed = useTranscriptRecordView() === 'detailed';
    const canonical = tool.canonicalText?.trim() ? tool.canonicalText : null;
    const input = tool.input === undefined ? null : formatAgentValue(tool.input);
    const readable = canonical ?? getAgentToolText(tool);
    const result = tool.output === undefined ? null : readable ?? formatAgentValue(tool.output);
    return <div id={id} className="agent-tool-details" data-state={state.status}>
        {heading && <div className="agent-tool-details-heading">
            <span>{tool.title}</span>
            {detailed && <code>{tool.name}</code>}
        </div>}
        {input !== null && <section className="agent-tool-section" aria-label="调用参数">
            <div className="agent-tool-section-heading">调用参数<CopyButton text={input} label="复制" name="复制调用参数" /></div>
            <ToolCommand name={tool.name} input={tool.input} />
        </section>}
        {result !== null && <section className="agent-tool-section" aria-label="工具结果">
            <div className="agent-tool-section-heading">工具结果{canonical ? <CopyButton text={canonical} label="复制规范文本" /> : <CopyButton text={result} label="复制" name="复制工具结果" />}</div>
            {/* 没有规范文本时给的是原样返回值：按 JSON 分色排版；有文本时保持原文。 */}
            {readable ? <pre className="agent-tool-value" tabIndex={0}>{result}</pre> : <JsonCode value={tool.output} label="工具结果" />}
        </section>}
        {input === null && result === null && <p className="agent-tool-empty">{state.status === 'running' ? '正在等待工具返回结果…' : '该步骤没有返回详情。'}</p>}
    </div>;
}

/** Workspace view of a single call: its details, then the full reading when the call produced one. */
export function AgentToolCard({ tool, runStatus }: { tool: AgentTool; runStatus: AgentRunStatus }) {
    return <div className="agent-tool-view">
        <AgentToolDetails tool={tool} runStatus={runStatus} />
        <AgentToolResult tool={tool} runStatus={runStatus} />
    </div>;
}
