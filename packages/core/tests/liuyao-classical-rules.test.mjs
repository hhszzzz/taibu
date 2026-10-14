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

test('liuyao picks the main 用神 by 持世、临月日、旺衰、动静、伤损 and leaves 空破 to 应期', async () => {
  // 《卜筮正宗·十八问答》第十七问「舍其闲爻而用持世，舍其无权而用月日」；《增删卜易·两现章》古法「舍其休囚，用其旺相，
  // 舍其静爻，而用动爻，舍其月破，而用不破，舍其旬空，用其不空，舍其被伤，用其不伤」。
  // 两现章「得其验者，应乎旬空月破」所附三例，皆以有权有气之爻断得失、以空破之爻断应期
  const groupOf = (result) => result.yongShen[0];
  const triggersOf = (result) => result.timeRecommendations.map((item) => item.trigger);

  // 小畜例 未月庚子日：六四未土临月建为主（「应临月建之财以克世，许之必得」），九三辰土旬空主应期（「却得于辰土出空之日」）
  const xiaoXu = await cast('风天小畜', '2024-08-04T10:00:00');
  assert.equal(groupOf(xiaoXu).selectionStatus, 'resolved');
  assert.equal(groupOf(xiaoXu).selected.naJia, '未');
  assert.equal(groupOf(xiaoXu).candidates[0].kongWangState, 'kong_supported');
  assert.match(groupOf(xiaoXu).selectionNote, /六四爻临月建，九三爻不临月日，「舍其无权而用月日」/u);
  // 主用神未土临月建而太旺，野鹤先许「次日辛丑冲动未财日得」，应期正在逢冲、逢墓（辰）之日
  assert.deepEqual(triggersOf(xiaoXu), ['逢辰入墓或逢丑冲', '逢辰出空']);
  const json = mcpCore.toLiuyaoCanonicalJson(xiaoXu).用神分析[0];
  assert.equal(json.取用说明, groupOf(xiaoXu).selectionNote);
  assert.deepEqual([json.候选用神[0].强弱, json.候选用神[0].动静], ['有气', '静']);

  // 师之涣例 未月甲午日：官鬼辰土有气（假空）为主，丑土月破主应期（「一空一破…皆应实空之年」）
  const shi = await cast('地水师', '2024-07-29T10:00:00', { changedHexagramName: '风水涣', yongShenTargets: ['官鬼'] });
  assert.equal(groupOf(shi).selected.naJia, '辰');
  assert.match(groupOf(shi).selectionNote, /「舍其休囚，用其旺相」/u);
  assert.match(groupOf(shi).selectionNote, /六四爻月破，另看应期/u);
  assert.deepEqual(triggersOf(shi), ['逢辰出空填实或戌冲空', '逢丑实破或逢子合']);

  // 豫之归妹例 亥月丙午日：九四午火临日建为主，六二巳火动而月破主应期（「许巳年脱厄，乃实破之年也」）
  const yu = await cast('雷地豫', '2025-12-03T10:00:00', { changedHexagramName: '雷泽归妹', yongShenTargets: ['子孙'] });
  assert.equal(groupOf(yu).selected.naJia, '午');
  assert.equal(groupOf(yu).candidates[0].specialStatus, 'yuePo');
  assert.ok(triggersOf(yu).includes('逢巳实破或逢申合'));

  // 持世先于动静：乾为天九三辰土发动，上九戌土持世
  const shiYao = await cast('乾为天', '2024-07-10T10:00:00', { changedHexagramName: '天泽履', yongShenTargets: ['父母'] });
  assert.equal(groupOf(shiYao).selected.naJia, '戌');
  assert.equal(groupOf(shiYao).candidates[0].movementState, 'changing');
  assert.match(groupOf(shiYao).selectionNote, /「舍其闲爻而用持世」/u);

  // 旺衰相同则取动：巳月庚午日坤为地初六未土发动，与六四丑土同为有气
  const moving = await cast('坤为地', '2024-05-06T10:00:00', { changedHexagramName: '地雷复', yongShenTargets: ['兄弟'] });
  assert.equal(groupOf(moving).selected.position, 1);
  assert.match(groupOf(moving).selectionNote, /初六爻明动，六四爻安静，「舍其静爻，而用动爻」/u);

  // 余皆相同则取无伤：寅月甲寅日两土同为无气，六四丑土旬空，只引「舍其旬空」之句
  const unhurt = await cast('坤为地', '2024-02-20T10:00:00', { yongShenTargets: ['兄弟'] });
  assert.equal(groupOf(unhurt).selected.position, 1);
  assert.match(groupOf(unhurt).selectionNote, /初六爻无伤，六四爻旬空，「舍其旬空，用其不空」（《增删卜易·两现章》）/u);
});

test('liuyao judges 伏神 by the six 有用 and five 不得出 conditions of 飞伏神章', async () => {
  // 《增删卜易·飞伏神章》「伏神有用者有六…伏神终不得出者有五」，各条例俱出本章
  const fuShenOf = async (hexagramName, date, target) => {
    const result = await cast(hexagramName, date, { yongShenTargets: [target] });
    const group = result.yongShen[0];
    assert.equal(group.selectionStatus, 'from_fushen');
    return { selected: group.selected, fuShen: result.fuShen[0], timing: result.timeRecommendations[0] };
  };

  // 贲卦例 卯月壬辰日：午火父母月生而旺相，伏于丑土之下又逢旬空，「许甲午日出空必得」
  const ben = await fuShenOf('山火贲', '2024-03-29T10:00:00', '父母');
  assert.equal(ben.fuShen.availabilityStatus, 'available');
  assert.equal(ben.selected.strengthLabel, '伏神有用');
  assert.equal(ben.selected.kongWangState, 'kong_supported');
  assert.equal(ben.timing.trigger, '待出伏');
  assert.match(ben.timing.description, /待午日出露，或未日冲开飞神.*；伏神旬空，出空之日方出/u);
  assert.ok(ben.selected.evidence.includes('伏于六二爻兄弟丑土之下'));

  // 复卦例 卯月丙辰日：「旺木以生巳火，飞来生伏」
  const fu = await fuShenOf('地雷复', '2019-03-20T10:00:00', '父母');
  assert.equal(fu.fuShen.availabilityStatus, 'available');
  assert.ok(fu.selected.evidence.includes('飞来生伏'));

  // 升卦例 酉月丙辰日：午火休囚无助，而飞神丑土旬空，「空下伏神，易于引拔…许午日子孙出现」
  const sheng = await fuShenOf('地风升', '2019-09-16T10:00:00', '子孙');
  assert.equal(sheng.fuShen.availabilityStatus, 'conditional');
  assert.ok(sheng.selected.evidence.includes('飞神虽有若无（旬空、无气、日墓）'));
  assert.match(sheng.timing.description, /待午日出露/u);

  // 遁卦例：辰土飞来克子水伏神。午月飞神旺相，「伏神受制，有用亦无用矣」
  const dun = await fuShenOf('天山遯', '2024-06-10T10:00:00', '子孙');
  assert.equal(dun.fuShen.availabilityStatus, 'blocked');
  assert.equal(dun.selected.evidence.at(-1), '旺相之飞神克伏，伏神受制，有用亦无用');
  assert.match(dun.timing.description, /不宜强断应期/u);
  // 卯月甲戌日飞神虽日破，伏神被日辰克而月令无助：黄金策注「用爻休囚又被月建日辰制服，纵遇生扶，亦不济事也」
  const ruled = await fuShenOf('天山遯', '2024-03-11T10:00:00', '子孙');
  assert.equal(ruled.fuShen.availabilityStatus, 'blocked');
  assert.equal(ruled.selected.evidence.at(-1), '伏神被日月冲克，纵遇生扶亦不济事');
});

test('liuyao derives 应期 from the 应期总注 and the 病 of the 用神', async () => {
  // 《增删卜易·各门类应期总注章》各条原注之例；《卜筮正宗》伏神正传「空要值日、破要填合、伏待出露、冲待合、合待冲」、
  // 十八问答第四问「宗其一爻有病关因者断之」：病在则应在去病之日，无病再看动静旺衰
  const timing = async (hexagramName, date, target, changedHexagramName) => {
    const result = await cast(hexagramName, date, { yongShenTargets: [target], ...(changedHexagramName ? { changedHexagramName } : {}) });
    return result.timeRecommendations.map((item) => [item.type, item.trigger]);
  };

  // 「静而逢值逢冲：如主事爻临子水不动，后逢子日午日而应之」——申月乙巳日乾为天初九子水
  assert.deepEqual(await timing('乾为天', '2024-08-09T10:00:00', '子孙'), [['critical', '逢子值或逢午冲']]);
  // 「太旺者逢墓逢冲：如主事爻临午火，又遇巳火午月日占卦…后逢亥子日应之，又有戌日应之乃火入墓也」——午月九四午火
  assert.deepEqual(await timing('乾为天', '2024-06-07T10:00:00', '官鬼'), [['critical', '逢戌入墓或逢子冲']]);
  // 「月破喜填：如子月占，主事爻临午火，乃为月破。后逢未日应之…又有逢午月应之」
  assert.deepEqual(await timing('乾为天', '2023-12-09T10:00:00', '官鬼'), [['critical', '逢午填实或逢未合']]);
  // 「遇六合亦宜相击…即如主象临子，与丑作合，后逢午未日应之是也」
  assert.deepEqual(await timing('乾为天', '2024-01-09T10:00:00', '子孙'), [['critical', '逢午或未冲开']]);
  // 月将章例：午月戊辰日火地晋，酉金合辰日，「卯日卯时必生…应卯时者，酉金与辰日相合」，引黄金策「若逢合住，必待冲开」
  assert.deepEqual(await timing('火地晋', '2024-07-03T10:00:00', '兄弟'), [['critical', '逢卯冲开']]);

  // 「入三墓俱喜冲开：如主事爻临午火，假使火墓于戌，后逢辰日则应之」；三墓即「用爻入日墓、入动墓、动而化墓」
  assert.deepEqual(await timing('乾为天', '2024-03-11T10:00:00', '官鬼'), [['critical', '逢辰冲开墓库']]);
  const dongMu = await cast('乾为天', '2024-03-04T10:00:00', { yongShenTargets: ['子孙'], changedHexagramName: '天泽履' });
  assert.deepEqual(dongMu.timeRecommendations[0].basis, ['用神入动墓', '入三墓俱喜冲开']);
  assert.match(dongMu.timeRecommendations[0].description, /入动墓（九三辰土发动），墓在辰，逢戌冲开之日方应/u);
  assert.deepEqual(await timing('天风姤', '2024-03-02T10:00:00', '官鬼', '山风蛊'), [['critical', '逢辰冲开墓库']]);
  // 辰日冲戌，墓神被冲破，不作化墓（墓库章「墓神破，日月动爻冲破，亦非真也」），回到动而逢值逢合
  assert.deepEqual(await timing('天风姤', '2024-03-05T10:00:00', '官鬼', '山风蛊'), [['critical', '逢午值或逢未合']]);

  // 「动而逢合逢值：如主事爻临子水发动，后遇丑日子日」，并「问有应于变爻动爻」
  const moving = await cast('坤为地', '2024-05-08T10:00:00', { yongShenTargets: ['兄弟'], changedHexagramName: '地雷复' });
  assert.deepEqual(moving.timeRecommendations.map((item) => item.trigger), ['逢未值或逢午合']);
  assert.match(moving.timeRecommendations[0].description, /变出子，亦有应于子之日/u);
  // 「化进神、逢值逢合：如申动酉…有应申月日者，有应巳月日者」；「化退神、忌值忌冲：如酉化申…有应申月日者，有应寅日月者」
  assert.deepEqual(await timing('雷泽归妹', '2024-03-08T10:00:00', '兄弟', '兑为泽'), [['critical', '逢申值或逢巳合']]);
  assert.deepEqual(await timing('兑为泽', '2024-03-01T10:00:00', '兄弟', '雷泽归妹'), [
    ['favorable', '遇辰戌丑未相生或秋令申酉月'], ['unfavorable', '逢申或寅'],
  ]);

  // 冲待合：暗动与冲空之爻俱待逢合（第四问「其冲破也，必待相合之期至」）
  assert.deepEqual(await timing('坤为地', '2024-08-09T10:00:00', '妻财'), [['critical', '逢寅合']]);
  assert.deepEqual(await timing('坤为地', '2024-06-04T10:00:00', '父母'), [['critical', '逢申合']]);
  // 休囚静爻旬空又逢日冲，是日破「愈加无用」，旬空论「休囚安静…谓之真空到底空矣」，不作冲空
  const zhenKong = await cast('坤为地', '2024-01-06T10:00:00');
  assert.equal(lineAt(zhenKong, 5).kongWangState, 'kong_static');
  assert.deepEqual(zhenKong.timeRecommendations.map((item) => item.trigger), ['待巳冲空或亥填实']);
  // 「衰绝者，遇生遇旺」，第四问「如自化绝或绝于日者，必待期生」
  const jue = await cast('坤为地', '2024-03-18T10:00:00');
  assert.deepEqual(jue.timeRecommendations.map((item) => [item.trigger, item.basis]), [['遇申酉相生或冬令亥子月', ['用神日绝', '绝待期生']]]);

  // 「大象吉而受克，须待克神受克：如用神临辰土，得日月动爻生扶…倘被寅卯克害，后逢申酉日冲克克神则吉」
  assert.deepEqual(await timing('坤为地', '2024-05-07T10:00:00', '兄弟', '地火明夷'), [
    ['critical', '逢未值或逢午合'], ['favorable', '逢申酉克去克神'],
  ]);
  // 「大象凶而受克，须防克者逢生：…既无日月动爻生扶…再逢寅卯克制者，后逢寅卯亥日，则凶」
  assert.deepEqual(await timing('坤为地', '2024-02-06T10:00:00', '兄弟', '地火明夷'), [
    ['critical', '逢未值或逢午合'], ['favorable', '遇巳午相生或辰戌丑未四季月'], ['unfavorable', '逢寅卯或亥子'],
  ]);
});

test('liuyao judges 反吟 and 伏吟 per inner and outer trigram', async () => {
  // 《增删卜易·反伏章》内外分论：「内卦反伏，内则不安。外卦反伏，外则不宁」「内卦动变伏吟，内则呻吟，外卦动变伏吟，外则忧郁」；
  // 《卜筮正宗·反吟卦定例》卦之反吟为乾巽、坎离、艮坤、震兑两卦相对，爻之反吟「惟有坤变巽，巽变坤」；伏吟卦定例「伏吟惟乾变震、震变乾」
  const scopes = async (hexagramName, changedHexagramName) => {
    const { guaFanFuYin } = await cast(hexagramName, '2024-08-04T10:00:00', changedHexagramName ? { changedHexagramName } : {});
    return { fanYin: guaFanFuYin.fanYinScope ?? null, fuYin: guaFanFuYin.fuYinScope ?? null };
  };

  // 反伏章例：申月癸巳日占父外任，姤之恒「卦得伏吟」，外卦乾化震
  assert.deepEqual(await scopes('天风姤', '雷风恒'), { fanYin: null, fuYin: 'outer' });
  assert.deepEqual(await scopes('天雷无妄', '雷天大壮'), { fanYin: null, fuYin: 'both' });
  // 外卦乾化坎不成伏吟，内卦乾化震仍是伏吟；旧法只认六爻纳甲全同，会漏判
  assert.deepEqual(await scopes('乾为天', '水雷屯'), { fanYin: null, fuYin: 'inner' });
  // 反伏章例：升之观、观之坤、巽之观为爻之反吟；比之井初爻未动，内卦坤化巽仍断「内卦反伏」；临之中孚「外卦反伏」
  assert.deepEqual(await scopes('地风升', '风地观'), { fanYin: 'both', fuYin: null });
  assert.deepEqual(await scopes('风地观', '坤为地'), { fanYin: 'outer', fuYin: null });
  assert.deepEqual(await scopes('巽为风', '风地观'), { fanYin: 'inner', fuYin: null });
  assert.deepEqual(await scopes('水地比', '水风井'), { fanYin: 'inner', fuYin: null });
  assert.deepEqual(await scopes('地泽临', '风泽中孚'), { fanYin: 'outer', fuYin: null });
  // 卦之反吟：两卦后天方位相对，爻支未必相冲
  assert.deepEqual(await scopes('坎为水', '离为火'), { fanYin: 'both', fuYin: null });
  assert.deepEqual(await scopes('乾为天', '天风姤'), { fanYin: 'inner', fuYin: null });
  // 乾化坤既非相对之卦，纳甲也不逐爻相冲，不作反吟；无动爻不论反伏
  assert.deepEqual(await scopes('乾为天', '坤为地'), { fanYin: null, fuYin: null });
  assert.deepEqual(await scopes('乾为天'), { fanYin: null, fuYin: null });

  // 内卦反吟与外卦伏吟可以并见：判据入卦级分析，断语入凶吉警告，两处不重复；渲染时各带所在之卦
  const both = await cast('天地否', '2024-08-04T10:00:00', { changedHexagramName: '雷风恒' });
  assert.deepEqual(await scopes('天地否', '雷风恒'), { fanYin: 'inner', fuYin: 'outer' });
  assert.ok(mcpCore.toLiuyaoCanonicalJson(both).卦级分析.includes(
    '内卦反吟、外卦伏吟：内卦坤化巽，未巳卯与丑亥酉逐爻相冲，爻之反吟；外卦乾化震，午申戌复化午申戌',
  ));
  assert.deepEqual(both.warnings.filter((warning) => /反吟|伏吟/u.test(warning)), [
    '内卦反吟，内则不安，主成而败、败而成，去而复来（《增删卜易·反伏章》）；外卦伏吟，外则忧郁，动如不动（《卜筮正宗》第六问）；吉凶仍以用神旺衰定。',
  ]);
  const text = mcpCore.toLiuyaoText(both, { detailLevel: 'full' });
  assert.ok(text.includes('- 共振: 内卦反吟\n- 共振: 外卦伏吟'));
  assert.ok(text.includes('- 反吟伏吟: 内卦反吟、外卦伏吟'));
  assert.deepEqual(mcpCore.toLiuyaoJson(both, { detailLevel: 'full' }).全局互动.反伏信息, [
    { 类型: '反吟', 范围: '内卦' }, { 类型: '伏吟', 范围: '外卦' },
  ]);
});

test('liuyao forms 三合 by the 三合章 and 第四问 conditions, not by 得令', async () => {
  // 《增删卜易·三合章》「一卦之内，有三爻动而合局者，一也；两爻动，一爻不动，亦成合局者，二也；有内卦初爻、三爻动，
  // 动而变出之爻成三合者，三也；又有外卦四爻、六爻动，动而变出之爻成三合者，四也」（全学网本；维基文库本「三爻动」
  // 作「一爻动」，与下文「三爻若有两爻动，不成局」相违，从全学网本），「一爻明动一爻暗动亦作两爻动」；
  // 《卜筮正宗》第四问「如一爻静二爻发者，待一爻静者值日应事」「不动不成局」。合化五行旺衰不是成局条件
  const formedOf = async (hexagramName, changedHexagramName, date) => {
    const { sanHeAnalysis } = await cast(hexagramName, date, { changedHexagramName });
    return Object.fromEntries((sanHeAnalysis.fullSanHeList ?? []).map((item) => [item.name, item.description]));
  };

  // 第四问例乾之需「寅午戌三合官局生世…内少寅字发动，须寅日递呈」：寅静、午戌动，两动一静成局，静者值日应事
  assert.equal((await formedOf('乾为天', '水天需', '2024-06-06T10:00:00')).寅午戌合火局,
    '九二寅静、九四午动、上九戌动，两动一静亦成局，静者寅值日应事');
  // 外卦四六爻动而与化出之支合成：午化申、戌化子，与九三辰成申子辰
  assert.match((await formedOf('乾为天', '水天需', '2024-06-06T10:00:00')).申子辰合水局, /^九四化出申、上九化出子、九三辰静，两动一静亦成局/u);
  // 第四问例「借寅月建补成三合，本月必选」：寅月时月建补足寅，不待静爻值日
  assert.equal((await formedOf('乾为天', '水天需', '2024-02-06T10:00:00')).寅午戌合火局,
    '月建寅、九四午动、上九戌动，借月建补成，本月可应');
  // 第四问例大畜之乾「寅午戌三合父局，独有寅字日冲又绝于申日，己亥日必归…冲中逢合也」：四爻戌动化午，一爻动而化出亦作两支
  assert.equal((await formedOf('山天大畜', '乾为天', '2024-09-29T10:00:00')).寅午戌合火局,
    '九二寅静、六四化出午、六四戌动，两动一静亦成局；寅日破，逢亥合之日成局');
  // 第四问例睽之鼎「内卦巳酉丑合成金局…丑土系月破…此其破而逢合也」
  assert.equal((await formedOf('火泽睽', '火风鼎', '2025-08-03T10:00:00')).巳酉丑合金局,
    '初九巳动、六三化出酉、六三丑动，三支俱动，可论成局；丑月破，逢丑填实或逢子合之日成局');
  // 第四问例萃之革「内卦亥卯未合财局…因于未土旬空必待未月…未月者实空之月也」
  assert.equal((await formedOf('泽地萃', '泽火革', '2024-03-21T10:00:00')).亥卯未合木局,
    '六三化出亥、六三卯动、初六未动，三支俱动，可论成局；未旬空，逢丑冲空或逢未填实之日成局');
  // 木在丑月囚，旧法以「未得令」不论成局；亥静、卯化出、未动，两动一静仍成局
  const xianZhiPi = await cast('泽山咸', '2026-01-10T12:00:00', { changedHexagramName: '天地否' });
  assert.equal(xianZhiPi.sanHeAnalysis.hasFullSanHe, true);
  assert.match(xianZhiPi.sanHeAnalysis.fullSanHe.description, /^九四亥静、九三化出卯、上六未动，两动一静亦成局/u);
  assert.ok(mcpCore.toLiuyaoCanonicalJson(xianZhiPi).卦级分析.some((line) => line.startsWith('三合局：亥卯未合木局→木（九四亥静')));

  // 只一爻发动：不成局，入凶吉警告，不进组合关系，也不再拆作半合
  const gou = await cast('乾为天', '2024-01-01T10:00:00', { changedHexagramName: '天风姤' });
  assert.equal(gou.sanHeAnalysis.hasFullSanHe, false);
  assert.ok(gou.warnings.includes('见申子辰合水局三支（九五申静、初九子动、九三辰静）而只一支发动，不成局（《卜筮正宗》第四问「不动不成局」）。'));
  assert.equal(mcpCore.toLiuyaoJson(gou, { detailLevel: 'full' }).全局互动.组合关系.length, 0);
});
