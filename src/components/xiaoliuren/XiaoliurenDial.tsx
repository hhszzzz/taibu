'use client';
// 'use client'：useSvgIds 依赖 useId 生成实例唯一的 SVG id。

import { XIAOLIUREN_PALACES, type XiaoliurenPalace, type XiaoliurenStageKey } from '@/components/xiaoliuren/xiaoliuren-count';
import {
  PalaceMarker,
  StageBadge,
  StartBadge,
  SvgDefs,
  buildStageBadges,
  markerState,
  useSvgIds,
  type XiaoliurenStagePalaces,
} from '@/components/xiaoliuren/XiaoliurenPalm';

/**
 * 圆盘视图：六宫按掐数顺序顺时针排成一圈（大安居上），
 * 与掌诀共用宫位标记、落宫徽标与路线箭头的样式，结果来自同一组月/日/时落宫。
 */

const SIZE = 400;
const CENTER = SIZE / 2;
const RADIUS = 124;
const BADGE_RADIUS = RADIUS + 48;
const ARC_GAP_DEG = 15;

function polar(radius: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) };
}

/** 大安在正上方（-90°），每宫顺时针间隔 60°。 */
const PALACE_ANGLE = Object.fromEntries(
  XIAOLIUREN_PALACES.map((palace, index) => [palace, -90 + index * 60]),
) as Record<XiaoliurenPalace, number>;

const ROUTE_ARCS = XIAOLIUREN_PALACES.map((palace) => {
  const from = polar(RADIUS, PALACE_ANGLE[palace] + ARC_GAP_DEG);
  const to = polar(RADIUS, PALACE_ANGLE[palace] + 60 - ARC_GAP_DEG);
  return { key: palace, d: `M${from.x.toFixed(1)} ${from.y.toFixed(1)}A${RADIUS} ${RADIUS} 0 0 1 ${to.x.toFixed(1)} ${to.y.toFixed(1)}` };
});

export interface XiaoliurenDialProps {
  monthStatus?: XiaoliurenPalace;
  dayStatus?: XiaoliurenPalace;
  hourStatus?: XiaoliurenPalace;
  highlightedStages?: readonly XiaoliurenStageKey[];
  ariaLabel?: string;
}

export function XiaoliurenDial({ monthStatus, dayStatus, hourStatus, highlightedStages = [], ariaLabel = '小六壬圆盘：六宫顺时针排列' }: XiaoliurenDialProps) {
  const ids = useSvgIds('xld');
  const stages: XiaoliurenStagePalaces = { month: monthStatus, day: dayStatus, hour: hourStatus };
  const highlighted = new Set(highlightedStages.flatMap((key) => (stages[key] ? [stages[key]] : [])));
  const start = polar(RADIUS, PALACE_ANGLE.大安);

  return (
    <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${SIZE} ${SIZE}`} className="block h-auto w-full max-w-[400px]">
      <SvgDefs ids={ids} />
      <circle cx={CENTER} cy={CENTER} r={RADIUS + 34} style={{ fill: 'color-mix(in srgb, var(--panel) 60%, var(--wx-earth-soft))' }} stroke="var(--border-hover)" strokeWidth="1" />
      <circle cx={CENTER} cy={CENTER} r={RADIUS - 34} fill="var(--surface)" stroke="var(--border)" strokeWidth="0.75" />
      {ROUTE_ARCS.map((arc) => (
        <path key={arc.key} d={arc.d} fill="none" stroke="var(--clay)" strokeWidth="1.25" strokeDasharray="3 3" markerEnd={`url(#${ids.arrow})`} />
      ))}
      {hourStatus ? (
        <g>
          <text x={CENTER} y={CENTER - 18} textAnchor="middle" fontSize="11" fill="var(--foreground-secondary)">最终落宫</text>
          <text x={CENTER} y={CENTER + 14} textAnchor="middle" fontSize="30" className="font-display" fill="var(--accent-strong)">{hourStatus}</text>
          <text x={CENTER} y={CENTER + 36} textAnchor="middle" fontSize="11" letterSpacing="2" fill="var(--foreground-tertiary)">顺时针掐数</text>
        </g>
      ) : (
        <text x={CENTER} y={CENTER + 4} textAnchor="middle" fontSize="12" letterSpacing="2" fill="var(--foreground-tertiary)">顺时针掐数</text>
      )}
      {XIAOLIUREN_PALACES.map((palace) => {
        const point = polar(RADIUS, PALACE_ANGLE[palace]);
        return (
          <PalaceMarker key={palace} palace={palace} x={point.x} y={point.y} state={markerState(palace, stages)} highlighted={highlighted.has(palace)} glowId={ids.glow} />
        );
      })}
      <StartBadge x={start.x - 21} y={start.y - 19} />
      {buildStageBadges(stages).map(({ palace, text, width }) => {
        const anchor = polar(BADGE_RADIUS, PALACE_ANGLE[palace]);
        const x = Math.min(Math.max(anchor.x, width / 2 + 4), SIZE - width / 2 - 4);
        return <StageBadge key={palace} x={x} y={anchor.y} text={text} width={width} />;
      })}
    </svg>
  );
}
