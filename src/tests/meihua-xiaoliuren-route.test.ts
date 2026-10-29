import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { createMockAuthContext } from './helpers/auth-mock';
import { createMockScopedDb } from './helpers/db-mock';
import { calculateMeihuaBundle } from '../lib/divination/meihua';
import { calculateXiaoliurenBundle } from '../lib/divination/xiaoliuren';

const MEIHUA_ROUTE = '../app/api/meihua/route';
const XIAOLIUREN_ROUTE = '../app/api/xiaoliuren/route';
const PIPELINE_PATH = require.resolve('../lib/api/divination-pipeline');
const FEATURE_GUARD_PATH = require.resolve('../lib/api/ai-feature-guard');

type PostHandler = (request: NextRequest) => Promise<Response>;

function post(handler: PostHandler, url: string, body: Record<string, unknown>) {
  return handler(new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }));
}

function clearRouteCaches(...routeModulePaths: string[]) {
  delete require.cache[PIPELINE_PATH];
  delete require.cache[FEATURE_GUARD_PATH];
  for (const routeModulePath of routeModulePaths) {
    delete require.cache[require.resolve(routeModulePath)];
  }
}

function mockUserContext(
  t: TestContext,
  routeModulePaths: string[],
  implementation: typeof import('../lib/api-utils').requireUserContext,
) {
  const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const original = apiUtils.requireUserContext;
  apiUtils.requireUserContext = implementation;
  clearRouteCaches(...routeModulePaths);
  t.after(() => {
    apiUtils.requireUserContext = original;
    clearRouteCaches(...routeModulePaths);
  });
}

function createInsertScope(expectedTable: string, id: string, onInsert: (payload: Record<string, unknown>) => void) {
  return createMockScopedDb({
    tx: async (work) => work({
      insertInto(table: string) {
        assert.equal(table, expectedTable);
        return {
          values(payload: Record<string, unknown>) {
            onInsert(payload);
            return {
              returning(columns: string) {
                assert.equal(columns, 'id');
                return {
                  async executeTakeFirst() { return { id }; },
                };
              },
            };
          },
        };
      },
    } as never),
  });
}

test('Meihua and Xiaoliuren calculate actions return canonical web bundles', async () => {
  clearRouteCaches(MEIHUA_ROUTE, XIAOLIUREN_ROUTE);
  const { POST: postMeihua } = require(MEIHUA_ROUTE) as { POST: PostHandler };
  const { POST: postXiaoliuren } = require(XIAOLIUREN_ROUTE) as { POST: PostHandler };

  const meihuaResponse = await post(postMeihua, 'http://localhost/api/meihua', {
    action: 'calculate',
    input: {
      question: '接口梅花',
      date: '2026-04-04T10:30',
      method: 'number_triplet',
      numbers: [3, 5, 2],
    },
  });
  const meihuaPayload = await meihuaResponse.json();
  assert.equal(meihuaResponse.status, 200);
  assert.equal(meihuaPayload.data.result.castMeta.method, 'number_triplet');
  assert.equal(meihuaPayload.data.canonicalJson.起卦信息.方法, '三数报数法');

  const xiaoliurenResponse = await post(postXiaoliuren, 'http://localhost/api/xiaoliuren', {
    action: 'calculate',
    date: '2025-08-01T23:00',
    question: '接口小六壬',
  });
  const xiaoliurenPayload = await xiaoliurenResponse.json();
  assert.equal(xiaoliurenResponse.status, 200);
  assert.equal(xiaoliurenPayload.data.isLeapMonth, true);
  assert.equal(xiaoliurenPayload.data.result.input.shichen, '子时');
  assert.equal(xiaoliurenPayload.data.canonicalJson.起课信息.时辰, '子时');
});

test('Meihua save is owner-scoped and recalculates canonical data on the server', async (t) => {
  const input = {
    question: '  保存梅花  ',
    date: '2026-04-04T10:30',
    method: 'number_pair' as const,
    numbers: [2, 7],
  };
  const canonical = calculateMeihuaBundle(input);
  const tampered = structuredClone(canonical);
  tampered.result.mainHexagram.name = '客户端伪造卦名';
  tampered.canonicalText = '客户端伪造文本';

  const insertCalls: Record<string, unknown>[] = [];
  const db = createInsertScope('meihua_divinations', 'mh-save-1', (payload) => { insertCalls.push(payload); });
  mockUserContext(t, [MEIHUA_ROUTE], async () => createMockAuthContext('owner-1', db));

  const { POST } = require(MEIHUA_ROUTE) as { POST: PostHandler };
  const response = await post(POST, 'http://localhost/api/meihua', {
    action: 'save',
    input,
    resultData: tampered,
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.divinationId, 'mh-save-1');
  const inserted = insertCalls.at(-1);
  assert.ok(inserted);
  assert.equal(inserted.user_id, 'owner-1');
  assert.equal(inserted?.question, '保存梅花');
  assert.equal(inserted?.main_hexagram, canonical.result.mainHexagram.name);
  assert.deepEqual(inserted?.result_data, canonical);
  const resultData = inserted.result_data;
  assert.ok(resultData && typeof resultData === 'object' && 'canonicalText' in resultData);
  assert.notEqual(resultData.canonicalText, '客户端伪造文本');
});

test('Xiaoliuren save is owner-scoped and recalculates canonical data on the server', async (t) => {
  const canonical = calculateXiaoliurenBundle({ date: '2025-08-01T01:00', question: '  保存小六壬  ' });
  const tampered = structuredClone(canonical);
  tampered.result.hourStatus = '客户端伪造落宫' as never;
  tampered.canonicalText = '客户端伪造文本';

  const insertCalls: Record<string, unknown>[] = [];
  const db = createInsertScope('xiaoliuren_divinations', 'xlr-save-1', (payload) => { insertCalls.push(payload); });
  mockUserContext(t, [XIAOLIUREN_ROUTE], async () => createMockAuthContext('owner-2', db));

  const { POST } = require(XIAOLIUREN_ROUTE) as { POST: PostHandler };
  const response = await post(POST, 'http://localhost/api/xiaoliuren', {
    action: 'save',
    resultData: tampered,
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.divinationId, 'xlr-save-1');
  const inserted = insertCalls.at(-1);
  assert.ok(inserted);
  assert.equal(inserted.user_id, 'owner-2');
  assert.equal(inserted?.question, '保存小六壬');
  assert.equal(inserted?.final_status, canonical.result.hourStatus);
  assert.equal(inserted?.shichen, '丑时');
  assert.deepEqual(inserted?.result_data, canonical);
  const resultData = inserted.result_data;
  assert.ok(resultData && typeof resultData === 'object' && 'canonicalText' in resultData);
  assert.notEqual(resultData.canonicalText, '客户端伪造文本');
});

test('Meihua and Xiaoliuren save actions reject anonymous users before database writes', async (t) => {
  let authCalls = 0;
  mockUserContext(t, [MEIHUA_ROUTE, XIAOLIUREN_ROUTE], async () => {
    authCalls += 1;
    return { error: { message: '请先登录', status: 401 } };
  });

  const meihua = calculateMeihuaBundle({ question: '匿名梅花', date: '2026-04-04T10:30', method: 'time' });
  const xiaoliuren = calculateXiaoliurenBundle({ date: '2026-04-04T10:30', question: '匿名小六壬' });
  const { POST: postMeihua } = require(MEIHUA_ROUTE) as { POST: PostHandler };
  const { POST: postXiaoliuren } = require(XIAOLIUREN_ROUTE) as { POST: PostHandler };

  const responses = await Promise.all([
    post(postMeihua, 'http://localhost/api/meihua', { action: 'save', input: meihua.input, resultData: meihua }),
    post(postXiaoliuren, 'http://localhost/api/xiaoliuren', { action: 'save', resultData: xiaoliuren }),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [401, 401]);
  assert.equal(authCalls, 2);
});
