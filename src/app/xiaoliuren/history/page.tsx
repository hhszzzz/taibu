'use client';

import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';

export default function XiaoliurenHistoryPage() {
  return (
    <HistoryPageTemplate
      sourceType="xiaoliuren"
      title="小六壬历史"
      subtitle="查看您的历史小六壬记录"
      searchPlaceholder="搜索问题或落宫"
      actionLabel="开始起课"
      deleteMessage="确定要删除这条小六壬记录吗？此操作无法撤销。"
      kbSourceType="xiaoliuren_divination"
    />
  );
}
