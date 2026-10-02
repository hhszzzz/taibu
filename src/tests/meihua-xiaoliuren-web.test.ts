import test from 'node:test';
import assert from 'node:assert/strict';

import { toMeihuaJson, toMeihuaText, toXiaoliurenJson, toXiaoliurenText } from 'taibu-core';
import { toDateTimeLocalValue } from '../lib/date-utils';
import { calculateMeihuaBundle } from '../lib/divination/meihua';
import { calculateXiaoliurenBundle, wallClockHourToShichenIndex } from '../lib/divination/xiaoliuren';
import { buildHistoryRestorePayload } from '../lib/history/registry';

const DATE = '2026-04-04T10:30:00';

test('shared datetime-local formatter preserves local wall-clock fields', () => {
  const date = new Date(2026, 3, 4, 9, 7, 55);
  assert.equal(toDateTimeLocalValue(date), '2026-04-04T09:07');
});

test('web Meihua wrapper supports all four exposed methods and preserves canonical output', () => {
  const cases = [
    { method: 'time' as const },
    { method: 'text_split' as const, text: '合同能成否', textSplitMode: 'count' as const },
    { method: 'number_pair' as const, numbers: [3, 5] },
    { method: 'number_triplet' as const, numbers: [3, 5, 2] },
  ];

  for (const [index, extra] of cases.entries()) {
    const bundle = calculateMeihuaBundle({
      question: `网页方法 ${index + 1}`,
      date: DATE,
      ...extra,
    });

    assert.equal(bundle.result.castMeta.method, extra.method);
    assert.deepEqual(bundle.canonicalJson, toMeihuaJson(bundle.result, { detailLevel: 'full' }));
    assert.equal(bundle.canonicalText, toMeihuaText(bundle.result, { detailLevel: 'full' }));
    assert.equal(bundle.input.date, DATE);
  }
});

test('web Meihua wrapper reuses core stroke and multi-sentence rules', () => {
  const stroke = calculateMeihuaBundle({
    question: '单字笔画测试',
    date: DATE,
    method: 'text_split',
    text: '天',
    textSplitMode: 'stroke',
    leftStrokeCount: 2,
    rightStrokeCount: 2,
  });
  assert.equal(stroke.result.castMeta.resolvedMode, 'stroke');
  assert.equal(stroke.result.castMeta.resolvedNumbers?.upper, 2);
  assert.equal(stroke.result.castMeta.resolvedNumbers?.lower, 2);
  assert.equal(stroke.result.castMeta.resolvedNumbers?.moving, 4);

  const first = calculateMeihuaBundle({
    question: '多句取首句',
    date: DATE,
    method: 'text_split',
    text: '甲乙。丙丁。戊己辛。',
    multiSentenceStrategy: 'first',
  });
  const last = calculateMeihuaBundle({
    question: '多句取末句',
    date: DATE,
    method: 'text_split',
    text: '甲乙。丙丁。戊己辛。',
    multiSentenceStrategy: 'last',
  });

  assert.equal(first.result.castMeta.inputSnapshot?.selectedText, '甲乙');
  assert.equal(last.result.castMeta.inputSnapshot?.selectedText, '戊己辛');
  assert.ok(first.canonicalJson.起卦信息.原始输入);
  assert.ok(last.canonicalJson.起卦信息.原始输入);
  assert.equal(first.canonicalJson.起卦信息.原始输入.取句方式, '首句');
  assert.equal(last.canonicalJson.起卦信息.原始输入.取句方式, '末句');
});

test('web Meihua wrapper rejects methods that the page does not expose', () => {
  assert.throws(
    () => calculateMeihuaBundle({ question: '不支持', date: DATE, method: 'measure' as never }),
    /网页版暂不支持/u,
  );
});

test('web Xiaoliuren wrapper converts local wall-clock boundaries and preserves lunar labels', () => {
  const expected = new Map([
    [0, ['子时', 1]],
    [1, ['丑时', 2]],
    [12, ['午时', 7]],
    [23, ['子时', 1]],
  ]);

  for (const [hour, [label, index]] of expected) {
    assert.equal(wallClockHourToShichenIndex(hour), index);
    const bundle = calculateXiaoliurenBundle({
      date: `2025-08-01T${String(hour).padStart(2, '0')}:00`,
      question: '边界测试',
    });
    assert.equal(bundle.result.input.shichen, label);
    assert.deepEqual(bundle.canonicalJson, toXiaoliurenJson(bundle.result, { detailLevel: 'full' }));
    assert.equal(bundle.canonicalText, toXiaoliurenText(bundle.result, { detailLevel: 'full' }));
  }

  const leap = calculateXiaoliurenBundle({ date: '2025-08-01T12:00', question: '闰月测试' });
  assert.equal(leap.isLeapMonth, true);
  assert.equal(leap.lunarMonth, 6);
  assert.equal(leap.lunarMonthName, '闰六');
  assert.equal(leap.lunarDayName, '初八');
});

test('web Xiaoliuren wrapper rejects offset datetimes and impossible dates', () => {
  assert.throws(
    () => calculateXiaoliurenBundle({ date: '2026-04-04T10:30:00+08:00' }),
    /不接受时区偏移/u,
  );
  assert.throws(
    () => calculateXiaoliurenBundle({ date: '2026-02-30T10:30' }),
    /日期无效/u,
  );
});

test('history restore payloads keep web inputs/results replayable and owner-bound', async () => {
  const meihua = calculateMeihuaBundle({ question: '历史梅花', date: DATE, method: 'number_pair', numbers: [2, 7] });
  const meihuaRestore = await buildHistoryRestorePayload('meihua', {
    id: 'mh-1',
    input_data: meihua.input,
    result_data: meihua,
    conversation_id: 'conv-mh-1',
  }, 'Asia/Shanghai');
  assert.equal(meihuaRestore.sessionKey, 'meihua_result');
  assert.deepEqual(meihuaRestore.sessionData.input, meihua.input);
  assert.equal(meihuaRestore.sessionData.divinationId, 'mh-1');
  assert.equal(meihuaRestore.sessionData.conversationId, 'conv-mh-1');

  const xiaoliuren = calculateXiaoliurenBundle({ date: '2026-04-04T10:30', question: '历史小六壬' });
  const xiaoliurenRestore = await buildHistoryRestorePayload('xiaoliuren', {
    id: 'xlr-1',
    result_data: xiaoliuren,
    conversation_id: 'conv-xlr-1',
  }, 'Asia/Shanghai');
  assert.equal(xiaoliurenRestore.sessionKey, 'xiaoliuren_result');
  assert.deepEqual(xiaoliurenRestore.sessionData.resultData, xiaoliuren);
  assert.equal(xiaoliurenRestore.sessionData.divinationId, 'xlr-1');
  assert.equal(xiaoliurenRestore.sessionData.conversationId, 'conv-xlr-1');
});
