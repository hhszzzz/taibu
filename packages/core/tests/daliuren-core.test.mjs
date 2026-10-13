import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateDaliuren, toDaliurenJson, toDaliurenText } from 'taibu-core';
import { resolveSingleKeMisclassifiedAsMaoXing } from '../dist/domains/daliuren/supplements.js';

test('daliuren basic output should have correct structure and field types', () => {
  const result = calculateDaliuren({
    date: '2026-04-10',
    hour: 14,
    minute: 30,
    question: '测试',
});

  // dateInfo
  assert.ok(result.dateInfo, 'dateInfo should exist');
  assert.equal(typeof result.dateInfo.solarDate, 'string');
  assert.ok(result.dateInfo.solarDate.length > 0, 'solarDate should be non-empty');
  assert.equal(typeof result.dateInfo.bazi, 'string');
  assert.ok(result.dateInfo.bazi.length > 0, 'bazi should be non-empty');
  assert.equal(typeof result.dateInfo.yueJiang, 'string');
assert.ok(result.dateInfo.yueJiang.length > 0, 'yueJiang should be non-empty');
  assert.ok(Array.isArray(result.dateInfo.kongWang), 'kongWang should be an array');
  assert.equal(result.dateInfo.kongWang.length, 2, 'kongWang should have 2 elements');
  assert.equal(typeof result.dateInfo.yiMa, 'string');
  assert.ok(result.dateInfo.yiMa.length > 0, 'yiMa should be non-empty');

  // siKe
  assert.ok(result.siKe, 'siKe should exist');
assert.ok(Array.isArray(result.siKe.yiKe), 'yiKe should be an array');
assert.ok(result.siKe.yiKe.length > 0, 'yiKe should be non-empty');
  assert.ok(Array.isArray(result.siKe.erKe), 'erKe should be an array');
  assert.ok(result.siKe.erKe.length > 0, 'erKe should be non-empty');
  assert.ok(Array.isArray(result.siKe.sanKe), 'sanKe should be an array');
  assert.ok(result.siKe.sanKe.length > 0, 'sanKe should be non-empty');
  assert.ok(Array.isArray(result.siKe.siKe), 'siKe should be an array');
  assert.ok(result.siKe.siKe.length > 0, 'siKe should be non-empty');

  // sanChuan
  assert.ok(result.sanChuan, 'sanChuan should exist');
  assert.ok(Array.isArray(result.sanChuan.chu), 'chu should be an array');
  assert.ok(result.sanChuan.chu.length > 0, 'chu should be non-empty');
  assert.ok(Array.isArray(result.sanChuan.zhong), 'zhong should be an array');
  assert.ok(result.sanChuan.zhong.length > 0, 'zhong should be non-empty');
  assert.ok(Array.isArray(result.sanChuan.mo), 'mo should be an array');
assert.ok(result.sanChuan.mo.length > 0, 'mo should be non-empty');

  // gongInfos
  assert.ok(Array.isArray(result.gongInfos), 'gongInfos should be an array');
  assert.equal(result.gongInfos.length, 12, 'gongInfos should have 12 elements');

  for (const gong of result.gongInfos) {
    assert.equal(typeof gong.diZhi, 'string');
    assert.ok(gong.diZhi.length > 0, 'diZhi should be non-empty');
    assert.equal(typeof gong.tianZhi, 'string');
    assert.ok(gong.tianZhi.length > 0, 'tianZhi should be non-empty');
    assert.equal(typeof gong.tianJiang, 'string');
    assert.equal(typeof gong.changSheng, 'string');
assert.equal(typeof gong.wangShuai, 'string');
  }
});

test('daliuren keTi should have method and subTypes', () => {
  const result = calculateDaliuren({
    date: '2026-04-10',
    hour: 14,
    minute: 30,
    question: '测试',
  });

  assert.ok(result.keTi, 'keTi should exist');
  assert.equal(typeof result.keTi.method, 'string');
  assert.ok(result.keTi.method.length > 0, 'keTi.method should be non-empty');
  assert.ok(Array.isArray(result.keTi.subTypes), 'keTi.subTypes should be an array');
});

test('daliuren JSON rendering should return non-empty output', () => {
  const result = calculateDaliuren({
    date: '2026-04-10',
    hour: 14,
    minute: 30,
    question: '测试',
  });

  const json = toDaliurenJson(result);
  assert.ok(json, 'toDaliurenJson should return a non-empty result');
  assert.ok(typeof json === 'object', 'toDaliurenJson should return an object');
  assert.ok(Object.keys(json).length > 0, 'toDaliurenJson output should have keys');
});

test('daliuren text rendering should return non-empty string', () => {
  const result = calculateDaliuren({
    date: '2026-04-10',
    hour: 14,
    minute: 30,
    question: '测试',
  });

  const text = toDaliurenText(result);
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0, 'toDaliurenText should return a non-empty string');
});

test('daliuren should keep the 戊辰日丁巳时 screenshot case as 重审', () => {
  const result = calculateDaliuren({
    date: '2026-06-23',
    hour: 10,
    minute: 0,
    timezone: 'Asia/Shanghai',
  });

  assert.equal(result.dateInfo.bazi, '丙午 甲午 戊辰 丁巳');
  assert.equal(result.sanChuan.method, '重审');
  assert.deepEqual(
    [result.sanChuan.chu[0], result.sanChuan.zhong[0], result.sanChuan.mo[0]],
    ['申', '戌', '子'],
  );
});

test('daliuren should correct an昴星 fallback when one four-lesson ke is present', () => {
  const correction = resolveSingleKeMisclassifiedAsMaoXing('昴星', {
    ganYang: '未',
    ganYing: '酉',
    zhiYang: '午',
    zhiYing: '申',
    gan: '戊',
    zhi: '辰',
  });

  assert.deepEqual(correction, { method: '重审', chu: '申' });
  assert.equal(
    resolveSingleKeMisclassifiedAsMaoXing('昴星', {
      ganYang: '未',
      ganYing: '酉',
      zhiYang: '午',
      zhiYing: '午',
      gan: '戊',
      zhi: '辰',
    }),
    null,
  );
});

test('daliuren names 铸印, 亨通, 蒿矢 and 弹射 as the 六壬大全 examples do', () => {
  const lesson = (date, hour, monthGeneral) => {
    const result = calculateDaliuren({ date, hour, minute: 0, monthGeneral });
    return {
      day: result.dateInfo.ganZhi.day,
      sanChuan: result.sanChuan.chu[0] + result.sanChuan.zhong[0] + result.sanChuan.mo[0],
      subTypes: result.keTi.subTypes,
      extraTypes: result.keTi.extraTypes,
    };
  };

  // 卷八铸印课：「丙子日未时子将，巳加子用，传遇天魁…为铸印课」「三传巳戌卯，巳为炉，戌为印，卯为印模」
  const zhuYin = lesson('2024-01-13', 14, '子');
  assert.equal(zhuYin.day, '丙子');
  assert.equal(zhuYin.sanChuan, '巳戌卯');
  assert.deepEqual(zhuYin.extraTypes, ['铸印']);
  // 卷八：「四月壬子日申将卯时占…三传巳戌卯…又巳戌卯为铸印」
  assert.deepEqual(lesson('2024-02-18', 6, '申').extraTypes, ['铸印']);

  // 卷八亨通课：「丙戌日申时亥将…初传申生中亥，亥生末传寅，寅生日干丙火，为亨通课」
  const hengTong = lesson('2024-01-23', 16, '亥');
  assert.equal(hengTong.day, '丙戌');
  assert.equal(hengTong.sanChuan, '申亥寅');
  assert.deepEqual(hengTong.extraTypes, ['亨通']);
  // 「癸丑日三传酉丑巳，末生中、中生初、初生日干也，为递生」
  const backward = lesson('2024-02-19', 1, '巳');
  assert.equal(backward.sanChuan, '酉丑巳');
  assert.ok(backward.extraTypes.includes('亨通'));

  // 卷七遥克课：「壬辰日巳时申将占…以辰上阴神戌土克日干壬水为用，曰蒿矢格」
  const haoShi = lesson('2024-01-29', 10, '申');
  assert.equal(haoShi.day, '壬辰');
  assert.equal(haoShi.sanChuan, '戌丑辰');
  assert.deepEqual(haoShi.subTypes, ['蒿矢']);
  // 卷十一：「丙子日弹射，申元加子用」
  const tanShe = lesson('2024-01-13', 0, '申');
  assert.equal(tanShe.sanChuan[0], '申');
  assert.deepEqual(tanShe.subTypes, ['弹射']);
});
