'use client';

// LifeTimeline — Vertical timeline showing life milestones and turning points
// Pure CSS layout (flexbox + pseudo-elements), responsive mobile-first

import { memo, useMemo, useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { useChartEntrance, CHART_ENTRANCE_BASE, CHART_ENTRANCE_ACTIVE } from '@/components/visualization/shared/useChartEntrance';
import ChartEmpty from '@/components/visualization/shared/ChartEmpty';
import type { LifeTimelineData, LifeTimelineMilestone } from '@/lib/visualization/chart-types';

// ─── Constants ───────────────────────────────────────────

const TYPE_COLORS: Record<LifeTimelineMilestone['type'], string> = {
  positive: '#22c55e',
  negative: '#ef4444',
  neutral: '#9ca3af',
  turning: '#f59e0b',
  peak: '#3b82f6',
};

const TYPE_LABELS: Record<LifeTimelineMilestone['type'], string> = {
  positive: '吉',
  negative: '凶',
  neutral: '平',
  turning: '转',
  peak: '旺',
};

// ─── Sub-components ──────────────────────────────────────

interface NodeCircleProps {
  milestone: LifeTimelineMilestone;
  isCurrent: boolean;
  isFuture: boolean;
}

function NodeCircle({ milestone, isCurrent, isFuture }: NodeCircleProps) {
  const color = TYPE_COLORS[milestone.type];
  const size = isCurrent ? 48 : 40;

  return (
    <div
      className="relative flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      {/* Pulse ring for current milestone */}
      {isCurrent && (
        <div
          className="absolute inset-0 rounded-full animate-ping"
          style={{
            backgroundColor: '#D4AF37',
            opacity: 0.2,
            animationDuration: '2s',
          }}
        />
      )}

      {/* Main circle */}
      <div
        className="relative flex items-center justify-center rounded-full text-base z-10 transition-all"
        style={{
          width: size,
          height: size,
          backgroundColor: isFuture ? 'transparent' : color,
          border: isCurrent
            ? '3px solid #D4AF37'
            : isFuture
              ? `2px dashed ${color}`
              : '2px solid transparent',
          opacity: isFuture ? 0.7 : 1,
        }}
      >
        <span>{milestone.icon}</span>
      </div>

      {/* "当前" badge */}
      {isCurrent && (
        <span
          className="absolute -top-2 -right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full z-20"
          style={{ backgroundColor: '#D4AF37', color: '#000' }}
        >
          当前
        </span>
      )}
    </div>
  );
}

interface MilestoneCardProps {
  milestone: LifeTimelineMilestone;
  isFuture: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function MilestoneCard({ milestone, isFuture, isExpanded, onToggle }: MilestoneCardProps) {
  const color = TYPE_COLORS[milestone.type];
  const hasDetail = milestone.detail !== null && milestone.detail !== '';

  return (
    <Button unstyled
      type="button"
      className="text-left w-full rounded-xl border px-3 py-2.5 transition-all"
      style={{
        borderColor: isFuture ? 'var(--color-border)' : color + '33',
        borderStyle: isFuture ? 'dashed' : 'solid',
        backgroundColor: 'var(--color-background)',
        opacity: isFuture ? 0.6 : 1,
        cursor: hasDetail ? 'pointer' : 'default',
        boxShadow: isExpanded ? 'var(--shadow-md)' : 'var(--shadow-sm)',
      }}
      onClick={hasDetail ? onToggle : undefined}
      aria-expanded={isExpanded}
    >
      {/* Top: age + year + type badge */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-bold tabular-nums" style={{ color }}>
          {milestone.age}岁
        </span>
        <span className="text-[10px] text-foreground-secondary tabular-nums">
          {milestone.year}年
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full ml-auto font-medium"
          style={{ backgroundColor: color + '20', color }}
        >
          {TYPE_LABELS[milestone.type]}
        </span>
      </div>

      {/* Title */}
      <div className="text-sm font-medium text-foreground leading-tight">
        {milestone.label}
      </div>

      {/* Summary */}
      <div className="text-xs text-foreground-secondary mt-1 leading-relaxed">
        {milestone.summary}
      </div>

      {/* Expandable detail */}
      {hasDetail && (
        <div
          className="overflow-hidden transition-all duration-300"
          style={{
            maxHeight: isExpanded ? 200 : 0,
            opacity: isExpanded ? 1 : 0,
            marginTop: isExpanded ? 8 : 0,
          }}
        >
          <div className="text-xs text-foreground-secondary border-t border-border pt-2 leading-relaxed">
            {milestone.detail}
          </div>
        </div>
      )}

      {/* Expand hint */}
      {hasDetail && !isExpanded && (
        <div className="text-[10px] text-foreground-secondary mt-1.5 opacity-60">
          点击展开详情
        </div>
      )}
    </Button>
  );
}

// ─── Compact sub-component ───────────────────────────────

function CompactTimeline({ milestones, currentAge }: { milestones: LifeTimelineMilestone[]; currentAge: number }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
      {milestones.map((ms, idx) => {
        const isFuture = ms.age > currentAge;
        const isCurrent = ms.age === currentAge || (
          idx < milestones.length - 1
            ? ms.age <= currentAge && milestones[idx + 1].age > currentAge
            : ms.age <= currentAge
        );
        const color = TYPE_COLORS[ms.type];
        return (
          <div
            key={idx}
            className="flex flex-col items-center gap-1 shrink-0"
            style={{ opacity: isFuture ? 0.5 : 1, minWidth: 72 }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
              style={{
                backgroundColor: isFuture ? 'transparent' : color,
                border: isCurrent
                  ? '2px solid #D4AF37'
                  : isFuture
                    ? `1.5px dashed ${color}`
                    : '1.5px solid transparent',
              }}
            >
              {ms.icon}
            </div>
            <span className="text-[10px] font-medium text-foreground leading-tight text-center">
              {ms.label}
            </span>
            <span className="text-[10px] text-foreground-secondary tabular-nums">
              {ms.age}岁
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────

interface LifeTimelineProps {
  data: LifeTimelineData;
  compact?: boolean;
}

function LifeTimelineInner({ data, compact = false }: LifeTimelineProps) {
  const { ref, entered } = useChartEntrance();
  const { currentAge, milestones: rawMilestones } = data.data;
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Sort milestones by age
  const milestones = useMemo(
    () => [...rawMilestones].sort((a, b) => a.age - b.age),
    [rawMilestones],
  );

  const toggle = useCallback(
    (idx: number) => setExpandedIdx((prev) => (prev === idx ? null : idx)),
    [],
  );

  if (milestones.length === 0) {
    return <ChartEmpty message="暂无人生节点数据" />;
  }

  // Compact mode — horizontal scroll
  if (compact) {
    return <div ref={ref} className={`${CHART_ENTRANCE_BASE} ${entered ? CHART_ENTRANCE_ACTIVE : ''}`}><CompactTimeline milestones={milestones} currentAge={currentAge} /></div>;
  }

  // Find current index (milestone closest to currentAge, or the first future one minus 1)
  const currentIdx = milestones.findIndex((ms) => ms.age >= currentAge);
  const resolvedCurrentIdx =
    currentIdx === -1
      ? milestones.length - 1
      : milestones[currentIdx].age === currentAge
        ? currentIdx
        : Math.max(0, currentIdx - 1);

  return (
    <div ref={ref} className={`relative ${CHART_ENTRANCE_BASE} ${entered ? CHART_ENTRANCE_ACTIVE : ''}`}>
      {milestones.map((ms, idx) => {
        const isFuture = ms.age > currentAge;
        const isCurrent = idx === resolvedCurrentIdx;
        const isLast = idx === milestones.length - 1;

        // On desktop (sm+), alternate left/right; on mobile, all right
        const isLeft = idx % 2 === 0;

        return (
          <div
            key={idx}
            className="relative flex items-start gap-3 sm:gap-4"
          >
            {/* Left card area (desktop only, odd items) */}
            <div className="hidden sm:flex flex-1 justify-end">
              {isLeft && (
                <div className="max-w-[280px] w-full">
                  <MilestoneCard
                    milestone={ms}
                    isFuture={isFuture}
                    isExpanded={expandedIdx === idx}
                    onToggle={() => toggle(idx)}
                  />
                </div>
              )}
            </div>

            {/* Center: node + vertical line */}
            <div className="relative flex flex-col items-center shrink-0">
              <NodeCircle milestone={ms} isCurrent={isCurrent} isFuture={isFuture} />
              {/* Vertical line segment to next node */}
              {!isLast && (
                <div
                  className="w-0.5 flex-1 min-h-[24px]"
                  style={{
                    background: isFuture
                      ? `repeating-linear-gradient(to bottom, var(--color-border) 0 4px, transparent 4px 8px)`
                      : `linear-gradient(${TYPE_COLORS[ms.type]}, ${TYPE_COLORS[milestones[idx + 1].type]})`,
                    opacity: isFuture ? 0.5 : 0.6,
                  }}
                />
              )}
            </div>

            {/* Right card area */}
            <div className="flex-1 pb-6 sm:pb-8">
              {/* On mobile: always show card. On desktop: only show for right-side items */}
              <div className="sm:hidden max-w-[280px]">
                <MilestoneCard
                  milestone={ms}
                  isFuture={isFuture}
                  isExpanded={expandedIdx === idx}
                  onToggle={() => toggle(idx)}
                />
              </div>
              <div className="hidden sm:block">
                {!isLeft && (
                  <div className="max-w-[280px]">
                    <MilestoneCard
                      milestone={ms}
                      isFuture={isFuture}
                      isExpanded={expandedIdx === idx}
                      onToggle={() => toggle(idx)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const LifeTimeline = memo(LifeTimelineInner);
export default LifeTimeline;
