'use client';

import { lazy, Suspense, Component, type ReactNode, useMemo } from 'react';
import type { ChartData, ChartType } from '@/lib/visualization/chart-types';
import { normalizeChartData } from '@/lib/visualization/chart-data-extract';

const chartComponents: Record<ChartType, ReturnType<typeof lazy>> = {
  life_fortune_trend: lazy(() => import('./charts/LifeFortuneTrend')),
  fortune_radar: lazy(() => import('./charts/FortuneRadar')),
  fortune_calendar: lazy(() => import('./charts/FortuneCalendar')),
  wuxing_energy: lazy(() => import('./charts/WuxingEnergyChart')),
  life_timeline: lazy(() => import('./charts/LifeTimeline')),
  compatibility_gauge: lazy(() => import('./charts/CompatibilityGauge')),
  divination_verdict: lazy(() => import('./charts/DivinationVerdict')),
  mbti_spectrum: lazy(() => import('./charts/MBTISpectrum')),
  tarot_elements: lazy(() => import('./charts/TarotElements')),
  personality_petal: lazy(() => import('./charts/PersonalityPetal')),
  yearly_sparklines: lazy(() => import('./charts/YearlySparklines')),
  physiognomy_annotation: lazy(() => import('./charts/PhysiognomyAnnotation')),
  fortune_comparison: lazy(() => import('./charts/FortuneComparison')),
  cross_system: lazy(() => import('./charts/CrossSystemCard')),
  dream_association: lazy(() => import('./charts/DreamAssociation')),
};

interface ChartRendererProps {
  data: ChartData;
  compact?: boolean;
  className?: string;
  onRenderError?: (error: Error) => void;
}

function ChartSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      {/* Score circle */}
      <div className="w-10 h-10 rounded-full bg-[var(--color-accent)]/20 animate-pulse" />
      {/* Text lines */}
      <div className="flex flex-col items-center gap-2 w-full px-8">
        <div className="h-2.5 w-3/5 rounded-full bg-[var(--color-accent)]/15 animate-pulse" />
        <div className="h-2.5 w-2/5 rounded-full bg-[var(--color-accent)]/10 animate-pulse" style={{ animationDelay: '150ms' }} />
      </div>
      {/* Chart area */}
      <div className="h-20 w-4/5 rounded-lg bg-[var(--color-accent)]/10 animate-pulse" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

interface ErrorBoundaryState {
  error: Error | null;
}

export function shouldResetChartError(prevResetKey: unknown, nextResetKey: unknown): boolean {
  return prevResetKey !== nextResetKey;
}

export class ChartErrorBoundary extends Component<{ children: ReactNode; resetKey: unknown; fallback?: ReactNode; onError?: (error: Error) => void }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: Readonly<{ children: ReactNode; resetKey: unknown }>) {
    if (this.state.error && shouldResetChartError(prevProps.resetKey, this.props.resetKey)) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div className="rounded-xl border border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-foreground-secondary)]">
          <p>图表渲染出错</p>
          <p className="mt-1 text-xs opacity-60">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ChartRenderer({ data, compact = false, className = '', onRenderError }: ChartRendererProps) {
  const normalizedData = useMemo(() => normalizeChartData(data), [data]);
  const ChartComponent = chartComponents[normalizedData.chartType as ChartType];

  if (!ChartComponent) {
    return (
      <div className={`rounded-xl border border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-foreground-secondary)] ${className}`}>
        暂不支持的图表类型：{normalizedData.chartType}
      </div>
    );
  }

  return (
    <ChartErrorBoundary resetKey={normalizedData} onError={onRenderError} fallback={onRenderError ? null : undefined}>
      <Suspense fallback={<ChartSkeleton />}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ChartComponent data={normalizedData as any} compact={compact} className={className} />
      </Suspense>
    </ChartErrorBoundary>
  );
}
