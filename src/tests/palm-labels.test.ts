import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPalmUserPrompt, generatePalmTitle, getPalmHandLabel, type HandType } from '../lib/divination/palm';

test('palm hand labels cover the known hand types and ignore anything else', () => {
    assert.equal(getPalmHandLabel('left'), '左手');
    assert.equal(getPalmHandLabel('right'), '右手');
    assert.equal(getPalmHandLabel('both'), '双手');
    assert.equal(getPalmHandLabel(undefined), null);
    assert.equal(getPalmHandLabel(null), null);
    assert.equal(getPalmHandLabel(''), null);
    // 接口会把任意字符串当作 handType 传入，原型链上的键不能被当成手型
    assert.equal(getPalmHandLabel('toString'), null);
    assert.equal(getPalmHandLabel('__proto__'), null);
});

test('palm prompts and titles still treat unknown hand types as both hands', () => {
    assert.equal(generatePalmTitle('lifeline', 'right'), '手相分析 - 右手生命线');
    assert.equal(generatePalmTitle('unknown', 'constructor' as HandType), '手相分析 - 双手综合分析');
    assert.match(buildPalmUserPrompt('full', 'left'), /^请分析这张左手手相图片，进行综合分析。/);
    assert.match(buildPalmUserPrompt('heartline', '__proto__' as HandType, '感情如何'), /^请分析这张双手手相图片，进行感情线。[\s\S]*用户特别关心的问题：感情如何/);
});
