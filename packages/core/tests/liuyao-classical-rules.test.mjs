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
  // 《增删卜易·生旺墓绝章》「土水长生在申 旺在子墓在辰绝在巳」；《卜筮正宗·四生逐位论》同。
  // 只输出实际作用的生旺墓绝：觉子注长生须本爻有根，月将章「月将当权，其能衰绝」
  const stagesOf = (result) => Object.fromEntries(result.fullYaos.map((yao) => [yao.naJia, yao.changSheng?.stage ?? null]));

  // 2024-03-09 丁卯月 壬申日：坤为地 初未 二巳 三卯 四丑 五亥 上酉
  // 亥水得申金生而长生；未丑土虽长生于申，卯月土死无根，不论生；卯木临月建，逢绝不绝
  const shenDay = await cast('坤为地', '2024-03-09T10:00:00');
  assert.deepEqual(stagesOf(shenDay), { 未: null, 巳: null, 卯: null, 丑: null, 亥: '长生', 酉: null });
  assert.ok(lineAt(shenDay, 1).strength.evidence.includes('日辰长生而本爻无根，不论生'));
  assert.ok(lineAt(shenDay, 3).strength.evidence.includes('月令当权，逢绝不绝'));
  // 2024-03-06 丁卯月 己巳日：土水绝于巳；酉金卯月月破又无生扶，巳火克金「论克不论生」；火临官、木病不在生旺墓绝之列
  const siDay = await cast('坤为地', '2024-03-06T10:00:00');
  assert.deepEqual(stagesOf(siDay), { 未: '绝', 巳: null, 卯: null, 丑: '绝', 亥: '绝', 酉: null });
  assert.deepEqual(lineAt(siDay, 6).strength.evidence, [
    '月令囚', '月破（静而无日辰动爻生助，为真破）', '日克', '日辰长生而本爻无根，不论生',
  ]);
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

  // 2024-08-15 壬申月 辛亥日：酉金得月令为旺 → 回头生；辰土月令休、亥日耗之，无帮比 → 化绝
  assert.equal(await relation('火地晋', '坤为地', 4, '2024-08-15T10:00:00'), '回头生');
  assert.equal(await relation('地水师', '坤为地', 2, '2024-08-15T10:00:00'), '化绝');
  // 2024-06-12 庚午月 丁未日：辰土月令相 → 回头生；酉金月克而未日生之，有日帮 → 回头生
  assert.equal(await relation('地水师', '坤为地', 2, '2024-06-12T10:00:00'), '回头生');
  assert.equal(await relation('火地晋', '坤为地', 4, '2024-06-12T10:00:00'), '回头生');
  // 2024-06-17 庚午月 壬子日：酉金月克、子日泄之，日月皆无帮比 → 化墓
  assert.equal(await relation('火地晋', '坤为地', 4, '2024-06-17T10:00:00'), '化墓');
});

test('liuyao counts 月破 on moving lines and lets a line on the day branch resist it', async () => {
  // 《增删卜易·月破章》「动则能伤于爻…目下虽破，出月则不破」；《卜筮正宗》「月破之爻发动旺相…不过在月内不能为吉凶」
  // 2024-03-01 丙寅月 甲子日：乾为天九五申金动，被寅月冲破
  const moving = lineAt(await cast('乾为天', '2024-03-01T10:00:00', { changedHexagramName: '火天大有' }), 5);
  assert.equal(moving.movementState, 'changing');
  assert.equal(moving.movementLabel, '明动·月破');
  assert.equal(moving.strength.specialStatus, 'yuePo');
  assert.equal(moving.strength.level, 'weak');
  assert.ok(moving.strength.evidence.includes('月破（动而不为真破，出月、逢合、实破之日可用）'));

  // 《日辰章》「酉月卯日占卦，爻临卯木谓之逢破不破，假使爻中有动出申酉之金…破亦为破」
  // 2024-03-10 丁卯月 癸酉日：坤为地上六酉金临日建
  const resisted = lineAt(await cast('坤为地', '2024-03-10T10:00:00'), 6);
  assert.equal(resisted.strength.specialStatus, 'none');
  assert.equal(resisted.movementState, 'static');
  assert.equal(resisted.strength.level, 'strong');
  assert.deepEqual(resisted.strength.evidence, ['月令囚', '临日建，逢月破而不破']);
  // 六二巳火发动克酉，寡不敌众
  const overwhelmed = await cast('坤为地', '2024-03-10T10:00:00', { changedHexagramName: '地水师' });
  const broken = lineAt(overwhelmed, 6);
  assert.equal(broken.strength.specialStatus, 'yuePo');
  assert.equal(broken.movementLabel, '月破');
  assert.ok(broken.strength.evidence.includes('临日建而受克，破亦为破'));
  assert.equal(mcpCore.toLiuyaoCanonicalJson(overwhelmed).六爻.find((line) => line.纳甲 === '酉').动静, '月破');
});

test('liuyao settles 日月相敌 by other moving lines instead of points', async () => {
  // 《月将章》「午月克之，未日生之，可以相敌」「月克日生遇帮而愈旺，月生日克逢他削而亦衰」
  // 2024-03-01 丙寅月 甲子日：午火月生而子日冲克，旺相静爻逢冲为暗动
  const plain = lineAt(await cast('乾为天', '2024-03-01T10:00:00'), 4);
  assert.equal(plain.movementState, 'hidden_moving');
  assert.equal(plain.strength.level, 'moderate');
  assert.equal(plain.strength.evidence.at(-1), '日月相敌');
  // 九二寅木发动生午 → 有气
  const helped = lineAt(await cast('乾为天', '2024-03-01T10:00:00', { changedHexagramName: '天火同人' }), 4);
  assert.equal(helped.strength.level, 'strong');
  assert.equal(helped.strength.evidence.at(-1), '日月相敌，得动爻相扶');
  // 六五子水发动克午 → 无气
  const harmed = lineAt(await cast('山水蒙', '2024-03-01T10:00:00', { changedHexagramName: '风水涣' }), 3);
  assert.equal(harmed.strength.level, 'weak');
  assert.equal(harmed.strength.evidence.at(-1), '日月相敌，又逢动爻克制');
  // 他爻之生扶已用作日辰帝旺之根者，不再重复计入相敌
  const rootedOnce = lineAt(await cast('乾为天', '2024-03-01T10:00:00'), 3);
  assert.ok(rootedOnce.strength.evidence.includes('日辰帝旺（得动爻生扶为根）'));
  assert.equal(rootedOnce.strength.level, 'moderate');
});

test('liuyao separates 真空 from 假空 and lets 动爻生扶 turn 日墓 into 生', async () => {
  // 《增删卜易·旬空章》「旺不为空，动不为空，有日建动爻生扶者不为空…真空即春土、夏金、秋木、三冬逢火」
  // 2024-03-01 丙寅月 甲子日，旬空戌亥：水雷屯九五戌土春土无根 → 真空；坤为地六五亥水月合日扶 → 假空
  const zhen = await cast('水雷屯', '2024-03-01T10:00:00');
  assert.equal(lineAt(zhen, 5).kongWangState, 'kong_static');
  assert.equal(lineAt(zhen, 5).strength.level, 'weak');
  assert.equal(mcpCore.toLiuyaoCanonicalJson(zhen).六爻.find((line) => line.纳甲 === '戌').空亡, '真空');
  const jia = await cast('坤为地', '2024-03-01T10:00:00');
  assert.equal(lineAt(jia, 5).kongWangState, 'kong_supported');
  assert.equal(mcpCore.toLiuyaoCanonicalJson(jia).六爻.find((line) => line.纳甲 === '亥').空亡, '假空');

  // 觉子注「金爻虽墓于丑土…卦中土多生金，论生不论墓也」：2024-03-02 丙寅月 乙丑日，酉金囚
  const tomb = lineAt(await cast('坤为地', '2024-03-02T10:00:00'), 6);
  assert.equal(tomb.changSheng?.stage, '墓');
  assert.equal(tomb.strength.level, 'weak');
  const raised = lineAt(await cast('坤为地', '2024-03-02T10:00:00', { changedHexagramName: '雷地豫' }), 6);
  assert.equal(raised.changSheng, undefined);
  assert.equal(raised.strength.level, 'strong');
  assert.ok(raised.strength.evidence.includes('日墓而得生扶，论生不论墓'));
  assert.ok(raised.strength.evidence.includes('动爻生扶（六四丑土）'));
});
