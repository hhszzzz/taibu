import test from 'node:test';
import assert from 'node:assert/strict';
import { toDaliurenText, toQimenText } from 'taibu-core';
import { resolveChartTextDetailLevel } from '@/lib/divination/detail-level';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

test('tarot data source formatForAI should reuse canonical reading text', async () => {
  const { tarotProvider } = await import('../lib/data-sources/tarot');
  const { generateTarotReadingText } = await import('../lib/divination/tarot');

  const row = {
    id: 'tarot-1',
    user_id: 'user-1',
    spread_id: 'three-card',
    question: '我该怎么做',
    cards: [
      { name: '愚者', orientation: 'upright', position: 1 },
      { name: '恋人', orientation: 'upright', position: 2 },
      { name: '力量', orientation: 'reversed', position: 3 },
    ],
    metadata: { seed: 'seed-1', birthDate: '1990-01-01', numerology: null },
    created_at: '2026-03-25T00:00:00.000Z',
    conversation_id: null,
  };

  assert.equal(
    tarotProvider.formatForAI(row as never),
    generateTarotReadingText({
      spreadName: '三牌阵',
      spreadId: 'three-card',
      question: row.question,
      cards: row.cards,
      seed: 'seed-1',
      numerology: null,
      birthDate: '1990-01-01',
    }),
  );
});

test('qimen data source formatForAI should reuse canonical qimen text', async () => {
  const { qimenProvider } = await import('../lib/data-sources/qimen');
  const { calculateQimenBundle } = await import('../lib/divination/qimen');

  const row = {
    id: 'qimen-1',
    user_id: 'user-1',
    question: '项目会顺利吗',
    dun_type: 'yang',
    ju_number: 3,
    year: 2026,
    month: 3,
    day: 25,
    hour: 10,
    minute: 0,
    timezone: 'Asia/Shanghai',
    pan_type: 'zhuan',
    ju_method: 'chaibu',
    zhi_fu_ji_gong: 'ji_liuyi',
    created_at: '2026-03-25T00:00:00.000Z',
  };

  const { output } = await calculateQimenBundle({
    year: row.year,
    month: row.month,
    day: row.day,
    hour: row.hour,
    minute: row.minute,
    timezone: row.timezone,
    question: row.question,
    panType: 'zhuan',
    juMethod: 'chaibu',
    zhiFuJiGong: 'jiLiuYi',
    juNumber: row.ju_number,
    dunType: 'yang',
  });

  assert.equal(
    await qimenProvider.formatForAI(row as never),
    toQimenText(row.question ? { ...output, question: row.question } : output, {
      detailLevel: resolveChartTextDetailLevel('qimen', undefined),
    }),
  );
});

test('daliuren data source formatForAI should reuse canonical daliuren text', async () => {
  const { daliurenProvider } = await import('../lib/data-sources/daliuren');

  const row = {
    id: 'daliuren-1',
    user_id: 'user-1',
    question: '出行如何',
    solar_date: '2026-03-25',
    day_ganzhi: '甲子',
    hour_ganzhi: '丙寅',
    yue_jiang: '申',
    result_data: {
      dateInfo: {
        solarDate: '2026-03-25 09:00',
        lunarDate: '二月初七',
        bazi: '甲辰 丁卯 己亥 甲子',
        ganZhi: { year: '甲辰', month: '丁卯', day: '己亥', hour: '甲子' },
        yueJiang: '申',
        yueJiangName: '传送',
        xun: '甲子旬',
        kongWang: ['戌', '亥'],
        yiMa: '申',
        dingMa: '未',
        tianMa: '午',
        diurnal: true,
      },
      tianDiPan: {
        diPan: {},
        tianPan: {},
        tianJiang: {},
      },
      siKe: {
        yiKe: ['子', '贵'],
        erKe: ['丑', '蛇'],
        sanKe: ['寅', '雀'],
        siKe: ['卯', '合'],
      },
      sanChuan: {
        chu: ['子', '贵', '兄弟', '甲'],
        zhong: ['丑', '蛇', '子孙', '乙'],
        mo: ['寅', '雀', '妻财', '丙'],
        method: '涉害',
      },
      keTi: {
        method: '涉害',
        subTypes: ['见机'],
        extraTypes: [],
      },
      keName: '涉害课',
      shenSha: [],
      gongInfos: [],
      dunGan: {},
      jianChu: {},
      question: '出行如何',
    },
    settings: null,
    conversation_id: null,
    created_at: '2026-03-25T00:00:00.000Z',
  };

  assert.equal(
    daliurenProvider.formatForAI(row as never),
    toDaliurenText(row.result_data as never, {
      detailLevel: resolveChartTextDetailLevel('daliuren', undefined),
    }),
  );
});

test('liuyao data source formatForAI should reuse traditional copy text path when analysis data is complete', async () => {
  const { liuyaoProvider } = await import('../lib/data-sources/liuyao');
  const {
    calculateLiuyaoBundle,
    findHexagram,
    generateLiuyaoChartText,
  } = await import('../lib/divination/liuyao');

  const row = {
    id: 'liuyao-1',
    user_id: 'user-1',
    question: '工作会顺利吗',
    hexagram_code: '101010',
    changed_hexagram_code: '101110',
    changed_lines: [3],
    yongshen_targets: ['官鬼'],
    created_at: '2026-03-25T00:00:00.000Z',
    conversation_id: null,
  };

  const yaos = row.hexagram_code.split('').map((value, index) => ({
    type: parseInt(value, 10) as 0 | 1,
    change: row.changed_lines.includes(index + 1) ? 'changing' as const : 'stable' as const,
    position: index + 1,
  }));
  const bundle = calculateLiuyaoBundle({
    yaos,
    question: row.question,
    date: new Date(row.created_at),
    yongShenTargets: ['官鬼'],
    hexagram: findHexagram(row.hexagram_code)!,
    changedHexagram: findHexagram(row.changed_hexagram_code)!,
  });

  assert.equal(
    liuyaoProvider.formatForAI(row as never),
    generateLiuyaoChartText(bundle.output),
  );
});

test('ziwei data source formatForAI should rebuild canonical text from stored base fields', async () => {
  const { ziweiProvider } = await import('../lib/data-sources/ziwei');
  const { calculateZiweiChartBundle, generateZiweiChartText } = await import('../lib/divination/ziwei');

  const row = {
    id: 'ziwei-1',
    user_id: 'user-1',
    name: '紫微命主',
    gender: 'male',
    birth_date: '1990-01-01',
    birth_time: '08:00',
    birth_place: '北京',
    longitude: 116.4074,
    calendar_type: 'solar',
    is_leap_month: false,
    created_at: '2026-03-25T00:00:00.000Z',
  };

  const bundle = calculateZiweiChartBundle({
    name: '紫微命主',
    gender: 'male',
    birthYear: 1990,
    birthMonth: 1,
    birthDay: 1,
    birthHour: 8,
    birthMinute: 0,
    birthPlace: '北京',
    longitude: 116.4074,
    calendarType: 'solar',
    isLeapMonth: false,
  });

  assert.equal(
    ziweiProvider.formatForAI(row as never),
    generateZiweiChartText(bundle.output, {
      detailLevel: resolveChartTextDetailLevel('ziwei', undefined),
    }),
  );
});

test('saved bazi and ziwei data sources preserve timezone and DST policy in canonical text', async () => {
  const { baziProvider } = await import('../lib/data-sources/bazi');
  const { ziweiProvider } = await import('../lib/data-sources/ziwei');
  const { calculateBaziChartBundle, generateBaziChartText } = await import('../lib/divination/bazi');
  const { calculateZiweiChartBundle, generateZiweiChartText } = await import('../lib/divination/ziwei');
  for (const disambiguation of ['earlier', 'later'] as const) {
    const row = {
      id: 'chart-time-1', user_id: 'user-1', name: '纽约命主', gender: 'female' as const,
      birth_date: '2024-11-03', birth_time: '01:30', birth_place: '纽约', longitude: -74.006,
      calendar_type: 'solar', is_leap_month: false, timezone: 'America/New_York', disambiguation,
      created_at: '2026-03-25T00:00:00.000Z',
    };
    const form = {
      name: row.name, gender: row.gender, birthYear: 2024, birthMonth: 11, birthDay: 3,
      birthHour: 1, birthMinute: 30, birthPlace: row.birth_place, longitude: row.longitude,
      calendarType: 'solar' as const, isLeapMonth: false, timezone: row.timezone, disambiguation,
    };
    const bazi = calculateBaziChartBundle(form);
    const ziwei = calculateZiweiChartBundle(form);
    assert.equal(baziProvider.formatForAI(row), generateBaziChartText(bazi.output, {
      name: row.name, meta: bazi.meta, detailLevel: resolveChartTextDetailLevel('bazi', undefined),
    }));
    assert.equal(ziweiProvider.formatForAI(row), generateZiweiChartText(ziwei.output, {
      detailLevel: resolveChartTextDetailLevel('ziwei', undefined),
    }));
  }
});

test('fortune and reminder chart reads pass saved time options to shared reconstruction', async (t) => {
  const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const storedBazi = require('../lib/divination/bazi-record') as typeof import('../lib/divination/bazi-record');
  const reminders = require('../lib/reminders') as typeof import('../lib/reminders');
  const { dailyFortuneProvider, monthlyFortuneProvider } = await import('../lib/data-sources/fortune');
  const { NextRequest } = await import('next/server');
  const row: Record<string, unknown> = {
    id: 'chart-time-1', user_id: 'user-1', name: '纽约命主', gender: 'female',
    birth_date: '2024-11-03', birth_time: '01:30', birth_place: '纽约', longitude: -74.006,
    calendar_type: 'solar', is_leap_month: false, timezone: 'America/New_York', disambiguation: 'later',
  };
  const rebuiltRows: Parameters<typeof storedBazi.calculateBaziOutputFromStoredFields>[0][] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          if (table === 'bazi_charts') {
            assert.ok(columns.split(', ').includes('timezone'));
            assert.ok(columns.split(', ').includes('disambiguation'));
          }
          const query = {
            eq() { return query; }, order() { return query; }, limit() { return query; }, in() { return query; },
            async maybeSingle() {
              if (table === 'user_settings') return { data: { default_bazi_chart_id: row.id }, error: null };
              assert.equal(table, 'bazi_charts');
              return { data: Object.fromEntries(columns.split(', ').map(key => [key, row[key]])), error: null };
            },
            then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown) {
              assert.ok(table === 'reminder_subscriptions' || table === 'user_settings');
              return Promise.resolve(resolve({
                data: table === 'reminder_subscriptions'
                  ? [{ user_id: 'user-1', reminder_type: 'key_date', enabled: true, notify_site: true }]
                  : [{ user_id: 'user-1', notifications_enabled: true, notify_site: true }],
                error: null,
              }));
            },
          };
          return query;
        },
      };
    },
  };
  const { createMockScopedDb } = await import('./helpers/db-mock');
  const scoped = createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        let columns: string[] = [];
        const query = {
          select(selection: string | readonly string[]) {
            columns = Array.isArray(selection)
              ? [...selection]
              : String(selection).split(',').map((column) => column.trim());
            if (table === 'bazi_charts') {
              assert.ok(columns.includes('timezone'));
              assert.ok(columns.includes('disambiguation'));
            }
            return query;
          },
          where() { return query; },
          orderBy() { return query; },
          limit() { return query; },
          async executeTakeFirst() {
            if (table === 'user_settings') return { default_bazi_chart_id: row.id };
            assert.equal(table, 'bazi_charts');
            return Object.fromEntries(columns.map((key) => [key, row[key]]));
          },
          async execute() { return []; },
        };
        return query;
      },
    } as never),
  });
  t.mock.method(apiUtils, 'getSystemAdminClient', () => client);
  t.mock.method(apiUtils, 'requireUserContext', async () => ({ user: { id: 'user-1' }, db: client, supabase: client }));
  t.mock.method(reminders, 'updateReminderSubscription', async () => true);
  t.mock.method(storedBazi, 'calculateBaziOutputFromStoredFields', (input: Parameters<typeof storedBazi.calculateBaziOutputFromStoredFields>[0]) => {
    rebuiltRows.push(input);
    return null;
  });
  const ctx = { db: scoped };
  await dailyFortuneProvider.get('2026-03-25', 'user-1', ctx);
  await monthlyFortuneProvider.get('2026-03', 'user-1', ctx);
  assert.equal(await reminders.scheduleAllUsersReminders(), 0);
  const { POST } = await import('../app/api/reminders/route');
  const response = await POST(new NextRequest('http://localhost/api/reminders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reminderType: 'key_date', enabled: true }),
  }));
  assert.equal(response.status, 200);
  assert.equal(rebuiltRows.length, 4);
  for (const input of rebuiltRows) {
    assert.equal(input.timezone, 'America/New_York');
    assert.equal(input.disambiguation, 'later');
    assert.equal(input.birth_time, '01:30');
  }
});

test('hepan data source formatForAI should match saved analysis structure instead of raw JSON dump', async () => {
  const { hepanProvider } = await import('../lib/data-sources/hepan');

  const row = {
    id: 'hepan-1',
    user_id: 'user-1',
    type: 'love',
    person1_name: '甲',
    person1_birth: {},
    person2_name: '乙',
    person2_birth: {},
    compatibility_score: 86,
    created_at: '2026-03-25T00:00:00.000Z',
    conversation_id: null,
    result_data: {
      type: 'love',
      overallScore: 86,
      person1: { name: '甲', year: 1990, month: 1, day: 1 },
      person2: { name: '乙', year: 1991, month: 2, day: 2 },
      dimensions: [
        { name: '沟通', score: 90, description: '交流顺畅' },
      ],
      conflicts: [
        { severity: 'medium', title: '节奏差异', description: '需要多磨合' },
      ],
    },
  };

  const text = await hepanProvider.formatForAI(row as never);
  assert.ok(text.includes('合盘类型：情侣合婚'));
  assert.ok(text.includes('综合契合度：86分'));
  assert.ok(text.includes('沟通: 90分 - 交流顺畅'));
  assert.ok(text.includes('[medium] 节奏差异: 需要多磨合'));
  assert.ok(!text.includes('结构化结果'));
});

test('mbti data source formatForAI should match saved analysis structure instead of raw percentage dump', async () => {
  const { mbtiProvider } = await import('../lib/data-sources/mbti');

  const row = {
    id: 'mbti-1',
    user_id: 'user-1',
    mbti_type: 'INTJ',
    scores: { I: 12, N: 15, T: 14, J: 13 },
    percentages: {
      EI: { E: 30, I: 70 },
      SN: { S: 20, N: 80 },
      TF: { T: 65, F: 35 },
      JP: { J: 60, P: 40 },
    },
    created_at: '2026-03-25T00:00:00.000Z',
    conversation_id: null,
  };

  const text = await mbtiProvider.formatForAI(row as never);
  assert.ok(text.includes('类型名称：策略家'));
  assert.ok(text.includes('外向(E) 30% vs 内向(I) 70%'));
  assert.ok(text.includes('实感(S) 20% vs 直觉(N) 80%'));
  assert.ok(text.includes('思考(T) 65% vs 情感(F) 35%'));
  assert.ok(text.includes('判断(J) 60% vs 知觉(P) 40%'));
  assert.ok(!text.includes('比例：'));
});

test('meihua data source formatForAI should reuse the canonical web result text', async () => {
  const { meihuaProvider } = await import('../lib/data-sources/meihua');
  const { calculateMeihuaBundle, buildMeihuaCanonicalText } = await import('../lib/divination/meihua');
  const bundle = calculateMeihuaBundle({
    question: '数据源梅花',
    date: '2026-04-04T10:30',
    method: 'number_pair',
    numbers: [2, 7],
  });
  const row = {
    id: 'meihua-1',
    user_id: 'user-1',
    question: bundle.input.question,
    method: bundle.input.method,
    cast_datetime: bundle.input.date,
    main_hexagram: bundle.result.mainHexagram.name,
    changed_hexagram: bundle.result.changedHexagram?.name ?? null,
    input_data: bundle.input,
    result_data: bundle,
    conversation_id: null,
    created_at: '2026-03-25T00:00:00.000Z',
  };

  assert.equal(meihuaProvider.formatForAI(row as never), buildMeihuaCanonicalText(bundle.result));
});

test('xiaoliuren data source formatForAI should reuse the canonical web result text', async () => {
  const { xiaoliurenProvider } = await import('../lib/data-sources/xiaoliuren');
  const { calculateXiaoliurenBundle, buildXiaoliurenCanonicalText } = await import('../lib/divination/xiaoliuren');
  const bundle = calculateXiaoliurenBundle({ date: '2026-04-04T10:30', question: '数据源小六壬' });
  const row = {
    id: 'xiaoliuren-1',
    user_id: 'user-1',
    question: bundle.input.question,
    solar_datetime: bundle.solarDateTime,
    lunar_month: bundle.lunarMonth,
    lunar_day: bundle.lunarDay,
    is_leap_month: bundle.isLeapMonth,
    shichen: bundle.result.input.shichen,
    final_status: bundle.result.hourStatus,
    input_data: bundle.input,
    result_data: bundle,
    conversation_id: null,
    created_at: '2026-03-25T00:00:00.000Z',
  };

  assert.equal(xiaoliurenProvider.formatForAI(row as never), buildXiaoliurenCanonicalText(bundle.result));
});
