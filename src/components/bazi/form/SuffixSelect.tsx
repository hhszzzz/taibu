'use client';

import { ComboBox } from '@/components/ui/ComboBox';

/** 数字下拉框：既能直接键入，也能从列表里选；右侧保留年/月/日单位。 */
export function SuffixSelect({
    ariaLabel,
    suffix,
    value,
    onChange,
    options,
}: {
    ariaLabel: string;
    suffix?: string;
    value: number;
    onChange: (value: number) => void;
    options: ReadonlyArray<{ value: number; label: string }>;
}) {
    return (
        <ComboBox
            value={value}
            options={options}
            onChange={onChange}
            ariaLabel={ariaLabel}
            suffix={suffix}
            inputMode="numeric"
            maxLength={suffix === '年' ? 4 : 2}
        />
    );
}
