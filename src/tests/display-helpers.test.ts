import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getElementColor } from '../lib/divination/display-helpers';

test('element colors are themable tokens that keep the historical colors outside the chat workspace', () => {
    assert.equal(getElementColor('金'), 'var(--element-metal, #FFD700)');
    assert.equal(getElementColor('木'), 'var(--element-wood, #228B22)');
    assert.equal(getElementColor('水'), 'var(--element-water, #1E90FF)');
    assert.equal(getElementColor('火'), 'var(--element-fire, #FF4500)');
    assert.equal(getElementColor('土'), 'var(--element-earth, #8B4513)');
});
