'use client';
// 需要盘面选择状态、跟随定位滚动与全屏弹窗

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LocateFixed, MessageCircleQuestion } from 'lucide-react';
import type { BaziCanonicalJSON, BaziRelationsCanonicalJSON, BaziWuxingCanonicalJSON } from 'taibu-core/bazi';
import type { AgentChart, AgentToolPart } from '@/lib/agent/tool-presentation';
import { getAgentToolText } from '@/lib/agent/tool-presentation';
import { getChartTargets, type ChartAskContext, type ChartFocus, type ChartTarget } from '@/lib/agent/chart-interaction';
import { ChartErrorBoundary } from '@/components/visualization/ChartRenderer';
import { BAZI_COLUMNS, baziBoardRows, layoutRelations, visibleRelationEdges, type RelationEdge, type RelationMode } from '@/lib/divination/ganzhi-relation-layout';
import { getGanZhiElement } from '@/components/bazi/element-classes';
import { WuxingCycleStrip } from '@/components/bazi/result/GanzhiRelationOverlay';
import { CanonicalChartView, type BaziRelationOverlay } from './CanonicalChartView';
import type { BaziViewing } from './bazi-board';
import { CopyButton } from './AgentToolCard';
import './agent-results.css';

/** A relation chip names what it links, as 关系 · 月柱丁克日柱庚; cells keep their label, as 月柱天干 丁. */
const chipLabel = (target: ChartTarget) => target.kind === 'bazi_relation' ? `关系 · ${target.label}` : target.label;

type BoardMode = RelationMode | 'off';
const BOARD_MODES: Array<[BoardMode, string]> = [['relations', '关系'], ['flow', '流通'], ['off', '不显示']];
const NO_ROWS: never[] = [];

/** 没有五行详查时，五行环按天干地支 8 字计数；藏干只用来判断某五行是否出现，与 Core 相生链同口径。 */
function glyphElementCounts(chart: BaziCanonicalJSON) {
  const counts = new Map<string, { 合计: number; 出现: boolean }>();
  const add = (char: string, weight: number) => {
    const element = getGanZhiElement(char);
    if (!element) return;
    const item = counts.get(element) ?? { 合计: 0, 出现: false };
    counts.set(element, { 合计: item.合计 + weight, 出现: true });
  };
  for (const pillar of chart.四柱) {
    if (pillar.干支.includes('*')) continue;
    add(pillar.干支.charAt(0), 1);
    add(pillar.干支.charAt(1), 1);
    for (const hidden of pillar.藏干 ?? []) add(hidden.天干, 0);
  }
  return [...counts].map(([五行, item]) => ({ 五行, ...item }));
}

/**
 * 命盘 (Main board): the subject line and compact tools, the position being
 * looked at with its actions, the interactive chart and bazi relations. The
 * title lives on the workspace tab, so the board itself does not repeat it.
 */
export function AgentInteractiveChart({ value, tool, reference, focus, followModel, live = false, pinned = false, subject, baziFacts, baziViewing, onAsk }: {
  value: AgentChart; tool: AgentToolPart; reference: string | null; focus?: ChartFocus | null; followModel: boolean;
  /**
   * 这张八字最近一次关系详查与五行详查的结果：关系模式补画命盘没列的原局关系（如相破），
   * 流通模式据五行详查画通根、自坐并给出加权五行统计。
   */
  baziFacts?: { relations: BaziRelationsCanonicalJSON | null; wuxing: BaziWuxingCanonicalJSON | null };
  /** Agent 最近在这张八字上看的是干支关系还是五行流通：跟随时盘面切到对应模式。 */
  baziViewing?: BaziViewing | null;
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
  const ids = model?.targetIds ?? [];
  // 三方四正 / 关联位置完全由模型决定：模型看了就展开，没看就不展开。
  const related = model?.includeRelated ?? false;
  const selected = targets.filter(target => ids.includes(target.id));
  const [focusOnly, setFocusOnly] = useState(false);
  const dimmed = focusOnly && selected.length > 0;
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
  const located = useMemo(() => new Set(model?.targetIds ?? []), [model?.targetIds]);
  const wuxing = baziFacts?.wuxing ?? null;
  const drilled = baziFacts?.relations?.原局关系 ?? null;
  const detail = value.kind === 'bazi' ? value.chart.干支关系明细 ?? NO_ROWS : NO_ROWS;
  const board = useMemo(() => layoutRelations(baziBoardRows(detail, { relations: drilled, wuxing }, located), BAZI_COLUMNS), [detail, drilled, wuxing, located]);
  const counts = { relations: board.edges.filter(edge => edge.mode === 'relations').length, flow: board.edges.filter(edge => edge.mode === 'flow').length };
  // 打开时停在 Agent 最后看的模式；没看过时，没有合冲刑害的盘直接看流通，不让盘面空着。
  const [boardMode, setBoardMode] = useState<BoardMode>(() => baziViewing?.mode ?? (counts.relations || !counts.flow ? 'relations' : 'flow'));
  // 跟随模型时，Agent 每换一次查看（关系详查、五行详查、定位某条关系）盘面就切过去。
  const viewingKey = baziViewing?.key, viewingMode = baziViewing?.mode;
  useEffect(() => {
    if (viewingMode && (followModel || pinned)) setBoardMode(viewingMode);
  }, [viewingKey, viewingMode, followModel, pinned]);
  const [hiddenMarks, setHiddenMarks] = useState<ReadonlySet<string>>(new Set());
  const marks = boardMode === 'off' ? [] : [...new Set(board.edges.filter(edge => edge.mode === boardMode).map(edge => edge.mark))];
  // 点徽标 = 追问这条关系：Core 给了关系 id 的直接带上关系，五行详查的事实带上它连着的字。
  const askEdge = (edge: RelationEdge) => {
    const relation = targets.find(target => target.id === edge.id);
    ask(relation ? [relation] : targets.filter(target => target.kind === 'bazi_cell'
      && edge.cells.some(cell => cell.column === target.cell.柱 && cell.part === target.cell.部位)));
  };
  const baziOverlay: BaziRelationOverlay | undefined = value.kind === 'bazi'
    ? { layout: visibleRelationEdges(board, boardMode, hiddenMarks, located), located, onSelect: reference && onAsk ? askEdge : undefined }
    : undefined;
  const toggleMark = (mark: string) => setHiddenMarks(current => {
    const next = new Set(current);
    if (!next.delete(mark)) next.add(mark);
    return next;
  });
  const text = getAgentToolText(tool);
  const label = model ? (live && followModel ? '模型正在看' : '分析位置') : null;
  const caption = model?.caption ?? null;
  const hasFocus = Boolean(label);
  return <section className="agent-interactive-chart" aria-labelledby={titleId} data-focus-only={dimmed || undefined}>
    <header className="agent-board-heading">
      <h3 id={titleId} className="sr-only">{value.title}</h3>
      {subject && <p className="agent-board-subject">{subject}</p>}
      <div className="agent-board-tools">
        {model && <span className="agent-board-tool is-viewing" role="img" title={live && followModel ? '模型正在看这里' : '模型查看的位置'}
          aria-label={live && followModel ? '模型正在看这里' : '模型查看的位置'}><LocateFixed size={14} aria-hidden="true" /></span>}
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
      {selected.length > 0 && <ul className="agent-board-chips" aria-label="盘面位置">{selected.map(target => <li key={target.id}>{chipLabel(target)}</li>)}</ul>}
      {selected.length > 0 && <button type="button" className="agent-board-only" aria-pressed={focusOnly} onClick={() => setFocusOnly(!focusOnly)}>只看相关位置</button>}
    </div>
    <div ref={viewportRef} className="agent-chart-scroll" tabIndex={0} aria-label={value.title + '内容'}>
      <ChartErrorBoundary resetKey={value.chart} fallback={<pre className="agent-board-fallback">{text ?? '命盘数据暂时无法显示'}</pre>}>
        <CanonicalChartView value={value} targets={selected} includeRelated={related} onTargetSelect={onAsk ? askTarget : undefined} baziOverlay={baziOverlay} />
      </ChartErrorBoundary>
    </div>
    {value.kind === 'bazi' && <section className="agent-board-relations" aria-label="干支关系与流通" data-board-mode={boardMode}>
      <div className="agent-board-relation-bar">
        <div className="agent-board-segments" role="group" aria-label="盘面连线">
          {BOARD_MODES.map(([mode, name]) => <button key={mode} type="button" aria-pressed={boardMode === mode} data-viewed={baziViewing?.mode === mode || undefined} onClick={() => setBoardMode(mode)}>
            {name}{mode !== 'off' && <span>{counts[mode]}</span>}
          </button>)}
        </div>
        {baziViewing && <span className="agent-board-viewing" data-live={live && followModel || undefined}>
          <LocateFixed size={12} aria-hidden="true" />{live && followModel ? '模型正在看' : 'Agent 查看了'}{baziViewing.label}
        </span>}
        {marks.length > 1 && <div className="agent-board-marks" role="group" aria-label="按类型筛选">
          {marks.map(mark => <button key={mark} type="button" aria-pressed={!hiddenMarks.has(mark)} onClick={() => toggleMark(mark)}>{mark}</button>)}
        </div>}
      </div>
      {boardMode === 'flow' && <WuxingCycleStrip dayElement={wuxing?.日主.五行 ?? getGanZhiElement(value.chart.基本信息.日主.charAt(0)) ?? undefined}
        counts={wuxing ? wuxing.五行统计.map(item => ({ 五行: item.五行, 合计: item.合计, 出现: !wuxing.缺失五行.includes(item.五行) })) : glyphElementCounts(value.chart)}
        caption={wuxing ? `五行详查：天干地支各计 1，藏干按 0.6 / 0.3 / 0.1 加权 · 月令${wuxing.月令.月支} ${wuxing.月令.旺}旺，日主${wuxing.月令.日主状态}`
          : '按天干地支 8 字计数（藏干只计是否出现）；让 Agent 做五行详查后改为加权统计，并在盘上画出通根与自坐。'} />}
      {!value.chart.干支关系明细 && <p>{value.chart.干支关系.join('；') || '此盘未返回干支关系。'} 此历史盘仅保留关系文本，可选择天干或地支查看。</p>}
    </section>}
  </section>;
}
