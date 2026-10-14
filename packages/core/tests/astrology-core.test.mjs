import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateAstrology, toAstrologyJson, toAstrologyText } from 'taibu-core';

const ASPECT_TARGETS = {
  conjunction: 0,
  opposition: 180,
  trine: 120,
  square: 90,
  sextile: 60,
};

const sampleInput = {
  birthYear: 1990,
  birthMonth: 1,
  birthDay: 1,
  birthHour: 12,
  birthMinute: 30,
  latitude: 40.7128,
  longitude: -74.006,
  birthPlace: 'New York, NY',
  transitDateTime: '2026-04-10T09:30:00',
};

test('astrology should produce natal chart, transit chart, houses, and aspects', () => {
  const result = calculateAstrology(sampleInput);

  assert.equal(result.chartMeta.zodiac, 'tropical');
  assert.equal(result.chartMeta.houseSystem, 'placidus');
  assert.equal(result.natal.bodies.length, 10);
  assert.equal(result.natal.points.length, 3);
  assert.equal(result.natal.angles.length, 2);
  assert.equal(result.natal.houses.length, 12);
  assert.equal(result.natal.zodiacCusps.length, 12);
  assert.equal(result.natal.origin.birthPlace, 'New York, NY');
  assert.ok(result.majorAspects.length > 0);
  assert.ok(result.transitToNatalAspects.length > 0);
  const supported = new Set([...result.natal.bodies, ...result.natal.points, ...result.natal.angles].map((item) => item.key));
  const extraAspectKeys = [...new Set(result.majorAspects.flatMap((item) => [item.from.key, item.to.key]).filter((key) => !supported.has(key)))];
  assert.deepEqual(extraAspectKeys, []);

  const natalPositionByKey = new Map([...result.natal.bodies, ...result.natal.points, ...result.natal.angles].map((item) => [item.key, item.position.decimal]));
  let foundBelowTargetCase = false;
  for (const aspect of result.majorAspects) {
    const left = natalPositionByKey.get(aspect.from.key);
    const right = natalPositionByKey.get(aspect.to.key);
    assert.equal(typeof left, 'number');
    assert.equal(typeof right, 'number');
    const diffRaw = Math.abs(left - right);
    const expected = Number((diffRaw > 180 ? 360 - diffRaw : diffRaw).toFixed(4));
    assert.equal(aspect.actualAngle, expected, `${aspect.from.key}-${aspect.to.key} actualAngle should match true angular distance`);
    if (expected < ASPECT_TARGETS[aspect.type]) {
      foundBelowTargetCase = true;
    }
  }
  assert.equal(foundBelowTargetCase, true);
});

test('astrology natal aspects leave out the fixed north–south node opposition', () => {
  for (const birthYear of [1950, 1975, 1990, 2010]) {
    const result = calculateAstrology({ ...sampleInput, birthYear });
    const isNodePair = (aspect) => [aspect.from.key, aspect.to.key].sort().join() === 'northnode,southnode';
    assert.equal(result.majorAspects.some(isNodePair), false, String(birthYear));
    assert.ok(result.majorAspects.some((aspect) => aspect.from.category === 'point' || aspect.to.category === 'point'), `${birthYear} keeps other point aspects`);
    assert.doesNotMatch(toAstrologyText(result, { detailLevel: 'full' }), /北交点 对冲 南交点/u);
  }
});

test('astrology renderers should keep full-only extensions opt-in', () => {
  const result = calculateAstrology(sampleInput);

  const json = toAstrologyJson(result);
  const moreJson = toAstrologyJson(result, { detailLevel: 'more' });
  const fullJson = toAstrologyJson(result, { detailLevel: 'full' });
  const text = toAstrologyText(result);
  const moreText = toAstrologyText(result, { detailLevel: 'more' });
  const fullText = toAstrologyText(result, { detailLevel: 'full' });

  assert.equal(typeof json.基础坐标.本命时刻, 'string');
  assert.equal(json.扩展信息, undefined);
  assert.ok(Array.isArray(moreJson.扩展信息?.附加点与交点));
  assert.ok(Array.isArray(moreJson.扩展信息?.宫位宫头));
  assert.ok(Array.isArray(fullJson.扩展信息?.附加点与交点));
  assert.ok(Array.isArray(fullJson.扩展信息?.宫位宫头));
  assert.ok(Array.isArray(fullJson.扩展信息?.完整相位矩阵?.本命));
  assert.equal(typeof json.命盘锚点.太阳.星座, 'string');
  assert.equal(typeof json.命盘锚点.月亮.黄经, 'string');
  assert.equal(typeof json.命盘锚点.上升?.星座, 'string');
  assert.equal(typeof json.命盘锚点.天顶?.黄经, 'string');
  assert.match(text, /# 西方占星主证据/u);
  assert.doesNotMatch(text, /## 附加点与交点/u);
  assert.doesNotMatch(text, /莉莉丝|北交点|南交点/u);
  assert.match(moreText, /## 附加点与交点/u);
  assert.doesNotMatch(moreText, /## 完整相位矩阵/u);
  assert.match(fullText, /## 完整相位矩阵/u);
  assert.match(fullText, /## 黄道分界/u);
});

test('astrology keeps explicit timezone provenance when coordinates are omitted', () => {
  const input = {
    birthYear: sampleInput.birthYear,
    birthMonth: sampleInput.birthMonth,
    birthDay: sampleInput.birthDay,
    birthHour: sampleInput.birthHour,
    birthMinute: sampleInput.birthMinute,
    birthPlace: sampleInput.birthPlace,
    transitDateTime: sampleInput.transitDateTime,
  };
  const provided = calculateAstrology({ ...input, timezone: 'Asia/Shanghai' });
  assert.equal(provided.chartMeta.calculationMode, 'approximate');
  assert.equal(provided.natal.origin.timezoneSource, 'provided');
  assert.equal(provided.natal.origin.utcDateTime, '1990-01-01T04:30:00.000Z');
  assert.equal(provided.natal.houses.length, 0);
  assert.equal(toAstrologyJson(provided).基础坐标.本命时区, 'Asia/Shanghai');
  assert.match(toAstrologyText(provided), /本命时区: Asia\/Shanghai/);
  const assumed = calculateAstrology(input);
  assert.equal(assumed.natal.origin.timezoneSource, 'default');
  assert.match(toAstrologyJson(assumed).基础坐标.本命时区, /未提供/);
  const derived = calculateAstrology(sampleInput);
  assert.equal(derived.natal.origin.timezoneSource, 'coordinates');
  const legacy = structuredClone(provided);
  delete legacy.natal.origin.timezoneSource;
  assert.equal(toAstrologyJson(legacy).基础坐标.本命时区, 'Asia/Shanghai');
});

test('astrology should degrade to an approximate chart when coordinates are omitted in default/more mode', () => {
  const result = calculateAstrology({
    birthYear: 1990,
    birthMonth: 1,
    birthDay: 1,
    birthHour: 12,
    birthMinute: 30,
    birthPlace: 'New York, NY',
    transitDateTime: '2026-04-10T09:30:00',
  });

  assert.equal(result.chartMeta.calculationMode, 'approximate');
  assert.match(result.chartMeta.calculationNote ?? '', /0°N, 0°E/u);
  assert.equal(result.natal.origin.coordinateSource, 'assumed_zero');
  assert.equal(result.natal.angles.length, 0);
  assert.equal(result.natal.houses.length, 0);
  assert.ok(result.majorAspects.every((item) => item.from.category !== 'angle' && item.to.category !== 'angle'));

  const defaultJson = toAstrologyJson(result);
  const moreJson = toAstrologyJson(result, { detailLevel: 'more' });
  const defaultText = toAstrologyText(result);
  const moreText = toAstrologyText(result, { detailLevel: 'more' });

  assert.equal(defaultJson.基础坐标.计算模式, '近似盘');
  assert.match(defaultJson.基础坐标.说明 ?? '', /Etc\/GMT/u);
  assert.equal(defaultJson.命盘锚点.上升, undefined);
  assert.equal(defaultJson.命盘锚点.天顶, undefined);
  assert.equal(defaultJson.命盘锚点.上升说明, '未计算（需经纬度）');
  assert.equal(defaultJson.命盘锚点.天顶说明, '未计算（需经纬度）');
  assert.equal(defaultJson.扩展信息, undefined);
  assert.ok(Array.isArray(moreJson.扩展信息?.附加点与交点));
  assert.equal(moreJson.扩展信息?.宫位宫头, undefined);
  assert.match(defaultText, /近似盘/u);
  assert.doesNotMatch(defaultText, /第\d+宫/u);
  assert.doesNotMatch(defaultText, /## 附加点与交点/u);
  assert.match(moreText, /## 附加点与交点/u);
  assert.doesNotMatch(moreText, /## 宫位宫头/u);
  assert.throws(
    () => toAstrologyJson(result, { detailLevel: 'full' }),
    /detailLevel=full.*latitude.*longitude/u,
  );
  assert.throws(
    () => toAstrologyText(result, { detailLevel: 'full' }),
    /detailLevel=full.*latitude.*longitude/u,
  );
});

test('astrology should reject unsupported house systems and invalid coordinates', () => {
  assert.throws(
    () => calculateAstrology({ ...sampleInput, houseSystem: 'unknown' }),
    /houseSystem/u,
  );
  assert.throws(
    () => calculateAstrology({ ...sampleInput, latitude: 200 }),
    /latitude/u,
  );
  assert.throws(
    () => calculateAstrology({ ...sampleInput, birthMonth: 2, birthDay: 31 }),
    /birth.*日期无效/u,
  );
  assert.throws(
    () => calculateAstrology({ ...sampleInput, longitude: undefined }),
    /latitude 和 longitude 需要同时提供/u,
  );
  assert.throws(
    () => calculateAstrology({ ...sampleInput, transitDateTime: '2026-02-31T10:00:00' }),
    /transitDateTime.*日期无效/u,
  );
  assert.throws(
    () => calculateAstrology({ ...sampleInput, transitDateTime: '2026-02-31T10:00:00Z' }),
    /transitDateTime.*日期无效/u,
  );
  assert.throws(
    () => calculateAstrology({ ...sampleInput, transitDateTime: '2026-02-31T10:00:00+08:00' }),
    /transitDateTime.*日期无效/u,
  );
  assert.doesNotThrow(
    () => calculateAstrology({ ...sampleInput, transitDateTime: '2026-04-10T09:30:00Z' }),
  );
});
