'use client';

import { CHART_TEXT_DETAIL_OPTIONS, type ChartTextDetailLevel } from '@/lib/divination/detail-level';
import { Button } from '@/components/ui/Button';

export function TextDetailLevelPicker({
  label = '复制级别',
  value,
  onChange,
  onSelect,
  className = '',
}: {
  label?: string | null;
  value: ChartTextDetailLevel;
  onChange: (value: ChartTextDetailLevel) => void;
  onSelect?: (value: ChartTextDetailLevel) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {label ? (
        <span className="text-[11px] font-bold uppercase tracking-widest text-foreground-secondary">
          {label}
        </span>
      ) : null}
      <div className="inline-flex rounded-md border border-border bg-background overflow-hidden">
        {CHART_TEXT_DETAIL_OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <Button unstyled
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                onSelect?.(option.value);
              }}
              className={`px-3 py-1.5 text-md font-medium transition-colors ${
                active
                  ? 'bg-background-secondary text-foreground'
                  : 'text-foreground-secondary hover:bg-background-secondary/60'
              }`}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
