import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildMeihuaStageRows,
    formatRelationTerm,
    parseMeihuaRelation,
    shortHexagramName,
} from '../components/meihua/meihua-display';
import { calculateMeihuaBundle } from '../lib/divination/meihua';

test('meihua relation parser reads directed and balanced core expressions and rejects unknown ones', () => {
    assert.deepEqual(parseMeihuaRelation('用卦(乾金) 克 体卦(巽木)'), { fromLabel: '用卦', from: '乾金', verb: '克', toLabel: '体卦', to: '巽木' });
    assert.deepEqual(parseMeihuaRelation('变卦(艮土) 生 体卦(兑金)'), { fromLabel: '变卦', from: '艮土', verb: '生', toLabel: '体卦', to: '兑金' });
    // 旧版保存的结果以「变卦整卦(卦名/五行)」记后段
    assert.deepEqual(parseMeihuaRelation(' 体卦(巽木) 生 变卦整卦(火风鼎/火) '), { fromLabel: '体卦', from: '巽木', verb: '生', toLabel: '变卦整卦', to: '火风鼎/火' });
    assert.deepEqual(parseMeihuaRelation('体卦(坤土) 与 体互(艮土) 比和'), { fromLabel: '体卦', from: '坤土', verb: '比和', toLabel: '体互', to: '艮土' });
    assert.equal(parseMeihuaRelation('体卦(坤土) 与 体互(艮土)'), null);
});

test('meihua stage rows merge identical 体互 / 用互 relations like the design board', () => {
    assert.deepEqual(buildMeihuaStageRows('体互(乾金) 克 体卦(巽木)；用互(乾金) 克 体卦(巽木)').map(row => row.description), ['体互、用互皆乾金克体']);
    assert.deepEqual(buildMeihuaStageRows('体卦(巽木) 生 体互(离火)；体卦(巽木) 生 用互(离火)').map(row => row.description), ['体卦生体互、用互']);
    assert.deepEqual(buildMeihuaStageRows('体卦(巽木) 与 体互(震木) 比和；体卦(巽木) 与 用互(震木) 比和').map(row => row.description), ['体卦与体互、用互比和']);
});

test('meihua stage rows keep differing or unparsable relations as separate rows', () => {
    const differing = buildMeihuaStageRows('体互(离火) 生 体卦(坤土)；用互(巽木) 克 体卦(坤土)');
    assert.deepEqual(differing.map(row => row.description), ['体互生体卦', '用互克体卦']);
    assert.equal(differing[1].relation?.from, '巽木');

    const unknown = buildMeihuaStageRows('体卦(坤土) 与 体互(艮土)；用互(巽木) 克 体卦(坤土)');
    assert.deepEqual(unknown.map(row => [row.relation === null, row.description]), [[true, ''], [false, '用互克体卦']]);
    assert.equal(unknown[0].text, '体卦(坤土) 与 体互(艮土)');

    assert.deepEqual(buildMeihuaStageRows('用卦(乾金) 克 体卦(巽木)').map(row => row.description), ['用卦克体卦']);
    assert.deepEqual(buildMeihuaStageRows(''), []);
});

test('meihua stage rows read the real canonical chart: the 中段 pair collapses into one line', () => {
    const bundle = calculateMeihuaBundle({ question: '这次搬家是否顺利', date: '2026-10-10T21:30', method: 'time' });
    const rows = bundle.canonicalJson.阶段推演.map(stage => buildMeihuaStageRows(stage.表达式));
    assert.deepEqual(rows.map(stageRows => stageRows.map(row => row.description)), [
        ['用卦克体卦'],
        ['体互、用互皆乾金克体'],
        ['体卦生变卦'],
    ]);
    // 后段取用卦乾金变出的离火（变卦火风鼎中用卦一侧）
    assert.equal(formatRelationTerm(rows[2][0].relation?.to ?? ''), '离火');
});

test('meihua short hexagram names drop the trigram images', () => {
    assert.equal(shortHexagramName('乾为天'), '乾');
    assert.equal(shortHexagramName('火风鼎'), '鼎');
    assert.equal(shortHexagramName('水火既济'), '既济');
    assert.equal(shortHexagramName('鼎'), '鼎');
    assert.equal(formatRelationTerm('乾金'), '乾金');
    assert.equal(formatRelationTerm('风天小畜/木'), '小畜 · 木');
});
