/**
 * 分段控件（八字 / 合盘共用的展示组件）：共享 SegmentedControl 的领域壳。
 */
import { SegmentedControl as SharedSegmentedControl, type SegmentedOption as SharedSegmentedOption } from '@/components/ui/SegmentedControl';

export type SegmentedOption<T extends string> = SharedSegmentedOption<T>;

export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
    mode = 'toggle',
    size = 'md',
    className = '',
}: {
    options: readonly SegmentedOption<T>[];
    value: T | null | undefined;
    onChange: (value: T) => void;
    ariaLabel: string;
    mode?: 'toggle' | 'tabs';
    size?: 'md' | 'sm';
    className?: string;
}) {
    return (
        <SharedSegmentedControl
            ariaLabel={ariaLabel}
            value={(value ?? options[0]?.value) as T}
            onChange={onChange}
            options={options}
            mode={mode}
            size={size}
            className={`rounded-xl ${className}`}
        />
    );
}
