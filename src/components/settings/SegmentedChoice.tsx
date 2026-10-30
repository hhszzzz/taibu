import { SegmentedControl } from '@/components/ui/SegmentedControl';

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
  return (
    <SegmentedControl
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      options={options}
      maxWidth={maxWidth}
      size="sm"
      gap={0}
      className="settings-segmented w-full"
      optionClassName="settings-segmented-option px-3"
      indicatorClassName="settings-segmented-indicator absolute inset-y-1 left-1"
    />
  );
}
