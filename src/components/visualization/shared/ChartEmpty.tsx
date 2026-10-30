import { Button } from '@/components/ui/Button';
/**
 * Chart Empty State
 *
 * Consistent empty-state placeholder for visualization components
 * when required data is missing or invalid.
 */

interface ChartEmptyProps {
  message?: string;
  action?: { label: string; onClick: () => void };
}

export default function ChartEmpty({ message = '暂无数据', action }: ChartEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="text-3xl mb-2 opacity-40">📊</div>
      <p className="text-sm text-[var(--color-foreground-secondary)]">{message}</p>
      {action && (
        <Button unstyled
          type="button"
          onClick={action.onClick}
          className="mt-3 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
