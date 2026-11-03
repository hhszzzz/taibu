'use client';
// 计划页：只读展示模型提交的 Markdown 计划，以及用户的决定（批准 / 修改意见）。

import { useId } from 'react';
import { isAgentRunTerminal, type AgentRunStatus } from '@/lib/agent/types';
import { getAgentPlan, type AgentToolPart } from '@/lib/agent/tool-presentation';
import { MarkdownContent } from '@/components/ui/MarkdownContent';

const DECISION_LABELS = { waiting: '等待你批准', approved: '已批准', revised: '要求修改', disabled: '计划模式已关闭' } as const;

/**
 * A submission's decision. A task that ended leaves an unanswered plan undecided instead of pretending it still waits.
 */
function draftState(tool: AgentToolPart, approved: boolean | null, ended: boolean, disabled = false): keyof typeof DECISION_LABELS | null {
    if (disabled) return 'disabled';
    if (approved === true) return 'approved';
    if (approved === false) return 'revised';
    return !ended && (tool.status === 'running' || tool.status === 'pending') ? 'waiting' : null;
}

/**
 * 分析计划 (Main board): every submission of this task, newest first — the plan text as the model wrote it in Markdown,
 * and the decision that moved the task on. A revision keeps the earlier plan, so the reader sees what changed.
 */
export function AgentPlanView({ tools, runStatus, step }: { tools: AgentToolPart[]; runStatus: AgentRunStatus; step?: number }) {
    const id = useId();
    const ended = isAgentRunTerminal(runStatus);
    const drafts = tools.flatMap(tool => {
        const plan = getAgentPlan(tool);
        return plan ? [{ tool, plan }] : [];
    });
    const latest = drafts.at(-1);
    const latestState = latest ? draftState(latest.tool, latest.plan.approved, ended, latest.plan.disabled) : null;
    const disabled = drafts.some(draft => draft.plan.disabled);
    const undecided = ended && drafts.length > 0 && drafts.every(draft => draft.plan.approved === null && !draft.plan.disabled);
    return <section className="agent-ws-view agent-ws-plan" aria-labelledby={id}>
        <header className="agent-ws-heading">
            <p>{['计划模式', step ? `第 ${step} 步` : '', latestState ? DECISION_LABELS[latestState] : ''].filter(Boolean).join(' · ')}</p>
            <h2 id={id}>分析计划</h2>
            <p>{disabled ? '计划模式已关闭，提交的计划未获批准；受计划审批保护的操作未执行。'
                : undecided ? '任务结束时计划未被处理，正文保留在这里备查。'
                : '计划由模型以 Markdown 提交；批准后按它执行，要求修改时新一版接在后面，旧版保留。'}</p>
        </header>
        {drafts.length === 0
            ? <p className="agent-ws-note">计划尚未提交。</p>
            : drafts.slice().reverse().map(({ tool, plan }, index) => {
                const state = draftState(tool, plan.approved, ended, plan.disabled);
                const heading = drafts.length > 1 ? `第 ${drafts.length - index} 次提交` : '提交的计划';
                return <article key={tool.id} className="agent-ws-plan-draft" aria-label={heading}>
                    <p className="agent-ws-note">
                        <strong>{heading}</strong>
                        {state && <> · <span data-state={state}>{DECISION_LABELS[state]}</span></>}
                    </p>
                    {plan.feedback && <p className="agent-ws-note">你的意见：{plan.feedback}</p>}
                    <div className="agent-ws-document agent-ws-document-card"><MarkdownContent content={plan.plan} /></div>
                </article>;
            })}
    </section>;
}
