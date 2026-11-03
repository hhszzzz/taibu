"use client";
// 需要工作区上下文与折叠交互；任务过程与操作栏按设计稿组合
import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { ArrowUpRight, CircleAlert, Globe } from "lucide-react";
import type { AgentMessageData, AgentPart } from "@/lib/agent/types";
import { collaborationProgress } from "@/lib/agent/parallel-results";
import { getAgentCitationLabels } from "@/lib/agent/evidence";
import { getAgentArchiveProposal, getAgentArchiveRecord, type AgentArchiveCard, type AgentArchiveRecord } from "@/lib/agent/archive";
import { MarkdownContent, type MarkdownCitations } from "@/components/ui/MarkdownContent";
import { BrandMark } from "@/components/brand/BrandMark";
import { AgentStatus } from './agent/AgentStatus';
import { AgentActivityGroup, AgentActivityIndicator } from './agent/AgentActivityGroup';
import { AgentTodoProgress } from './agent/AgentTodoProgress';
import { AgentEvidenceChip } from './agent/AgentEvidenceChip';
import { AgentArchiveProposalCard, AgentArchiveReceipt } from './agent/AgentArchiveCards';
import { useAgentResultWorkspace } from './agent/AgentResultContext';
import { useAgentTailText } from '@/lib/agent/use-agent-tail';
import { groupAgentParts } from './agent/presentation';
import { GeneratedImageGallery } from './agent/GeneratedImageGallery';
import { getAgentGeneratedImages } from '@/lib/agent/tool-presentation';
import { AGENT_WEB_TOOLS } from "@/lib/agent/tool-catalog";
import { useToast } from '@/components/ui/Toast';

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

type ArchiveEntry = { id: string; kind: 'card'; card: AgentArchiveCard } | { id: string; kind: 'record'; record: AgentArchiveRecord };

/**
 * Save cards and recorded events of this answer, under it: the steps fold away, but what waits for the user must not.
 * A script cannot write the archive, so only the model's own calls count.
 */
function getArchiveEntries(parts: AgentPart[]): ArchiveEntry[] {
  return parts.flatMap((part): ArchiveEntry[] => {
    if (part.type !== 'tool' || part.parentId) return [];
    const card = getAgentArchiveProposal(part);
    if (card) return [{ id: part.id, kind: 'card', card }];
    const record = getAgentArchiveRecord(part);
    return record ? [{ id: part.id, kind: 'record', record }] : [];
  });
}

export function AgentMessage({ data, actions }: { data: AgentMessageData; actions?: ReactNode }) {
  const { showToast } = useToast();
  const chartErrorToasted = useRef(false);
  const handleChartError = useCallback(() => {
    if (chartErrorToasted.current) return;
    chartErrorToasted.current = true;
    showToast('error', '图表错误，已隐藏该图表；文字解读仍保留。');
  }, [showToast]);
  const citations = useAnswerCitations(data.parts);
  const groups = groupAgentParts(data.parts);
  const active = ['queued', 'running', 'awaiting_input', 'cancelling'].includes(data.status);
  const summarizing = data.status === 'running' && data.runtime?.model.name && collaborationProgress(data.parts) ? data.runtime.model.name : null;
  const lastText = groups.findLastIndex(group => group.type === 'content' && group.part.type === 'text');
  const tail = useAgentTailText(data.runId);
  const lastTextPart = lastText < 0 || groups[lastText].type !== 'content' ? undefined : groups[lastText].part;
  // 增量只承接已提交的正文：快照还没走到这一块时按快照显示。
  const liveText = lastTextPart?.type === 'text' && tail.length > lastTextPart.text.length && tail.startsWith(lastTextPart.text) ? tail : undefined;
  const hasSearchStep = data.parts.some(part => part.type === 'tool' && (AGENT_WEB_TOOLS.has(part.name) || part.name === 'search_knowledge'));
  const archive = useMemo(() => getArchiveEntries(data.parts), [data.parts]);
  // 生图结果在回答下方以图集展示：步骤会折叠，图片是这次任务的成果。
  const generatedImages = useMemo(() => data.parts.flatMap(part => {
    if (part.type !== 'tool' || part.parentId) return [];
    const generated = getAgentGeneratedImages(part);
    return generated ? [generated.images] : [];
  }), [data.parts]);
  return (
    <div className="agent-message" data-agent-run-id={data.runId} data-agent-status={data.status}>
      <div className="agent-message-heading">
        <BrandMark className="agent-avatar" compact />
        <span className="agent-name">太卜</span>
        {/* 进行中由底部那一行实时说明，失败由错误提示说明；这里只给没有别处交代的结局：已停止、没有原因的失败。 */}
        {(data.status === 'cancelled' || (data.status === 'failed' && !data.error)) && <AgentStatus status={data.status} />}
        {summarizing && <span className="agent-response-time">主模型 {summarizing} · 汇总</span>}
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
          const text = index === lastText && liveText ? liveText : part.text;
          return <div key={part.id} className={`chat-answer${streaming ? ' is-streaming' : ''}`}><MarkdownContent content={text} className="chat-prose" streaming={streaming} citations={citations} onChartError={handleChartError} /></div>;
        }
        if (part.type === "source") {
          // 命中的来源现在列在对应检索调用的框里；只有检索调用不在这条消息里的旧记录才在正文下单独列出。
          if (hasSearchStep) return null;
          return /^https?:\/\//iu.test(part.url) ? (
            <a key={part.id} href={part.url} target="_blank" rel="noopener noreferrer" className="agent-source-link">
              <Globe className="h-4 w-4 shrink-0 mt-0.5" />
              {part.title || part.url}
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </a>
          ) : null;
        }
        return null;
      })}
      {generatedImages.map((images, index) => <GeneratedImageGallery key={images[0]?.id ?? index} images={images} label="生成的图片" />)}
      {archive.length > 0 && <div className="agent-archive-list">
        {archive.map(entry => entry.kind === 'card' ? <AgentArchiveProposalCard key={entry.id} card={entry.card} /> : <AgentArchiveReceipt key={entry.id} record={entry.record} />)}
      </div>}
      <AgentActivityIndicator data={data} />
      {data.error && <p className="agent-error" role="alert"><CircleAlert size={15} aria-hidden="true" />{data.error}</p>}
      {/* Evidence and message actions share one row; it collapses when both are absent. */}
      <div className="agent-message-footer"><AgentEvidenceChip parts={data.parts} />{actions}</div>
    </div>
  );
}
