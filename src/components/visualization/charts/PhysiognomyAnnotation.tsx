'use client';

import { memo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { PhysiognomyAnnotationData } from '@/lib/visualization/chart-types';
import { useChartEntrance, CHART_ENTRANCE_BASE, CHART_ENTRANCE_ACTIVE } from '@/components/visualization/shared/useChartEntrance';
import ChartEmpty from '@/components/visualization/shared/ChartEmpty';

interface PhysiognomyAnnotationProps {
  data: PhysiognomyAnnotationData;
  compact?: boolean;
  className?: string;
}

function PhysiognomyAnnotationInner({ data, compact = false, className = '' }: PhysiognomyAnnotationProps) {
  const { ref, entered } = useChartEntrance();
  const { annotations, type } = data.data;
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  if (annotations.length === 0) {
    return <ChartEmpty message={`暂无${type === 'face' ? '面相' : '手相'}数据`} />;
  }

  return (
    <div ref={ref} className={`space-y-3 ${CHART_ENTRANCE_BASE} ${entered ? CHART_ENTRANCE_ACTIVE : ''} ${className}`}>
      <div className="relative bg-background-secondary/30 rounded-xl overflow-hidden p-8">
        <svg viewBox="0 0 100 100" className="w-full h-auto">
          {annotations.map((ann, idx) => (
            <g key={idx}>
              <circle
                cx={`${ann.position.x}%`}
                cy={`${ann.position.y}%`}
                r="4"
                fill={activeIdx === idx ? '#D4AF37' : '#3b82f6'}
                opacity={activeIdx === idx ? 1 : 0.8}
              />
              <circle
                cx={`${ann.position.x}%`}
                cy={`${ann.position.y}%`}
                r="12"
                fill="none"
                stroke={activeIdx === idx ? '#D4AF37' : '#3b82f6'}
                strokeWidth="1.5"
                opacity={0.6}
              />
            </g>
          ))}
        </svg>
      </div>

      {!compact && (
        <div className="space-y-2">
          {annotations.map((ann, idx) => (
            <Button unstyled
              key={idx}
              type="button"
              className="w-full text-left p-2.5 rounded-lg border transition-all"
              style={{
                borderColor: activeIdx === idx ? '#D4AF37' : 'var(--color-border)',
                backgroundColor: activeIdx === idx ? 'var(--color-background-secondary)' : 'transparent',
              }}
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseLeave={() => setActiveIdx(null)}
            >
              <div className="text-sm font-medium text-foreground">{ann.label}</div>
              <div className="text-xs text-foreground-secondary mt-1">{ann.detail}</div>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export const PhysiognomyAnnotation = memo(PhysiognomyAnnotationInner);
export default PhysiognomyAnnotation;
