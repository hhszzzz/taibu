/**
 * MentionPopover 标题栏（含返回按钮和错误提示）
 *
 * 'use client' 标记说明：
 * - 有点击交互（返回按钮）
 */
'use client';

import { ArrowLeft } from 'lucide-react';
import type { Level, DataSourceLoadError } from '@/components/chat/mention/mention-constants';

interface MentionHeaderProps {
    title: string;
    activeLevel: Level;
    loadError: string | null;
    dataSourceErrors: DataSourceLoadError[];
    onGoBack: () => void;
}

export function MentionHeader({ title, activeLevel, loadError, dataSourceErrors, onGoBack }: MentionHeaderProps) {
    return (
        <>
            <div className="chat-mention-head">
                {activeLevel !== 'category' && activeLevel !== 'search' && (
                    <button
                        type="button"
                        onClick={onGoBack}
                        className="chat-mention-back"
                        aria-label="返回"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </button>
                )}
                <div className="chat-mention-head-title">{title}</div>
            </div>
            {!!loadError && (
                <div className="chat-mention-alert is-error">
                    {loadError}
                </div>
            )}
            {!loadError && dataSourceErrors.length > 0 && (
                <div className="chat-mention-alert is-warning">
                    数据源加载部分失败：{dataSourceErrors.slice(0, 2).map(e => e.type).join('、')}{dataSourceErrors.length > 2 ? '…' : ''}
                </div>
            )}
        </>
    );
}
