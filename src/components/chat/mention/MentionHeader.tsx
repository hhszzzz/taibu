/**
 * MentionPopover 标题栏（含返回按钮和错误提示）
 *
 * 'use client' 标记说明：
 * - 有点击交互（返回按钮）
 */
'use client';

import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface MentionHeaderProps {
    title: string;
    showBack: boolean;
    onGoBack: () => void;
}

export function MentionHeader({ title, showBack, onGoBack }: MentionHeaderProps) {
    return (
        <div className="chat-mention-head">
            {showBack && (
                <Button unstyled
                    type="button"
                    onClick={onGoBack}
                    className="chat-mention-back"
                    aria-label="返回"
                >
                    <ArrowLeft className="w-4 h-4" />
                </Button>
            )}
            <div className="chat-mention-head-title">{title}</div>
        </div>
    );
}
