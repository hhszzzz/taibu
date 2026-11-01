#!/usr/bin/env node
// 从已安装的 @lobehub/icons 生成模型图标目录与按图标分包的加载器；升级该依赖后重跑 `pnpm icons:lobe`。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = dirname(createRequire(join(root, 'package.json')).resolve('@lobehub/icons/package.json'));
const esDir = join(packageDir, 'es');

// toc.js 是 `var toc = [...]; export default toc;`，数组本身是 JSON。
const source = readFileSync(join(esDir, 'toc.js'), 'utf8');
const toc = JSON.parse(source.slice(source.indexOf('['), source.lastIndexOf(']') + 1));

const GROUPS = new Set(['model', 'provider', 'application']);
const icons = [];
for (const entry of toc) {
  if (typeof entry?.id !== 'string' || !/^[A-Za-z0-9]+$/u.test(entry.id)) continue;
  const variant = existsSync(join(esDir, entry.id, 'components', 'Color.js')) ? 'Color'
    : existsSync(join(esDir, entry.id, 'components', 'Mono.js')) ? 'Mono' : null;
  if (!variant) {
    console.warn(`skip ${entry.id}: no Color or Mono component`);
    continue;
  }
  const title = String(entry.fullTitle || entry.title || entry.id);
  icons.push({ id: entry.id, title, group: GROUPS.has(entry.group) ? entry.group : 'application', variant });
}
icons.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
if (new Set(icons.map(icon => icon.id.toLowerCase())).size !== icons.length) throw new Error('icon ids collide case-insensitively');

const quote = (value) => `'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'")}'`;
const key = (id) => (/^[A-Za-z_$][\w$]*$/u.test(id) ? id : quote(id));
const banner = `// 由 scripts/generate-lobe-icons.mjs 从 @lobehub/icons 生成，不要手改。\n`;
const catalog = `${banner}
export type LobeIconGroup = 'model' | 'provider' | 'application';
export type LobeIconEntry = { id: string; title: string; group: LobeIconGroup };

export const LOBE_ICONS: readonly LobeIconEntry[] = [
${icons.map(icon => `  { id: ${quote(icon.id)}, title: ${quote(icon.title)}, group: '${icon.group}' },`).join('\n')}
];
`;
const loaders = `${banner}// 每个图标一条静态 import()，打包时各自成块，用到才下载。
import type { IconType } from '@lobehub/icons/es/types';

export const LOBE_ICON_LOADERS: Readonly<Record<string, () => Promise<{ default: IconType }>>> = {
${icons.map(icon => `  ${key(icon.id)}: () => import('@lobehub/icons/es/${icon.id}/components/${icon.variant}.js'),`).join('\n')}
};
`;

writeFileSync(join(root, 'src/lib/ai/lobe-icons.generated.ts'), catalog);
writeFileSync(join(root, 'src/lib/ai/lobe-icon-loaders.generated.ts'), loaders);
console.log(`lobe icons: ${icons.length} (${icons.filter(icon => icon.variant === 'Color').length} color, ${icons.filter(icon => icon.variant === 'Mono').length} mono)`);
