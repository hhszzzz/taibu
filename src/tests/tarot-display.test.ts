import test from 'node:test';
import assert from 'node:assert/strict';
import { TAROT_SPREADS as CORE_TAROT_SPREADS } from 'taibu-core/tarot';

import {
    formatTarotCardCount,
    getTarotElementToneClass,
    getTarotInterpretCopy,
    getTarotSpreadGridClass,
    getUniformTarotElement,
    summarizeTarotElements,
} from '../components/tarot/tarot-display';
import { TAROT_SPREADS } from '../lib/divination/tarot';

test('tarot web spreads cover every core spread with matching positions', () => {
    assert.deepEqual(TAROT_SPREADS.map(spread => spread.id), CORE_TAROT_SPREADS.map(spread => spread.id));
    for (const spread of TAROT_SPREADS) {
        const core = CORE_TAROT_SPREADS.find(item => item.id === spread.id);
        assert.ok(core, `missing core spread ${spread.id}`);
        assert.equal(spread.cardCount, core.positions.length, spread.id);
        assert.equal(spread.positions.length, core.positions.length, spread.id);
        assert.ok(spread.positions.every(position => position.name && position.meaning), spread.id);
    }
    assert.equal(TAROT_SPREADS.find(spread => spread.id === 'horseshoe')?.name, '马蹄牌阵');
    assert.equal(TAROT_SPREADS.find(spread => spread.id === 'decision')?.cardCount, 5);
});

test('tarot card counts and element summaries read naturally in Chinese', () => {
    assert.equal(formatTarotCardCount(2), '两张');
    assert.equal(formatTarotCardCount(3), '三张');
    assert.equal(formatTarotCardCount(10), '十张');
    assert.equal(formatTarotCardCount(12), '12张');

    assert.equal(getUniformTarotElement(['火', '火', '火']), '火');
    assert.equal(getUniformTarotElement(['火']), null);
    assert.equal(getUniformTarotElement(['火', '水']), null);
    assert.equal(getUniformTarotElement([undefined, undefined]), null);

    assert.equal(summarizeTarotElements(['火', '火', '火']), '三张牌都是火元素');
    assert.equal(summarizeTarotElements(['火', '水', '火']), '火 2 · 水 1');
    assert.equal(summarizeTarotElements(['火']), null);
    assert.equal(summarizeTarotElements([undefined, undefined]), null);

    assert.equal(getTarotElementToneClass('火'), 'text-fire');
    assert.equal(getTarotElementToneClass('风'), 'text-metal');
    assert.equal(getTarotElementToneClass(undefined), 'text-foreground-secondary');
});

test('tarot spread grid wraps large spreads by container width', () => {
    assert.equal(getTarotSpreadGridClass(1), 'grid-cols-1');
    assert.equal(getTarotSpreadGridClass(3), 'grid-cols-3');
    assert.equal(getTarotSpreadGridClass(4), 'grid-cols-2 @xl:grid-cols-4');
    assert.equal(getTarotSpreadGridClass(10), 'grid-cols-3 @2xl:grid-cols-5');
});

test('tarot interpret entry only reveals the element summary once every card is turned', () => {
    const fire = ['火', '火', '火'];

    assert.deepEqual(getTarotInterpretCopy({ elements: fire, allRevealed: true, hasQuestion: true }), {
        title: '三张牌都是火元素',
        description: '让太卜结合你的问题，把三张牌串成一个完整的故事',
    });
    assert.deepEqual(getTarotInterpretCopy({ elements: fire, allRevealed: false, hasQuestion: false }), {
        title: '把这三张牌串起来',
        description: '让太卜把三张牌串成一个完整的故事',
    });
    assert.equal(getTarotInterpretCopy({ elements: ['火', '水'], allRevealed: true, hasQuestion: false }).title, '把这两张牌串起来');
    assert.deepEqual(getTarotInterpretCopy({ elements: ['水'], allRevealed: true, hasQuestion: false }), {
        title: '听听这张牌的提醒',
        description: '让太卜说说这张牌想提醒你什么',
    });
});
