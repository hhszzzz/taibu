import test from 'node:test';
import assert from 'node:assert/strict';

import * as mcpCore from 'taibu-core';

// 每条规则都对照《增删卜易》《卜筮正宗》两书原文；两书分歧处在用例注释中说明取舍

async function cast(hexagramName, date, extra = {}) {
  return mcpCore.calculateLiuyao({
    question: '规则核对',
    yongShenTargets: ['妻财'],
    method: 'select',
    hexagramName,
    date,
    ...extra,
  });
}

function lineAt(result, position) {
  return result.fullYaos.find((yao) => yao.position === position);
}

test('liuyao reads 生旺墓绝 against the day branch with 土 following 水 (水土同宫)', async () => {
  // 《增删卜易·生旺墓绝章》「土水长生在申 旺在子墓在辰绝在巳」；《卜筮正宗·四生逐位论》同
  const stagesOf = (result) => Object.fromEntries(result.fullYaos.map((yao) => [yao.naJia, yao.changSheng?.stage ?? null]));

  // 2024-03-09 丁卯月 壬申日：坤为地 初未 二巳 三卯 四丑 五亥 上酉
  assert.deepEqual(stagesOf(await cast('坤为地', '2024-03-09T10:00:00')), {
    未: '长生', 巳: null, 卯: '绝', 丑: '长生', 亥: '长生', 酉: null,
  });
  // 2024-03-06 丁卯月 己巳日：土水绝于巳，金长生于巳；火临官、木病不在生旺墓绝之列，不输出
  assert.deepEqual(stagesOf(await cast('坤为地', '2024-03-06T10:00:00')), {
    未: '绝', 巳: null, 卯: null, 丑: '绝', 亥: '绝', 酉: '长生',
  });
  // 2024-03-05 丙寅月 戊辰日：土水同墓于辰
  const tomb = await cast('坤为地', '2024-03-05T10:00:00');
  assert.deepEqual(stagesOf(tomb), { 未: '墓', 巳: null, 卯: null, 丑: '墓', 亥: '墓', 酉: null });
  assert.match(mcpCore.toLiuyaoCanonicalText(tomb), /\| 日辰长生 \|/u);
  assert.equal(mcpCore.toLiuyaoCanonicalJson(tomb).六爻.find((line) => line.纳甲 === '未').长生, '墓');
});

test('liuyao names 进退神 before 化墓 and 回头克 before 墓绝', async () => {
  const relation = async (base, changed, position, date = '2024-03-12T10:00:00') => {
    const line = lineAt(await cast(base, date, { changedHexagramName: changed }), position);
    return { relation: line.changedYao.relation, description: line.changeAnalysis.description };
  };

  // 未化戌是进神（土墓在辰，不在戌）；《增删卜易》占例「丑土官动化进神」亦论进不论墓
  assert.equal((await relation('泽地萃', '天地否', 6)).relation, '化进');
  assert.equal((await relation('地泽临', '地天泰', 3)).relation, '化进');
  // 亥化辰、卯化申、午化亥：回头克为主，墓绝写入说明
  assert.deepEqual(await relation('地火明夷', '地雷复', 3), { relation: '回头克', description: '回头克：变爻回克本爻（兼化墓）' });
  assert.equal((await relation('坤为地', '地山谦', 3)).description.startsWith('回头克：变爻回克本爻（兼化绝）'), true);
  assert.deepEqual(await relation('地山谦', '地风升', 2), { relation: '回头克', description: '回头克：变爻回克本爻（兼化绝）' });
  // 土化亥不再误作化绝（土绝于巳）
  assert.equal((await relation('地雷复', '地火明夷', 3)).relation, '平');
});

test('liuyao resolves 金化丑 and 土化巳 by whether the moving line has 日月帮比', async () => {
  // 《卜筮正宗·绝处逢生论》「土化出巳有日月帮比不云化绝，乃云回头生也，如日月制土…则是化绝于爻也」；
  // 《增删卜易》觉子注：金墓于丑，「卦中土多生金，论生不论墓」
  const relation = async (base, changed, position, date) => lineAt(await cast(base, date, { changedHexagramName: changed }), position).changedYao.relation;

  // 2024-08-15 壬申月：酉金得月令为旺 → 回头生；辰土月令休 → 化绝
  assert.equal(await relation('火地晋', '坤为地', 4, '2024-08-15T10:00:00'), '回头生');
  assert.equal(await relation('地水师', '坤为地', 2, '2024-08-15T10:00:00'), '化绝');
  // 2024-06-12 庚午月：酉金月令死 → 化墓；辰土月令相 → 回头生
  assert.equal(await relation('火地晋', '坤为地', 4, '2024-06-12T10:00:00'), '化墓');
  assert.equal(await relation('地水师', '坤为地', 2, '2024-06-12T10:00:00'), '回头生');
});
