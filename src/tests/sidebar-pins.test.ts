import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SIDEBAR_PINS, normalizeSidebarPins, toggleSidebarPin } from '../lib/navigation/sidebar-pins';

test('normalizeSidebarPins rejects non-array payloads so callers fall back to defaults', () => {
  assert.equal(normalizeSidebarPins(null), null);
  assert.equal(normalizeSidebarPins('bazi'), null);
  assert.equal(normalizeSidebarPins({ 0: 'bazi' }), null);
});

test('normalizeSidebarPins keeps order, drops malformed ids and duplicates', () => {
  assert.deepEqual(
    normalizeSidebarPins(['ziwei', 'bazi', 'ziwei', 42, '', 'Bad Id', '../x', 'qimen']),
    ['ziwei', 'bazi', 'qimen'],
  );
  assert.deepEqual(normalizeSidebarPins([]), []);
});

test('normalizeSidebarPins caps the stored list length', () => {
  const many = Array.from({ length: 50 }, (_, index) => `item-${index}`);
  assert.equal(normalizeSidebarPins(many)?.length, 32);
});

test('toggleSidebarPin appends new pins and removes existing ones without mutating input', () => {
  const pins = ['bazi', 'ziwei'];
  assert.deepEqual(toggleSidebarPin(pins, 'meihua'), ['bazi', 'ziwei', 'meihua']);
  assert.deepEqual(toggleSidebarPin(pins, 'bazi'), ['ziwei']);
  assert.deepEqual(pins, ['bazi', 'ziwei']);
});

test('default pins are frozen', () => {
  assert.ok(Object.isFrozen(DEFAULT_SIDEBAR_PINS));
  assert.deepEqual([...DEFAULT_SIDEBAR_PINS], ['bazi', 'ziwei', 'tarot', 'liuyao', 'qimen']);
});
