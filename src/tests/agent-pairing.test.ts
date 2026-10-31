import { test, beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildToolSuccessPayload, executeTool } from 'taibu-core/mcp';
import { createAgentTools } from '../lib/agent/tools.server';
import { MemoryStore, row } from './helpers/agent-runtime-fixture';
import { createMockScopedDb } from './helpers/db-mock';

const HIM = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };
const HER = { gender: 'female', birthYear: 1992, birthMonth: 8, birthDay: 3, birthHour: 14 };

beforeEach(t => {
  assert.ok('mock' in t);
  t.mock.method(require('../lib/app-settings'), 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' }));
});

async function setup() {
  const store = new MemoryStore(), run = row();
  const tools = await createAgentTools(store, run, run.checkpoint);
  const tool = (name: string) => tools.find(item => item.name === name)!;
  await tool('bazi').execute('1:him', HIM);
  await tool('ziwei').execute('2:ziwei', HIM);
  return { store, tool, him: 'artifact:' + store.draft('1:him')!.id, ziwei: 'artifact:' + store.draft('2:ziwei')!.id };
}

/** Saved bazi charts the user owns, as the data source returns their rows. */
function mockSavedCharts(t: Pick<TestContext, 'mock'>, rows: Record<string, Record<string, unknown>>) {
  const context = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  t.mock.method(context, 'systemDb', () => createMockScopedDb({
    tx: async (work) => work({
      selectFrom() {
        const query = { select: () => query, where: () => query, executeTakeFirst: async () => ({ id: 'owned' }) };
        return query;
      },
    } as never),
  }));
  t.mock.method(require('../lib/data-sources'), 'getProvider', async () => ({ get: async (id: string) => rows[id] ?? null, formatForAI: async () => '' }));
}

const people = async (input: Record<string, unknown>) =>
  (buildToolSuccessPayload('bazi_hepan', await executeTool('bazi_hepan', input)).structuredContent as { 双方: unknown }).双方;
const resultOf = (details: unknown) => (details as { result: { 双方: unknown; 年柱之间: unknown[] } }).result;

test('the Agent schema lets either person name a bazi chart instead of giving birth data', async () => {
  const { tool } = await setup();
  const hepan = tool('bazi_hepan');
  const parameters = hepan.parameters as unknown as { required: string[]; properties: Record<string, { required?: string[]; properties: Record<string, unknown> }> };
  assert.deepEqual(parameters.required, ['a', 'b']);
  for (const side of ['a', 'b']) {
    assert.ok(['reference', 'name', 'birthYear', 'gender'].every(key => key in parameters.properties[side].properties), side);
    assert.equal(parameters.properties[side].required, undefined, 'a reference stands in for the birth data');
  }
  assert.match(hepan.description, /reference/);
});

test('a referenced chart is rebuilt from its own birth data and keeps the name the model gave', async () => {
  const { tool, him } = await setup();
  // Argument preparation fills the schema defaults in; they are not birth data the model gave.
  const result = await tool('bazi_hepan').execute('3:pair', { a: { name: '我', reference: him, birthMinute: 0, calendarType: 'solar', timezone: 'Asia/Shanghai' }, b: { name: '她', ...HER } });
  assert.deepEqual(resultOf(result.details).双方, await people({ a: { name: '我', ...HIM }, b: { name: '她', ...HER } }));
  assert.ok(resultOf(result.details).年柱之间.length > 0);
  assert.match(result.content[0].text, /# 八字合盘[\s\S]*- 我（男）：己巳 丁丑 庚辰 辛巳/u);
  const unnamed = await tool('bazi_hepan').execute('4:pair', { a: { reference: him }, b: HER });
  assert.match(unnamed.content[0].text, /- 甲方（男）：己巳 丁丑 庚辰 辛巳/u, 'an unnamed side keeps Core\'s default name');
});

test('a reference never mixes with birth data, and only bazi charts of this conversation can be paired', async () => {
  const { tool, him, ziwei } = await setup();
  const pair = (a: Record<string, unknown>) => tool('bazi_hepan').execute(randomUUID(), { a, b: HER });
  await assert.rejects(pair({ reference: him, birthHour: 10 }), /a 已引用命盘，不能再传出生信息（birthHour）/u);
  await assert.rejects(pair({ reference: ziwei }), /合盘只能引用八字命盘/u);
  await assert.rejects(pair({ reference: 'artifact:' + randomUUID() }), /命盘不在当前会话中或无权访问/u);
  await assert.rejects(pair({ reference: 'not-a-reference' }), /命盘引用格式不正确/u);
});

test('a saved bazi chart is rebuilt from its stored birth fields', async t => {
  const id = randomUUID();
  mockSavedCharts(t, { [id]: { id, gender: 'female', birth_date: '1992-08-03', birth_time: '14:00', calendar_type: 'solar', timezone: 'Asia/Shanghai' } });
  const { tool } = await setup();
  const result = await tool('bazi_hepan').execute('5:pair', { a: { name: '我', ...HIM }, b: { name: '她', reference: 'bazi_chart:' + id } });
  assert.deepEqual(resultOf(result.details).双方, await people({ a: { name: '我', ...HIM }, b: { name: '她', ...HER } }));
});
