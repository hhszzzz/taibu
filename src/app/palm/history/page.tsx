/**
 * 手相历史记录页面 - 使用 HistoryPageTemplate
 */
'use client';

import { Hand } from 'lucide-react';
import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';

export default function PalmHistoryPage() {
    return (
        <HistoryPageTemplate
            sourceType="palm"
            title="手相分析历史"
            subtitle="查看您的历史手相分析记录"
            icon={Hand}
            iconColor="text-accent"
            layout="list"
            searchPlaceholder="搜索分析类型..."
            emptyActionLabel="开始手相分析"
            deleteMessage="确定要删除这条手相分析记录吗？此操作无法撤销。"
            kbSourceType="palm_reading"
            themeColor="accent"
            invalidateTypes={['palm_reading']}
            kbTitleFn={item => [...(item.badges || []), item.title].filter(Boolean).join(' ')}
        />
    );
}
