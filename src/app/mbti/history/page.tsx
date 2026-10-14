/**
 * MBTI 历史记录页面 - 使用 HistoryPageTemplate
 */
'use client'; // HistoryPageTemplate 依赖客户端 hooks，渲染函数需在客户端传入

import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';
import { PERSONALITY_BASICS, type MBTIType } from '@/lib/divination/mbti';

function resolveMbtiTypeLabel(title: string) {
  return title.replace(/\s*人格$/u, '').trim();
}

export default function MBTIHistoryPage() {
  return (
    <HistoryPageTemplate
      sourceType="mbti"
      title="MBTI 测试历史"
      subtitle="查看您的历史测试结果"
      layout="list"
      searchPlaceholder="搜索人格类型"
      actionLabel="开始测试"
      deleteMessage="确定要删除这条 MBTI 测试记录吗？此操作无法撤销。"
      kbSourceType="mbti_reading"
      invalidateTypes={['mbti_reading']}
      kbTitleFn={(item) => `MBTI - ${resolveMbtiTypeLabel(item.title)}`}
      // 旧记录没有维度百分比时，用人格简介代替。
      renderDetail={(item) => (item.badges?.length
        ? item.badges.join(' · ')
        : PERSONALITY_BASICS[resolveMbtiTypeLabel(item.title) as MBTIType]?.description ?? null)}
    />
  );
}
