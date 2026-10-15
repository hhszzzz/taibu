/**
 * 奇门遁甲历史记录页面 - 使用 HistoryPageTemplate
 *
 * 'use client'：kbTitleFn 为函数 prop，无法从服务端组件传入客户端模板。
 */
'use client';

import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';

export default function QimenHistoryPage() {
    return (
        <HistoryPageTemplate
            sourceType="qimen"
            title="奇门遁甲历史"
            subtitle="三式之首，洞察天时地利"
            searchPlaceholder="搜索占事"
            actionLabel="开始起局"
            deleteMessage="确定要删除这条排盘记录吗？此操作无法撤销。"
            kbSourceType="qimen_chart"
            invalidateTypes={['qimen_chart']}
            kbTitleFn={item => item.question || '奇门遁甲排盘'}
        />
    );
}
