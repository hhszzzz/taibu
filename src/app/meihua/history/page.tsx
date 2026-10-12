'use client';

import { Flower2 } from 'lucide-react';
import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';

export default function MeihuaHistoryPage() {
  return (
    <HistoryPageTemplate
      sourceType="meihua"
      title="梅花历史"
      subtitle="查看您的历史梅花记录"
      icon={Flower2}
      iconColor="text-accent"
      searchPlaceholder="搜索..."
      emptyActionLabel="开始起卦"
      emptyActionHref="/meihua"
      deleteMessage="确定要删除这条梅花记录吗？此操作无法撤销。"
      kbSourceType="meihua_divination"
      themeColor="accent"
    />
  );
}
