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

/** One row of the pairing strip, as 「男方年柱己」…: each glyph is keyed for the relation lines drawn over it. */
const glyphs = (html: string, part: '天干' | '地支') => [...html.matchAll(new RegExp(`data-relation-cell="([^"]+):${part}"[^>]*>(.)<`, 'gu'))].map(match => match[1] + match[2]);

test('a pairing shows both charts as one strip, and the relations between them in three groups', async () => {
  const { html, text } = await render('bazi_hepan', {
    a: { name: '男方', gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 },
    b: { name: '女方', gender: 'female', birthYear: 1992, birthMonth: 8, birthDay: 3, birthHour: 14 },
  });
  // Eight pillars side by side, colored by element, with the strip's relation layer over them.
  assert.deepEqual(glyphs(html, '天干'), ['男方年柱己', '男方月柱丁', '男方日柱庚', '男方时柱辛', '女方年柱壬', '女方月柱丁', '女方日柱辛', '女方时柱乙']);
  assert.equal(glyphs(html, '地支').map(cell => cell.at(-1)).join(''), '巳丑辰巳申未亥未');
  assert.match(html, /<span class="text-water" data-relation-cell="女方年柱:天干" title="女方年柱 · 剑锋金">壬<\/span>/u);
  assert.match(html, /data-relation-overlay=""/u);
  assert.match(text, /男方 男 · 属蛇 女方 女 · 属猴 年 月 日 时 年 月 日 时/u);
  assert.match(text, /日主庚金 · 生于丑月（相） 缺失五行 无 日主辛金 · 生于未月（相） 缺失五行 无 五行互补：双方原局五行俱全/u);
  // How the day masters see each other leads the day-pillar group; zodiac and year nayin lead the year-pillar group.
  assert.match(text, /日柱之间 日主与夫妻宫 · 0 项 日主互见 女方日主辛金是男方的劫财；男方日主庚金是女方的劫财；男方日主庚金与女方日主辛金比和 两人日柱之间没有干支合冲刑害破。/u);
  assert.match(text, /生肖 男方属蛇，女方属猴 年命纳音 男方大林木，女方剑锋金：女方年命剑锋金克男方年命大林木/u);
  // Each group is a labelled section with its count; an empty one says so instead of vanishing.
  const groups = [...html.matchAll(/<h3 id="[^"]+">([^<]+) <span>([^<]+)<\/span><\/h3>/gu)].map(match => `${match[1]}|${match[2].replace(/\d+ 项/u, 'N 项')}`);
  assert.deepEqual(groups, ['日柱之间|日主与夫妻宫 · N 项', '年柱之间|生肖与年命 · N 项', '其余关系|其余柱位 · N 项']);
  assert.match(text, /合 巳申六合化水 男方年支巳·女方年支申/u);
  // The same relation from two of one person's pillars reads apart by where it falls.
  assert.match(text, /冲 巳亥相冲 男方年支巳·女方日支亥 .*冲 巳亥相冲 男方时支巳·女方日支亥/u);
});

test('a date selection names every zodiac it avoids', async () => {
  const { text } = await render('almanac_select', { startDate: '2026-02-14', endDate: '2026-02-20', excludeClash: ['牛', '兔'] });
  assert.match(text, /2026-02-14 至 2026-02-20 · 7 天 · 避冲 丑牛（冲未）、卯兔（冲酉） · 候选 5 天/u);
});

test('a pairing with an unknown birth time leaves that hour pillar empty and says why', async () => {
  const { html, text } = await render('bazi_hepan', {
    a: { name: '男方', gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 },
    b: { name: '女方', gender: 'female', birthYear: 1992, birthMonth: 8, birthDay: 3 },
  });
  assert.deepEqual(glyphs(html, '天干'), ['男方年柱己', '男方月柱丁', '男方日柱庚', '男方时柱辛', '女方年柱壬', '女方月柱丁', '女方日柱辛']);
  assert.equal([...html.matchAll(/<span class="agent-ws-pairing-missing" title="出生时辰未知，未排时柱">—<\/span><\/td><\/tr>/gu)].length, 2, 'both rows end in an empty hour');
  assert.match(text, /日主辛金 · 生于未月（相） 缺失五行 无 · 出生时辰未知，未排时柱/u);
  assert.match(text, /日主庚金 · 生于丑月（相） 缺失五行 无 日主辛金/u, 'the side with a time keeps four pillars and no note');
});

test('luck periods of an unknown birth time show the start as a range and the year that may come later', async () => {
  const { text } = await render('bazi_dayun', { gender: 'female', birthYear: 1995, birthMonth: 1, birthDay: 9 });
  assert.match(text, /起运时刻 1995-12-19 00:00:00 至 1996-04-09 23:59:00/u);
  assert.match(text, /交运年份 出生时辰未知：时辰偏晚时各步大运晚一年交运/u);
  assert.match(text, /1995（或1996）–2004 · 1 岁/u);
});

test('hour candidates list every hour with what sets it apart, and how each past year falls on it', async () => {
  const { html, text } = await render('bazi_hour_candidates', { gender: 'female', birthYear: 1995, birthMonth: 1, birthDay: 9, eventYears: [2018] });
  const items = new Map([...html.matchAll(/<li data-hour-candidate="([^"]+)">(.*?)<\/li>/gu)].map(match => [match[1], match[2].replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()]));
  assert.deepEqual([...items.keys()], ['早子时', '丑时', '寅时', '卯时', '辰时', '巳时', '午时', '未时', '申时', '酉时', '戌时', '亥时', '晚子时']);
  assert.match(text, /公历 1995-01-09（农历一九九四年腊月初九）· 女 · 共有 年柱甲戌 月柱丁丑 日柱庚子（日主庚金）/u);
  assert.match(items.get('丑时')!, /^丑时 · 01:00–03:00 · 时柱 丁丑 正官 · 日主坐墓 · 涧下水 · 命宫丁卯 · 日主庚通根于时支丑（藏辛·余气） 子丑六合化土（日支子·时支丑） · 戌丑恃势之刑（年支戌·月支丑·时支丑）/u);
  assert.match(items.get('晚子时')!, /^晚子时 · 23:00–24:00 · 时柱 戊子/u);
  // The year and the luck period are both 戌, so the same clash shows twice, told apart by where it falls.
  assert.match(items.get('辰时')!, /2018 戊戌 · 甲戌（第3步大运）：庚甲相冲（时干庚·大运干甲） · 辰戌相冲（时支辰·大运支戌） · 辰戌相冲（时支辰·流年支戌） · 大运与时柱天克地冲/u);
  assert.match(items.get('寅时')!, /2018 戊戌 · 甲戌（第3步大运）：无区分候选的关系$/u);
  assert.match(text, /只列各时辰的事实，不判断哪个更可能；时辰由你确认。/u);
});

test('true solar time that falls on the day before reads as such, not as a second date', async () => {
  const { text } = await render('bazi_hour_candidates', { gender: 'male', birthYear: 1990, birthMonth: 5, birthDay: 20, longitude: 87.6, fromHour: 0, toHour: 2 });
  assert.match(text, /戌时 · 00:00–00:06（真太阳时 前一日 20:54–21:00） · 时柱 甲戌/u);
  assert.match(text, /亥时 · 00:06–02:06（真太阳时 前一日 21:00–23:00） · 时柱 乙亥/u);
});
