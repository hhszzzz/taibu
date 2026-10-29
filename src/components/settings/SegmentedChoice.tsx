import type { CSSProperties, KeyboardEvent } from 'react';

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
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const lastIndex = options.length - 1;
    const nextIndex = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (activeIndex + 1) % options.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (activeIndex + lastIndex) % options.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? lastIndex
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    onChange(options[nextIndex].value);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]');
    buttons?.[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="settings-segmented relative grid w-full p-1"
      style={layoutStyle}
    >
      <span
        aria-hidden="true"
        className="settings-segmented-indicator pointer-events-none absolute inset-y-1 left-1"
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
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={handleKeyDown}
            className={`settings-segmented-option relative z-10 px-3 ${active ? 'is-active' : ''}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
