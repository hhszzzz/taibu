'use client';
// 需要盘面选择状态、跟随定位滚动与全屏弹窗

import { useEffect, useId, useMemo, useRef } from 'react';
import { LocateFixed, MessageCircleQuestion } from 'lucide-react';
import type { BaziWuxingCanonicalJSON } from 'taibu-core/bazi';
import type { AgentChart, AgentToolPart } from '@/lib/agent/tool-presentation';
import { getAgentToolText } from '@/lib/agent/tool-presentation';
import { getChartTargets, type ChartAskContext, type ChartFocus, type ChartTarget } from '@/lib/agent/chart-interaction';
import { ChartErrorBoundary } from '@/components/visualization/ChartRenderer';
import { BAZI_COLUMNS, baziBoardRows, layoutRelations, type RelationEdge } from '@/lib/divination/ganzhi-relation-layout';
import { CanonicalChartView, type BaziRelationOverlay } from './CanonicalChartView';
import { baziGlyphMarks } from './bazi-board';
import { CopyButton } from './AgentToolCard';
import './agent-results.css';

const NO_ROWS: never[] = [];

/**
 * 命盘 (Main board): the subject line and compact tools, the position being
 * looked at with its actions, the interactive chart and bazi relations. The
 * title lives on the workspace tab, so the board itself does not repeat it.
 */
export function AgentInteractiveChart({ value, tool, reference, focus, followModel, live = false, pinned = false, subject, baziWuxing, onAsk }: {
  value: AgentChart; tool: AgentToolPart; reference: string | null; focus?: ChartFocus | null; followModel: boolean;
  /** 这张八字最近的五行详查：盘面画干支自坐与相邻天干，并在藏干旁标出通根与月令透出。 */
  baziWuxing?: BaziWuxingCanonicalJSON | null;
  /** The model is still working, so the focus box says whether it is being followed. */
  live?: boolean;
  /** The focus was opened from its step or a citation: show and reveal it even while not following. */
  pinned?: boolean;
  /** 男 · 公历 1990-01-15 09:00 · Asia/Shanghai · 日主 庚 */
  subject?: string;
  /** 追问：把盘名与当前查看的位置作为富文本上下文交给输入框。 */
  onAsk?: (ask: ChartAskContext) => void;
}) {
  const titleId = useId();
  const targets = useMemo(() => getChartTargets(value), [value]);
  const model = focus?.reference === reference ? focus : null;
  // 当前查看的位置只来自模型：点击盘面不再改高亮，只把该位置带入追问。
  const ids = useMemo(() => model?.targetIds ?? [], [model?.targetIds]);
  // 三方四正 / 关联位置完全由模型决定：模型看了就展开，没看就不展开。
  const related = model?.includeRelated ?? false;
  const selected = useMemo(() => targets.filter(target => ids.includes(target.id)), [targets, ids]);
  // 一个位置与它的某一层（六壬的地盘丑与其天盘子）可能同名，同名的位置只列一次。
  const chips = [...new Map(selected.map(target => [target.label, target.id])).entries()];
  const viewportRef = useRef<HTMLDivElement>(null);
  const first = selected[0];
  const scrollTarget = first?.kind === 'bazi_relation'
    ? targets.find(target => target.kind === 'bazi_cell' && first.relation.位置.some(cell => target.cell.柱 === cell.柱 && target.cell.部位 === cell.部位))?.id
    : first?.id;
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !(followModel || pinned) || !scrollTarget) return;
    const reveal = () => {
      const target = [...viewport.querySelectorAll<HTMLElement>('[data-chart-target]')].find(node => node.dataset.chartTarget === scrollTarget);
      if (!target) return false;
      const bounds = viewport.getBoundingClientRect(), cell = target.getBoundingClientRect();
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      if (cell.left < bounds.left || cell.right > bounds.right) viewport.scrollBy({ left: cell.left - bounds.left - bounds.width / 2 + cell.width / 2, behavior });
      const panel = viewport.closest<HTMLElement>('.agent-panel-scroll');
      if (panel) {
        const visible = panel.getBoundingClientRect();
        if (cell.top < visible.top || cell.bottom > visible.bottom) panel.scrollBy({ top: cell.top - visible.top - visible.height / 2 + cell.height / 2, behavior });
      }
      return true;
    };
    if (reveal()) return;
    const observer = new MutationObserver(() => { if (reveal()) observer.disconnect(); });
    observer.observe(viewport, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [scrollTarget, followModel, pinned]);
  const ask = (asked: ChartTarget[]) => {
    if (!reference || !onAsk) return;
    onAsk({ reference, title: value.title, kind: value.kind, targets: asked });
  };
  // 点击盘面 = 追问这个位置；盘面高亮仍由模型给出的位置决定。
  const askTarget = (id: string) => {
    const target = targets.find(item => item.id === id);
    ask(target ? [target] : selected);
  };
  const located = useMemo(() => new Set(ids), [ids]);
  // Agent 看的字：定位的字块与定位关系的两端，五行详查画的线靠它们认出是否在看。
  const locatedCells = useMemo(() => new Set(selected.flatMap(target => target.kind === 'bazi_cell' ? [target.cell]
    : target.kind === 'bazi_relation' ? target.relation.位置 : []).map(cell => cell.柱 + ':' + cell.部位)), [selected]);
  const wuxing = baziWuxing ?? null;
  const detail = value.kind === 'bazi' ? value.chart.干支关系明细 ?? NO_ROWS : NO_ROWS;
  // 相邻关系的直连线画在两字之间；只有可点击的字块留了足够内边距，只读的纯文字列仍走括线，徽标不会压住字形。
  const inlineRelations = Boolean(onAsk);
  // 关系与流通同时画在盘上：流通在内层、关系在外层，两套线不交叉。
  const board = useMemo(() => layoutRelations(baziBoardRows(detail, wuxing, located), BAZI_COLUMNS, { inlineRelations, layered: true }), [detail, wuxing, located, inlineRelations]);
  const marks = useMemo(() => baziGlyphMarks(wuxing), [wuxing]);
  // 点徽标 = 追问这条关系：Core 给了关系 id 的直接带上关系，五行详查的事实带上它连着的字。
  const askEdge = (edge: RelationEdge) => {
    const relation = targets.find(target => target.id === edge.id);
    ask(relation ? [relation] : targets.filter(target => target.kind === 'bazi_cell'
      && edge.cells.some(cell => cell.column === target.cell.柱 && cell.part === target.cell.部位)));
  };
  const baziOverlay: BaziRelationOverlay | undefined = value.kind === 'bazi'
    ? { layout: board, located, locatedCells, marks, onSelect: reference && onAsk ? askEdge : undefined }
    : undefined;
  const text = getAgentToolText(tool);
  // 详查在盘面上方只留一行「太卜正在查看」；看的是哪一项由紧随其后的详查标题说明。
  const label = model ? '太卜正在查看' : null;
  const caption = model?.caption ?? null;
  const hasFocus = Boolean(label);
  // Agent 正在看某些位置时，盘面其余位置自动退后；指着任一位置时只亮它（样式见 agent-results.css）。
  return <section className="agent-interactive-chart" aria-labelledby={titleId} data-viewing={selected.length > 0 || undefined}>
    <header className="agent-board-heading">
      <h3 id={titleId} className="sr-only">{value.title}</h3>
      {subject && <p className="agent-board-subject">{subject}</p>}
      <div className="agent-board-tools">
        {model && <span className="agent-board-tool is-viewing" role="img" title={live && followModel ? '太卜正在查看这里' : '太卜查看的位置'}
          aria-label={live && followModel ? '太卜正在查看这里' : '太卜查看的位置'}><LocateFixed size={14} aria-hidden="true" /></span>}
        {reference && onAsk && <button type="button" className="agent-board-tool" aria-label={selected.length ? '追问这里' : '追问这张命盘'}
          title={selected.length ? '追问这里' : '追问这张命盘'} onClick={() => ask(selected)}><MessageCircleQuestion size={14} aria-hidden="true" /></button>}
        {text && <CopyButton text={text} label="复制规范文本" iconOnly className="agent-board-tool" />}
      </div>
    </header>
    <div className={`agent-board-focus${hasFocus ? '' : ' is-empty'}`} aria-live="polite" data-chart-focus={selected.map(target => target.id).join(',')} data-source={model ? 'model' : undefined}>
      {label && <span className="agent-board-focus-label">
        <LocateFixed size={13} aria-hidden="true" /><span>{label}</span>
        {live && <span className="agent-board-follow-state">{followModel ? '跟随中' : '已暂停跟随'}</span>}
      </span>}
      {caption && <span className="agent-board-caption">{caption}</span>}
      {chips.length > 0 && <ul className="agent-board-chips" aria-label="盘面位置">{chips.map(([label, id]) => <li key={id}>{label}</li>)}</ul>}
    </div>
    <div ref={viewportRef} className="agent-chart-scroll" tabIndex={0} aria-label={value.title + '内容'}>
      <ChartErrorBoundary resetKey={value.chart} fallback={<pre className="agent-board-fallback">{text ?? '命盘数据暂时无法显示'}</pre>}>
        <CanonicalChartView value={value} targets={selected} includeRelated={related} onTargetSelect={onAsk ? askTarget : undefined} baziOverlay={baziOverlay} />
      </ChartErrorBoundary>
    </div>
    {value.kind === 'bazi' && !value.chart.干支关系明细 && <p className="agent-board-legacy">
      {value.chart.干支关系.join('；') || '此盘未返回干支关系。'} 此历史盘仅保留关系文本，可选择天干或地支查看。
    </p>}
  </section>;
}
