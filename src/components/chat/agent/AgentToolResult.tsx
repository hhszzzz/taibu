'use client';
// 需要协作成员展开状态与工作区上下文

import { useId, useMemo, useState, type CSSProperties } from 'react';
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { ModelAvatar } from './ModelAvatar';
import { MemberRoleBadge } from './MemberRoleBadge';
import { getAgentChart, getAgentGeneratedImages, getAgentToolText, type AgentToolPart } from '@/lib/agent/tool-presentation';
import { REASONING_EFFORT_LABELS } from '@/lib/chat/model-settings';
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import { isAgentChartTool } from '@/lib/agent/tool-catalog';
import { ChartErrorBoundary } from '@/components/visualization/ChartRenderer';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { CanonicalChartView } from './CanonicalChartView';
import { useAgentResultWorkspace } from './AgentResultContext';
import './agent-results.css';
import { getChartFocus } from '@/lib/agent/chart-interaction';
import { memberAnswerText, parallelAnalysisResults, parallelMemberName, type ParallelAnalysisResult } from '@/lib/agent/parallel-results';
import type { AgentRunStatus } from '@/lib/agent/types';
import { getAgentToolState, getParallelMemberState } from './presentation';
import { GeneratedImageGallery } from './GeneratedImageGallery';

function TextFallback({ tool, incomplete = false }: { tool: AgentToolPart; incomplete?: boolean }) {
  const text = getAgentToolText(tool);
  return <div className="agent-result-fallback">
    <p className="text-sm text-foreground-secondary">{incomplete ? '命盘数据不完整，已保留工具返回内容。' : '暂时无法显示命盘，已切换为工具返回文本。'}</p>
    <div className="agent-result-text" tabIndex={0} aria-label="工具返回文本">{text ? <MarkdownContent content={text} /> : <pre>{JSON.stringify(tool.output, null, 2) ?? '未返回命盘数据。'}</pre>}</div>
  </div>;
}

const effortLabel = (value?: string) => value === 'off' ? '不推理' : value && (AI_REASONING_EFFORTS as readonly string[]).includes(value) ? REASONING_EFFORT_LABELS[value as AIReasoningEffort] : null;

/** 协作分析: one column per member with its model, effort and the call it is on; answers are compared in the workspace. */
function CollaborationCard({ tool, analyses, runStatus }: { tool: AgentToolPart; analyses: ParallelAnalysisResult[]; runStatus: AgentRunStatus }) {
  const id = useId();
  const workspace = useAgentResultWorkspace();
  const call = getAgentToolState(tool, runStatus).status;
  const [opened, setOpened] = useState<number | null>(null);
  const open = analyses.find(analysis => analysis.conversationId === opened);
  return <section className="agent-collaboration-results" aria-labelledby={id} style={{ '--members': analyses.length } as CSSProperties}>
    <header>
      <h3 id={id}>协作分析</h3>
      <p>各成员独立分析，主模型汇总分歧</p>
      {workspace && <button type="button" onClick={() => workspace.openResource(`tool:${tool.id}`)}>在工作区比较</button>}
    </header>
    <ul>
      {analyses.map(analysis => {
        const status = getParallelMemberState(analysis, call);
        const current = status.state === 'running' ? analysis.steps?.findLast(step => step.status === 'running')?.title : undefined;
        const content = <>
          <strong><ModelAvatar member={analysis} size={13} />{parallelMemberName(analysis)}<MemberRoleBadge member={analysis} /></strong>
          <small>{[analysis.modelName ?? analysis.model ?? '主模型', effortLabel(analysis.reasoningEffort)].filter(Boolean).join(' · ')}</small>
          <span className="agent-member-status" data-state={status.state}>
            {status.state === 'completed' ? <Check size={12} strokeWidth={2.6} aria-hidden="true" /> : status.state === 'running' ? <LoaderCircle size={12} strokeWidth={2.6} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CircleAlert size={12} aria-hidden="true" />}
            {current ? <>{current}<span className="sr-only">（{status.label}）</span></> : status.label}
          </span>
        </>;
        // With a workspace the comparison lives there; otherwise a member discloses its own answer here.
        return <li key={analysis.conversationId} data-state={status.state}>
          {workspace ? <button type="button" onClick={() => workspace.openResource(`member:${tool.id}:${analysis.conversationId}`)}>{content}</button>
            : analysis.answer ? <button type="button" aria-expanded={opened === analysis.conversationId} onClick={() => setOpened(opened === analysis.conversationId ? null : analysis.conversationId)}>{content}</button>
            : <div>{content}</div>}
        </li>;
      })}
    </ul>
    {!workspace && open?.answer && <div className="agent-collaboration-answer"><MarkdownContent content={memberAnswerText(open.answer)} /></div>}
  </section>;
}

/** A workspace tool view's result: collaboration columns, a focus receipt or the full chart; other calls show nothing extra. */
export function AgentToolResult({ tool, runStatus }: { tool: AgentToolPart; runStatus: AgentRunStatus }) {
  const value = useMemo(() => getAgentChart(tool), [tool]);
  const analyses = tool.name === 'parallel_analysis' ? parallelAnalysisResults(tool.output) : [];
  if (analyses.length) return <CollaborationCard tool={tool} analyses={analyses} runStatus={runStatus} />;
  if (tool.status !== 'completed') return null;
  const generated = getAgentGeneratedImages(tool);
  if (generated) return <GeneratedImageGallery images={generated.images} label="生成的图片" />;
  const focus = getChartFocus(tool);
  if (focus) return <p className="agent-focus-receipt"><span>盘面已定位</span>{focus.caption}</p>;
  if (!isAgentChartTool(tool.name) && tool.name !== 'inspect_chart') return null;
  const title = value?.title ?? tool.title;
  const content = value ? <ChartErrorBoundary resetKey={tool.output} fallback={<TextFallback tool={tool} />}><CanonicalChartView value={value} text={getAgentToolText(tool) ?? undefined} /></ChartErrorBoundary> : <TextFallback tool={tool} incomplete />;
  return <section className="agent-result-full" aria-label={title}>{value && <p className="agent-result-summary">{value.summary}</p>}<div className="agent-chart-scroll" tabIndex={0} aria-label={`${title}内容`}>{content}</div></section>;
}
