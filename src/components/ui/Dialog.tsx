'use client';

import { useId, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { Modal } from '@/components/ui/Modal';

interface DialogBaseProps {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    onClose?: () => void;
    describedBy?: string;
    keepMounted?: boolean;
    id?: string;
    role?: 'dialog' | 'alertdialog';
    children?: ReactNode;
    busy?: boolean;
    className?: string;
    initialFocusRef?: RefObject<HTMLElement | null>;
    returnFocusRef?: RefObject<HTMLElement | null>;
}

/** Bare mode keeps a caller's measured shell and must name it; structured mode renders the shared header. */
export type DialogProps = DialogBaseProps & (
    | { bare: true; labelledBy: string; title?: never; description?: never; footer?: never; showClose?: never }
    | { bare?: false; labelledBy?: string; title: ReactNode; description?: ReactNode; footer?: ReactNode; showClose?: boolean }
);

/**
 * 语义对话框 = 原生 top-layer 的 Modal + 固定标题/说明/页脚。
 * 应用内所有对话框共用这一条实现，业务只描述内容。
 */
export function Dialog(props: DialogProps) {
    const { open, onOpenChange, onClose, describedBy: describedByProp, keepMounted = false, id, role, children, busy = false,
        className, initialFocusRef, returnFocusRef } = props;
    const titleId = useId();
    const descriptionId = useId();
    const close = onClose ?? (() => onOpenChange?.(false));

    if (props.bare) {
        return (
            <Modal open={open} onClose={close} labelledBy={props.labelledBy} describedBy={describedByProp}
                busy={busy} initialFocusRef={initialFocusRef} returnFocusRef={returnFocusRef}
                keepMounted={keepMounted} id={id} role={role} className={className}>
                {children}
            </Modal>
        );
    }

    const { labelledBy, title, description, footer, showClose = true } = props;
    return (
        <Modal
            open={open}
            onClose={close}
            labelledBy={labelledBy ?? titleId}
            describedBy={describedByProp ?? (description ? descriptionId : undefined)}
            busy={busy}
            initialFocusRef={initialFocusRef}
            returnFocusRef={returnFocusRef}
            keepMounted={keepMounted}
            id={id}
            role={role}
            className={className}
        >
            <div className="flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden text-foreground">
                <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6">
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-lg font-medium leading-snug text-foreground">{title}</h2>
                        {description ? (
                            <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-foreground-secondary">{description}</p>
                        ) : null}
                    </div>
                    {showClose ? (
                        <IconButton label="关闭对话框" size="sm" className="-mr-2 -mt-2" disabled={busy} onClick={close}>
                            <X aria-hidden="true" />
                        </IconButton>
                    ) : null}
                </div>
                {children ? <div className="min-h-0 overflow-y-auto px-6 py-5">{children}</div> : null}
                {footer ? <div className="flex shrink-0 flex-wrap justify-end gap-2.5 px-6 pb-6 pt-1">{footer}</div> : null}
            </div>
        </Modal>
    );
}
