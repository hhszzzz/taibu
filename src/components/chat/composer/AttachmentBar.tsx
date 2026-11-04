/**
 * 普通对话的单个附件
 *
 * 'use client' 标记说明：
 * - 需要处理用户交互事件
 */
'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { AttachmentState } from '@/types';

interface AttachmentBarProps {
    hasFile: boolean;
    attachmentState?: AttachmentState;
    onAttachmentChange?: (state: AttachmentState) => void;
    disabled: boolean;
}

const fileType = (name: string) => name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE';

export function AttachmentBar({
    hasFile,
    attachmentState,
    onAttachmentChange,
    disabled,
}: AttachmentBarProps) {
    const file = hasFile ? attachmentState?.file : undefined;
    if (!file) return null;
    return (
        <div className="chat-attachment-row">
            {file && <span className="chat-attachment-chip">
                <span className="chat-attachment-type" aria-hidden="true">{fileType(file.name)}</span>
                <span className="chat-attachment-name" title={file.name}>{file.name}</span>
                {!disabled && <Button unstyled type="button" aria-label={`移除附件 ${file.name}`}
                    onClick={() => onAttachmentChange?.({ ...attachmentState, file: undefined, webSearchEnabled: attachmentState?.webSearchEnabled ?? false })}>
                    <X size={14} aria-hidden="true" />
                </Button>}
            </span>}
        </div>
    );
}
