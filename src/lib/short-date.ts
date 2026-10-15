/**
 * 列表里的简短日期：今年的只显示「月/日」，往年的补上年份。
 *
 * 不依赖 date-utils（它引入了农历库），设置页等列表可以直接使用。
 */

const SHORT_DATE = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' });
const SHORT_DATE_WITH_YEAR = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });

/** 空值或无法解析的日期返回空字符串。 */
export function formatShortDate(value: string | null | undefined, now: Date = new Date()): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return (date.getFullYear() === now.getFullYear() ? SHORT_DATE : SHORT_DATE_WITH_YEAR).format(date);
}
