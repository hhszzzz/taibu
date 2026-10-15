'use client';

import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';

export default function MeihuaHistoryPage() {
  return (
    <HistoryPageTemplate
      sourceType="meihua"
      title="梅花历史"
      subtitle="查看您的历史梅花记录"
      searchPlaceholder="搜索问题或卦名"
      actionLabel="开始起卦"
      deleteMessage="确定要删除这条梅花记录吗？此操作无法撤销。"
      kbSourceType="meihua_divination"
    />
  );
}
