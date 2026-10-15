import test from 'node:test';
import assert from 'node:assert/strict';

import { buildXiaoliurenCountStages } from '../components/xiaoliuren/xiaoliuren-count';
import { calculateXiaoliurenBundle } from '../lib/divination/xiaoliuren';

test('xiaoliuren count stages expand the engine chain finger by finger', () => {
  const bundle = calculateXiaoliurenBundle({ date: '2026-10-10T21:30', question: '今晚出门找东西能找到吗' });
  const info = bundle.canonicalJson.起课信息;
  const chain = bundle.canonicalJson.推演链;
  const stages = buildXiaoliurenCountStages({
    lunarMonth: info.农历月,
    lunarDay: info.农历日,
    hour: info.时辰序号,
    monthStatus: chain.月上起,
    dayStatus: chain.日上落,
    hourStatus: chain.时上落,
  });

  assert.ok(stages);
  // 九月初一亥时：大安起数九月落速喜，速喜起数初一仍落速喜，速喜起数亥时（第 12）落留连
  assert.deepEqual(stages.map((stage) => [stage.start, stage.count, stage.landing]), [
    ['大安', 9, '速喜'],
    ['速喜', 1, '速喜'],
    ['速喜', 12, '留连'],
  ]);
  assert.deepEqual(stages[0].chips, ['大安', '留连', '速喜', '赤口', '小吉', '空亡', '大安', '留连', '速喜']);
  for (const stage of stages) {
    assert.equal(stage.chips.length, stage.count);
    assert.equal(stage.chips[stage.chips.length - 1], stage.landing);
  }
  assert.equal(stages[2].landing, chain.时上落);
});

test('xiaoliuren count stages pad the steps when the engine lands past the nominal count', () => {
  // 闰月递进：名义第六月从大安数应落空亡，引擎按七月落大安，明细补足一步而不改落宫
  const stages = buildXiaoliurenCountStages({ lunarMonth: 6, lunarDay: 1, hour: 1, monthStatus: '大安', dayStatus: '大安', hourStatus: '大安' });

  assert.ok(stages);
  assert.equal(stages[0].nominal, 6);
  assert.equal(stages[0].count, 7);
  assert.equal(stages[0].chips[6], '大安');
  assert.deepEqual(stages.slice(1).map((stage) => stage.count), [1, 1]);
});

test('xiaoliuren count stages reject unknown palaces and out-of-range numbers', () => {
  const valid = { lunarMonth: 9, lunarDay: 1, hour: 12, monthStatus: '速喜', dayStatus: '速喜', hourStatus: '留连' };

  assert.ok(buildXiaoliurenCountStages(valid));
  assert.equal(buildXiaoliurenCountStages({ ...valid, hourStatus: '未知' }), null);
  assert.equal(buildXiaoliurenCountStages({ ...valid, lunarMonth: 13 }), null);
  assert.equal(buildXiaoliurenCountStages({ ...valid, lunarDay: 0 }), null);
  assert.equal(buildXiaoliurenCountStages({ ...valid, hour: 1.5 }), null);
});
