'use client';
// 需要盘面选择状态、跟随定位滚动与全屏弹窗

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LocateFixed, MessageCircleQuestion } from 'lucide-react';
import type { AgentChart, AgentToolPart } from '@/lib/agent/tool-presentation';
import { getAgentToolText } from '@/lib/agent/tool-presentation';
import { getChartTargets, type ChartAskContext, type ChartFocus, type ChartTarget } from '@/lib/agent/chart-interaction';
import { ChartErrorBoundary } from '@/components/visualization/ChartRenderer';
import { CanonicalChartView } from './CanonicalChartView';
import { CopyButton } from './AgentToolCard';
import './agent-results.css';

/** A relation chip names what it links, as 关系 · 月柱丁克日柱庚; cells keep their label, as 月柱天干 丁. */
const chipLabel = (target: ChartTarget) => target.kind === 'bazi_relation' ? `关系 · ${target.label}` : target.label;

/**
 * 命盘 (Main board): the subject line and compact tools, the position being
 * looked at with its actions, the interactive chart and bazi relations. The
 * title lives on the workspace tab, so the board itself does not repeat it.
 */
export function AgentInteractiveChart({ value, tool, reference, focus, followModel, live = false, pinned = false, subject, onAsk }: {
  value: AgentChart; tool: AgentToolPart; reference: string | null; focus?: ChartFocus | null; followModel: boolean;
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
  const relations = targets.filter(target => target.kind === 'bazi_relation');
  const located = new Set(model?.targetIds ?? []);
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
        <CanonicalChartView value={value} targets={selected} includeRelated={related} onTargetSelect={onAsk ? askTarget : undefined} />
      </ChartErrorBoundary>
    </div>
    {value.kind === 'bazi' && <section className="agent-board-relations" aria-labelledby={`${titleId}-relations`}>
      <h4 id={`${titleId}-relations`}>干支关系 <span>{relations.length || value.chart.干支关系.length}</span></h4>
      {relations.length ? <ul>{relations.map(target => <li key={target.id}>
        <button type="button" data-chart-target={target.id} aria-pressed={ids.includes(target.id)} data-located={located.has(target.id) || undefined} onClick={() => ask([target])}>
          <span className="agent-board-relation-type">{target.relation.类型}</span>
          <span className="agent-board-relation-text">{target.label}</span>
          {located.has(target.id) && <span className="agent-board-located">模型定位</span>}
        </button>
      </li>)}</ul>
        : <p>{value.chart.干支关系.join('；') || '此盘未返回干支关系。'}</p>}
      {!value.chart.干支关系明细 && <p>此历史盘仅保留关系文本，可选择天干或地支查看。</p>}
    </section>}
  </section>;
}
