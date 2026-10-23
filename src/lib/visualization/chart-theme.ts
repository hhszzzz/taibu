/**
 * Chart theme constants for visualization components.
 */

import type { FortuneDimensionKey } from './dimensions';
import { getDimensionConfig } from './dimensions';

export function getScoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 65) return '#3b82f6';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

export function getScoreLevel(score: number): { level: string; color: string } {
  if (score >= 85) return { level: '大吉', color: '#22c55e' };
  if (score >= 75) return { level: '吉', color: '#4ade80' };
  if (score >= 65) return { level: '中吉', color: '#3b82f6' };
  if (score >= 55) return { level: '平', color: '#f59e0b' };
  if (score >= 45) return { level: '小凶', color: '#f97316' };
  return { level: '凶', color: '#ef4444' };
}

export function getDimensionColor(key: FortuneDimensionKey): string {
  return getDimensionConfig(key).color;
}

export const CHART_COLORS = {
  grid: 'var(--color-border)',
  axis: 'var(--color-foreground-secondary)',
  background: 'var(--color-background)',
  cardBg: 'var(--color-background-secondary)',
  accent: '#D4AF37',
  positive: '#22c55e',
  negative: '#ef4444',
  neutral: '#9ca3af',
  warning: '#f59e0b',
} as const;

export const WUXING_COLORS = {
  wood: '#22c55e',
  fire: '#ef4444',
  earth: '#eab308',
  metal: '#e2e8f0',
  water: '#3b82f6',
} as const;

export type WuxingElement = keyof typeof WUXING_COLORS;
