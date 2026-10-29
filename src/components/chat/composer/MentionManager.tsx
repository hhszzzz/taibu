/**
 * Mention 弹出层管理组件
 *
 * 'use client' 标记说明：
 * - 需要处理用户交互事件
 */
'use client';

import type { Mention } from '@/types';
import { MentionPopover } from '@/components/chat/MentionPopover';
import type { DataSourceSummary, DataSourceLoadError } from '@/lib/data-sources/types';
import type { KnowledgeBaseSummary } from '@/components/chat/composer/useComposerState';
import type { DataSourceType } from '@/lib/data-sources/types';

interface MentionManagerProps {
    userId?: string | null;
    // Mention popover
    mentionOpen: boolean;
    setMentionOpen: (open: boolean) => void;
    mentionQuery: string;
    mentionDataSources: DataSourceSummary[];
    mentionKnowledgeBases: KnowledgeBaseSummary[];
    enabledDataSourceTypes: DataSourceType[];
    mentionLoadError: string | null;
    mentionDataSourceErrors: DataSourceLoadError[];
    mentionLoading: boolean;
    mentionDefaultCategory: 'knowledge' | 'data' | null;
    setMentionDefaultCategory: (cat: 'knowledge' | 'data' | null) => void;
    canUseKnowledgeBase: boolean;
    handleSelectMention: (mention: Mention) => void;
}

export function MentionManager({
    userId,
    mentionOpen, setMentionOpen,
    mentionQuery,
    mentionDataSources, mentionKnowledgeBases,
    enabledDataSourceTypes,
    mentionLoadError, mentionDataSourceErrors,
    mentionLoading, mentionDefaultCategory, setMentionDefaultCategory,
    canUseKnowledgeBase, handleSelectMention,
}: MentionManagerProps) {
    return (
        <>
            {/* Mention 弹出层 */}
            {mentionOpen && userId && (
                <>
                    <div
                        className="fixed inset-0 z-30"
                        onClick={() => setMentionOpen(false)}
                    />
                    <MentionPopover
                        query={mentionQuery}
                        dataSources={mentionDataSources}
                        knowledgeBases={mentionKnowledgeBases}
                        enabledDataSourceTypes={enabledDataSourceTypes}
                        loadError={mentionLoadError}
                        dataSourceErrors={mentionDataSourceErrors}
                        loading={mentionLoading}
                        defaultCategory={mentionDefaultCategory || undefined}
                        knowledgeBaseLocked={!canUseKnowledgeBase}
                        onSelect={handleSelectMention}
                        onClose={() => {
                            setMentionOpen(false);
                            setMentionDefaultCategory(null);
                        }}
                    />
                </>
            )}
        </>
    );
}
