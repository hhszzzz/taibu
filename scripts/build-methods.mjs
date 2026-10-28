#!/usr/bin/env node
/**
 * 方法唯一来源：skills/taibu-divination/methods/*.md 与 SKILL.md 的「约定」「解读通则」。
 * 生成 packages/core/src/mcp/methods.generated.ts（Agent、MCP prompts 与普通对话人格共用），
 * 并把方法目录写进 SKILL.md 的 METHODS 标记之间。改方法后运行 pnpm build:methods。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL_DIR = path.join(root, 'skills/taibu-divination');
export const METHODS_DIR = path.join(SKILL_DIR, 'methods');
export const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
export const target = path.join(root, 'packages/core/src/mcp/methods.generated.ts');

/**
 * Every Core tool belongs to exactly one system, listed chart first, then the drilldowns in workflow order.
 * Each system has a default method named after it; school methods (bazi-mangpai) share its tools; dream needs none.
 * Technique methods (birth-hour, past-events) are procedures loaded beside a system method when their situation arises;
 * one may serve several systems and then reads all of their tools.
 */
export const SYSTEM_TOOLS = Object.freeze({
  bazi: ['bazi', 'bazi_wuxing', 'bazi_dayun', 'bazi_liunian_scan', 'bazi_relations', 'bazi_pillars_resolve', 'bazi_hour_candidates', 'bazi_hepan'],
  ziwei: ['ziwei', 'ziwei_palace', 'ziwei_flying_star', 'ziwei_horoscope'],
  liuyao: ['liuyao', 'liuyao_line'],
  meihua: ['meihua'],
  qimen: ['qimen', 'qimen_palace'],
  daliuren: ['daliuren', 'daliuren_lessons'],
  xiaoliuren: ['xiaoliuren'],
  taiyi: ['taiyi'],
  tarot: ['tarot'],
  astrology: ['astrology', 'astrology_point'],
  almanac: ['almanac', 'almanac_select'],
  dream: [],
});

const SECTIONS = [['role', '角色'], ['method', '断法'], ['workflow', '工具流程'], ['output', '输出要求']];
const FIELDS = ['name', 'title', 'system', 'version', 'description'];
/** Required on every method but a system's default one: a school replaces the default method, a technique joins it. */
const KINDS = ['school', 'technique'];

/** The method body exactly as a method is laid out; parsing must round-trip to the source. */
export function renderMethodBody(method) {
  return `# ${method.title}\n\n${SECTIONS.map(([key, heading]) => `## ${heading}\n\n${method[key]}\n`).join('\n')}`;
}

export function parseMethod(source, file) {
  const fail = message => { throw new Error(`方法 ${file}：${message}`); };
  const text = source.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(text);
  if (!match) fail('缺少 frontmatter');
  const meta = {};
  for (const line of match[1].split('\n')) {
    const field = /^([a-z]+): (.+)$/.exec(line);
    if (!field) fail(`frontmatter 行格式应为「键: 值」：${line}`);
    if (![...FIELDS, 'kind'].includes(field[1]) || field[1] in meta) fail(`未知或重复的字段 ${field[1]}`);
    meta[field[1]] = field[2].trim();
  }
  for (const key of FIELDS) if (!meta[key]) fail(`缺少 ${key}`);
  if (meta.name !== path.basename(file, '.md')) fail('name 必须与文件名一致');
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(meta.name)) fail('name 只能用小写字母、数字与连字符');
  const systems = meta.system.split(',').map(system => system.trim());
  for (const system of systems) if (!Object.hasOwn(SYSTEM_TOOLS, system)) fail(`未登记的体系 ${system}，请在 scripts/build-methods.mjs 的 SYSTEM_TOOLS 中登记`);
  if (new Set(systems).size !== systems.length) fail('system 不能重复');
  if (meta.name === systems[0] && systems.length === 1) {
    if (meta.kind) fail('体系的默认方法不写 kind');
    meta.kind = 'system';
  } else if (!KINDS.includes(meta.kind)) fail(`kind 须为 ${KINDS.join(' 或 ')}`);
  if (systems.length > 1 && meta.kind !== 'technique') fail('只有技法可以用于多个体系');
  if (!/^\d+\.\d+\.\d+$/.test(meta.version)) fail('version 须为 x.y.z');
  const parts = match[2].split(/^## (.+)\n\n/m);
  const heading = /^# (.+)\n\n$/.exec(parts[0])?.[1];
  if (heading !== meta.title) fail('正文须以与 title 相同的一级标题开头');
  const parsed = { name: meta.name, title: meta.title, kind: meta.kind, system: systems[0], systems, version: meta.version, description: meta.description };
  SECTIONS.forEach(([key, name], index) => {
    if (parts[1 + index * 2] !== name) fail(`第 ${index + 1} 节应为「${name}」`);
    const body = parts[2 + index * 2]?.trim();
    if (!body) fail(`「${name}」为空`);
    parsed[key] = body;
  });
  if (parts.length !== 1 + SECTIONS.length * 2) fail(`只能包含 ${SECTIONS.map(([, name]) => name).join('、')} 四节`);
  if (renderMethodBody(parsed) !== match[2]) fail('排版不规范：各节之间保留一个空行，文件以单个换行结尾');
  return parsed;
}

/** A level-two section of SKILL.md, through the next level-two heading or the end of the file. */
export function skillSection(source, heading) {
  const body = new RegExp(`(?:^|\\n)## ${heading}[ \\t]*\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`).exec(source)?.[1].trim();
  if (!body) throw new Error(`SKILL.md 缺少「${heading}」段`);
  return body;
}

export function readMethods() {
  const methods = readdirSync(METHODS_DIR).filter(name => name.endsWith('.md')).sort()
    .map(name => parseMethod(readFileSync(path.join(METHODS_DIR, name), 'utf8'), name));
  const systems = Object.keys(SYSTEM_TOOLS);
  for (const system of systems) if (!methods.some(method => method.name === system)) throw new Error(`体系 ${system} 缺少同名的默认方法`);
  // Systems in registry order, each default method first.
  return methods.sort((a, b) => systems.indexOf(a.system) - systems.indexOf(b.system) || Number(b.name === b.system) - Number(a.name === a.system) || a.name.localeCompare(b.name));
}

export function methodsSource(methods = readMethods(), skill = readFileSync(SKILL_MD, 'utf8')) {
  return '// Generated by scripts/build-methods.mjs from skills/taibu-divination; do not edit.\n'
    + "import type { MethodSource } from './methods.js';\n\n"
    + `export const METHOD_SYSTEMS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(SYSTEM_TOOLS, null, 2)};\n\n`
    + `export const METHOD_SOURCES: readonly MethodSource[] = ${JSON.stringify(methods, null, 2)};\n\n`
    + `export const METHOD_PRINCIPLES = ${JSON.stringify(skillSection(skill, '解读通则'))};\n\n`
    + `export const METHOD_CONVENTIONS = ${JSON.stringify(skillSection(skill, '约定'))};\n`;
}

/** SKILL.md with the method catalogue between its METHODS markers. */
export function skillWithCatalogue(skill, methods = readMethods()) {
  const table = [
    '| 方法 | 名称 | 适用 | 文件 |',
    '| --- | --- | --- | --- |',
    ...methods.map(method => `| \`${method.name}\` | ${method.title} | ${method.description} | [methods/${method.name}.md](methods/${method.name}.md) |`),
  ].join('\n');
  if (!/<!-- METHODS:BEGIN -->[\s\S]*?<!-- METHODS:END -->/.test(skill)) throw new Error('SKILL.md 缺少 <!-- METHODS:BEGIN --> / <!-- METHODS:END --> 标记');
  return skill.replace(/<!-- METHODS:BEGIN -->[\s\S]*?<!-- METHODS:END -->/, `<!-- METHODS:BEGIN -->\n${table}\n<!-- METHODS:END -->`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const methods = readMethods();
  const skill = skillWithCatalogue(readFileSync(SKILL_MD, 'utf8'), methods);
  const source = methodsSource(methods, skill);
  if (process.argv.includes('--check')) {
    const drifted = [[target, source], [SKILL_MD, skill]].filter(([file, expected]) => readFileSync(file, 'utf8') !== expected);
    if (drifted.length) {
      console.error(`方法产物已漂移（${drifted.map(([file]) => path.relative(root, file)).join('、')}），请运行 pnpm build:methods`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(SKILL_MD, skill);
    writeFileSync(target, source);
    console.log(`methods: ${methods.length} methods -> ${path.relative(root, target)}`);
  }
}
