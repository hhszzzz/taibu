import test from 'node:test';
import assert from 'node:assert/strict';

import {
    TIANDIPAN_GRID_POSITIONS,
    findLesson,
    formatBenMing,
    formatCastTime,
    formatKeShiDetail,
    getElementTextClass,
    getGanZhiTextClass,
    getHourBranch,
    getPalaceCornerText,
    getPalaceTags,
    parseKeShi,
    splitLabel,
} from '../components/daliuren/daliuren-display';
import { buildDaliurenCanonicalJSON, calculateDaliurenBundle } from '../lib/divination/daliuren';

const CAST_PARAMS = {
    date: '2026-10-10',
    hour: 21,
    minute: 30,
    timezone: 'Asia/Shanghai',
    question: '近期适合签合同吗',
    birthYear: 1984,
    gender: 'female' as const,
};

/** 设计稿样例：2026-10-10 21:30（北京时间）夜占，丁巳日第二局重审课，三传巳 → 戌 → 卯。 */
function loadBoardChart() {
    const { output } = calculateDaliurenBundle(CAST_PARAMS);
    const chart = buildDaliurenCanonicalJSON(output);
    const palaceOf = (diPan: string) => {
        const palace = chart.天地盘.find(item => item.地盘 === diPan);
        assert.ok(palace, `missing palace ${diPan}`);
        return palace;
    };
    return { output, chart, palaceOf };
}

test('daliuren 课式 splits into the title and the day / ju / 干上 subtitle', () => {
    const { chart } = loadBoardChart();
    const keShi = parseKeShi(chart.基本信息.课式);

    assert.deepEqual(keShi, { title: '重审课', day: '丁巳日', ju: '第二局', ganShang: '干上子', detail: '丁巳日第二局 干上子' });
    assert.equal(formatKeShiDetail(keShi.detail), '丁巳日第二局 · 干上子');
    // 课式格式不符时整段作为标题，不丢信息
    assert.deepEqual(parseKeShi('伏吟课'), { title: '伏吟课', day: '', ju: '', ganShang: '', detail: '' });
    assert.equal(formatKeShiDetail(''), '');
    assert.equal(getHourBranch(chart.基本信息.四柱), '亥');
    assert.equal(getHourBranch(''), '');
});

test('daliuren labels split 传序 / 课别 notes and lessons are found by prefix', () => {
    const { chart } = loadBoardChart();

    assert.deepEqual(splitLabel(chart.三传[0].传序), { name: '初传', note: '发端' });
    assert.deepEqual(splitLabel('一课（干上）'), { name: '一课', note: '干上' });
    assert.deepEqual(splitLabel('末传'), { name: '末传', note: '' });
    assert.equal(findLesson(chart, '一课')?.上神, '子');
    assert.equal(findLesson(chart, '三课')?.上神, '戌');
    assert.equal(findLesson(chart, '五课'), undefined);
});

test('daliuren palace tags put 三传 first, then 干上 / 支上 / 贵人', () => {
    const { chart, palaceOf } = loadBoardChart();

    // 巳宫天盘戌：既是中传又是支上
    assert.deepEqual(getPalaceTags(palaceOf('巳'), chart), [
        { label: '中传', emphasis: true },
        { label: '支上', emphasis: false },
    ]);
    assert.deepEqual(getPalaceTags(palaceOf('子'), chart), [{ label: '初传', emphasis: true }]);
    assert.deepEqual(getPalaceTags(palaceOf('戌'), chart), [{ label: '末传', emphasis: true }]);
    assert.deepEqual(getPalaceTags(palaceOf('未'), chart), [{ label: '干上', emphasis: false }]);
    assert.deepEqual(getPalaceTags(palaceOf('辰'), chart), [{ label: '贵人', emphasis: false }]);
    assert.deepEqual(getPalaceTags(palaceOf('午'), chart), []);
});

test('daliuren palace corner shows 遁干, or 空 for a 旬空 palace without one', () => {
    const { chart, palaceOf } = loadBoardChart();
    const kongSet = new Set(chart.基本信息.关键状态.空亡);

    assert.deepEqual([...kongSet], ['子', '丑']);
    assert.deepEqual(getPalaceCornerText(palaceOf('子'), kongSet), { dunGan: '空', isKong: true });
    assert.deepEqual(getPalaceCornerText(palaceOf('巳'), kongSet), { dunGan: '丁', isKong: false });
    assert.deepEqual(getPalaceCornerText({ ...palaceOf('午'), 遁干: '-' }, kongSet), { dunGan: '', isKong: false });
});

test('daliuren 干支 colours prefer the canonical 五行 and fall back to the character itself', () => {
    assert.equal(getGanZhiTextClass('戌', '土'), 'text-earth');
    // 四课下神为日干时 canonical 不给五行，按干支本身取色
    assert.equal(getGanZhiTextClass('丁'), 'text-fire');
    assert.equal(getGanZhiTextClass('子', '未知'), 'text-water');
    assert.equal(getGanZhiTextClass(undefined), 'text-foreground');
    assert.equal(getElementTextClass('木'), 'text-wood');
    assert.equal(getElementTextClass(undefined), 'text-foreground');
});

test('daliuren meta line formats the cast time and 本命 / 行年 from the session params', () => {
    const { output, chart } = loadBoardChart();
    const fallback = chart.基本信息.占测时间;

    assert.equal(formatCastTime(CAST_PARAMS, fallback), '2026-10-10 21:30');
    assert.equal(formatCastTime({ ...CAST_PARAMS, hour: 9, minute: 5 }, fallback), '2026-10-10 09:05');
    assert.equal(formatCastTime({ date: '2026-10-10' }, fallback), fallback);
    assert.equal(formatCastTime({ ...CAST_PARAMS, minute: Number.NaN }, fallback), fallback);
    assert.equal(formatCastTime(null, fallback), fallback);

    assert.equal(formatBenMing(CAST_PARAMS, output.xingNian), '本命 1984 坤 · 行年庚寅');
    assert.equal(formatBenMing({ birthYear: 1990, gender: 'male' }, undefined), '本命 1990 乾');
    assert.equal(formatBenMing({ birthYear: 1990 }, undefined), '本命 1990');
    assert.equal(formatBenMing(null, '庚寅'), '行年庚寅');
    assert.equal(formatBenMing(null, undefined), '');
});

test('daliuren 天地盘 outer ring places all twelve palaces once around the 2x2 center', () => {
    const indices = TIANDIPAN_GRID_POSITIONS.map(position => position.index).sort((a, b) => a - b);
    assert.deepEqual(indices, Array.from({ length: 12 }, (_, index) => index));

    const cells = new Set(TIANDIPAN_GRID_POSITIONS.map(({ row, col }) => `${row},${col}`));
    assert.equal(cells.size, 12);
    for (const center of ['2,2', '2,3', '3,2', '3,3']) assert.equal(cells.has(center), false);
    // 子宫在底行第三列，巳宫在左上角
    assert.deepEqual(TIANDIPAN_GRID_POSITIONS.find(position => position.index === 0), { index: 0, row: 4, col: 3 });
    assert.deepEqual(TIANDIPAN_GRID_POSITIONS.find(position => position.index === 5), { index: 5, row: 1, col: 1 });
});
