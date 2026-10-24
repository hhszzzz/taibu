import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';

const RANGE = { startDate: '2026-02-14', endDate: '2026-02-20' };

async function select(input) {
  return renderToolResult('almanac_select', await executeTool('almanac_select', input)).structuredContent;
}

async function day(date) {
  return renderToolResult('almanac', await executeTool('almanac', { date }), { detailLevel: 'full' }).structuredContent;
}

test('almanac_select is published next to the single-day almanac tool', () => {
  const names = listToolDefinitions().map((item) => item.name);
  assert.ok(names.includes('almanac'));
  assert.ok(names.includes('almanac_select'));
});

test('every candidate repeats the single-day almanac facts for that date', async () => {
  const json = await select(RANGE);
  assert.deepEqual(json.查询, { 起止日期: '2026-02-14 至 2026-02-20', 天数: 7 });
  assert.equal(json.候选日.length, 7);
  assert.deepEqual(json.候选日.map((item) => item.日期), ['2026-02-14', '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20']);
  assert.deepEqual(json.排除统计, { 候选数: 7, 犯忌: 0, 无对应宜: 0, 冲煞: 0 });
  for (const candidate of json.候选日) {
    const base = await day(candidate.日期);
    assert.equal(candidate.日干支, base.基础与个性化坐标.日干支, candidate.日期);
    assert.deepEqual(candidate.宜, base.择日宜忌.宜);
    assert.deepEqual(candidate.忌, base.择日宜忌.忌);
    assert.equal(candidate.冲煞, base.传统黄历基调.冲煞);
    assert.equal(candidate.建除, base.值日信息.建除十二值星);
    assert.equal(candidate.星宿, base.值日信息.二十八星宿);
    assert.equal(candidate.星宿吉凶, base.值日信息.星宿吉凶);
    assert.equal(candidate.纳音, base.值日信息.日柱纳音);
  }
  assert.ok(json.计算规则.ruleVersion.startsWith('almanac-select-'));
});

test('an activity keeps the days that 宜 it and excludes the days that 忌 it', async () => {
  const json = await select({ ...RANGE, activity: '嫁娶' });
  assert.equal(json.查询.事项, '嫁娶');
  const { 候选数: candidates, 犯忌: banned, 无对应宜: silent } = json.排除统计;
  assert.equal(candidates + banned + silent, 7);
  assert.ok(candidates > 0);
  assert.ok(json.候选日.every((item) => item.宜.some((text) => text.includes('嫁娶'))));
  assert.ok(json.候选日.every((item) => !item.忌.some((text) => text.includes('嫁娶'))));
  assert.ok(json.候选日.some((item) => item.日期 === '2026-02-14'), '该日的宜含嫁娶');
  const unknown = await select({ ...RANGE, activity: '登基' });
  assert.equal(unknown.候选日.length, 0);
  assert.equal(unknown.排除统计.无对应宜, 7);
});

test('excludeClash drops the days whose branch clashes the given zodiac or branch', async () => {
  const byAnimal = await select({ ...RANGE, excludeClash: ['牛'] });
  const byBranch = await select({ ...RANGE, excludeClash: ['丑'] });
  assert.deepEqual(byAnimal.查询.排除冲煞, ['丑牛（冲未）']);
  assert.deepEqual(byAnimal.排除统计, byBranch.排除统计);
  assert.equal(byAnimal.候选日.length + byAnimal.排除统计.冲煞, 7);
  assert.ok(byAnimal.候选日.every((item) => !item.日干支.endsWith('未')));
  assert.ok(byAnimal.排除统计.冲煞 > 0, '区间内应有未日');
});

test('several people\'s clashes are avoided together, each branch once', async () => {
  // 2026-02-14 至 02-20 的日支依次为 未申酉戌亥子丑：属牛避未日，属兔避酉日
  const both = await select({ ...RANGE, excludeClash: ['兔', '牛', '丑'] });
  assert.deepEqual(both.查询.排除冲煞, ['丑牛（冲未）', '卯兔（冲酉）'], '按地支顺序，同一支只算一次');
  assert.equal(both.排除统计.冲煞, 2);
  assert.ok(both.候选日.every((item) => !/[未酉]$/u.test(item.日干支)));
  const text = renderToolResult('almanac_select', await executeTool('almanac_select', { ...RANGE, excludeClash: ['牛', '兔'] })).content[0].text;
  assert.match(text, /- 排除冲煞：丑牛（冲未）、卯兔（冲酉）/u);
  await assert.rejects(executeTool('almanac_select', { ...RANGE, excludeClash: ['牛', '财神'] }), /excludeClash\[1\]/u);
});

test('the 92-day boundary is inclusive and anything longer is rejected', async () => {
  const exact = await select({ startDate: '2026-01-01', endDate: '2026-04-02' });
  assert.equal(exact.查询.天数, 92);
  assert.equal(exact.候选日.length, 92);
  await assert.rejects(executeTool('almanac_select', { startDate: '2026-01-01', endDate: '2026-04-03' }), '93 days');
});

test('boundaries and invalid inputs are rejected', async () => {
  for (const input of [
    { startDate: '2026-02-20', endDate: '2026-02-14' },
    { startDate: '2026-02-30', endDate: '2026-03-01' },
    { startDate: '2026-2-14', endDate: '2026-02-20' },
    { endDate: '2026-02-20' },
    { startDate: '2026-02-14' },
  ]) {
    await assert.rejects(executeTool('almanac_select', input), JSON.stringify(input));
  }
  for (const extra of [{ excludeClash: ['财神'] }, { excludeClash: [''] }, { excludeClash: [] }, { excludeClash: '牛' }, { activity: '' }, { activity: '一二三四五六七八九十一二三四五六七八九十一二三四五' }]) {
    await assert.rejects(executeTool('almanac_select', { ...RANGE, ...extra }), JSON.stringify(extra));
  }
});
