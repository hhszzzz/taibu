'use client';

// WuxingEnergyChart — Five Elements (五行) energy distribution visualization
// Custom SVG donut chart with strength bars and interaction cards

import { memo, useMemo } from 'react';
import type { WuxingEnergyData } from '@/lib/visualization/chart-types';
import { WUXING_COLORS, type WuxingElement } from '@/lib/visualization/chart-theme';
import { ScoreBar } from '@/components/visualization/shared/ScoreBar';
import { useChartEntrance, CHART_ENTRANCE_BASE, CHART_ENTRANCE_ACTIVE } from '@/components/visualization/shared/useChartEntrance';
import ChartEmpty from '@/components/visualization/shared/ChartEmpty';

// ─── Constants ───────────────────────────────────────────

const ELEMENT_ORDER: WuxingElement[] = ['wood', 'fire', 'earth', 'metal', 'water'];

const ELEMENT_CN: Record<WuxingElement, string> = {
  wood: '木', fire: '火', earth: '土', metal: '金', water: '水',
};

const ELEMENT_EMOJI: Record<WuxingElement, string> = {
  wood: '🌲', fire: '🔥', earth: '🌍', metal: '🪙', water: '💧',
};

const CX = 150;
const CY = 150;
const INNER_R = 80;
const OUTER_R = 120;
const LABEL_R = 140;
const GAP_DEG = 3;

// ─── SVG Arc helpers ─────────────────────────────────────

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startDeg: number,
  endDeg: number,
): string {
  const sweep = endDeg - startDeg;
  if (sweep <= 0) return '';
  const largeArc = sweep > 180 ? 1 : 0;

  const outerStart = polarToCartesian(cx, cy, outerR, startDeg);
  const outerEnd = polarToCartesian(cx, cy, outerR, endDeg);
  const innerEnd = polarToCartesian(cx, cy, innerR, endDeg);
  const innerStart = polarToCartesian(cx, cy, innerR, startDeg);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

// ─── Sheng/Ke cycle lookup ───────────────────────────────

const SHENG_PAIRS: [WuxingElement, WuxingElement][] = [
  ['wood', 'fire'],
  ['fire', 'earth'],
  ['earth', 'metal'],
  ['metal', 'water'],
  ['water', 'wood'],
];

// ─── Sub-components ──────────────────────────────────────

interface DonutProps {
  elements: WuxingEnergyData['data']['elements'];
  favorableElement: WuxingElement;
  interactions: WuxingEnergyData['data']['interactions'];
}

function DonutChart({ elements, favorableElement, interactions }: DonutProps) {
  const segments = useMemo(() => {
    const total = ELEMENT_ORDER.reduce((s, k) => s + elements[k].strength, 0) || 1;
    const usable = 360 - GAP_DEG * ELEMENT_ORDER.length;

    const result: Array<{ key: WuxingElement; startDeg: number; endDeg: number; midDeg: number; pct: number }> = [];
    let cursor = 0;
    for (const key of ELEMENT_ORDER) {
      const pct = elements[key].strength / total;
      const sweep = Math.max(pct * usable, 4);
      const startDeg = cursor + GAP_DEG;
      const endDeg = startDeg + sweep;
      const midDeg = startDeg + sweep / 2;
      cursor = endDeg;
      result.push({ key, startDeg, endDeg, midDeg, pct });
    }
    return result;
  }, [elements]);

  // Build a lookup from element key to midpoint angle for ke lines
  const midAngles = useMemo(() => {
    const map: Record<string, number> = {};
    segments.forEach((s) => { map[s.key] = s.midDeg; });
    return map;
  }, [segments]);

  const keInteractions = useMemo(
    () => interactions.filter((i) => i.type === '克'),
    [interactions],
  );

  return (
    <svg viewBox="0 0 300 300" className="w-full max-w-[280px] mx-auto" aria-label="五行能量环形图">
      <defs>
        {/* Golden glow filter for favorable element */}
        <filter id="wuxing-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
          <feFlood floodColor="#D4AF37" floodOpacity="0.6" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Donut arcs */}
      {segments.map((seg) => {
        const isFavorable = seg.key === favorableElement;
        return (
          <path
            key={seg.key}
            d={describeArc(CX, CY, INNER_R, OUTER_R, seg.startDeg, seg.endDeg)}
            fill={WUXING_COLORS[seg.key]}
            stroke={isFavorable ? '#D4AF37' : 'none'}
            strokeWidth={isFavorable ? 2.5 : 0}
            filter={isFavorable ? 'url(#wuxing-glow)' : undefined}
            opacity={0.9}
          />
        );
      })}

      {/* 相生 flow arrows between adjacent segments */}
      {SHENG_PAIRS.map(([from, to]) => {
        const fromAngle = midAngles[from];
        const toAngle = midAngles[to];
        if (fromAngle === undefined || toAngle === undefined) return null;
        const p1 = polarToCartesian(CX, CY, OUTER_R + 6, fromAngle);
        const p2 = polarToCartesian(CX, CY, OUTER_R + 6, toAngle);
        return (
          <line
            key={`sheng-${from}-${to}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke="#22c55e"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.35}
          >
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to="-12"
              dur="2s"
              repeatCount="indefinite"
            />
          </line>
        );
      })}

      {/* 相克 dashed red lines across the donut */}
      {keInteractions.map((inter, idx) => {
        const fromA = inter.from ? midAngles[inter.from] : undefined;
        const toA = inter.to ? midAngles[inter.to] : undefined;
        if (fromA === undefined || toA === undefined) return null;
        const p1 = polarToCartesian(CX, CY, (INNER_R + OUTER_R) / 2, fromA);
        const p2 = polarToCartesian(CX, CY, (INNER_R + OUTER_R) / 2, toA);
        return (
          <line
            key={`ke-${idx}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke="#ef4444"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            opacity={0.6}
          />
        );
      })}

      {/* Element labels outside the ring */}
      {segments.map((seg) => {
        const pos = polarToCartesian(CX, CY, LABEL_R, seg.midDeg);
        return (
          <text
            key={`label-${seg.key}`}
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            dominantBaseline="central"
            className="text-[11px] font-medium"
            fill="var(--color-foreground)"
          >
            {ELEMENT_EMOJI[seg.key]}{ELEMENT_CN[seg.key]}
          </text>
        );
      })}

      {/* Center text: 喜用神 */}
      <text
        x={CX}
        y={CY - 8}
        textAnchor="middle"
        dominantBaseline="central"
        className="text-[10px]"
        fill="var(--color-foreground-secondary)"
      >
        喜用神
      </text>
      <text
        x={CX}
        y={CY + 12}
        textAnchor="middle"
        dominantBaseline="central"
        className="text-[16px] font-bold"
        fill="#D4AF37"
      >
        {ELEMENT_EMOJI[favorableElement]}{' '}
        {ELEMENT_CN[favorableElement]}
      </text>
    </svg>
  );
}

// ─── Main component ──────────────────────────────────────

interface WuxingEnergyChartProps {
  data: WuxingEnergyData;
  compact?: boolean;
}

function WuxingEnergyChartInner({ data, compact = false }: WuxingEnergyChartProps) {
  const { ref, entered } = useChartEntrance();
  const { elements, favorableElement, unfavorableElement, advice, interactions } = data.data;

  if (!elements) {
    return <ChartEmpty message="暂无五行能量数据" />;
  }

  return (
    <div ref={ref} className={`space-y-5 ${CHART_ENTRANCE_BASE} ${entered ? CHART_ENTRANCE_ACTIVE : ''}`}>
      {/* Donut */}
      <DonutChart
        elements={elements}
        favorableElement={favorableElement}
        interactions={interactions}
      />

      {/* Strength bars */}
      <div className="space-y-3">
        {ELEMENT_ORDER.map((key) => {
          const el = elements[key];
          const isFavorable = key === favorableElement;
          const isUnfavorable = key === unfavorableElement;
          return (
            <div
              key={key}
              className="flex items-center gap-2 flex-wrap sm:flex-nowrap"
              style={{
                borderLeft: isFavorable
                  ? '3px solid #D4AF37'
                  : isUnfavorable
                    ? '3px solid #ef4444'
                    : '3px solid transparent',
                paddingLeft: 8,
              }}
            >
              {/* Icon + name */}
              <span className="text-base w-12 shrink-0">
                {ELEMENT_EMOJI[key]}{ELEMENT_CN[key]}
              </span>

              {/* Bar */}
              <div className="flex-1">
                <ScoreBar value={el.strength} color={WUXING_COLORS[key]} height={10} showLabel={false} />
              </div>

              {/* Score */}
              <span className="text-xs tabular-nums w-8 text-right text-foreground-secondary">
                {el.strength}
              </span>

              {/* Level badge */}
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    el.level === '旺'
                      ? 'rgba(34,197,94,0.15)'
                      : el.level === '弱'
                        ? 'rgba(239,68,68,0.15)'
                        : 'rgba(234,179,8,0.15)',
                  color:
                    el.level === '旺'
                      ? '#22c55e'
                      : el.level === '弱'
                        ? '#ef4444'
                        : '#eab308',
                }}
              >
                {el.level}
              </span>

              {/* Stars */}
              {el.stars.length > 0 && (
                <div className="flex gap-1 shrink-0 flex-wrap">
                  {el.stars.map((star) => (
                    <span
                      key={star}
                      className="text-[10px] px-1 py-0.5 rounded bg-background-secondary text-foreground-secondary"
                    >
                      {star}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Interactions (skip in compact mode) */}
      {!compact && interactions.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground-secondary">五行生克</div>
          <div className="flex flex-wrap gap-2">
            {interactions.map((inter, idx) => {
              const isKe = inter.type === '克';
              return (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border"
                  style={{
                    borderColor: isKe ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)',
                    backgroundColor: isKe ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)',
                  }}
                >
                  <span style={{ color: inter.from ? WUXING_COLORS[inter.from] : undefined }}>
                    {inter.from ? (ELEMENT_CN[inter.from] ?? inter.from) : null}
                  </span>
                  <span
                    className="font-medium"
                    style={{ color: isKe ? '#ef4444' : '#22c55e' }}
                  >
                    {inter.type}
                  </span>
                  <span style={{ color: inter.to ? WUXING_COLORS[inter.to] : undefined }}>
                    {inter.to ? (ELEMENT_CN[inter.to] ?? inter.to) : null}
                  </span>
                  {inter.impact && (
                    <span className="text-foreground-secondary ml-1">
                      {(inter.from || inter.to || inter.type) ? '| ' : ''}{inter.impact}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Advice */}
      {!compact && advice && (
        <div className="text-xs text-foreground-secondary px-3 py-2.5 rounded-lg border border-border bg-background-secondary leading-relaxed">
          {advice}
        </div>
      )}
    </div>
  );
}

export const WuxingEnergyChart = memo(WuxingEnergyChartInner);
export default WuxingEnergyChart;
