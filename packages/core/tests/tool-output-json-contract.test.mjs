import test from 'node:test';
import assert from 'node:assert/strict';

import { buildToolSuccessPayload, executeTool } from 'taibu-core/mcp';

function createBaziResult() {
  return {
    calculationOptions: { dayBoundary: 'midnight', timezone: 'Asia/Shanghai', solarTermBasis: 'instant', disambiguation: 'reject', ruleVersion: 'bazi-2026.10' },
    gender: 'male',
    birthPlace: '北京',
    dayMaster: '甲',
    kongWang: { xun: '甲子', kongZhi: ['戌', '亥'] },
    fourPillars: {
      year: { stem: '甲', branch: '子', tenGod: '比肩', hiddenStems: [], naYin: '海中金', diShi: '沐浴', shenSha: [], kongWang: { isKong: false } },
      month: { stem: '乙', branch: '丑', tenGod: '劫财', hiddenStems: [], naYin: '海中金', diShi: '冠带', shenSha: [], kongWang: { isKong: false } },
      day: { stem: '甲', branch: '寅', tenGod: '', hiddenStems: [], naYin: '大溪水', diShi: '临官', shenSha: [], kongWang: { isKong: false } },
      hour: { stem: '丙', branch: '子', tenGod: '食神', hiddenStems: [], naYin: '涧下水', diShi: '沐浴', shenSha: [], kongWang: { isKong: false } },
    },
    relations: [],
    tianGanWuHe: [],
    tianGanChongKe: [],
    diZhiBanHe: [],
    diZhiSanHui: [],
  };
}

test('json response should keep structuredContent aligned with published outputSchema', () => {
  const payload = buildToolSuccessPayload('bazi', createBaziResult());

  assert.equal(typeof payload.structuredContent, 'object');
  assert.equal(payload.structuredContent.基本信息.性别, '男');
  assert.equal(payload.structuredContent.基本信息.出生地, '北京');
  assert.equal(payload.structuredContent.四柱[0].柱, '年柱');
  assert.match(payload.content[0].text, /# 八字命盘/u);
  assert.doesNotMatch(payload.content[0].text, /"basicInfo"/u);
});

test('markdown response should still keep schema-aligned structuredContent', () => {
  const payload = buildToolSuccessPayload('bazi', createBaziResult());

  assert.equal(typeof payload.structuredContent, 'object');
  assert.equal(payload.structuredContent.基本信息.性别, '男');
  assert.equal(payload.structuredContent.四柱[0].柱, '年柱');
  assert.match(payload.content[0].text, /# 八字命盘/u);
  assert.doesNotMatch(payload.content[0].text, /"basicInfo"/u, 'markdown content should remain human-readable text');
});

test('runtime placeResolutionInfo should merge into ziwei structured output when declared in tool schema', async () => {
  const horoscopeRaw = await executeTool('ziwei_horoscope', {
    gender: 'male',
    birthYear: 2003,
    birthMonth: 9,
    birthDay: 2,
    birthHour: 10,
    birthMinute: 20,
    calendarType: 'solar',
  });
  const flyingStarRaw = await executeTool('ziwei_flying_star', {
    gender: 'male',
    birthYear: 2003,
    birthMonth: 9,
    birthDay: 2,
    birthHour: 10,
    birthMinute: 20,
    calendarType: 'solar',
    queries: [{ type: 'mutagedPlaces', palace: '命宫' }],
  });
  const placeResolutionInfo = {
    requestedPlace: '广东河源',
    resolved: true,
    provider: 'amap',
    usedLongitude: 114.700215,
    source: 'birth_place',
    locationMode: 'true_solar_time',
  };

  const horoscopePayload = buildToolSuccessPayload(
    'ziwei_horoscope',
    { ...horoscopeRaw, placeResolutionInfo },
  );
  const flyingStarPayload = buildToolSuccessPayload(
    'ziwei_flying_star',
    { ...flyingStarRaw, placeResolutionInfo },
  );

  assert.equal(horoscopePayload.structuredContent.placeResolutionInfo.usedLongitude, 114.700215);
  assert.equal(horoscopePayload.structuredContent.placeResolutionInfo.source, 'birth_place');
  assert.equal(flyingStarPayload.structuredContent.placeResolutionInfo.usedLongitude, 114.700215);
  assert.equal(flyingStarPayload.structuredContent.placeResolutionInfo.source, 'birth_place');
});

test('core astrology tool should allow default approximation without coordinates but keep full strict', async () => {
  const approximate = await executeTool('astrology', {
    birthYear: 1990,
    birthMonth: 1,
    birthDay: 1,
    birthHour: 12,
    birthPlace: 'New York, NY',
  });

  assert.equal(approximate.chartMeta.calculationMode, 'approximate');
  assert.equal(approximate.natal.origin.coordinateSource, 'assumed_zero');
  assert.equal(approximate.natal.angles.length, 0);
  assert.equal(approximate.natal.houses.length, 0);
  assert.throws(
    () => buildToolSuccessPayload('astrology', approximate, { detailLevel: 'full' }),
    /detailLevel=full.*latitude.*longitude/u,
  );

  await assert.rejects(
    () => executeTool('astrology', {
      birthYear: 1990,
      birthMonth: 1,
      birthDay: 1,
      birthHour: 12,
      detailLevel: 'full',
    }),
    /缺少必填参数 'latitude'.*缺少必填参数 'longitude'/u,
  );
});

test('tarot default/full should split slim card text from detailed numerology metadata', async () => {
  const rawResult = await executeTool('tarot', {
    spreadType: 'single',
    question: '今天如何',
    birthYear: 2003,
    birthMonth: 9,
    birthDay: 2,
    seed: 'tarot-detail',
  });

  const defaultPayload = buildToolSuccessPayload('tarot', rawResult, { detailLevel: 'default' });
  const fullPayload = buildToolSuccessPayload('tarot', rawResult, { detailLevel: 'full' });

  assert.match(defaultPayload.content[0].text, /## 牌阵展开/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /塔罗数秘术/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /出生日期/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /随机种子/u);
  assert.match(defaultPayload.content[0].text, /元素/u);
  assert.match(fullPayload.content[0].text, /求问者生命数字/u);
  assert.match(fullPayload.content[0].text, /出生日期/u);
  assert.match(fullPayload.content[0].text, /随机种子/u);
  assert.match(fullPayload.content[0].text, /元素 \| 星象/u);

  assert.equal(defaultPayload.structuredContent.问卜设定.出生日期, undefined);
  assert.equal(defaultPayload.structuredContent.问卜设定.随机种子, undefined);
  assert.equal(typeof defaultPayload.structuredContent.牌阵展开[0].元素, 'string');
  assert.equal(defaultPayload.structuredContent.求问者生命数字, undefined);
  assert.equal(typeof fullPayload.structuredContent.问卜设定.出生日期, 'string');
  assert.equal(typeof fullPayload.structuredContent.问卜设定.随机种子, 'string');
  assert.equal(typeof fullPayload.structuredContent.牌阵展开[0].元素, 'string');
  assert.equal(typeof fullPayload.structuredContent.求问者生命数字.人格牌.对应塔罗, 'string');
});

test('almanac default/full should keep default compact and full append complete calendrical details', async () => {
  const rawResult = await executeTool('almanac', {
    date: '2026-04-01',
    dayMaster: '戊',
  });

  const defaultPayload = buildToolSuccessPayload('almanac', rawResult, { detailLevel: 'default' });
  const fullPayload = buildToolSuccessPayload('almanac', rawResult, { detailLevel: 'full' });

  assert.match(defaultPayload.content[0].text, /# 每日黄历/u);
  assert.match(defaultPayload.content[0].text, /## 基础与个性化坐标/u);
  assert.match(defaultPayload.content[0].text, /## 择日宜忌/u);
  assert.match(defaultPayload.content[0].text, /吉神宜趋/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /## 方位信息/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /## 时辰吉凶/u);

  assert.match(fullPayload.content[0].text, /## 方位信息/u);
  assert.match(fullPayload.content[0].text, /## 值日信息/u);
  assert.match(fullPayload.content[0].text, /## 时辰吉凶/u);

  assert.equal(defaultPayload.structuredContent.方位信息, undefined);
  assert.equal(defaultPayload.structuredContent.值日信息, undefined);
  assert.equal(defaultPayload.structuredContent.时辰吉凶, undefined);
  assert.equal(typeof fullPayload.structuredContent.方位信息.财神, 'string');
  assert.equal(typeof fullPayload.structuredContent.值日信息.日柱纳音, 'string');
  assert.ok(Array.isArray(fullPayload.structuredContent.时辰吉凶));
});

test('taiyi default/full should keep compact guidance and expose full board only on demand', async () => {
  const rawResult = await executeTool('taiyi', {
    mode: 'minute',
    date: '2026-04-10',
    hour: 13,
    minute: 37,
    timezone: 'Asia/Shanghai',
  });

  const defaultPayload = buildToolSuccessPayload('taiyi', rawResult, { detailLevel: 'default' });
  const fullPayload = buildToolSuccessPayload('taiyi', rawResult, { detailLevel: 'full' });

  assert.match(defaultPayload.content[0].text, /# 太乙九星主证据/u);
  assert.match(defaultPayload.content[0].text, /## 九星阵列/u);
  assert.match(defaultPayload.content[0].text, /## 古典参考/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /当前实现|观测尺度|## 说明/u);
  assert.match(fullPayload.content[0].text, /## 九星阵列/u);
  assert.match(fullPayload.content[0].text, /## 古典参考/u);
  assert.doesNotMatch(fullPayload.content[0].text, /当前实现|观测尺度|## 说明/u);
  assert.ok(Array.isArray(defaultPayload.structuredContent.九星阵列));
  assert.equal(typeof defaultPayload.structuredContent.古典参考.主诀原文, 'string');
  assert.equal(defaultPayload.structuredContent.说明, undefined);
  assert.equal(defaultPayload.structuredContent.问卜与时空底盘.实现边界, undefined);
  assert.equal(defaultPayload.structuredContent.问卜与时空底盘.观测尺度, undefined);
  assert.ok(Array.isArray(fullPayload.structuredContent.九星阵列));
  assert.equal(typeof fullPayload.structuredContent.古典参考.主诀原文, 'string');
  assert.equal(fullPayload.structuredContent.说明, undefined);
});

test('astrology default/full should expose compact chart data while preserving place resolution runtime extras', async () => {
  const rawResult = await executeTool('astrology', {
    birthYear: 1990,
    birthMonth: 1,
    birthDay: 1,
    birthHour: 12,
    birthMinute: 30,
    latitude: 40.7128,
    longitude: -74.006,
    birthPlace: 'New York, NY',
    transitDateTime: '2026-04-10T09:30:00',
  });

  const withRuntimeInfo = {
    ...rawResult,
    placeResolutionInfo: {
      requestedPlace: 'New York, NY',
      resolved: true,
      provider: 'amap',
      usedLongitude: -74.006,
      usedLatitude: 40.7128,
      source: 'birth_place',
      locationMode: 'coordinates',
    },
  };

  const defaultPayload = buildToolSuccessPayload('astrology', withRuntimeInfo, { detailLevel: 'default' });
  const morePayload = buildToolSuccessPayload('astrology', withRuntimeInfo, { detailLevel: 'more' });
  const fullPayload = buildToolSuccessPayload('astrology', withRuntimeInfo, { detailLevel: 'full' });

  assert.match(defaultPayload.content[0].text, /# 西方占星主证据/u);
  assert.equal(defaultPayload.structuredContent.扩展信息, undefined);
  assert.equal(defaultPayload.structuredContent.placeResolutionInfo.usedLatitude, 40.7128);
  assert.ok(Array.isArray(morePayload.structuredContent.扩展信息.附加点与交点));
  assert.ok(Array.isArray(fullPayload.structuredContent.扩展信息.附加点与交点));
  assert.ok(Array.isArray(fullPayload.structuredContent.扩展信息.宫位宫头));
  assert.ok(Array.isArray(fullPayload.structuredContent.扩展信息.完整相位矩阵.本命));
});

test('meihua detailLevel full should reach transport renderers and expose full-only seasonal fields', async () => {
  const rawResult = await executeTool('meihua', {
    question: '这次合作能否谈成？',
    method: 'time',
    date: '2026-04-04T10:30:00',
  });

  const defaultPayload = buildToolSuccessPayload('meihua', rawResult, { detailLevel: 'default' });
  const fullPayload = buildToolSuccessPayload('meihua', rawResult, { detailLevel: 'full' });

  assert.doesNotMatch(defaultPayload.content[0].text, /体互月令/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /用互月令/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /变卦月令/u);
  assert.match(fullPayload.content[0].text, /体互月令/u);
  assert.match(fullPayload.content[0].text, /用互月令/u);
  assert.match(fullPayload.content[0].text, /变卦月令/u);

  assert.equal(defaultPayload.structuredContent.体用分析.月令环境.体互, undefined);
  assert.equal(defaultPayload.structuredContent.体用分析.月令环境.用互, undefined);
  assert.equal(defaultPayload.structuredContent.体用分析.月令环境.变卦, undefined);
  assert.equal(typeof fullPayload.structuredContent.体用分析.月令环境.体互, 'string');
  assert.equal(typeof fullPayload.structuredContent.体用分析.月令环境.用互, 'string');
  assert.equal(typeof fullPayload.structuredContent.体用分析.月令环境.变卦, 'string');
});

test('xiaoliuren detailLevel full should keep default compact and append explanation only on demand', async () => {
  const rawResult = await executeTool('xiaoliuren', {
    lunarMonth: 3,
    lunarDay: 15,
    hour: 8,
    question: '今日运势如何？',
  });

  const defaultPayload = buildToolSuccessPayload('xiaoliuren', rawResult, { detailLevel: 'default' });
  const fullPayload = buildToolSuccessPayload('xiaoliuren', rawResult, { detailLevel: 'full' });

  assert.match(defaultPayload.content[0].text, /# 小六壬主证据/u);
  assert.match(defaultPayload.content[0].text, /## 推演链/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /## 参考释义/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /## 诗诀/u);
  assert.match(fullPayload.content[0].text, /## 参考释义/u);
  assert.match(fullPayload.content[0].text, /## 诗诀/u);

  assert.equal(defaultPayload.structuredContent.结果.释义, undefined);
  assert.equal(defaultPayload.structuredContent.结果.诗诀, undefined);
  assert.equal(typeof fullPayload.structuredContent.结果.释义, 'string');
  assert.equal(typeof fullPayload.structuredContent.结果.诗诀, 'string');
});

test('bazi tool output should keep chart-only boundaries without implicit dayun summary', async () => {
  const rawResult = await executeTool('bazi', {
    gender: 'male',
    birthYear: 2003,
    birthMonth: 9,
    birthDay: 2,
    birthHour: 10,
    birthMinute: 20,
    calendarType: 'solar',
  });

  const payload = buildToolSuccessPayload('bazi', rawResult);

  assert.doesNotMatch(payload.content[0].text, /## 大运轨迹/u);
  assert.equal(typeof payload.structuredContent, 'object');
  assert.equal(payload.structuredContent.大运, undefined);
});

test('bazi detailLevel full should restore full metadata while default stays slim', async () => {
  const rawResult = await executeTool('bazi', {
    gender: 'male',
    birthYear: 2003,
    birthMonth: 9,
    birthDay: 2,
    birthHour: 10,
    birthMinute: 20,
    calendarType: 'solar',
  });

  const defaultPayload = buildToolSuccessPayload('bazi', rawResult, { detailLevel: 'default' });
  const fullPayload = buildToolSuccessPayload('bazi', rawResult, { detailLevel: 'full' });

  assert.doesNotMatch(defaultPayload.content[0].text, /命主五行/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /胎元/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /神煞/u);
  assert.match(fullPayload.content[0].text, /命主五行/u);
  assert.match(fullPayload.content[0].text, /胎元/u);
  assert.match(fullPayload.content[0].text, /神煞/u);

  assert.equal(defaultPayload.structuredContent.基本信息.命主五行, undefined);
  assert.equal(defaultPayload.structuredContent.基本信息.胎元, undefined);
  assert.equal(defaultPayload.structuredContent.四柱[0].纳音, undefined);
  assert.equal(defaultPayload.structuredContent.四柱[0].神煞, undefined);
  assert.equal(typeof fullPayload.structuredContent.基本信息.命主五行, 'string');
  assert.equal(typeof fullPayload.structuredContent.基本信息.胎元, 'string');
  assert.ok(Array.isArray(fullPayload.structuredContent.四柱[0].神煞));
});

test('bazi_dayun should expose slim default output and detailed full output', async () => {
  const rawResult = await executeTool('bazi_dayun', {
    gender: 'male',
    birthYear: 2003,
    birthMonth: 9,
    birthDay: 2,
    birthHour: 10,
    birthMinute: 20,
    calendarType: 'solar',
  });

  const defaultPayload = buildToolSuccessPayload('bazi_dayun', rawResult, { detailLevel: 'default' });
  const fullPayload = buildToolSuccessPayload('bazi_dayun', rawResult, { detailLevel: 'full' });

  assert.doesNotMatch(defaultPayload.content[0].text, /## 小运/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /### 2012-2021/u);
  assert.match(fullPayload.content[0].text, /## 小运/u);
  assert.match(fullPayload.content[0].text, /### 2012-2021/u);
  assert.match(fullPayload.content[0].text, /\| 流年 \| 年龄 \| 干支 \|/u);

  assert.equal(defaultPayload.structuredContent.小运, undefined);
  assert.equal(defaultPayload.structuredContent.大运列表[0].流年列表, undefined);
  assert.equal(defaultPayload.structuredContent.大运列表[0].原局关系, undefined);
  assert.ok(Array.isArray(fullPayload.structuredContent.小运));
  assert.ok(Array.isArray(fullPayload.structuredContent.大运列表[0].流年列表));
  assert.ok(fullPayload.structuredContent.大运列表.some((item) => Array.isArray(item.原局关系) && item.原局关系.length > 0));
});

test('ziwei should expose compact default output and preserve full detail on demand', async () => {
  const rawResult = await executeTool('ziwei', {
    gender: 'male',
    birthYear: 2003,
    birthMonth: 9,
    birthDay: 2,
    birthHour: 10,
    birthMinute: 20,
    calendarType: 'solar',
  });

  const defaultPayload = buildToolSuccessPayload('ziwei', rawResult, { detailLevel: 'default' });
  const fullPayload = buildToolSuccessPayload('ziwei', rawResult, { detailLevel: 'full' });

  assert.match(defaultPayload.content[0].text, /## 十二宫位全盘/u);
  assert.match(defaultPayload.content[0].text, /生年四化/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /子年斗君/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /命主星/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /身主星/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /\| 流年 \| 小限 \|/u);

  assert.match(fullPayload.content[0].text, /## 十二宫位/u);
  assert.match(fullPayload.content[0].text, /斗君/u);
  assert.match(fullPayload.content[0].text, /命主星/u);
  assert.match(fullPayload.content[0].text, /身主星/u);
  assert.match(fullPayload.content[0].text, /\| 宫位 \| 干支 \| 大限 \| 主星及四化 \| 辅星 \| 杂曜 \| 神煞 \| 流年 \| 小限 \|/u);

  assert.equal(typeof defaultPayload.structuredContent.基本信息.生年四化?.天干, 'string');
  assert.equal(defaultPayload.structuredContent.基本信息.斗君, undefined);
  assert.equal(defaultPayload.structuredContent.基本信息.命主星, undefined);
  assert.equal(defaultPayload.structuredContent.基本信息.身主星, undefined);
  assert.equal(defaultPayload.structuredContent.小限, undefined);
  assert.equal(defaultPayload.structuredContent.十二宫位[0].杂曜, undefined);
  assert.equal(defaultPayload.structuredContent.十二宫位[0].神煞, undefined);
  assert.equal(defaultPayload.structuredContent.十二宫位[0].小限虚岁, undefined);
  assert.equal(defaultPayload.structuredContent.十二宫位[0].流年虚岁, undefined);

  assert.equal(typeof fullPayload.structuredContent.基本信息.斗君, 'string');
  assert.equal(typeof fullPayload.structuredContent.基本信息.命主星, 'string');
  assert.equal(typeof fullPayload.structuredContent.基本信息.身主星, 'string');
  assert.ok(Array.isArray(fullPayload.structuredContent.小限));
  assert.ok(Array.isArray(fullPayload.structuredContent.十二宫位[0].杂曜));
  assert.ok(Array.isArray(fullPayload.structuredContent.十二宫位[0].神煞));
  assert.ok(Array.isArray(fullPayload.structuredContent.十二宫位[0].小限虚岁));
  assert.ok(Array.isArray(fullPayload.structuredContent.十二宫位[0].流年虚岁));
});

test('ziwei should expose compact default output and keep full board behind detailLevel full', async () => {
  const rawResult = await executeTool('ziwei', {
    gender: 'male',
    birthYear: 2003,
    birthMonth: 9,
    birthDay: 2,
    birthHour: 10,
    birthMinute: 20,
    calendarType: 'solar',
  });

  const defaultPayload = buildToolSuccessPayload('ziwei', rawResult, { detailLevel: 'default' });
  const fullPayload = buildToolSuccessPayload('ziwei', rawResult, { detailLevel: 'full' });

  assert.match(defaultPayload.content[0].text, /生年四化/u);
  assert.match(defaultPayload.content[0].text, /主星及四化/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /子年斗君/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /命主星/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /身主星/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /杂曜/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /神煞/u);
  assert.doesNotMatch(defaultPayload.content[0].text, /\| 流年 \| 小限 \|/u);

  assert.match(fullPayload.content[0].text, /斗君/u);
  assert.match(fullPayload.content[0].text, /命主星/u);
  assert.match(fullPayload.content[0].text, /身主星/u);
  assert.match(fullPayload.content[0].text, /杂曜/u);
  assert.match(fullPayload.content[0].text, /神煞/u);

  assert.equal(typeof defaultPayload.structuredContent.基本信息.生年四化?.天干, 'string');
  assert.equal(defaultPayload.structuredContent.基本信息.斗君, undefined);
  assert.equal(defaultPayload.structuredContent.基本信息.命主星, undefined);
  assert.equal(defaultPayload.structuredContent.基本信息.身主星, undefined);
  assert.equal(defaultPayload.structuredContent.基本信息.真太阳时, undefined);
  assert.equal(defaultPayload.structuredContent.小限, undefined);
  assert.equal(defaultPayload.structuredContent.十二宫位[0].杂曜, undefined);
  assert.equal(defaultPayload.structuredContent.十二宫位[0].神煞, undefined);
  assert.equal(defaultPayload.structuredContent.十二宫位[0].小限虚岁, undefined);
  assert.equal(defaultPayload.structuredContent.十二宫位[0].流年虚岁, undefined);

  assert.equal(typeof fullPayload.structuredContent.基本信息.斗君, 'string');
  assert.equal(typeof fullPayload.structuredContent.基本信息.命主星, 'string');
  assert.equal(typeof fullPayload.structuredContent.基本信息.身主星, 'string');
  assert.ok(Array.isArray(fullPayload.structuredContent.小限));
  assert.ok(Array.isArray(fullPayload.structuredContent.十二宫位[0].杂曜));
  assert.ok(Array.isArray(fullPayload.structuredContent.十二宫位[0].神煞));
  assert.ok(Array.isArray(fullPayload.structuredContent.十二宫位[0].小限虚岁));
  assert.ok(Array.isArray(fullPayload.structuredContent.十二宫位[0].流年虚岁));
});
