'use client';
// 'use client'：useId 为每个实例生成独立的 SVG marker/filter id（同页可能并存多张掌诀）。

import { useId } from 'react';
import {
  XIAOLIUREN_PALACES,
  XIAOLIUREN_PALACE_NATURE,
  type XiaoliurenPalace,
  type XiaoliurenStageKey,
} from '@/components/xiaoliuren/xiaoliuren-count';

export const MARKER_W = 44;
export const MARKER_H = 40;

/**
 * 左手掌诀：食、中、无名三指六节为六宫，顺时针掐数。
 * 坐标系沿用设计稿（viewBox 400×476，手形整体右移 20）。宫位几何是固定的掌诀布局，
 * 落宫、徽标与拇指指向全部来自传入的月/日/时结果。
 */

type Point = { x: number; y: number };

const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 476;
const BADGE_H = 20;

const HAND_OUTLINE = 'M108 474C92 452 72 420 64 392L16.9 257.5A25 25 0 0 1 63.1 238.5L96 304Q95 296 95 284L95 232L100 100A28 28 0 0 1 156 100L161 228Q162 234 163 228L168 65A29 29 0 0 1 226 65L231 224Q232 230 233 224L238 88A28 28 0 0 1 294 88L299 238Q301 246 303 238L308 150A23 23 0 0 1 354 150L359 244L360 290C364 340 364 390 348 425C340 445 334 460 332 474';
const PALM_LINES = 'M356 300C312 296 252 286 198 262M98 306C160 322 240 344 300 376M98 306C136 346 148 410 140 470';
const FINGER_CREASES = 'M108 130Q128 134 148 130M106 182Q128 186 150 182M110 186Q128 190 146 186M176 98Q197 102 218 98M174 158Q197 162 220 158M178 162Q197 166 216 162M246 118Q266 122 286 118M244 170Q266 174 288 170M248 174Q266 178 284 174M316 178Q331 181 346 178M314 212Q331 215 348 212M317 216Q331 219 345 216M43 301Q60 297 76 287';

/** 六宫中心：食指根/尖、中指尖/根、无名指尖/根。 */
const PALACE_CENTER: Record<XiaoliurenPalace, Point> = {
  大安: { x: 128, y: 212 },
  留连: { x: 128, y: 106 },
  速喜: { x: 197, y: 70 },
  赤口: { x: 266, y: 92 },
  小吉: { x: 266, y: 206 },
  空亡: { x: 197, y: 196 },
};

/** 落宫徽标中心：指尖宫放在上方、指根宫放在下方，相邻宫错开高度避免重叠。 */
const BADGE_CENTER: Record<XiaoliurenPalace, Point> = {
  大安: { x: 128, y: 264 },
  留连: { x: 128, y: 54 },
  速喜: { x: 197, y: 19 },
  赤口: { x: 266, y: 41 },
  小吉: { x: 266, y: 264 },
  空亡: { x: 197, y: 238 },
};

/** 顺时针路线：大安→留连→速喜→赤口→小吉→空亡→大安。 */
const ROUTE_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [128, 191, 128, 129],
  [151, 97, 173, 79],
  [220, 76, 242, 86],
  [266, 113, 266, 183],
  [243, 204, 221, 199],
  [174, 199, 152, 208],
];

/** 拇指尖到各宫的指向曲线（绘制在宫位标记之下，避开相邻宫）。 */
const THUMB_POINTER: Record<XiaoliurenPalace, string> = {
  大安: 'M44 220Q58 196 101 210',
  留连: 'M44 220Q46 136 101 112',
  速喜: 'M44 220Q60 60 172 70',
  赤口: 'M44 220C50 40 220 0 247 69',
  小吉: 'M44 220Q150 300 246 228',
  空亡: 'M44 220Q110 290 175 212',
};

const STAGE_LABEL: Record<XiaoliurenStageKey, string> = { month: '① 月', day: '② 日', hour: '③ 时' };
const STAGE_ORDER: readonly XiaoliurenStageKey[] = ['month', 'day', 'hour'];

export interface XiaoliurenPalmProps {
  /** 月上起落宫；三者都缺省时只画掌诀与路线（用于起课前的说明）。 */
  monthStatus?: XiaoliurenPalace;
  dayStatus?: XiaoliurenPalace;
  hourStatus?: XiaoliurenPalace;
  /** 外部选中（如对话中的模型焦点）的步骤，额外描一圈虚线。 */
  highlightedStages?: readonly XiaoliurenStageKey[];
  ariaLabel?: string;
  className?: string;
}

/** 估算徽标宽度：汉字/圈号按 11px，空格与间隔点更窄。 */
function badgeWidth(text: string): number {
  let width = 16;
  for (const char of text) {
    if (char === ' ' || char === '·') width += 4;
    else if (char === '　') width += 8;
    else width += 11;
  }
  return width;
}

export type XiaoliurenStagePalaces = Partial<Record<XiaoliurenStageKey, XiaoliurenPalace>>;

/** 同宫的月/日/时合并为一个徽标，如「① 月　② 日」「③ 时 · 落宫」。 */
export function buildStageBadges(stages: XiaoliurenStagePalaces) {
  const byPalace = new Map<XiaoliurenPalace, XiaoliurenStageKey[]>();
  for (const key of STAGE_ORDER) {
    const palace = stages[key];
    if (!palace) continue;
    byPalace.set(palace, [...(byPalace.get(palace) ?? []), key]);
  }
  return [...byPalace.entries()].map(([palace, keys]) => {
    const text = keys.map((key) => STAGE_LABEL[key]).join('　') + (keys.includes('hour') ? ' · 落宫' : '');
    return { palace, text, width: badgeWidth(text) };
  });
}

export function StageBadge({ x, y, text, width }: { x: number; y: number; text: string; width: number }) {
  return (
    <g>
      <rect x={x - width / 2} y={y - BADGE_H / 2} width={width} height={BADGE_H} rx="10" fill="var(--foreground)" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fill="var(--background)">{text}</text>
    </g>
  );
}

export type PalaceMarkerState = 'final' | 'passed' | 'idle';

/** 宫位标记：落宫实心黏土色（带柔光），经过宫浅黏土描边，其余为卡片白。 */
export function PalaceMarker({ palace, x, y, state, highlighted, glowId }: {
  palace: XiaoliurenPalace; x: number; y: number; state: PalaceMarkerState; highlighted: boolean; glowId: string;
}) {
  const left = x - MARKER_W / 2;
  const top = y - MARKER_H / 2;
  const isFinal = state === 'final';
  const isPassed = state === 'passed';
  const nature = XIAOLIUREN_PALACE_NATURE[palace];
  const natureColor = isFinal ? 'var(--accent-soft)' : nature === '吉' ? 'var(--success)' : 'var(--danger)';
  return (
    <g data-palace={palace} data-state={state}>
      {highlighted && (
        <rect x={left - 5} y={top - 5} width={MARKER_W + 10} height={MARKER_H + 10} rx="15" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" />
      )}
      {isFinal && <rect x={left} y={top + 2} width={MARKER_W} height={MARKER_H} rx="11" fill="var(--accent)" opacity="0.35" filter={`url(#${glowId})`} />}
      <rect
        x={left}
        y={top}
        width={MARKER_W}
        height={MARKER_H}
        rx="11"
        fill={isFinal ? 'var(--accent)' : isPassed ? 'var(--accent-soft)' : 'var(--surface)'}
        stroke={isFinal || isPassed ? 'var(--accent)' : 'var(--border-hover)'}
        strokeWidth={isPassed ? 1.5 : 0.75}
      />
      <text x={x} y={y - 1} textAnchor="middle" fontSize="14" className="font-display" fill={isFinal ? 'var(--on-accent)' : 'var(--foreground)'}>{palace}</text>
      <text x={x} y={y + 13} textAnchor="middle" fontSize="10" fill={natureColor}>{nature}</text>
    </g>
  );
}

export function markerState(palace: XiaoliurenPalace, stages: XiaoliurenStagePalaces): PalaceMarkerState {
  if (palace === stages.hour) return 'final';
  return palace === stages.month || palace === stages.day ? 'passed' : 'idle';
}

export function StartBadge({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden="true">
      <circle cx={x} cy={y} r="9" fill="var(--foreground)" />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize="10" fill="var(--background)">起</text>
    </g>
  );
}

/** useId 生成的 id 含冒号等字符，去掉后才能安全用于 url(#…) 引用。 */
export function useSvgIds(prefix: string) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return { arrow: `${prefix}-arr-${uid}`, arrowDark: `${prefix}-arr-dark-${uid}`, glow: `${prefix}-glow-${uid}` };
}

export function SvgDefs({ ids }: { ids: ReturnType<typeof useSvgIds> }) {
  return (
    <defs>
      <marker id={ids.arrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0 0.5L7.5 4L0 7.5z" fill="var(--clay)" />
      </marker>
      <marker id={ids.arrowDark} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 0.5L7.5 4L0 7.5z" fill="var(--accent-strong)" />
      </marker>
      <filter id={ids.glow} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
    </defs>
  );
}

export function XiaoliurenPalm({
  monthStatus,
  dayStatus,
  hourStatus,
  highlightedStages = [],
  ariaLabel = '左手掌诀：食指、中指、无名指六节为六宫，顺时针掐数',
  className = '',
}: XiaoliurenPalmProps) {
  const ids = useSvgIds('xl');
  const stagePalace: XiaoliurenStagePalaces = { month: monthStatus, day: dayStatus, hour: hourStatus };
  const highlightedPalaces = new Set<XiaoliurenPalace>(
    highlightedStages.flatMap((key) => (stagePalace[key] ? [stagePalace[key]] : [])),
  );

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      className={`block h-auto w-full max-w-[400px] ${className}`}
    >
      <SvgDefs ids={ids} />
      <g transform="translate(20 0)">
        <path
          d={HAND_OUTLINE}
          style={{ fill: 'color-mix(in srgb, var(--panel) 60%, var(--wx-earth-soft))' }}
          stroke="var(--border-hover)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path d={PALM_LINES} fill="none" stroke="var(--wx-earth)" strokeOpacity="0.2" strokeWidth="1.2" strokeLinecap="round" />
        <path d={FINGER_CREASES} fill="none" stroke="var(--border-hover)" strokeWidth="1" strokeLinecap="round" />
        <text x="232" y="322" textAnchor="middle" fontSize="12" letterSpacing="2" fill="var(--foreground-tertiary)">顺时针掐数</text>

        {ROUTE_SEGMENTS.map(([x1, y1, x2, y2]) => (
          <line
            key={`${x1}-${y1}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="var(--clay)"
            strokeWidth="1.25"
            strokeDasharray="3 3"
            markerEnd={`url(#${ids.arrow})`}
          />
        ))}

        {hourStatus && (
          <g>
            <path
              d={THUMB_POINTER[hourStatus]}
              fill="none"
              stroke="var(--accent-strong)"
              strokeWidth="1.25"
              strokeDasharray="2 3"
              markerEnd={`url(#${ids.arrowDark})`}
            />
            <text x="22" y="192" textAnchor="middle" fontSize="11" fill="var(--accent-strong)">拇指</text>
            <text x="22" y="206" textAnchor="middle" fontSize="11" fill="var(--accent-strong)">掐此</text>
          </g>
        )}

        {XIAOLIUREN_PALACES.map((palace) => (
          <PalaceMarker
            key={palace}
            palace={palace}
            x={PALACE_CENTER[palace].x}
            y={PALACE_CENTER[palace].y}
            state={markerState(palace, stagePalace)}
            highlighted={highlightedPalaces.has(palace)}
            glowId={ids.glow}
          />
        ))}

        <StartBadge x={PALACE_CENTER.大安.x - 21} y={PALACE_CENTER.大安.y - 19} />

        {buildStageBadges(stagePalace).map(({ palace, text, width }) => (
          <StageBadge key={palace} x={BADGE_CENTER[palace].x} y={BADGE_CENTER[palace].y} text={text} width={width} />
        ))}
      </g>
    </svg>
  );
}
