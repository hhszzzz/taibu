import test from 'node:test';
import assert from 'node:assert/strict';

import {
    findZhiShiPalaceIndex,
    formatJuLabel,
    getCenterHostNote,
    getElementTextClass,
    getHostedStarLabel,
    getPalaceCellTags,
    getPalaceDetailTags,
    getPalaceDirection,
    getPalaceShortName,
    getShortStarName,
    getStemTextClass,
} from '../components/qimen/qimen-display';
import { buildQimenCanonicalJSON, calculateQimenBundle } from '../lib/divination/qimen';

/** 设计稿样例：2026-10-10 21:30（北京时间）寒露阴遁九局，值符天禽寄乾六、值使死门落兑七。 */
async function loadBoardChart() {
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
    const palaceAt = (index: number) => {
        const palace = chart.九宫盘.find(item => item.宫位序号 === index);
        assert.ok(palace, `missing palace ${index}`);
        return palace;
    };
    return { output, chart, palaceAt };
}

test('qimen display labels format ju, palace names, directions and stars for the grid', async () => {
    const { chart, palaceAt } = await loadBoardChart();

    assert.equal(formatJuLabel(chart.基本信息.局式), '阴遁九局');
    assert.equal(formatJuLabel('阳遁1局'), '阳遁一局');
    assert.equal(formatJuLabel('未知局式'), '未知局式');
    assert.equal(getPalaceShortName(palaceAt(4)), '巽四');
    assert.equal(getPalaceShortName(palaceAt(5)), '中五');
    assert.equal(getPalaceDirection(palaceAt(6)), '西北');
    assert.equal(getShortStarName('天任星'), '天任');
    assert.equal(getHostedStarLabel(palaceAt(6).寄星), '禽寄');
    assert.equal(getHostedStarLabel(undefined), '');
    assert.equal(getStemTextClass('壬'), 'text-water');
    assert.equal(getStemTextClass('-'), 'text-foreground');
    assert.equal(getStemTextClass(undefined), 'text-foreground');
    // canonical 给出的五行优先，非法五行回退到天干本身
    assert.equal(getStemTextClass('壬', '火'), 'text-fire');
    assert.equal(getStemTextClass('壬', '未知'), 'text-water');
    assert.equal(getElementTextClass(palaceAt(6).九星五行), 'text-earth');
    assert.equal(getElementTextClass('金'), 'text-metal');
    assert.equal(getElementTextClass('-'), 'text-foreground');
});

test('qimen display tags put 值符 / 值使 first and keep the detail-only statuses out of the grid cell', async () => {
    const { chart, palaceAt } = await loadBoardChart();
    const zhiShi = chart.基本信息.值使;

    assert.equal(findZhiShiPalaceIndex(chart.九宫盘, zhiShi), 7);
    assert.equal(findZhiShiPalaceIndex(chart.九宫盘, undefined), undefined);
    assert.deepEqual(getPalaceCellTags(palaceAt(6), zhiShi), [
        { label: '值符', emphasis: true },
        { label: '驿马', emphasis: false },
        { label: '入墓', emphasis: false },
    ]);
    assert.deepEqual(getPalaceCellTags(palaceAt(7), zhiShi).map(tag => tag.label), ['值使']);
    assert.deepEqual(getPalaceCellTags(palaceAt(8), zhiShi).map(tag => tag.label), ['日空', '时空']);
    // 中五宫的寄宫说明不是状态，详情卡不应把它当标签
    assert.deepEqual(getPalaceDetailTags(palaceAt(5), zhiShi), []);
});

test('qimen center host note names what the center palace lends and where it goes', async () => {
    const { chart } = await loadBoardChart();

    assert.deepEqual(getCenterHostNote(chart.九宫盘), { subject: '天禽星与壬', target: '寄乾六宫' });
    assert.equal(getCenterHostNote(chart.九宫盘.map(palace => ({ ...palace, 寄星: undefined, 寄天盘干: undefined }))), null);
});
