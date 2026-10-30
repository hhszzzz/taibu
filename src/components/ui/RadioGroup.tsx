'use client';

import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import { cn } from '@/lib/utils';

export type RadioOption<Value extends string | number> = {
    value: Value;
    label: string;
    description?: string;
    disabled?: boolean;
};

export interface RadioGroupProps<Value extends string | number> extends Omit<RadioGroupPrimitive.Props<Value>, 'value' | 'onChange' | 'onValueChange' | 'children' | 'className'> {
    value: Value;
    onChange: (value: Value) => void;
    options: readonly RadioOption<Value>[];
    className?: string;
    optionClassName?: string | ((option: RadioOption<Value>, checked: boolean) => string);
}

export function RadioGroup<Value extends string | number>({
    value,
    onChange,
    options,
    className,
    optionClassName,
    ...props
}: RadioGroupProps<Value>) {
    return (
        <RadioGroupPrimitive
            value={value}
            onValueChange={onChange}
            className={cn('flex flex-col gap-2', className)}
            {...props}
        >
            {options.map(option => (
                <label
                    key={String(option.value)}
                    className={cn(
                        'flex min-h-6 cursor-pointer items-start gap-2.5 text-sm text-foreground has-disabled:cursor-not-allowed has-disabled:opacity-50',
                        typeof optionClassName === 'function' ? optionClassName(option, value === option.value) : optionClassName,
                    )}
                >
                    <RadioPrimitive.Root
                        value={option.value}
                        disabled={option.disabled}
                        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[0.5px] border-border-hover bg-surface text-accent data-checked:border-accent data-disabled:cursor-not-allowed"
                    >
                        <RadioPrimitive.Indicator className="flex items-center justify-center">
                            <span className="h-2 w-2 rounded-full bg-current" />
                        </RadioPrimitive.Indicator>
                    </RadioPrimitive.Root>
                    <span className="flex min-w-0 flex-col">
                        <span>{option.label}</span>
                        {option.description ? <span className="text-[13px] leading-relaxed text-foreground-secondary">{option.description}</span> : null}
                    </span>
                </label>
            ))}
        </RadioGroupPrimitive>
    );
}
