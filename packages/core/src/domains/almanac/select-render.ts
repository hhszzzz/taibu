import { withRulesJSON } from '../../shared/calculation-rules.js';
import type { AlmanacSelectOutput, AlmanacSelectSections } from './select-types.js';

export type AlmanacSelectCanonicalJSON = AlmanacSelectSections;

function renderAlmanacSelectJSONBase(result: AlmanacSelectOutput): AlmanacSelectCanonicalJSON {
  return structuredClone(result.sections);
}

/** 口径与工具说明同义、每次相同，只留在 JSON；文本只写查询、候选日与排除统计 */
export function toAlmanacSelectText(result: AlmanacSelectOutput): string {
  const { 查询: query, 候选日: days, 排除统计: stats } = result.sections;
  const lines = ['# 黄历择日筛选', '', '## 查询', '', `- 区间：${query.起止日期}`, `- 天数：${query.天数}`];
  if (query.事项) lines.push(`- 事项：${query.事项}`);
  if (query.排除冲煞) lines.push(`- 排除冲煞：${query.排除冲煞}`);
  lines.push('', '## 候选日', '');
  lines.push(...(days.length
    ? days.map((day) => `- ${day.日期}｜${day.日干支}｜${day.农历}｜建除${day.建除}｜${day.天神}｜${day.星宿}（${day.星宿吉凶}）｜宜 ${day.宜.join('、') || '无'}｜忌 ${day.忌.join('、') || '无'}｜${day.冲煞}`)
    : ['- 无']));
  lines.push('', '## 排除统计', '', `- 候选：${stats.候选数} 天`, `- 犯忌：${stats.犯忌} 天`, `- 无对应宜：${stats.无对应宜} 天`, `- 冲煞：${stats.冲煞} 天`);
  return lines.join('\n');
}

export const toAlmanacSelectJson = withRulesJSON(renderAlmanacSelectJSONBase);
