import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { METHODS_DIR, SKILL_MD, SYSTEM_TOOLS, methodsSource, parseMethod, readMethods, renderMethodBody, skillSection, skillWithCatalogue, target } from '../build-methods.mjs';

const SOURCE = `---
name: bazi
title: 子平八字
system: bazi
version: 2.0.0
description: 子平法论八字。
---

# 子平八字

## 角色

你是命理师。

## 断法

1. 定盘。

## 工具流程

1. \`bazi\` 排盘。

## 输出要求

- 先结论。
`;

test('a card parses into its fields and four sections, and lays out exactly as written', () => {
  const card = parseMethod(SOURCE, 'bazi.md');
  assert.deepEqual(card, { name: 'bazi', title: '子平八字', kind: 'system', system: 'bazi', systems: ['bazi'], version: '2.0.0', description: '子平法论八字。', role: '你是命理师。', method: '1. 定盘。', workflow: '1. `bazi` 排盘。', output: '- 先结论。' });
  assert.equal(renderMethodBody(card), SOURCE.split('---\n\n')[1]);
  assert.deepEqual(parseMethod(SOURCE.replaceAll('\n', '\r\n'), 'bazi.md'), card, 'CRLF checkouts parse the same');
});

test('a malformed card is refused with the file and the reason', () => {
  const refused = (source, file, reason) => assert.throws(() => parseMethod(source, file), error => error.message.startsWith(`方法 ${file}`) && reason.test(error.message));
  refused('# 子平八字\n', 'bazi.md', /缺少 frontmatter/);
  refused(SOURCE, 'ziwei.md', /name 必须与文件名一致/);
  refused(SOURCE.replace('system: bazi', 'system: fengshui'), 'bazi.md', /未登记的体系 fengshui/);
  refused(SOURCE.replace('version: 2.0.0', 'version: 2'), 'bazi.md', /version/);
  refused(SOURCE.replace('version: 2.0.0\n', 'version: 2.0.0\nversion: 2.0.1\n'), 'bazi.md', /重复/);
  refused(SOURCE.replace('description: 子平法论八字。\n', ''), 'bazi.md', /缺少 description/);
  refused(SOURCE.replace('# 子平八字', '# 八字'), 'bazi.md', /一级标题/);
  refused(SOURCE.replace('## 断法\n\n1. 定盘。\n\n', ''), 'bazi.md', /第 2 节应为「断法」/);
  refused(SOURCE.replace('## 工具流程', '## 流程'), 'bazi.md', /第 3 节应为「工具流程」/);
  refused(SOURCE.replace('1. 定盘。', ''), 'bazi.md', /「断法」为空/);
  refused(`${SOURCE}\n## 附录\n\n其他\n`, 'bazi.md', /只能包含/);
  refused(SOURCE.replace('你是命理师。\n\n', '你是命理师。\n\n\n'), 'bazi.md', /排版不规范/);
  refused(SOURCE.replace('- 先结论。\n', '- 先结论。'), 'bazi.md', /排版不规范/);
});

test('a card other than a system default says whether it is a school or a technique; only a technique serves several systems', () => {
  const card = (name, frontmatter) => SOURCE.replace('name: bazi', `name: ${name}`).replace('system: bazi', frontmatter);
  const refused = (source, file, reason) => assert.throws(() => parseMethod(source, file), error => error.message.startsWith(`方法 ${file}`) && reason.test(error.message));
  assert.equal(parseMethod(card('bazi-mangpai', 'system: bazi\nkind: school'), 'bazi-mangpai.md').kind, 'school');
  const technique = parseMethod(card('birth-hour', 'system: bazi, ziwei\nkind: technique'), 'birth-hour.md');
  assert.deepEqual({ kind: technique.kind, system: technique.system, systems: technique.systems }, { kind: 'technique', system: 'bazi', systems: ['bazi', 'ziwei'] });
  refused(card('bazi-mangpai', 'system: bazi'), 'bazi-mangpai.md', /kind 须为 school 或 technique/);
  refused(card('bazi-mangpai', 'system: bazi\nkind: persona'), 'bazi-mangpai.md', /kind 须为/);
  refused(SOURCE.replace('system: bazi', 'system: bazi\nkind: school'), 'bazi.md', /默认方法不写 kind/);
  refused(card('bazi-ziwei', 'system: bazi, ziwei\nkind: school'), 'bazi-ziwei.md', /只有技法可以用于多个体系/);
  refused(card('birth-hour', 'system: bazi, bazi\nkind: technique'), 'birth-hour.md', /system 不能重复/);
  refused(card('birth-hour', 'system: bazi, fengshui\nkind: technique'), 'birth-hour.md', /未登记的体系 fengshui/);
});

test('shared SKILL.md sections run through the next heading or the end of the file', () => {
  const body = '- 历法：公历\n- 时间：钟表小时';
  assert.equal(skillSection(`prefix\n## 约定\n\n${body}\n## 其他\nnot conventions`, '约定'), body);
  assert.equal(skillSection(`## 约定\r\n${body.replaceAll('\n', '\r\n')}\r\n`, '约定'), body.replaceAll('\n', '\r\n'));
  assert.throws(() => skillSection('## 其他\nbody', '约定'), /缺少「约定」段/);
});

test('every registered system has a default card, and the Core artifact and the SKILL.md catalogue are current', () => {
  const cards = readMethods();
  const files = readdirSync(METHODS_DIR).filter(name => name.endsWith('.md'));
  assert.equal(cards.length, files.length);
  for (const system of Object.keys(SYSTEM_TOOLS)) assert.ok(cards.some(card => card.name === system), system);
  // Cards appear in registry order, a system's default card before its schools.
  const systems = Object.keys(SYSTEM_TOOLS);
  assert.deepEqual(cards.map(card => systems.indexOf(card.system)), [...cards.map(card => systems.indexOf(card.system))].sort((a, b) => a - b));
  for (const card of cards) {
    const fields = [['name', card.name], ['title', card.title], ['system', card.systems.join(', ')], ...(card.kind === 'system' ? [] : [['kind', card.kind]]), ['version', card.version], ['description', card.description]];
    assert.equal(`---\n${fields.map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n\n${renderMethodBody(card)}`, readFileSync(path.join(METHODS_DIR, `${card.name}.md`), 'utf8'));
  }
  const skill = readFileSync(SKILL_MD, 'utf8');
  assert.equal(skillWithCatalogue(skill, cards), skill, 'SKILL.md 方法目录已漂移，请运行 pnpm build:methods');
  assert.equal(readFileSync(target, 'utf8'), methodsSource(cards, skill), 'Core 方法产物已漂移，请运行 pnpm build:methods');
  for (const card of cards) assert.ok(skill.includes(`[methods/${card.name}.md](methods/${card.name}.md)`), card.name);
});
