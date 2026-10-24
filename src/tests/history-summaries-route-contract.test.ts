import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';


type FixtureOptions = {
  table: string;
  rows?: Array<Record<string, unknown>>;
  row?: Record<string, unknown> | null;
  conversations?: Array<{ id: string; source_data: unknown }>;
  listError?: unknown;
  rowError?: unknown;
  rpc?: (name: string, args: Record<string, unknown>) => unknown;
};

function useScopedFixture(t: TestContext, options: FixtureOptions) {
  const calls = {
    select: [] as Array<{ table: string; columns: unknown }>,
    selectAll: [] as string[],
    where: [] as Array<{ table: string; column: string; value: unknown }>,
    orderBy: [] as Array<{ table: string; column: string; direction: string }>,
    limit: [] as Array<{ table: string; value: number }>,
    offset: [] as Array<{ table: string; value: number }>,
    rpc: [] as Array<{ name: string; args: unknown }>,
  };
  const trx = {
    selectFrom(name: string) {
      const query: Record<string, unknown> = {};
      Object.assign(query, {
        select: (columns: unknown) => { calls.select.push({ table: name, columns }); return query; },
        selectAll: () => { calls.selectAll.push(name); return query; },
        where: (column: string, _operator: string, value: unknown) => { calls.where.push({ table: name, column, value }); return query; },
        orderBy: (column: string, direction: string) => { calls.orderBy.push({ table: name, column, direction }); return query; },
        limit: (value: number) => { calls.limit.push({ table: name, value }); return query; },
        offset: (value: number) => { calls.offset.push({ table: name, value }); return query; },
        execute: async () => {
          if (name === 'conversations') return options.conversations ?? [];
          if (options.listError) throw options.listError;
          return options.rows ?? [];
        },
        executeTakeFirst: async () => {
          if (options.rowError) throw options.rowError;
          return options.row ?? null;
        },
      });
      return query;
    },
  };
  const scoped = {
    scope: { kind: 'user' as const, userId: 'user-1' },
    tx: async (work: (trx: unknown) => unknown) => work(trx),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      if (!options.rpc) throw new Error('unexpected rpc');
      return options.rpc(name, args);
    },
  };
  const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  apiUtilsModule.requireUserContext = (async () => ({ user: { id: 'user-1' }, db: scoped })) as unknown as typeof originalRequireUserContext;
  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
  });
  return calls;
}

test('history summaries route should support qimen summaries through the shared history registry', async (t) => {
  const calls = useScopedFixture(t, {
    table: 'qimen_charts',
    rows: [{
      id: 'qm-1',
      dun_type: 'yang',
      ju_number: 9,
      question: '事业如何',
      created_at: '2026-03-16T00:00:00.000Z',
    }],
  });

  const { GET } = await import('../app/api/history-summaries/route');
  const response = await GET(new NextRequest('http://localhost/api/history-summaries?type=qimen&limit=50'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.items[0].id, 'qm-1');
  assert.equal(payload.items[0].title, '阳遁9局');
  assert.equal(payload.pagination.hasMore, false);
  assert.deepEqual(calls.select[0], {
    table: 'qimen_charts',
    columns: ['id', 'dun_type', 'ju_number', 'question', 'conversation_id', 'created_at'],
  });
  assert.ok(calls.where.some((call) => call.table === 'qimen_charts' && call.column === 'user_id' && call.value === 'user-1'));
  assert.deepEqual(calls.limit, [{ table: 'qimen_charts', value: 51 }]);
  assert.deepEqual(calls.offset, [{ table: 'qimen_charts', value: 0 }]);
});

test('history summaries route should support mbti summaries through the shared history registry', async (t) => {
  const calls = useScopedFixture(t, {
    table: 'mbti_readings',
    rows: [{
      id: 'mbti-1',
      mbti_type: 'INTJ',
      percentages: {
        EI: { E: 20, I: 80 },
        SN: { S: 35, N: 65 },
        TF: { T: 70, F: 30 },
        JP: { J: 60, P: 40 },
      },
      conversation_id: 'conv-mbti-1',
      created_at: '2026-04-11T00:00:00.000Z',
    }],
    conversations: [{ id: 'conv-mbti-1', source_data: { model_id: 'gpt-4.1' } }],
  });

  const { GET } = await import('../app/api/history-summaries/route');
  const response = await GET(new NextRequest('http://localhost/api/history-summaries?type=mbti&limit=50'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.items[0].id, 'mbti-1');
  assert.equal(payload.items[0].title, 'INTJ');
  assert.equal(payload.items[0].question, '策略家');
  assert.deepEqual(payload.items[0].badges, [
    'E20% / I80%',
    'S35% / N65%',
    'T70% / F30%',
    'J60% / P40%',
  ]);
  assert.equal(payload.items[0].conversationId, 'conv-mbti-1');
  assert.ok(calls.where.some((call) => call.table === 'conversations' && call.column === 'id'
    && Array.isArray(call.value) && call.value.includes('conv-mbti-1')));
});

test('history summaries route should return qimen restore payloads from stored base inputs', async (t) => {
  const calls = useScopedFixture(t, {
    table: 'qimen_charts',
    row: {
      id: 'qm-restore-1',
      question: '合作能成吗',
      year: 2026,
      month: 3,
      day: 16,
      hour: 9,
      minute: 30,
      timezone: 'Asia/Shanghai',
      pan_type: 'zhuan',
      ju_method: 'chaibu',
      zhi_fu_ji_gong: 'ji_wugong',
      created_at: '2026-03-16T00:00:00.000Z',
      conversation_id: 'conv-qm-1',
    },
  });

  const { GET } = await import('../app/api/history-summaries/route');
  const response = await GET(new NextRequest(
    'http://localhost/api/history-summaries?type=qimen&id=qm-restore-1&timezone=Asia%2FShanghai',
  ));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.item.sessionKey, 'qimen_result');
  assert.equal(payload.item.sessionData.year, 2026);
  assert.equal(payload.item.sessionData.minute, 30);
  assert.equal(payload.item.sessionData.timezone, 'Asia/Shanghai');
  assert.equal(payload.item.sessionData.juMethod, 'chaibu');
  assert.equal(payload.item.sessionData.zhiFuJiGong, 'jiWuGong');
  assert.equal(payload.item.sessionData.conversationId, 'conv-qm-1');
  assert.deepEqual(calls.selectAll, ['qimen_charts']);
  assert.ok(calls.where.some((call) => call.column === 'id' && call.value === 'qm-restore-1'));
  assert.ok(calls.where.some((call) => call.column === 'user_id' && call.value === 'user-1'));
});

test('history summaries route should return mbti restore payloads with stored scores and percentages', async (t) => {
  useScopedFixture(t, {
    table: 'mbti_readings',
    row: {
      id: 'mbti-restore-1',
      mbti_type: 'ENFP',
      scores: { E: 8, I: 2, S: 3, N: 7, T: 4, F: 6, J: 5, P: 5 },
      percentages: {
        EI: { E: 80, I: 20 },
        SN: { S: 30, N: 70 },
        TF: { T: 40, F: 60 },
        JP: { J: 50, P: 50 },
      },
      conversation_id: 'conv-mbti-restore',
    },
  });

  const { GET } = await import('../app/api/history-summaries/route');
  const response = await GET(new NextRequest('http://localhost/api/history-summaries?type=mbti&id=mbti-restore-1'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.item.sessionKey, 'mbti_result');
  assert.equal(payload.item.sessionData.type, 'ENFP');
  assert.equal(payload.item.sessionData.scores.E, 8);
  assert.equal(payload.item.sessionData.percentages.EI.I, 20);
  assert.equal(payload.item.sessionData.conversationId, 'conv-mbti-restore');
});

test('history summaries route should return daliuren restore payloads through the shared history registry', async (t) => {
  useScopedFixture(t, {
    table: 'daliuren_divinations',
    row: {
      id: 'lr-1',
      solar_date: '2026-03-16',
      question: '明天出行如何',
      conversation_id: 'conv-1',
      settings: {
        hour: 10,
        minute: 30,
        timezone: 'Asia/Shanghai',
      },
    },
  });

  const { GET } = await import('../app/api/history-summaries/route');
  const response = await GET(new NextRequest(
    'http://localhost/api/history-summaries?type=daliuren&id=lr-1&timezone=Asia%2FShanghai',
  ));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.item.sessionKey, 'daliuren_params');
  assert.equal(payload.item.sessionData.timezone, 'Asia/Shanghai');
  assert.equal(payload.item.sessionData.conversationId, 'conv-1');
});

test('history summaries route should support offset pagination instead of clamping the list to the first 50 rows forever', async (t) => {
  const calls = useScopedFixture(t, {
    table: 'tarot_readings',
    rows: [{
      id: 'tarot-101',
      spread_id: 'single',
      question: '后续如何',
      cards: [],
      created_at: '2026-03-16T00:00:00.000Z',
    }],
  });

  const { GET } = await import('../app/api/history-summaries/route');
  const response = await GET(new NextRequest('http://localhost/api/history-summaries?type=tarot&limit=100&offset=100'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.items[0].id, 'tarot-101');
  assert.equal(payload.pagination.hasMore, false);
  assert.equal(payload.pagination.nextOffset, null);
  assert.deepEqual(calls.offset, [{ table: 'tarot_readings', value: 100 }]);
  assert.deepEqual(calls.limit, [{ table: 'tarot_readings', value: 101 }]);
});

test('history summaries route should restore tarot birthDate and numerology metadata', async (t) => {
  useScopedFixture(t, {
    table: 'tarot_readings',
    row: {
      id: 'tarot-1',
      spread_id: 'single',
      question: '今天如何',
      cards: [],
      conversation_id: 'conv-1',
      created_at: '2026-03-20T00:00:00.000Z',
      metadata: {
        birthDate: '1990-01-01',
        numerology: {
          personalityCard: { number: 1, name: 'The Magician', nameChinese: '魔术师' },
          soulCard: { number: 2, name: 'The High Priestess', nameChinese: '女祭司' },
          yearlyCard: { number: 19, name: 'The Sun', nameChinese: '太阳', year: 2026 },
        },
      },
    },
  });

  const { GET } = await import('../app/api/history-summaries/route');
  const response = await GET(new NextRequest('http://localhost/api/history-summaries?type=tarot&id=tarot-1'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.item.sessionKey, 'tarot_result');
  assert.equal(payload.item.sessionData.birthDate, '1990-01-01');
  assert.equal(payload.item.sessionData.numerology.personalityCard.nameChinese, '魔术师');
  assert.equal(payload.item.sessionData.conversationId, 'conv-1');
});

test('history summaries DELETE should call transactional RPC and return success', async (t) => {
  const calls = useScopedFixture(t, {
    table: 'qimen_charts',
    row: { id: 'qm-1', conversation_id: 'conv-qm-1' },
    rpc: () => true,
  });

  const { DELETE } = await import('../app/api/history-summaries/route');
  const response = await DELETE(
    new NextRequest('http://localhost/api/history-summaries?type=qimen&id=qm-1', {
      method: 'DELETE',
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls.rpc, [{
    name: 'delete_history_item_and_conversation',
    args: { p_history_type: 'qimen', p_history_id: 'qm-1' },
  }]);
  assert.equal(body.success, true);
  assert.equal(body.type, 'qimen');
  assert.equal(body.id, 'qm-1');
  assert.equal(body.conversationId, 'conv-qm-1');
});

test('history summaries DELETE should return 404 when transactional RPC reports missing row', async (t) => {
  useScopedFixture(t, {
    table: 'tarot_readings',
    row: null,
    rpc: () => false,
  });

  const { DELETE } = await import('../app/api/history-summaries/route');
  const response = await DELETE(
    new NextRequest('http://localhost/api/history-summaries?type=tarot&id=tarot-1', {
      method: 'DELETE',
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error, '未找到历史记录');
});

test('history summaries DELETE should return 500 when transactional RPC fails', async (t) => {
  useScopedFixture(t, {
    table: 'liuyao_divinations',
    row: { id: 'ly-1', conversation_id: 'conv-ly-1' },
    rpc: () => { throw { message: 'transaction failed' }; },
  });

  const { DELETE } = await import('../app/api/history-summaries/route');
  const response = await DELETE(
    new NextRequest('http://localhost/api/history-summaries?type=liuyao&id=ly-1', {
      method: 'DELETE',
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.error, '删除历史记录失败');
});
