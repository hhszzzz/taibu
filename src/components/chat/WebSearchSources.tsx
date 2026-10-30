/**
 * 普通对话联网搜索的来源：回答下方说明这次搜索是否完成，并列出回答参考的网页。
 *
 * 'use client' 标记说明：展开/收起网页列表需要 useState 与点击事件。
 */
'use client';

import { memo, useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ChevronDown, Globe } from 'lucide-react';
import type { VisibleWebSearch } from '@/lib/chat/feature-normalization';
import { markdownLinkProps } from '@/lib/chat/markdown-links';

const NOT_SEARCHED: Record<Exclude<VisibleWebSearch['status'], 'ok'>, string> = {
    failed: '联网搜索未能完成，本次回答没有参考网页',
    unavailable: '联网搜索暂不可用，本次回答没有参考网页',
};

export const WebSearchSources = memo(function WebSearchSources({ search }: { search: VisibleWebSearch }) {
    const [expanded, setExpanded] = useState(false);
    const listId = useId();
    if (search.status !== 'ok' || !search.sources.length) {
        return (
            <p className="chat-message-meta is-assistant is-after inline-flex items-center gap-1">
                <Globe className="w-3 h-3" aria-hidden="true" />
                {search.status === 'ok' ? '联网搜索没有找到可参考的网页' : NOT_SEARCHED[search.status]}
            </p>
        );
    }
    return (
        <div className="mt-2 border-t border-border/50 pt-2 px-2">
            <Button unstyled
                type="button"
                onClick={() => setExpanded(open => !open)}
                aria-expanded={expanded}
                aria-controls={expanded ? listId : undefined}
                className="flex items-center gap-1 text-xs text-foreground-secondary hover:text-foreground transition-colors"
            >
                <Globe className="w-3 h-3" aria-hidden="true" />
                <span>联网搜索参考了 {search.sources.length} 个网页</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
            </Button>
            {expanded && (
                <ol id={listId} className="mt-2 flex flex-col gap-1">
                    {search.sources.map(source => (
                        <li key={source.url} className="min-w-0">
                            <a
                                href={source.url}
                                {...markdownLinkProps(source.url)}
                                className="flex min-w-0 items-baseline gap-2 text-xs text-foreground hover:text-accent transition-colors"
                            >
                                <span className="truncate">{source.title}</span>
                                <span className="shrink-0 text-foreground-tertiary">{source.host}</span>
                            </a>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
});
