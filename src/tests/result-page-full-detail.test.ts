import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDaliurenCanonicalJSON, calculateDaliurenBundle } from '@/lib/divination/daliuren';
import { buildQimenCanonicalJSON, calculateQimenBundle } from '@/lib/divination/qimen';
import {
    buildLiuyaoCanonicalJSON,
    calculateLiuyaoBundle,
    findHexagram,
    type Yao,
} from '@/lib/divination/liuyao';

test('qimen result page builder returns the full-detail board', async () => {
    const { output } = await calculateQimenBundle({
        year: 2026,
        month: 10,
        day: 10,
        hour: 21,
        minute: 30,
        timezone: 'Asia/Shanghai',
        question: '近期适合签合同吗',
        panType: 'zhuan',
        juMethod: 'chaibu',
        zhiFuJiGong: 'jiLiuYi',
    });
    const chart = buildQimenCanonicalJSON(output);

    // 完整档才有的基本信息与全盘信息
    assert.equal(chart.基本信息.公历, output.dateInfo.solarDate);
    assert.equal(chart.基本信息.农历, output.dateInfo.lunarDate);
    assert.ok(chart.空亡信息, '空亡信息 should be present in the full board');
    assert.ok(chart.十干月令旺衰, '十干月令旺衰 should be present in the full board');

    // 九宫盘的方位与五行字段只在完整档输出，宫格配色与详情卡依赖它们
    for (const palace of chart.九宫盘) {
        assert.equal(typeof palace.方位, 'string', `palace ${palace.宫位序号} should carry 方位`);
    }
    const sample = chart.九宫盘.find(palace => palace.宫位序号 === 6);
    assert.ok(sample, 'palace 6 should exist');
    assert.ok('宫旺衰' in sample || output.palaces[5].elementState === undefined);
    assert.ok('格局' in sample || output.palaces[5].formations.length === 0);
});

test('daliuren result page builder returns 建除 and 神煞', () => {
    const { output } = calculateDaliurenBundle({
        date: '2026-10-10',
        hour: 21,
        minute: 30,
        timezone: 'Asia/Shanghai',
        question: '近期适合签合同吗',
        birthYear: 1984,
        gender: 'female',
    });
    const chart = buildDaliurenCanonicalJSON(output);

    assert.ok(Array.isArray(chart.神煞), '神煞 should be present in the full board');
    for (const palace of chart.天地盘) {
        assert.equal(typeof palace.建除, 'string', `palace ${palace.地盘} should carry 建除`);
    }
    assert.equal(chart.基本信息.月将名称, output.dateInfo.yueJiangName);
});

test('liuyao result page builder keeps the full board without a question or yongshen', () => {
    const yaos: Yao[] = '101111'.split('').map((value, index) => ({
        type: value === '1' ? 1 : 0,
        change: index === 1 ? 'changing' : 'stable',
        position: index + 1,
    }));
    const bundle = calculateLiuyaoBundle({
        yaos,
        question: '',
        date: new Date('2026-01-01T00:00:00Z'),
        yongShenTargets: [],
        requireYongShen: false,
        hexagram: findHexagram('101111')!,
        changedHexagram: findHexagram('111111')!,
    });
    const chart = buildLiuyaoCanonicalJSON(bundle.output);

    assert.equal(chart.卦盘.问题, undefined, 'an empty question should not be rendered');
    assert.deepEqual(chart.用神分析, [], 'display-only analysis should not invent yongshen groups');
    assert.ok(chart.卦盘.卦身, '卦身 should still be rendered');
    assert.equal(chart.六爻.length, 6);

    // 旺衰 / 动静 是结果页卦盘的核心列，不能因为未填问题而缺失
    for (const line of chart.六爻) {
        assert.ok(line.旺衰, `${line.爻位} should carry 旺衰`);
        assert.equal(typeof line.动静, 'string', `${line.爻位} should carry 动静`);
    }
    assert.ok(bundle.output.fullYaos.every(yao => Array.isArray(yao.shenSha)), 'every line should carry shensha facts');

    const changingLine = chart.六爻.find(line => line.爻位 === '六二');
    assert.ok(changingLine?.变爻, 'the changing line should keep its 变爻');
    assert.match(changingLine?.动静 ?? '', /^明动/u, 'the changing line should be labelled as moving');
});

test('liuyao bundle honors explicit yongshen targets without a question', () => {
    const yaos: Yao[] = '101111'.split('').map((value, index) => ({
        type: value === '1' ? 1 : 0,
        change: 'stable',
        position: index + 1,
    }));
    const bundle = calculateLiuyaoBundle({
        yaos,
        question: '',
        date: new Date('2026-01-01T00:00:00Z'),
        yongShenTargets: ['官鬼'],
        hexagram: findHexagram('101111')!,
    });
    assert.deepEqual(bundle.output.yongShen.map(group => group.targetLiuQin), ['官鬼']);
    assert.ok(buildLiuyaoCanonicalJSON(bundle.output).用神分析.length > 0);

    assert.throws(() => calculateLiuyaoBundle({
        yaos,
        question: '',
        date: new Date('2026-01-01T00:00:00Z'),
        yongShenTargets: [],
        hexagram: findHexagram('101111')!,
    }), /请先明确问题后再解卦/u);
    assert.throws(() => calculateLiuyaoBundle({
        yaos,
        question: '问工作',
        date: new Date('2026-01-01T00:00:00Z'),
        yongShenTargets: [],
        hexagram: findHexagram('101111')!,
    }), /请至少选择一个分析目标/u);
});
