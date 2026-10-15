/**
 * 通用确认弹窗组件
 *
 * 用于危险操作（删除/重置等）的确认提示
 */
'use client';

import { useCallback, useId, type ReactNode } from 'react';
import { Modal } from './Modal';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';

// 危险/警告色在深色主题下是浅色，用背景色作文字才能保证两种主题的对比度。
const CONFIRM_BUTTON_CLASS = {
    danger: 'bg-danger text-background hover:bg-danger/90',
    warning: 'bg-warning text-background hover:bg-warning/90',
    default: 'bg-accent text-on-accent hover:bg-accent/90',
} as const;

interface ConfirmDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    description: string;
    children?: ReactNode;
    showActions?: boolean;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'default';
    loading?: boolean;
}

export function ConfirmDialog({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    children,
    showActions = true,
    confirmText = '确认',
    cancelText = '取消',
    variant = 'danger',
    loading = false,
}: ConfirmDialogProps) {
    const id = useId();

    // 处理确认
    const handleConfirm = useCallback(async () => {
        await onConfirm();
    }, [onConfirm]);

    if (!isOpen) return null;

    return (
        <Modal open={isOpen} onClose={onClose} busy={loading} labelledBy={`${id}-title`} describedBy={`${id}-description`} className="max-w-sm">
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
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="h-10 rounded-[10px] border-[0.5px] border-border-hover bg-transparent px-4 text-sm text-foreground transition-colors hover:bg-background-secondary disabled:opacity-50"
                        >
                            {cancelText}
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={loading}
                            className={`inline-flex h-10 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-medium transition-colors disabled:opacity-50 ${CONFIRM_BUTTON_CLASS[variant]}`}
                        >
                            {loading && <SoundWaveLoader variant="inline" />}
                            {confirmText}
                        </button>
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}
