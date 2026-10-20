/**
 * 详查工具规范文本的通用排版：每个 JSON 段一个「## 段名」块。
 * 对象逐项写「键：值」，字符串数组逐条列出，带「类型/位置/说明」的事实行写作「类型｜说明」。
 * 「位置」是给盘面定位用的坐标，说明里已写明所在，文本不再重复。
 */

type Value = unknown;

function isFactRow(value: Value): value is { 类型: string; 位置: unknown[]; 说明: string } {
  return !!value && typeof value === 'object' && typeof (value as { 类型?: unknown }).类型 === 'string'
    && Array.isArray((value as { 位置?: unknown }).位置) && typeof (value as { 说明?: unknown }).说明 === 'string';
}

function inline(value: Value): string {
  if (value === undefined || value === null || value === '') return '-';
  if (Array.isArray(value)) return value.map(inline).join('、') || '-';
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}${inline(item)}`).join(' ');
  return String(value);
}

function lines(value: Value): string[] {
  if (Array.isArray(value)) {
    if (!value.length) return ['- 无'];
    return value.map(item => {
      if (isFactRow(item)) return `- ${item.类型}｜${item.说明}`;
      if (item && typeof item === 'object') {
        return `- ${Object.entries(item as Record<string, unknown>).filter(([key]) => key !== '位置').map(([key, field]) => `${key}：${inline(field)}`).join('；')}`;
      }
      return `- ${inline(item)}`;
    });
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    return entries.length ? entries.map(([key, item]) => `- ${key}：${inline(item)}`) : ['- 无'];
  }
  return [`- ${inline(value)}`];
}

/** 按段落顺序渲染；空数组段写「无」，undefined 段跳过 */
export function renderFactSections(title: string, sections: Record<string, Value>): string {
  const out = [`# ${title}`];
  for (const [name, value] of Object.entries(sections)) {
    if (value === undefined) continue;
    out.push('', `## ${name}`, '', ...lines(value));
  }
  return out.join('\n');
}
