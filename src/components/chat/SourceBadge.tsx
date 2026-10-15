/**
 * 数据来源标签组件
 *
 * 'use client' 标记说明：
 * - 使用 Next.js Link 组件进行客户端导航
 */
'use client';

import Link from 'next/link';
import { BookOpenText, AtSign, FileText } from 'lucide-react';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { getDataSourceFeatureId } from '@/lib/data-sources/catalog';
import { DATA_SOURCE_TYPES, type DataSourceType } from '@/lib/data-sources/types';
import type { InjectedSource } from '@/types';

function isDataSourceType(value: string): value is DataSourceType {
    return DATA_SOURCE_TYPES.includes(value as DataSourceType);
}

function getSourceHref(
    source: InjectedSource,
    options: {
        knowledgeBaseEnabled: boolean;
        isFeatureEnabled: (featureId: string) => boolean;
    }
): string {
    if (source.type === 'knowledge_base') {
        if (!options.knowledgeBaseEnabled) return '#';
        return `/api/knowledge-base/${source.id}`;
    }
    if (source.type === 'mention' || source.type === 'data_source') {
        const type = source.sourceType || '';
        if (!type) return '#';
        if (!isDataSourceType(type)) return '#';
        if (!options.isFeatureEnabled(getDataSourceFeatureId(type))) return '#';
        return `/api/data-sources/${encodeURIComponent(type)}/${encodeURIComponent(source.id)}`;
    }
    return '#';
}

function getSourceIcon(type: InjectedSource['type']) {
    if (type === 'knowledge_base') return <BookOpenText className="w-3 h-3" />;
    if (type === 'mention') return <AtSign className="w-3 h-3" />;
    return <FileText className="w-3 h-3" />;
}

export function SourceBadge({ source }: { source: InjectedSource }) {
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const { isFeatureEnabled } = useFeatureToggles();
    const href = getSourceHref(source, { knowledgeBaseEnabled, isFeatureEnabled });
    const icon = getSourceIcon(source.type);
    const isInteractive = href !== '#';

    return (
        <Link
            href={href}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${isInteractive ? 'bg-accent/10 hover:bg-accent/20' : 'bg-accent/5 text-foreground-secondary cursor-default pointer-events-none'}`}
            title={source.preview}
            target={isInteractive && href.startsWith('/api/') ? '_blank' : undefined}
            aria-disabled={!isInteractive}
        >
            {icon}
            <span className="max-w-[200px] truncate">{source.name}</span>
            {source.truncated && <span className="text-foreground-tertiary">(部分)</span>}
        </Link>
    );
}
