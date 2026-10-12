'use client';

import { Waypoints } from 'lucide-react';
import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';

export default function XiaoliurenHistoryPage() {
  return (
    <HistoryPageTemplate
      sourceType="xiaoliuren"
      title="小六壬历史"
      subtitle="查看您的历史小六壬记录"
      icon={Waypoints}
      iconColor="text-accent"
      searchPlaceholder="搜索..."
      emptyActionLabel="开始起课"
      emptyActionHref="/xiaoliuren"
      deleteMessage="确定要删除这条小六壬记录吗？此操作无法撤销。"
      kbSourceType="xiaoliuren_divination"
      themeColor="accent"
    />
  );
}
