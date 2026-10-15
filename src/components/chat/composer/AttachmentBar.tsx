/**
 * 普通对话的单个附件与解梦上下文
 *
 * 'use client' 标记说明：
 * - 需要处理用户交互事件
 */
'use client';

import { Moon, X } from 'lucide-react';
import type { AttachmentState } from '@/types';

interface AttachmentBarProps {
    hasFile: boolean;
    attachmentState?: AttachmentState;
    onAttachmentChange?: (state: AttachmentState) => void;
    disabled: boolean;
    isDreamMode: boolean;
    dreamContextLoading: boolean;
    dreamContext?: { baziChartName?: string; dailyFortune?: string };
}

const fileType = (name: string) => name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE';

export function AttachmentBar({
    hasFile,
    attachmentState,
    onAttachmentChange,
    disabled,
    isDreamMode,
    dreamContextLoading,
    dreamContext,
}: AttachmentBarProps) {
    const file = hasFile ? attachmentState?.file : undefined;
    const dreamItems = isDreamMode ? [
        dreamContextLoading ? '正在加载解梦资料' : null,
        dreamContext?.baziChartName ?? null,
        dreamContext?.dailyFortune ? '今日运势' : null,
    ].filter((item): item is string => !!item) : [];
    if (!file && !dreamItems.length) return null;
    return (
        <div className="chat-attachment-row">
            {file && <span className="chat-attachment-chip">
                <span className="chat-attachment-type" aria-hidden="true">{fileType(file.name)}</span>
                <span className="chat-attachment-name" title={file.name}>{file.name}</span>
                {!disabled && <button type="button" aria-label={`移除附件 ${file.name}`}
                    onClick={() => onAttachmentChange?.({ ...attachmentState, file: undefined, webSearchEnabled: attachmentState?.webSearchEnabled ?? false })}>
                    <X size={14} aria-hidden="true" />
                </button>}
            </span>}
            {dreamItems.map(item => <span key={item} className="chat-context-chip"><Moon size={13} aria-hidden="true" />{item}</span>)}
        </div>
    );
}
