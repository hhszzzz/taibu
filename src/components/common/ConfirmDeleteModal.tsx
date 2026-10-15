/**
 * 通用删除确认弹窗：历史记录等列表的单条删除
 *
 * 复用 ConfirmDialog，获得统一的焦点约束、Esc 关闭与危险按钮样式。
 */
'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface ConfirmDeleteModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    message?: string;
    /** 删除请求进行中：禁用按钮并阻止关闭，避免重复提交。 */
    loading?: boolean;
}

export function ConfirmDeleteModal({ open, onClose, onConfirm, message, loading = false }: ConfirmDeleteModalProps) {
    return (
        <ConfirmDialog
            isOpen={open}
            onClose={onClose}
            onConfirm={onConfirm}
            title="删除这条记录？"
            description={message || '删除后无法恢复。'}
            confirmText="删除"
            loading={loading}
        />
    );
}
