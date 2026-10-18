import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGanzhiRelations } from '../dist/domains/shared/ganzhi-relations.js';
import {
  analyzeDiZhiBanHe,
  analyzeDiZhiSanHui,
  analyzePillarRelations,
  analyzeTianGanChongKe,
  analyzeTianGanWuHe,
} from '../dist/domains/bazi/calculate.js';
import { calculateBranchRelations, calculateTaiSui } from '../dist/domains/bazi-dayun/calculate.js';

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const SLOTS = ['年', '月', '日', '时'];
const NATAL_LABELS = ['年柱', '月柱', '日柱', '时柱'];

function natal(stems, branches) {
  return SLOTS.map((_, i) => ({ label: NATAL_LABELS[i], layer: '原局', stem: stems[i], branch: branches[i] }));
}

function* product(values, size) {
  const index = new Array(size).fill(0);
  while (true) {
    yield index.map((i) => values[i]);
    let k = size - 1;
    while (k >= 0 && ++index[k] === values.length) index[k--] = 0;
    if (k < 0) return;
  }
}

const sortRows = (rows) => rows.map((row) => JSON.stringify(row)).sort();
const slotsOf = (fact, part) => fact.participants.filter((p) => p.part === part).map((p) => SLOTS[p.index]);

test('peer mode reproduces the natal branch analyzers for every 12^4 combination', () => {
  const stems = ['甲', '甲', '甲', '甲'];
  const pillarName = { 年支: '年', 月支: '月', 日支: '日', 时支: '时' };
  for (const branches of product(BRANCHES, 4)) {
    const facts = analyzeGanzhiRelations(natal(stems, branches));
    const legacy = analyzePillarRelations(...branches).map((r) => [r.type, r.pillars.map((p) => pillarName[p]), r.description]);
    const engine = facts.flatMap((f) => {
      const slots = slotsOf(f, '地支');
      switch (f.type) {
        case '六合': case '三合': return [['合', slots, f.description]];
        case '六冲': return [['冲', slots, f.description]];
        case '相害': return [['害', slots, f.description]];
        case '相刑': return [['刑', slots, f.result]];
        default: return [];
      }
    });
    assert.deepEqual(sortRows(engine), sortRows(legacy), branches.join(''));

    const banHe = analyzeDiZhiBanHe(...branches).map((r) => [r.branches.join(''), r.resultElement, r.positions.map((p) => pillarName[p])]);
    const engineBanHe = facts.filter((f) => f.type === '半合').map((f) => [
      f.description.slice(0, 2), f.result, slotsOf(f, '地支'),
    ]);
    assert.deepEqual(sortRows(engineBanHe), sortRows(banHe), `半合 ${branches.join('')}`);

    const sanHui = analyzeDiZhiSanHui(...branches).map((r) => [r.resultElement, r.positions.map((p) => pillarName[p])]);
    const engineSanHui = facts.filter((f) => f.type === '三会').map((f) => [f.result, slotsOf(f, '地支')]);
    assert.deepEqual(sortRows(engineSanHui), sortRows(sanHui), `三会 ${branches.join('')}`);
  }
});

test('peer mode reproduces the natal stem analyzers for every 10^4 combination', () => {
  const branches = ['子', '子', '子', '子'];
  const stemName = { 年干: '年', 月干: '月', 日干: '日', 时干: '时' };
  for (const stems of product(STEMS, 4)) {
    const facts = analyzeGanzhiRelations(natal(stems, branches));
    const wuHe = analyzeTianGanWuHe(...stems).map((r) => [r.stemA + r.stemB, r.resultElement, r.positions.map((p) => stemName[p])]);
    const engineWuHe = facts.filter((f) => f.type === '天干五合').map((f) => [
      f.participants.map((p) => p.char).join(''), f.result, slotsOf(f, '天干'),
    ]);
    assert.deepEqual(sortRows(engineWuHe), sortRows(wuHe), stems.join(''));
    const chong = analyzeTianGanChongKe(...stems).map((r) => [r.stemA + r.stemB, r.positions.map((p) => stemName[p])]);
    const engineChong = facts.filter((f) => f.type === '天干相冲').map((f) => [
      f.participants.map((p) => p.char).join(''), slotsOf(f, '天干'),
    ]);
    assert.deepEqual(sortRows(engineChong), sortRows(chong), stems.join(''));
  }
});

test('focus mode reproduces the 大运/流年 branch relations for every target against 12^4 natal charts', () => {
  const legacyType = { 六合: '六合', 六冲: '六冲', 三合: '三合', 相刑: '相刑', 相害: '相害' };
  const stems = ['甲', '甲', '甲', '甲', '甲'];
  for (const branches of product(BRANCHES, 4)) {
    for (const target of BRANCHES) {
      const pillars = [...natal(stems, branches), { label: '流年', layer: '流年', stem: stems[4], branch: target }];
      const engine = analyzeGanzhiRelations(pillars, { focus: [4] })
        .filter((f) => legacyType[f.type])
        .map((f) => [f.type, f.participants.filter((p) => p.index !== 4).map((p) => NATAL_LABELS[p.index]).join('、')]);
      const legacy = calculateBranchRelations(target, branches, NATAL_LABELS)
        .map((r) => [r.type, /（与(.+)）$/.exec(r.description)[1]]);
      assert.deepEqual(sortRows(engine), sortRows(legacy), `${target} vs ${branches.join('')}`);
    }
  }
});

test('classical cases', () => {
  const facts = (stems, branches, options) => analyzeGanzhiRelations(natal([...stems], [...branches]), options);
  const describe = (list) => list.map((f) => `${f.type}:${f.description}`);

  const jiaJi = describe(facts('甲己丙丁', '子午寅亥'));
  assert.ok(jiaJi.includes('天干五合:甲己合土'));
  assert.ok(jiaJi.includes('六冲:子午相冲'));
  assert.ok(jiaJi.includes('六合:寅亥六合化木'));
  assert.ok(jiaJi.includes('相破:寅亥相破'), '寅亥合而兼破');

  const sanXing = facts('甲甲甲甲', '寅巳申子');
  assert.deepEqual(sanXing.filter((f) => f.type === '相刑').map((f) => f.description), ['寅巳申无恩之刑']);
  const siShen = describe(facts('甲甲甲甲', '巳申卯丑'));
  for (const expected of ['六合:巳申六合化水', '相刑:巳申无恩之刑', '相破:巳申相破']) assert.ok(siShen.includes(expected), expected);

  assert.ok(describe(facts('甲甲甲甲', '子酉卯丑')).includes('相破:子酉相破'));
  assert.ok(describe(facts('甲甲甲甲', '辰辰卯丑')).includes('相刑:辰自刑'));
  assert.equal(facts('甲甲甲甲', '辰卯丑寅').filter((f) => f.type === '相刑').length, 0, '单个辰不成自刑');

  // 半合在第三支出现时让位于三合
  assert.deepEqual(describe(facts('甲甲甲甲', '申子卯丑')).filter((d) => d.startsWith('半合')), ['半合:申子半合水局']);
  assert.deepEqual(describe(facts('甲甲甲甲', '申子辰丑')).filter((d) => /半合|三合/.test(d)), ['三合:申子辰三合水局']);
  // 生墓两支（申辰）是拱合，不报半合
  assert.equal(facts('甲甲甲甲', '申辰卯丑').some((f) => f.type === '半合' || f.type === '三合'), false);
});

test('focus mode lists only relations touching a focus pillar and merges duplicate group facts', () => {
  const pillars = [
    ...natal(['甲', '丙', '戊', '庚'], ['申', '寅', '午', '子']),
    { label: '大运', layer: '大运', stem: '己', branch: '辰' },
    { label: '流年', layer: '流年', stem: '庚', branch: '子' },
  ];
  const facts = analyzeGanzhiRelations(pillars, { focus: [4, 5] });
  assert.ok(facts.every((f) => f.participants.some((p) => p.index >= 4)), 'natal-only relations are excluded');
  assert.equal(facts.some((f) => f.type === '六冲' && f.participants.every((p) => p.index < 4)), false);
  assert.ok(facts.some((f) => f.type === '天干五合' && f.description === '甲己合土' && f.participants.map((p) => p.label).join() === '年柱,大运'));
  const sanHe = facts.filter((f) => f.type === '三合');
  assert.equal(sanHe.length, 1, JSON.stringify(sanHe));
  // 流年子冲日支午
  assert.ok(facts.some((f) => f.type === '六冲' && f.participants.map((p) => p.label).join() === '日柱,流年'));
  assert.throws(() => analyzeGanzhiRelations(pillars, { focus: [6] }), RangeError);
});

test('太岁 keeps its six relation labels', () => {
  assert.deepEqual(calculateTaiSui('子', '子'), ['值太岁']);
  assert.deepEqual(calculateTaiSui('午', '子'), ['冲太岁']);
  assert.deepEqual(calculateTaiSui('酉', '子'), ['破太岁']);
  assert.deepEqual(calculateTaiSui('申', '巳'), ['合太岁', '刑太岁', '破太岁']);
  assert.deepEqual(calculateTaiSui('辰', '辰'), ['值太岁', '刑太岁']);
});
