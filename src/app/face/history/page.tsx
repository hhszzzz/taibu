/**
 * 面相历史记录页面 - 使用 HistoryPageTemplate
 */
'use client';

import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';

export default function FaceHistoryPage() {
    return (
        <HistoryPageTemplate
            sourceType="face"
            title="面相分析历史"
            subtitle="查看您的历史面相分析记录"
            layout="list"
            searchPlaceholder="搜索分析类型"
            actionLabel="开始面相分析"
            deleteMessage="确定要删除这条面相分析记录吗？此操作无法撤销。"
            kbSourceType="face_reading"
            invalidateTypes={['face_reading']}
        />
    );
}
