'use client';
// 需要复制状态与 Toast 反馈

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { AgentRunStatus } from '@/lib/agent/types';
import { getAgentToolText } from '@/lib/agent/tool-presentation';
import { useToast } from '@/components/ui/Toast';
import { formatAgentToolDuration, formatAgentValue, getAgentTaskSpan, getAgentToolState, type AgentTool } from './presentation';
import { AgentToolResult } from './AgentToolResult';

/** Copies `text`; an icon-only button is named by `label` and confirms with a check mark. */
export function CopyButton({ text, label, name, iconOnly = false, className = 'agent-tool-copy' }: { text: string; label: string; name?: string; iconOnly?: boolean; className?: string }) {
    const [copied, setCopied] = useState(false);
    const { showToast } = useToast();
    const size = iconOnly ? 16 : 12;
    return <button type="button" className={className} aria-label={name ?? (iconOnly ? label : undefined)} title={iconOnly ? label : undefined} onClick={async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
        } catch {
            showToast('error', '复制失败，请重试');
        }
    }}>
        {copied ? <Check size={size} aria-hidden="true" /> : <Copy size={size} aria-hidden="true" />}
        {!iconOnly && (copied ? '已复制' : label)}
    </button>;
}

/** 调用详情: the call's arguments and its stored result as returned, each copyable; nothing is restructured. */
export function AgentToolDetails({ tool, runStatus, id, heading = true }: {
    tool: AgentTool; runStatus: AgentRunStatus; id?: string;
    /** False when the surrounding view already names the step and its timing. */
    heading?: boolean;
}) {
    const state = getAgentToolState(tool, runStatus);
    const span = getAgentTaskSpan(tool);
    const measured = typeof tool.durationMs === 'number' && Number.isFinite(tool.durationMs) && tool.durationMs >= 0;
    // Execution is the measured execute(); the stage span also covers waiting for an answer and recovery.
    const timing = [measured ? `执行 ${formatAgentToolDuration(tool.durationMs!)}` : null, span !== null ? `阶段 ${formatAgentToolDuration(span)}（含等待）` : null].filter(Boolean).join(' · ');
    const canonical = tool.canonicalText?.trim() ? tool.canonicalText : null;
    const input = tool.input === undefined ? null : formatAgentValue(tool.input);
    const result = tool.output === undefined ? null : canonical ?? getAgentToolText(tool) ?? formatAgentValue(tool.output);
    return <div id={id} className="agent-tool-details" data-state={state.status}>
        {heading && <div className="agent-tool-details-heading">
            <span>{tool.title}</span>
            <code>{tool.name}</code>
            {timing && <span className="agent-tool-timing">{timing}</span>}
        </div>}
        {input !== null && <section className="agent-tool-section" aria-label="调用参数">
            <div className="agent-tool-section-heading">调用参数<CopyButton text={input} label="复制" name="复制调用参数" /></div>
            <pre className="agent-tool-value" tabIndex={0}>{input}</pre>
        </section>}
        {result !== null && <section className="agent-tool-section" aria-label="工具结果">
            <div className="agent-tool-section-heading">工具结果{canonical ? <CopyButton text={canonical} label="复制规范文本" /> : <CopyButton text={result} label="复制" name="复制工具结果" />}</div>
            <pre className="agent-tool-value" tabIndex={0}>{result}</pre>
        </section>}
        {input === null && result === null && <p className="agent-tool-empty">{state.status === 'running' ? '正在等待工具返回结果…' : '该步骤没有返回详情。'}</p>}
    </div>;
}

/** Workspace view of a single call: its details, then the full reading when the call produced one. */
export function AgentToolCard({ tool, runStatus }: { tool: AgentTool; runStatus: AgentRunStatus }) {
    return <div className="agent-tool-view">
        <AgentToolDetails tool={tool} runStatus={runStatus} />
        <AgentToolResult tool={tool} runStatus={runStatus} full />
    </div>;
}
