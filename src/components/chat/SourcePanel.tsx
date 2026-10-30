/**
 * 数据来源面板组件
 *
 * 'use client' 标记说明：
 * - 使用 React memo 优化
 * - 有交互按钮需要事件处理
 */
'use client';

import { memo } from 'react';
import { Button } from '@/components/ui/Button';
import { ChevronDown } from 'lucide-react';
import type { InjectedSource } from '@/types';
import { SourceBadge } from '@/components/chat/SourceBadge';

interface SourcePanelProps {
    sources: InjectedSource[];
    isExpanded: boolean;
    onToggle: () => void;
}

// memo 优化：避免父组件重渲染时不必要的重渲染
export const SourcePanel = memo(function SourcePanel({ sources, isExpanded, onToggle }: SourcePanelProps) {
    if (!sources || sources.length === 0) return null;

    return (
        <div className="mt-2 border-t border-border/50 pt-2 px-2">
            <Button unstyled
                onClick={onToggle}
                className="flex items-center gap-1 text-xs text-foreground-secondary hover:text-foreground transition-colors"
                type="button"
            >
                <span>参考了 {sources.length} 个来源</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </Button>

            {isExpanded && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {sources.map((source) => (
                        <SourceBadge key={`${source.type}:${source.id}`} source={source} />
                    ))}
                </div>
            )}
        </div>
    );
});
