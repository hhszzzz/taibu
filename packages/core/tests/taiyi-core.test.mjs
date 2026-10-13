import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateTaiyi, toTaiyiJson, toTaiyiText } from 'taibu-core';

test('taiyi day mode should produce complete four-layer star context', () => {
  const result = calculateTaiyi({
    mode: 'day',
    date: '2026-04-10',
    timezone: 'Asia/Shanghai',
    question: '项目推进是否顺利',
  });

  assert.equal(result.boardMeta.system, 'taiyi_nine_star');
  assert.equal(result.boardMeta.mode, 'day');
  assert.equal(result.coreBoard.primaryStar.taiyiName, result.coreBoard.dayStar.taiyiName);
  assert.equal(typeof result.datetimeContext.dayGanZhi, 'string');
  assert.equal(typeof result.coreBoard.yearStar.song, 'string');
  assert.ok(result.derivedIndicators.favorableSignals.length > 0);
  assert.ok(result.derivedIndicators.cautionSignals.length > 0);
});

test('taiyi minute mode should expose minute refinement without replacing hour board context', () => {
  const result = calculateTaiyi({
    mode: 'minute',
    date: '2026-04-10',
    hour: 13,
    minute: 37,
    timezone: 'Asia/Shanghai',
  });

  assert.equal(result.boardMeta.mode, 'minute');
  assert.equal(result.boardMeta.minuteSlot, 4);
  assert.equal(result.coreBoard.minuteRefinement?.slot, 4);
  assert.equal(result.coreBoard.primaryStar.taiyiName, result.coreBoard.minuteRefinement?.refinedStar.taiyiName);
  assert.equal(typeof result.coreBoard.hourStar.taiyiName, 'string');
});

test('taiyi renderers should keep compact default and expose full board on demand', () => {
  const result = calculateTaiyi({
    mode: 'hour',
    date: '2026-04-10',
    hour: 13,
    timezone: 'Asia/Shanghai',
  });

  const json = toTaiyiJson(result);
  const fullJson = toTaiyiJson(result, { detailLevel: 'full' });
  const text = toTaiyiText(result);
  const fullText = toTaiyiText(result, { detailLevel: 'full' });

  assert.equal(typeof json.问卜与时空底盘.时间, 'string');
  assert.ok(Array.isArray(json.九星阵列));
  assert.equal(typeof json.古典参考.主诀原文, 'string');
  assert.equal(typeof json.古典参考.使用提示, 'string');
  assert.equal(json.说明, undefined);
  assert.ok(Array.isArray(fullJson.九星阵列));
  assert.equal(typeof fullJson.古典参考?.主诀原文, 'string');
  assert.equal(fullJson.说明, undefined);
  assert.match(text, /# 太乙九星主证据/u);
  assert.match(text, /## 九星阵列/u);
  assert.match(text, /## 古典参考/u);
  assert.doesNotMatch(text, /当前实现|观测尺度|## 说明/u);
  assert.match(fullText, /## 九星阵列/u);
  assert.match(fullText, /## 古典参考/u);
  assert.doesNotMatch(fullText, /当前实现|观测尺度|## 说明/u);
});

test('taiyi should validate mode-specific hour and minute requirements', () => {
  assert.throws(
    () => calculateTaiyi({ mode: 'hour', date: '2026-04-10' }),
    /hour/u,
  );
  assert.throws(
    () => calculateTaiyi({ mode: 'minute', date: '2026-04-10', hour: 8 }),
    /minute/u,
  );
});

test('taiyi four pillars change year at 立春 like the month pillar and the year star', () => {
  // 2024-02-06 在立春之后、春节之前；2023-01-25 在春节之后、立春之前
  for (const [date, pillars, yearStar] of [
    ['2024-02-06', '甲辰 丙寅', 3],
    ['2023-01-25', '壬寅 癸丑', 5],
  ]) {
    for (const system of ['nine-star', 'traditional']) {
      const result = calculateTaiyi({ mode: 'year', date, hour: 12, system, timezone: 'Asia/Shanghai' });
      const json = toTaiyiJson(result);
      assert.ok(json.问卜与时空底盘.四柱.startsWith(`${pillars} `), `${system} ${date}: ${json.问卜与时空底盘.四柱}`);
      assert.match(toTaiyiText(result), new RegExp(`${pillars.replace(' ', '年 ')}月`, 'u'));
      if (system === 'nine-star') assert.equal(result.coreBoard.yearStar.index, yearStar);
    }
  }
});
