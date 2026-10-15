/**
 * 历史记录摘要的展示文本：时间与补充信息行。
 *
 * 纯函数，历史页卡片与测试共用。
 */
import type { HistorySummaryItem } from '@/lib/history/registry';

const HISTORY_DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** 空值或无法解析的时间返回空字符串，避免显示 Invalid Date。 */
export function formatHistoryDate(dateStr: string): string {
  const date = dateStr ? new Date(dateStr) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return HISTORY_DATE_FORMAT.format(date);
}

/**
 * 默认补充信息：徽标与指标合成一行，例如「3月 · 12日 · 子时」「变爻：第2爻」。
 * 已经出现在标题里的徽标（手相的「右手」「事业线」）不重复显示。
 */
export function getDefaultHistoryDetail(item: Pick<HistorySummaryItem, 'title' | 'badges' | 'metric'>): string {
  return [...(item.badges ?? []), item.metric]
    .map(value => value?.trim())
    .filter((value): value is string => !!value && !item.title.includes(value))
    .join(' · ');
}
