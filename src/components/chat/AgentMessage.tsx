"use client";
// 需要工作区上下文与折叠交互；任务过程、成果与操作栏按设计稿组合
import { useId, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleAlert, FileCheck2, Globe } from "lucide-react";
import type { AgentMessageData, AgentPart } from "@/lib/agent/types";
import { getAgentChart, getAgentToolArtifactId } from "@/lib/agent/tool-presentation";
import { AGENT_CHART_NAMES, isAgentChartTool } from "@/lib/agent/tool-catalog";
import { collaborationProgress } from "@/lib/agent/parallel-results";
import { getAgentCitationLabels } from "@/lib/agent/evidence";
import { MarkdownContent, type MarkdownCitations } from "@/components/ui/MarkdownContent";
import { AgentStatus } from './agent/AgentStatus';
import { AgentActivityGroup, AgentActivityIndicator } from './agent/AgentActivityGroup';
import { AgentTodoProgress } from './agent/AgentTodoProgress';
import { AgentEvidenceChip } from './agent/AgentEvidenceChip';
import { useAgentResultWorkspace } from './agent/AgentResultContext';
import { BaziPillars } from './agent/AgentToolResult';
import { formatAgentToolDuration, getAgentArtifactHref, getAgentIntermediateResults, getAgentResponseTiming, groupAgentParts, type AgentArtifact, type AgentTool } from './agent/presentation';

/** 本任务成果: the readings the Agent selected before answering, saved once the task completed. */
function AgentFinalResults({ artifacts, tools }: { artifacts: AgentArtifact[]; tools: AgentTool[] }) {
  const id = useId();
  const rows = artifacts.flatMap(artifact => {
    const href = getAgentArtifactHref(artifact);
    if (!href) return [];
    const reading = tools.find(tool => getAgentToolArtifactId(tool) === artifact.id);
    const chart = reading ? getAgentChart(reading) : null;
    const kind = artifact.chartType && isAgentChartTool(artifact.chartType) ? AGENT_CHART_NAMES[artifact.chartType] : null;
    return [{ artifact, href, chart, title: kind ? [kind, artifact.title].filter(Boolean).join(' · ') : artifact.title, kind }];
  });
  if (!rows.length) return null;
  const intermediate = getAgentIntermediateResults(tools, artifacts);
  return <section className="agent-final-results" aria-labelledby={id}>
    <div className="agent-final-heading"><h3 id={id}>本任务成果</h3><span>由 Agent 在答复前选定</span></div>
    <ul>
      {rows.map(({ artifact, href, chart, title, kind }) => <li key={artifact.id}>
        {chart?.kind === 'bazi' ? <BaziPillars chart={chart.chart} size="small" /> : <span className="agent-final-icon" aria-hidden="true"><FileCheck2 size={17} /></span>}
        <span className="agent-final-text">
          <span>{title}</span>
          {/* Completion reuses a saved chart of the same person and birth data instead of adding another. */}
          <small>{kind ? '已保存到「命盘」 · 与已有命盘同一身份时复用，不重复保存' : '已保存到「命理记录」'}</small>
        </span>
        <Link href={href} className="agent-final-open" aria-label={`打开${title}`}>打开<ArrowUpRight size={13} aria-hidden="true" /></Link>
      </li>)}
    </ul>
    {intermediate && <p>{intermediate}是中间结果，保留在任务过程和工作区中，不另存记录。</p>}
  </section>;
}

/**
 * [n] badges for what this answer's own task returned; a badge opens its source in the workspace.
 * The labels keep their identity while text streams in, so settled blocks are not parsed again.
 */
function useAnswerCitations(parts: AgentPart[]): MarkdownCitations | undefined {
  const workspace = useAgentResultWorkspace();
  const key = useMemo(() => JSON.stringify([...getAgentCitationLabels(parts)]), [parts]);
  const labels = useMemo(() => new Map(JSON.parse(key) as Array<[number, string]>), [key]);
  const active = workspace?.shown?.cite ?? null;
  const openResource = workspace?.openResource;
  return useMemo(() => labels.size ? { labels, active, onOpen: openResource && ((cite: number) => openResource(`cite:${cite}`)) } : undefined, [labels, active, openResource]);
}

export function AgentMessage({ data, actions }: { data: AgentMessageData; actions?: ReactNode }) {
  const citations = useAnswerCitations(data.parts);
  const groups = groupAgentParts(data.parts);
  const responseTiming = getAgentResponseTiming(data.runtime?.responses);
  const active = ['queued', 'running', 'awaiting_input', 'cancelling'].includes(data.status);
  const tools = data.parts.filter((part): part is AgentTool => part.type === 'tool');
  const artifacts = data.parts.filter((part): part is AgentArtifact => part.type === 'artifact');
  // While members analyse, the main model only gathers and reconciles their answers.
  const summarizing = data.status === 'running' && data.runtime?.model.name && collaborationProgress(data.parts) ? data.runtime.model.name : null;
  const lastText = groups.findLastIndex(group => group.type === 'content' && group.part.type === 'text');
  return (
    <div className="agent-message" data-agent-run-id={data.runId} data-agent-status={data.status}>
      <div className="agent-message-heading">
        <span className="agent-avatar" aria-hidden="true">卜</span>
        <span className="agent-name">太卜</span>
        <AgentStatus status={data.status} />
        {summarizing ? <span className="agent-response-time">主模型 {summarizing} · 汇总</span>
          : responseTiming && <span className="agent-response-time" title="已结束的模型响应用时，不含工具执行与等待回答">模型响应 {formatAgentToolDuration(responseTiming.durationMs)} · {responseTiming.count} 次</span>}
      </div>
      {data.parts.map(part => part.type === 'todo' && <AgentTodoProgress key={part.id} items={part.items} />)}
      {data.compactions?.map(record => <details key={record.id} className="agent-compaction">
        <summary>{record.status === 'completed' ? '已压缩上下文 · 保留最近内容' : '上下文压缩失败 · 原上下文仍保留'}</summary>
        <MarkdownContent content={record.summary ?? record.reason ?? ''} />
      </details>)}
      {groups.map((group, index) => {
        if (group.type === 'activity') return <AgentActivityGroup key={group.id} parts={group.parts} data={data} active={active && !groups.slice(index + 1).some(next => next.type === 'activity')} />;
        const part = group.part;
        if (part.type === "text") {
          const streaming = data.status === 'running' && index === groups.length - 1 && index === lastText;
          return <div key={part.id} className={`chat-answer${streaming ? ' is-streaming' : ''}`}><MarkdownContent content={part.text} className="chat-prose" streaming={streaming} citations={citations} /></div>;
        }
        if (part.type === "source")
          return /^https?:\/\//iu.test(part.url) ? (
            <a key={part.id} href={part.url} target="_blank" rel="noopener noreferrer" className="agent-source-link">
              <Globe className="h-4 w-4 shrink-0 mt-0.5" />
              {part.title || part.url}
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </a>
          ) : null;
        return null;
      })}
      <AgentFinalResults artifacts={artifacts} tools={tools} />
      <AgentActivityIndicator data={data} />
      {data.error && <p className="agent-error" role="alert"><CircleAlert size={15} aria-hidden="true" />{data.error}</p>}
      {/* Evidence and message actions share one row; it collapses when both are absent. */}
      <div className="agent-message-footer"><AgentEvidenceChip parts={data.parts} />{actions}</div>
    </div>
  );
}
