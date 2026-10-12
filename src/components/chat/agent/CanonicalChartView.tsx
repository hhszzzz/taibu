'use client';
import { lazy, Suspense } from 'react';
import type { AgentChart } from '@/lib/agent/tool-presentation';
import { getChartTargets, type ChartTarget } from '@/lib/agent/chart-interaction';

const Bazi = lazy(() => import('@/components/bazi/result/ProfessionalTable').then(module => ({ default: module.ProfessionalTable })));
const Ziwei = lazy(() => import('@/components/ziwei/ZiweiChartGrid').then(module => ({ default: module.ZiweiChartGrid })));
const Qimen = lazy(() => import('@/components/qimen/QimenGrid').then(module => ({ default: module.QimenGrid })));
const Liuyao = lazy(() => import('@/components/liuyao/CanonicalLiuyaoChart').then(module => ({ default: module.CanonicalLiuyaoChart })));
const Meihua = lazy(() => import('@/components/meihua/MeihuaChart').then(module => ({ default: module.MeihuaChart })));
const Daliuren = lazy(() => import('@/components/daliuren/DaliurenChart').then(module => ({ default: module.DaliurenChart })));
const Xiaoliuren = lazy(() => import('@/components/xiaoliuren/XiaoliurenChart').then(module => ({ default: module.XiaoliurenChart })));
const Tarot = lazy(() => import('@/components/tarot/TarotChart').then(module => ({ default: module.TarotChart })));
const Taiyi = lazy(() => import('@/components/visualization/TaiyiChart').then(module => ({ default: module.TaiyiChart })));
const Astrology = lazy(() => import('@/components/visualization/AstrologyChart').then(module => ({ default: module.AstrologyChart })));
const Almanac = lazy(() => import('@/components/visualization/AlmanacChart').then(module => ({ default: module.AlmanacChart })));

export function CanonicalChartView({ value, targets = [], includeRelated = true, onTargetSelect }: { value: AgentChart; text?: string; targets?: ChartTarget[]; includeRelated?: boolean; onTargetSelect?: (id: string) => void }) {
  let content;
  const interaction = onTargetSelect ? { selectedIds: targets.map(target => target.id), onSelect: onTargetSelect } : undefined;
  switch (value.kind) {
    case 'bazi': content = <Bazi canonicalChart={value.chart} isUnknownTime={value.chart.四柱[3]?.干支.includes('*')} canonicalLabels
      highlightedCells={targets.flatMap(target => target.kind === 'bazi_cell' ? [target.cell] : target.kind === 'bazi_relation' ? target.relation.位置 : [])}
      onCellSelect={onTargetSelect ? cell => {
        const target = getChartTargets(value).find(target => target.kind === 'bazi_cell' && target.cell.柱 === cell.柱 && target.cell.部位 === cell.部位 && target.cell.字 === cell.字);
        if (target) onTargetSelect(target.id);
      } : undefined} />; break;
    case 'ziwei': content = <Ziwei canonicalChart={value.chart} interaction={onTargetSelect ? {
      palaceIndices: [...new Set(targets.flatMap(target => 'palaceIndex' in target ? [target.palaceIndex] : []))],
      stars: targets.filter((target): target is Extract<ChartTarget, { kind: 'ziwei_star' }> => target.kind === 'ziwei_star'),
      includeRelated,
      onPalaceSelect: index => onTargetSelect('ziwei:palace:' + index),
      onStarSelect: (index, group, starIndex) => onTargetSelect('ziwei:star:' + index + ':' + ['主星及四化', '辅星', '杂曜'].indexOf(group) + ':' + starIndex),
    } : undefined} />; break;
    case 'qimen': content = <Qimen palaces={value.chart.九宫盘} monthPhaseMap={value.chart.十干月令旺衰} ju={value.chart.基本信息.局式} interaction={interaction} />; break;
    case 'liuyao': content = <Liuyao chart={value.chart} interaction={interaction} />; break;
    case 'meihua': content = <Meihua chart={value.chart} interaction={interaction} />; break;
    case 'daliuren': content = <Daliuren chart={value.chart} interaction={interaction} includeRelated={includeRelated} />; break;
    case 'xiaoliuren': content = <Xiaoliuren chart={value.chart} interaction={interaction} />; break;
    case 'tarot': content = <Tarot chart={value.chart} interaction={interaction} />; break;
    case 'taiyi': content = <Taiyi chart={value.chart} interaction={interaction} />; break;
    case 'astrology': content = <Astrology chart={value.chart} interaction={interaction} includeRelated={includeRelated} />; break;
    case 'almanac': content = <Almanac chart={value.chart} interaction={interaction} />; break;
  }
  return <Suspense fallback={<p className="p-4 text-sm text-foreground-secondary" role="status">加载命盘视图…</p>}><div className={`agent-canonical-chart agent-canonical-chart--${value.kind}`} data-chart-kind={value.kind}>{content}</div></Suspense>;
}
