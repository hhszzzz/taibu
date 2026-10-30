'use client';

import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type FieldControlProps = {
    id?: string;
    required?: boolean;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean | 'false' | 'true' | 'grammar' | 'spelling';
};

export type FieldRenderProps = Required<Pick<FieldControlProps, 'id'>> & FieldControlProps;

export interface FieldProps {
    label: ReactNode;
    children: ReactElement<FieldControlProps> | ((props: FieldRenderProps) => ReactNode);
    description?: ReactNode;
    error?: ReactNode;
    required?: boolean;
    controlId?: string;
    className?: string;
}

export function Field({ label, children, description, error, required = false, controlId, className }: FieldProps) {
    const generatedId = useId();
    const childProps = typeof children === 'function' ? {} : children.props;
    const id = controlId ?? childProps.id ?? generatedId;
    const descriptionId = description && !error ? `${id}-description` : undefined;
    const errorId = error ? `${id}-error` : undefined;
    const describedBy = [childProps['aria-describedby'], descriptionId, errorId].filter(Boolean).join(' ') || undefined;

    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            <label htmlFor={id} className="text-sm font-medium leading-5 text-foreground">
                {label}
                {required ? <><span aria-hidden="true" className="ml-1 text-danger">*</span><span className="sr-only">（必填）</span></> : null}
            </label>
            {typeof children === 'function'
                ? children({ id, required: required || undefined, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })
                : cloneElement(children, {
                    id,
                    required: required || children.props.required,
                    'aria-describedby': describedBy,
                    'aria-invalid': error ? true : children.props['aria-invalid'],
                })}
            {descriptionId ? <p id={descriptionId} className="text-[13px] leading-relaxed text-foreground-secondary">{description}</p> : null}
            {errorId ? <p id={errorId} className="text-[13px] leading-relaxed text-danger">{error}</p> : null}
        </div>
    );
}
