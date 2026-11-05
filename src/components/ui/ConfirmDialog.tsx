/**
 * 通用确认弹窗组件
 *
 * 用于危险操作（删除/重置等）的确认提示
 */
'use client';

import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from './Modal';

type ConfirmDialogProps = {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    description: string;
    children?: ReactNode;
    cancelText?: string;
    variant?: 'danger' | 'default';
    loading?: boolean;
} & (
    /** The confirm button names the action ("删除记录"), never a bare "确认". */
    | { showActions?: true; confirmText: string }
    | { showActions: false; confirmText?: never }
);

export function ConfirmDialog({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    children,
    showActions = true,
    confirmText,
    cancelText = '取消',
    variant = 'danger',
    loading = false,
}: ConfirmDialogProps) {
    const id = useId();

    return (
        <Modal open={isOpen} onClose={onClose} busy={loading} labelledBy={`${id}-title`} describedBy={`${id}-description`} className="max-w-sm"
            role={showActions ? 'alertdialog' : undefined}>
            <div className="p-6">
                <h2 id={`${id}-title`} className="font-display text-xl leading-snug text-foreground">
                    {title}
                </h2>
                <p id={`${id}-description`} className="mt-2 text-sm leading-relaxed text-foreground-secondary">
                    {description}
                </p>

                {children ? <div className="mt-5">{children}</div> : null}

                {showActions ? (
                    <div className="mt-6 flex justify-end gap-2.5">
                        <Button variant="secondary" size="lg" onClick={onClose} disabled={loading}>
                            {cancelText}
                        </Button>
                        <Button
                            size="lg"
                            variant={variant === 'danger' ? 'danger' : 'primary'}
                            onClick={onConfirm}
                            loading={loading}
                        >
                            {confirmText}
                        </Button>
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}
