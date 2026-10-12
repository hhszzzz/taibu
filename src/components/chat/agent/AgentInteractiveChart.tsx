'use client';
// 需要盘面选择状态、跟随定位滚动与全屏弹窗

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LocateFixed, Maximize2, RotateCcw, X } from 'lucide-react';
import type { AgentChart, AgentToolPart } from '@/lib/agent/tool-presentation';
import { getAgentToolText } from '@/lib/agent/tool-presentation';
import { chartQuestion, getChartTargets, type ChartFocus, type ChartTarget } from '@/lib/agent/chart-interaction';
import { ChartErrorBoundary } from '@/components/visualization/ChartRenderer';
import { Modal } from '@/components/ui/Modal';
import { CanonicalChartView } from './CanonicalChartView';
import { CopyButton } from './AgentToolCard';
import { describeAgentChartRules } from './presentation';
import './agent-results.css';

/** A relation chip names what it links, as 关系 · 月柱丁克日柱庚; cells keep their label, as 月柱天干 丁. */
const chipLabel = (target: ChartTarget) => target.kind === 'bazi_relation' ? `关系 · ${target.label}` : target.label;

/**
 * 命盘 (Main board): the reading's steps, title and subject, the position being
 * looked at with its actions, the interactive chart, bazi relations and the
 * rules Core calculated with. The model's focus shows while following or when
 * opened from its step; a manual selection pauses following.
 */
export function AgentInteractiveChart({ value, tool, reference, focus, followModel, live = false, pinned = false, kicker, subject, onManual, onAsk }: {
  value: AgentChart; tool: AgentToolPart; reference: string | null; focus?: ChartFocus | null; followModel: boolean;
  /** The model is still working, so the focus box says whether it is being followed. */
  live?: boolean;
  /** The focus was opened from its step or a citation: show and reveal it even while not following. */
  pinned?: boolean;
  /** 第 2 步计算 · 第 5 步定位 · 暂存成果 */
  kicker?: string;
  /** 男 · 公历 1990-01-15 09:00 · Asia/Shanghai · 日主 庚 */
  subject?: string;
  onManual: () => void; onAsk?: (text: string) => void;
}) {
  const titleId = useId();
  const dialogId = useId();
  const targets = useMemo(() => getChartTargets(value), [value]);
  const snapshot = useMemo(() => JSON.stringify(value.chart), [value.chart]);
  const [manual, setManual] = useState<{ snapshot: string; ids: string[]; related: boolean } | null>(null);
  const [focusOnly, setFocusOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const currentManual = manual?.snapshot === snapshot ? manual : null;
  const model = focus?.reference === reference ? focus : null;
  // A manual selection shows while not following; otherwise the model's latest focus does.
  const manualShown = !followModel && currentManual !== null;
  const showsModel = !manualShown && model !== null;
  const ids = manualShown ? currentManual.ids : model?.targetIds ?? [];
  const related = manualShown ? currentManual.related : model?.includeRelated ?? true;
  const selected = targets.filter(target => ids.includes(target.id));
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
  const select = (id: string) => { onManual(); setManual({ snapshot, ids: [id], related }); };
  const relations = targets.filter(target => target.kind === 'bazi_relation');
  const located = new Set(model?.targetIds ?? []);
  const text = getAgentToolText(tool);
  const rules = describeAgentChartRules(value);
  const label = showsModel ? live && followModel ? '模型正在看' : '分析位置' : selected.length ? '正在查看' : '命盘全览';
  const caption = showsModel ? model.caption : selected.length ? selected.map(target => target.label).join('、') : '点选盘面中的位置，可以就那里继续追问。';
  return <section className="agent-interactive-chart" aria-labelledby={titleId} data-focus-only={dimmed || undefined}>
    <header className="agent-board-heading">
      <div>
        {kicker && <p className="agent-board-kicker">{kicker}</p>}
        <h3 id={titleId}>{value.title}</h3>
        {subject && <p>{subject}</p>}
      </div>
      <div className="agent-board-tools">
        {manualShown && selected.length > 0 && <button type="button" className="agent-board-tool" aria-label="清除盘面高亮" title="清除盘面高亮"
          onClick={() => { onManual(); setManual({ snapshot, ids: [], related }); }}><RotateCcw size={16} aria-hidden="true" /></button>}
        <button type="button" className="agent-board-tool" aria-label="全屏查看命盘" title="全屏查看命盘" aria-haspopup="dialog" onClick={() => setExpanded(true)}><Maximize2 size={16} aria-hidden="true" /></button>
        {text && <CopyButton text={text} label="复制规范文本" iconOnly className="agent-board-tool" />}
      </div>
    </header>
    <div className="agent-board-focus" aria-live="polite" data-chart-focus={selected.map(target => target.id).join(',')} data-source={showsModel ? 'model' : manualShown ? 'manual' : undefined}>
      <div className="agent-board-focus-label">
        <LocateFixed size={15} aria-hidden="true" /><span>{label}</span>
        {live && <span className="agent-board-follow-state">{followModel ? '跟随中' : '已暂停跟随'}</span>}
      </div>
      <p className="agent-board-caption">{caption}</p>
      {selected.length > 0 && <ul className="agent-board-chips" aria-label="盘面位置">{selected.map(target => <li key={target.id}>{chipLabel(target)}</li>)}</ul>}
      {(reference && onAsk || selected.length > 0) && <div className="agent-board-focus-actions">
        {reference && onAsk && <button type="button" className="agent-board-ask" title="填入输入框，发送前可以修改"
          onClick={() => onAsk(chartQuestion(reference, selected))}>{selected.length ? '追问这里' : '追问这张命盘'}</button>}
        {selected.length > 0 && <button type="button" className="agent-board-only" aria-pressed={focusOnly} onClick={() => setFocusOnly(!focusOnly)}>只看相关位置</button>}
      </div>}
    </div>
    {['ziwei', 'daliuren', 'astrology'].includes(value.kind) && <label className="agent-board-related"><input type="checkbox" checked={related} onChange={event => {
      onManual(); setManual({ snapshot, ids, related: event.target.checked });
    }} />{value.kind === 'ziwei' ? '三方四正' : '关联位置'}</label>}
    <div ref={viewportRef} className="agent-chart-scroll" tabIndex={0} aria-label={value.title + '内容'}>
      <ChartErrorBoundary resetKey={value.chart} fallback={<pre className="agent-board-fallback">{text ?? '命盘数据暂时无法显示'}</pre>}>
        <CanonicalChartView value={value} targets={selected} includeRelated={related} onTargetSelect={select} />
      </ChartErrorBoundary>
    </div>
    {value.kind === 'bazi' && <section className="agent-board-relations" aria-labelledby={`${titleId}-relations`}>
      <h4 id={`${titleId}-relations`}>干支关系 <span>{relations.length || value.chart.干支关系.length}</span></h4>
      {relations.length ? <ul>{relations.map(target => <li key={target.id}>
        <button type="button" data-chart-target={target.id} aria-pressed={ids.includes(target.id)} data-located={located.has(target.id) || undefined} onClick={() => select(target.id)}>
          <span className="agent-board-relation-type">{target.relation.类型}</span>
          <span className="agent-board-relation-text">{target.label}</span>
          {located.has(target.id) && <span className="agent-board-located">模型定位</span>}
        </button>
      </li>)}</ul>
        : <p>{value.chart.干支关系.join('；') || '此盘未返回干支关系。'}</p>}
      {!value.chart.干支关系明细 && <p>此历史盘仅保留关系文本，可选择天干或地支查看。</p>}
    </section>}
    {rules && <p className="agent-board-rules">{rules}</p>}
    <Modal open={expanded} onClose={() => setExpanded(false)} labelledBy={dialogId} className="agent-chart-dialog">
      <header className="agent-chart-dialog-header">
        <div><h2 id={dialogId}>{value.title}</h2>{subject && <p className="agent-result-summary">{subject}</p>}</div>
        <button type="button" className="agent-icon-button" aria-label="关闭命盘" onClick={() => setExpanded(false)}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className="agent-chart-dialog-body"><div className="agent-chart-scroll" tabIndex={0} aria-label={`${value.title}内容`}>
        <ChartErrorBoundary resetKey={value.chart} fallback={<pre className="agent-board-fallback">{text ?? '命盘数据暂时无法显示'}</pre>}>
          <CanonicalChartView value={value} targets={selected} includeRelated={related} />
        </ChartErrorBoundary>
      </div></div>
    </Modal>
  </section>;
}
