import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/taibu-divination');
export const TOOL_GUIDES = Object.freeze({
  astrology: 'astrology', astrology_point: 'astrology',
  bazi: 'bazi', bazi_pillars_resolve: 'bazi', bazi_dayun: 'bazi', bazi_relations: 'bazi', bazi_wuxing: 'bazi', bazi_liunian_scan: 'bazi',
  ziwei: 'ziwei', ziwei_horoscope: 'ziwei', ziwei_flying_star: 'ziwei', ziwei_palace: 'ziwei',
  liuyao: 'liuyao', liuyao_line: 'liuyao', meihua: 'meihua', tarot: 'tarot', taiyi: 'taiyi', almanac: 'almanac', almanac_select: 'almanac',
  qimen: 'qimen', qimen_palace: 'qimen', daliuren: 'daliuren', daliuren_lessons: 'daliuren', xiaoliuren: 'xiaoliuren',
});

export function requireGuide(toolName) {
  const guide = TOOL_GUIDES[toolName];
  if (!guide) throw new Error(`工具 ${toolName} 缺少解读指引映射，请更新 scripts/skill-guides.mjs 并补写 interpretation/ 文档`);
  statSync(path.join(SKILL_DIR, 'interpretation', `${guide}.md`));
  return guide;
}

export function shortDescription(description) {
  const [, afterDash] = description.split(/\s+-\s+/, 2);
  const text = (afterDash ?? description).replace(/\n+/g, ' ');
  return text.split(/[。；]/, 1)[0] || text;
}
