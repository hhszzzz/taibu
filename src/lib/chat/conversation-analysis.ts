import { requestBrowserData } from '@/lib/browser-api';

export type ConversationAnalysisSnapshot = {
  analysis: string | null;
  reasoning: string | null;
  modelId: string | null;
  reasoningEnabled: boolean;
};

export async function loadConversationAnalysisSnapshot(
  conversationId: string,
): Promise<ConversationAnalysisSnapshot | null> {
  const payload = await requestBrowserData<{
    snapshot?: ConversationAnalysisSnapshot | null;
  }>(`/api/conversations/${conversationId}?snapshot=analysis`, { method: 'GET' }, {
    fallbackMessage: '加载分析快照失败',
    allowNotFound: true,
  });

  return payload?.snapshot ?? null;
}

export async function loadLatestConversationAnalysisSnapshot(filters: {
  sourceType: string;
  chartId?: string;
}): Promise<ConversationAnalysisSnapshot | null> {
  const query = new URLSearchParams({
    includeArchived: 'true',
    limit: '1',
    sourceType: filters.sourceType,
  });
  if (filters.chartId) {
    query.set('chartId', filters.chartId);
  }

  const payload = await requestBrowserData<{
    conversations?: Array<{ id?: string | null }>;
  }>(`/api/conversations?${query.toString()}`, { method: 'GET' }, {
    fallbackMessage: '加载分析快照失败',
  });
  const conversationId = payload?.conversations?.[0]?.id;
  if (typeof conversationId !== 'string' || !conversationId) {
    return null;
  }

  return await loadConversationAnalysisSnapshot(conversationId);
}
