import type { CSSProperties } from 'react';

type SegmentedChoiceOption<T extends string> = {
  value: T;
  label: string;
};

type SegmentedChoiceProps<T extends string> = {
  ariaLabel: string;
  value: T;
  onChange: (nextValue: T) => void;
  options: readonly SegmentedChoiceOption<T>[];
  maxWidth?: number;
};

export function SegmentedChoice<T extends string>({
  ariaLabel,
  value,
  onChange,
  options,
  maxWidth = 240,
}: SegmentedChoiceProps<T>) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const layoutStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
    maxWidth,
  };
  const indicatorStyle: CSSProperties = {
    width: `calc((100% - 0.5rem) / ${options.length})`,
    transform: `translateX(${activeIndex * 100}%)`,
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="relative grid w-full rounded-[10px] bg-background-secondary p-1"
      style={layoutStyle}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-1 rounded-[7px] bg-surface shadow-sm transition-transform duration-150 dark:bg-background-tertiary"
        style={indicatorStyle}
      />
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`relative z-10 h-8 rounded-[7px] px-3 text-[13px] transition-colors duration-150 ${
              active
                ? 'font-medium text-foreground'
                : 'text-foreground-secondary hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
