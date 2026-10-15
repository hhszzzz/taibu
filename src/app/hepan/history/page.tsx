/**
 * 合盘历史记录页面 - 使用 HistoryPageTemplate
 *
 * 'use client'：卡片交互（查看 / 删除 / 加入知识库）在客户端处理
 */
'use client';

import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';

export default function HepanHistoryPage() {
    return (
        <HistoryPageTemplate
            sourceType="hepan"
            title="合盘分析历史"
            subtitle="查看您的历史合盘记录"
            layout="list"
            searchPlaceholder="搜索姓名或类型"
            actionLabel="开始分析"
            deleteMessage="确定要删除这条合盘记录吗？此操作无法撤销。"
            kbSourceType="hepan_chart"
            invalidateTypes={['hepan_chart']}
            kbTitleFn={item => item.question || item.title}
            renderDetail={item => (item.metric ? `契合度 ${item.metric}` : null)}
        />
    );
}
