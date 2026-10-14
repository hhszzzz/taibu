/**
 * 六爻历史记录页面 - 使用 HistoryPageTemplate
 */
'use client'; // HistoryPageTemplate 依赖客户端 hooks，配置里的函数需在客户端传入

import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';

export default function LiuyaoHistoryPage() {
    return (
        <HistoryPageTemplate
            sourceType="liuyao"
            title="六爻起卦历史"
            subtitle="回看每一次起卦的卦象、变爻与解读。"
            searchPlaceholder="搜索问题或卦名"
            actionLabel="开始起卦"
            deleteMessage="确定要删除这条起卦记录吗？此操作无法撤销。"
            kbSourceType="liuyao_divination"
            invalidateTypes={['liuyao_divination']}
            kbTitleFn={item => item.question || [item.title, item.changedTitle].filter(Boolean).join(' 变 ')}
        />
    );
}
