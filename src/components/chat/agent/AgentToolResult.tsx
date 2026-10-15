'use client';
// 需要展开弹窗状态与工作区上下文：卡片打开工作区或就地展开命盘

import { useId, useMemo, useState, type CSSProperties } from 'react';
import { Check, CircleAlert, LoaderCircle, Maximize2, Orbit, PanelRight, X } from 'lucide-react';
import { getAgentChart, getAgentToolText, type AgentChart, type AgentToolPart } from '@/lib/agent/tool-presentation';
import { REASONING_EFFORT_LABELS } from '@/lib/chat/model-settings';
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import { getBranchElement, getElementColor, getStemElement } from '@/lib/divination/display-helpers';
import { isAgentChartTool, type AgentChartKind } from '@/lib/agent/tool-catalog';
import { ChartErrorBoundary } from '@/components/visualization/ChartRenderer';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { Modal } from '@/components/ui/Modal';
import { CanonicalChartView } from './CanonicalChartView';
import { useAgentResultWorkspace } from './AgentResultContext';
import './agent-results.css';
import { getChartFocus } from '@/lib/agent/chart-interaction';
import { parallelAnalysisResults, type ParallelAnalysisResult } from '@/lib/agent/parallel-results';
import type { AgentRunStatus } from '@/lib/agent/types';
import { getAgentToolState, getParallelMemberState } from './presentation';

function TextFallback({ tool, incomplete = false }: { tool: AgentToolPart; incomplete?: boolean }) {
  const text = getAgentToolText(tool);
  return <div className="agent-result-fallback">
    <p className="text-sm text-foreground-secondary">{incomplete ? '命盘数据不完整，已保留工具返回内容。' : '暂时无法显示命盘，已切换为工具返回文本。'}</p>
    <div className="agent-result-text" tabIndex={0} aria-label="工具返回文本">{text ? <MarkdownContent content={text} /> : <pre>{JSON.stringify(tool.output, null, 2) ?? '未返回命盘数据。'}</pre>}</div>
  </div>;
}

/** One serif character per reading kind for the compact card; bazi shows its four pillars instead. */
export const CHART_GLYPHS: Record<AgentChartKind, string> = {
  bazi: '八', ziwei: '紫', qimen: '奇', liuyao: '卦', meihua: '梅', daliuren: '课', xiaoliuren: '壬', tarot: '塔', taiyi: '乙', astrology: '星', almanac: '历',
};

/**
 * Four pillars in element colors. `card` and `overview` mark the day pillar;
 * `small` is the final-results variant and `overview` fills a workspace card.
 */
export function BaziPillars({ chart, size = 'card' }: { chart: Extract<AgentChart, { kind: 'bazi' }>['chart']; size?: 'card' | 'small' | 'overview' }) {
  const color = (element: ReturnType<typeof getStemElement>) => element ? { color: getElementColor(element) } : undefined;
  return <span className="agent-result-pillars" data-size={size} aria-hidden="true">{chart.四柱.map(pillar => {
    const [stem, branch] = [pillar.干支.charAt(0), pillar.干支.charAt(1)];
    return <span key={pillar.柱} data-day-pillar={size !== 'small' && pillar.柱 === '日柱' ? 'true' : undefined}><span style={color(getStemElement(stem))}>{stem}</span><span style={color(getBranchElement(branch))}>{branch}</span></span>;
  })}</span>;
}

function ChartGlyph({ value, kind }: { value: AgentChart | null; kind: AgentChartKind | null }) {
  if (value?.kind === 'bazi') return <BaziPillars chart={value.chart} />;
  const glyphKind = value?.kind ?? kind;
  return <span className="agent-result-glyph" aria-hidden="true">{glyphKind ? CHART_GLYPHS[glyphKind] : <Orbit size={18} />}</span>;
}

const effortLabel = (value?: string) => value === 'off' ? '不推理' : value && (AI_REASONING_EFFORTS as readonly string[]).includes(value) ? REASONING_EFFORT_LABELS[value as AIReasoningEffort] : null;

function chartSubtitle(value: AgentChart) {
  if (value.kind !== 'bazi') return value.summary;
  const basic = value.chart.基本信息;
  return [basic.性别, `日主 ${basic.日主}`, value.chart.干支关系[0]].filter(Boolean).join(' · ');
}

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
          <strong>{analysis.name ?? analysis.system}</strong>
          <small>{[analysis.modelName ?? analysis.model ?? '主模型', effortLabel(analysis.reasoningEffort)].filter(Boolean).join(' · ')}</small>
          <span className="agent-member-status" data-state={status.state}>
            {status.state === 'completed' ? <Check size={12} strokeWidth={2.6} aria-hidden="true" /> : status.state === 'running' ? <LoaderCircle size={12} strokeWidth={2.6} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CircleAlert size={12} aria-hidden="true" />}
            {current ? <>{current}<span className="sr-only">（{status.label}）</span></> : status.label}
          </span>
        </>;
        // With a workspace the comparison lives there; otherwise a member discloses its own answer here.
        return <li key={analysis.conversationId} data-state={status.state}>
          {workspace ? <button type="button" onClick={() => workspace.openResource(`tool:${tool.id}`)}>{content}</button>
            : analysis.answer ? <button type="button" aria-expanded={opened === analysis.conversationId} onClick={() => setOpened(opened === analysis.conversationId ? null : analysis.conversationId)}>{content}</button>
            : <div>{content}</div>}
        </li>;
      })}
    </ul>
    {!workspace && open?.answer && <div className="agent-collaboration-answer"><MarkdownContent content={open.answer} /></div>}
  </section>;
}

export function AgentToolResult({ tool, runStatus, full = false }: { tool: AgentToolPart; runStatus: AgentRunStatus; full?: boolean }) {
  const id = useId();
  const workspace = useAgentResultWorkspace();
  const [expanded, setExpanded] = useState(false);
  const value = useMemo(() => getAgentChart(tool), [tool]);
  const analyses = tool.name === 'parallel_analysis' ? parallelAnalysisResults(tool.output) : [];
  if (analyses.length) return <CollaborationCard tool={tool} analyses={analyses} runStatus={runStatus} />;
  if (tool.status !== 'completed') return null;
  const focus = getChartFocus(tool);
  if (focus) return <p className="agent-focus-receipt"><span>盘面已定位</span>{focus.caption}</p>;
  if (!isAgentChartTool(tool.name) && tool.name !== 'inspect_chart') return null;
  const title = value?.title ?? tool.title;
  const content = value ? <ChartErrorBoundary resetKey={tool.output} fallback={<TextFallback tool={tool} />}><CanonicalChartView value={value} text={getAgentToolText(tool) ?? undefined} /></ChartErrorBoundary> : <TextFallback tool={tool} incomplete />;
  if (full) return <section className="agent-result-full" aria-label={title}>{value && <p className="agent-result-summary">{value.summary}</p>}<div className="agent-chart-scroll" tabIndex={0} aria-label={`${title}内容`}>{content}</div></section>;
  // Calculations are cached task results until the final selection saves them; inspections read saved records.
  const status = tool.name === 'inspect_chart' ? '已存资料' : '暂存成果';
  const shown = workspace?.shown?.toolIds.has(tool.id) ?? false;
  return <article className="agent-result-card" data-tool-result={tool.id} data-result-kind={tool.name}>
    <ChartGlyph value={value} kind={isAgentChartTool(tool.name) ? tool.name : null} />
    <div className="agent-result-text-block">
      <h3>{title}</h3>
      <p className="agent-result-summary">{value ? `${chartSubtitle(value)} · ${status}` : '命盘数据不完整 · 已保留工具返回内容'}</p>
    </div>
    {workspace
      ? <button type="button" className="agent-primary-button" data-shown={shown || undefined} onClick={() => workspace.openResource(`tool:${tool.id}`)}>
        <PanelRight size={15} aria-hidden="true" />{shown ? '正在工作区显示' : '在工作区查看'}
      </button>
      : <button type="button" className="agent-primary-button" onClick={() => setExpanded(true)}><Maximize2 size={15} aria-hidden="true" />展开{value ? '命盘' : '结果'}</button>}
    {!workspace && <Modal open={expanded} onClose={() => setExpanded(false)} labelledBy={id} className="agent-chart-dialog">
      <header className="agent-chart-dialog-header"><div><h2 id={id}>{title}</h2><p className="agent-result-summary">{value?.summary}</p></div><button type="button" className="agent-icon-button" aria-label="关闭命盘" onClick={() => setExpanded(false)}><X size={20} /></button></header>
      <div className="agent-chart-dialog-body"><div className="agent-chart-scroll" tabIndex={0} aria-label={`${title}内容`}>{content}</div></div>
    </Modal>}
  </article>;
}
