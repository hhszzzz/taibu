'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

export interface ChartInteraction {
  selectedIds: readonly string[];
  onSelect: (id: string) => void;
}

export function isChartTargetSelected(interaction: ChartInteraction | undefined, id: string) {
  return interaction?.selectedIds.some(selected => selected === id || selected.startsWith(id + ':')) ?? false;
}

/**
 * 盘面单元（宫、爻、牌、课…）的 data-chart-selected：交互盘总写出 true / false，
 * Agent 在看时样式据此让没在看的单元退后（agent-results.css）；只读盘不写。
 */
export function chartSelected(interaction: ChartInteraction | undefined, id: string): boolean | undefined {
  return interaction ? isChartTargetSelected(interaction, id) : undefined;
}

/** An optional control for persisted chart views; ordinary result pages stay passive. */
export function ChartTarget({ interaction, id, children, className = '' }: {
  interaction?: ChartInteraction; id: string; children: ReactNode; className?: string;
}) {
  if (!interaction) return <span className={className}>{children}</span>;
  return <Button unstyled type="button" className={'chart-target-control ' + className} data-chart-target={id}
    aria-pressed={interaction.selectedIds.includes(id)} onClick={() => interaction.onSelect(id)}>{children}</Button>;
}
