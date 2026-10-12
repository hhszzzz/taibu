import test from 'node:test';
import assert from 'node:assert/strict';
import type { LiuyaoCanonicalJSON } from 'taibu-core/liuyao';

import { buildLiuyaoHighlights } from '../components/liuyao/liuyao-highlights';
import { buildLiuyaoCanonicalJSON, calculateLiuyaoBundle, findHexagram, type Yao } from '../lib/divination/liuyao';

type Line = LiuyaoCanonicalJSON['六爻'][number];

function line(爻位: string, 六亲: string, 纳甲: string, 五行: string, extra: Partial<Line> = {}): Line {
    return { 爻位, 六亲, 六神: '青龙', 纳甲, 五行, 旺衰: '相', 动静状态: 'static', 动静: '静', ...extra };
}

function chart(overrides: Partial<LiuyaoCanonicalJSON>): LiuyaoCanonicalJSON {
    return {
        卦盘: { 本卦: { 卦名: '测试卦', 卦宫: '乾', 五行: '金' } },
        干支时间: [{ 柱: '日', 干支: '丁巳', 空亡: ['子', '丑'] }],
        六爻: [],
        用神分析: [],
        卦级分析: [],
        提示: [],
        ...overrides,
    };
}

test('liuyao highlights summarize yongshen, the single moving line and the day pillar like the design board', () => {
    const yaos: Yao[] = '101111'.split('').map((value, index) => ({
        type: value === '1' ? 1 : 0,
        change: index === 1 ? 'changing' : 'stable',
        position: index + 1,
    }));
    const bundle = calculateLiuyaoBundle({
        yaos,
        question: '这次跳槽能否顺利拿到 offer',
        date: new Date('2026-10-11T12:00:00+08:00'),
        yongShenTargets: ['官鬼'],
        hexagram: findHexagram('101111')!,
        changedHexagram: findHexagram('111111')!,
    });
    const json = buildLiuyaoCanonicalJSON(bundle.output);
    const day = json.干支时间.find((pillar) => pillar.柱 === '日')!;
    const highlights = buildLiuyaoHighlights(json);

    assert.equal(highlights[0], '用神官鬼亥水持世');
    assert.equal(highlights[1], '六二子孙丑土独发，化出父母寅木（回头克）');
    assert.ok(highlights.includes(`日辰${day.干支}，旬空${day.空亡.join('')}`), 'day pillar and its void branches should be listed');
    for (const relation of json.卦级分析) assert.ok(highlights.includes(relation), 'hexagram-level relations should be kept');
});

test('liuyao highlights list several moving lines bottom-up and keep neutral transformations short', () => {
    const highlights = buildLiuyaoHighlights(chart({
        六爻: [
            line('上六', '兄弟', '酉', '金', { 动静状态: 'changing', 变爻: { 六亲: '子孙', 纳甲: '子', 五行: '水', 关系: '平' } }),
            line('六三', '妻财', '卯', '木'),
            line('初九', '父母', '巳', '火', { 动静状态: 'changing', 变爻: { 六亲: '官鬼', 纳甲: '午', 五行: '火', 关系: '化进神' } }),
        ],
    }));

    assert.deepEqual(highlights.slice(0, 2), ['初九父母巳火发动，化出官鬼午火（化进神）', '上六兄弟酉金发动，化出子孙子水']);
});

test('liuyao highlights call out static hexagrams, dark movement, day breaks and hidden spirits', () => {
    const highlights = buildLiuyaoHighlights(chart({
        六爻: [
            line('九五', '官鬼', '申', '金', { 动静状态: 'hidden_moving', 伏神: { 六亲: '妻财', 纳甲: '寅', 五行: '木', 关系: '飞克伏' } }),
            line('六二', '子孙', '亥', '水', { 动静状态: 'day_break' }),
        ],
        干支时间: [{ 柱: '日', 干支: '丁巳', 空亡: [] }],
        卦级分析: ['六冲卦：是'],
    }));

    assert.deepEqual(highlights, ['六爻安静，无动爻', '六二子孙亥水日破', '九五官鬼申金暗动', '日辰丁巳', '六冲卦：是', '妻财寅木伏于九五下']);
});

test('liuyao highlights describe where each yongshen sits when it is not on the shi line', () => {
    const selected = (extra: Partial<LiuyaoCanonicalJSON['用神分析'][number]['已选用神']>) => ({
        目标六亲: '妻财',
        取用状态: '已定主用',
        已选用神: { 六亲: '妻财', 纳甲: '寅', 五行: '木', 强弱: '旺', 动静: '静', ...extra },
    });
    const highlights = buildLiuyaoHighlights(chart({
        用神分析: [
            selected({ 是否应爻: '是', 爻位: '六四爻' }),
            selected({ 来源: 'fushen', 爻位: '九二爻' }),
            selected({ 来源: 'changed', 爻位: '初六爻' }),
            selected({ 来源: 'visible', 爻位: '九五爻' }),
            selected({ 来源: 'temporal' }),
        ],
    }));

    assert.deepEqual(highlights.slice(0, 5), [
        '用神妻财寅木临应',
        '用神妻财寅木伏于九二爻下',
        '用神妻财寅木由初六爻化出',
        '用神妻财寅木居九五爻',
        '用神妻财寅木',
    ]);
});
