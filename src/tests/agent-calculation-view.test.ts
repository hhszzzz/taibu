import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildToolSuccessPayload, executeTool } from 'taibu-core/mcp';
import { CalculationResult } from '../components/chat/agent/AgentCalculationViews';
import { getAgentCalculation } from '../lib/agent/tool-presentation';

async function render(name: string, input: Record<string, unknown>) {
  const payload = buildToolSuccessPayload(name, await executeTool(name, input));
  const value = getAgentCalculation({ type: 'tool', id: name, name, title: name, status: 'completed', input, output: { artifactId: 'a', result: payload.structuredContent } });
  assert.ok(value, `${name} has a structured view`);
  const html = renderToStaticMarkup(createElement(CalculationResult, { value }));
  return { html, text: html.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ') };
}

test('a pairing shows both people, how they see each other and the relations between their charts in three groups', async () => {
  const { html, text } = await render('bazi_hepan', {
    a: { name: '男方', gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 },
    b: { name: '女方', gender: 'female', birthYear: 1992, birthMonth: 8, birthDay: 3, birthHour: 14 },
  });
  assert.match(text, /男方（男）· 属蛇 · 日主庚金，生于丑月（相）· 缺失五行 无/u);
  assert.match(html, /aria-label="女方四柱"><span title="年柱 · 剑锋金">壬申<\/span><span[^>]*>丁未<\/span><span[^>]*>辛亥<\/span><span[^>]*>乙未<\/span><\/p>/u);
  assert.match(text, /日主互见 女方日主辛金是男方的劫财；男方日主庚金是女方的劫财；男方日主庚金与女方日主辛金比和/u);
  assert.match(text, /年命纳音 男方大林木，女方剑锋金：女方年命剑锋金克男方年命大林木/u);
  // Each group is a labelled section with its count; an empty one says so instead of vanishing.
  const groups = [...html.matchAll(/<h3 id="[^"]+">([^<]+) <span>([^<]+)<\/span><\/h3>/gu)].map(match => `${match[1]}|${match[2].replace(/\d+ 项/u, 'N 项')}`);
  assert.deepEqual(groups, ['日柱之间|日主与夫妻宫 · N 项', '年柱之间|生肖与年命 · N 项', '其余关系|其余柱位 · N 项']);
  assert.match(text, /两人日柱之间没有干支合冲刑害破。/u);
  assert.match(text, /巳申六合化水 男方年柱地支巳 · 女方年柱地支申/u);
});

test('a date selection names every zodiac it avoids', async () => {
  const { text } = await render('almanac_select', { startDate: '2026-02-14', endDate: '2026-02-20', excludeClash: ['牛', '兔'] });
  assert.match(text, /2026-02-14 至 2026-02-20 · 7 天 · 避冲 丑牛（冲未）、卯兔（冲酉） · 候选 5 天/u);
});
