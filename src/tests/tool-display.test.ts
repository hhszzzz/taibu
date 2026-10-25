import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStepMarkdown, joinTokens, jsonTokens, toolCommandTokens } from '../lib/agent/tool-display';

test('a call reads as a command line: the tool is the command and its arguments are options', () => {
  assert.equal(joinTokens(toolCommandTokens('inspect_chart', { reference: 'artifact:1' })), '$ inspect_chart --reference "artifact:1"');
  assert.equal(joinTokens(toolCommandTokens('read_user_memory', {})), '$ read_user_memory', 'no arguments, no options');
  // More than two options, or a long line, puts each option on its own continued line.
  assert.equal(joinTokens(toolCommandTokens('bazi', { gender: 'male', birthYear: 1990, isLeapMonth: false })),
    '$ bazi \\\n    --gender "male" \\\n    --birthYear 1990 \\\n    --isLeapMonth false');
  // Nested arguments flatten to paths; scalar lists join into one value.
  assert.equal(joinTokens(toolCommandTokens('bazi_hepan', { a: { name: '甲' }, b: { reference: 'artifact:2' } })), '$ bazi_hepan --a.name "甲" --b.reference "artifact:2"');
  assert.equal(joinTokens(toolCommandTokens('almanac_select', { excludeClash: ['牛', '鸡'] })), '$ almanac_select --excludeClash "牛,鸡"');
  assert.equal(joinTokens(toolCommandTokens('parallel_analysis', { tasks: [{ system: 'bazi' }] })), '$ parallel_analysis --tasks[0].system "bazi"');
  // Quotes and backslashes are escaped; line breaks stay readable.
  assert.equal(joinTokens(toolCommandTokens('ask_user', { question: 'a "b"\\c\nd' })), '$ ask_user \\\n    --question "a \\"b\\"\\\\c\nd"');
});

test('each piece of a command line carries its kind for coloring', () => {
  const kinds = toolCommandTokens('bazi', { birthYear: 1990, name: '小王', known: true, place: null }).map(token => `${token.kind}:${token.text.trim()}`).filter(item => !item.endsWith(':'));
  assert.deepEqual(kinds, ['prompt:$', 'command:bazi', 'punct:\\', 'flag:--birthYear', 'number:1990', 'punct:\\', 'flag:--name', 'string:"小王"', 'punct:\\', 'flag:--known', 'literal:true', 'punct:\\', 'flag:--place', 'literal:null']);
});

test('raw results print as indented JSON with keys, strings, numbers and literals told apart', () => {
  const tokens = jsonTokens({ id: 'm1', count: 2, ok: true, items: [], nested: { tags: ['a'] } });
  assert.equal(joinTokens(tokens), JSON.stringify({ id: 'm1', count: 2, ok: true, items: [], nested: { tags: ['a'] } }, null, 2));
  assert.deepEqual(tokens.filter(token => token.kind === 'key').map(token => token.text), ['"id"', '"count"', '"ok"', '"items"', '"nested"', '"tags"']);
  assert.ok(tokens.some(token => token.kind === 'number' && token.text === '2') && tokens.some(token => token.kind === 'literal' && token.text === 'true'));
});

test('key-value list lines of a reading get their key set apart, and nothing else changes', () => {
  assert.equal(formatStepMarkdown('- 姓名: 演示命盘\n- 日主：庚'), '- **姓名** 演示命盘\n- **日主** 庚');
  // Clock times, links, sentences and code are left alone.
  const untouched = ['- 09:00 起', '- https://example.com', '- 这是一句没有冒号的说明', '```\n- 键: 值\n```', '| 柱 | 干支 |', '- 一个超过十二个字的很长很长的键名: 值'];
  for (const line of untouched) assert.equal(formatStepMarkdown(line), line, line);
  assert.equal(formatStepMarkdown('  - 大运: 癸酉'), '  - **大运** 癸酉', 'nested items keep their indent');
});
