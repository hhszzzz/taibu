import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SIDEBAR_PINS,
  SIDEBAR_DIVINATION_ORDER,
  SIDEBAR_PINS_STORAGE_KEY,
  normalizeSidebarPins,
  resolveSidebarPinnedIds,
  toggleSidebarPin,
} from '../lib/navigation/sidebar-pins';
import { getSidebarNavItems } from '../lib/navigation/registry';

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

test('default pins are frozen and include the fortune entries, which stay toggleable', () => {
  assert.ok(Object.isFrozen(DEFAULT_SIDEBAR_PINS));
  assert.deepEqual([...DEFAULT_SIDEBAR_PINS], ['bazi', 'ziwei', 'tarot', 'liuyao', 'qimen', 'daily', 'monthly']);
  assert.deepEqual(toggleSidebarPin(DEFAULT_SIDEBAR_PINS, 'daily'), ['bazi', 'ziwei', 'tarot', 'liuyao', 'qimen', 'monthly']);
  assert.deepEqual(toggleSidebarPin(['bazi'], 'monthly'), ['bazi', 'monthly'], 'an unpinned fortune entry can be pinned again');
});

test('the storage key version gives existing browsers the new defaults once', () => {
  assert.equal(SIDEBAR_PINS_STORAGE_KEY, 'taibu.pref.sidebarPinned.v2');
});

test('sidebar order follows the registry declaration order, not pin insertion order', () => {
  assert.deepEqual([...SIDEBAR_DIVINATION_ORDER], getSidebarNavItems().map(item => item.id));
  assert.deepEqual(
    resolveSidebarPinnedIds(['qimen', 'bazi', 'meihua', 'daily']),
    ['bazi', 'qimen', 'meihua', 'daily'],
  );
});

test('adding or removing a pin never reorders the remaining entries', () => {
  const base = resolveSidebarPinnedIds(['bazi', 'qimen']);
  const added = resolveSidebarPinnedIds(['bazi', 'meihua', 'qimen']);
  assert.deepEqual(added.filter(id => id !== 'meihua'), base);
  assert.deepEqual(resolveSidebarPinnedIds(['bazi']), ['bazi'], 'an empty stored list is not refilled with fortune entries');
  assert.deepEqual(
    resolveSidebarPinnedIds(['qimen', 'bazi']).filter(id => id !== 'bazi'),
    ['qimen'],
  );
});

test('resolveSidebarPinnedIds drops stale ids and de-duplicates', () => {
  assert.deepEqual(
    resolveSidebarPinnedIds(['removed-method', 'tarot', 'tarot', 'daily', 'monthly']),
    ['tarot', 'daily', 'monthly'],
  );
  assert.deepEqual(resolveSidebarPinnedIds(['daily', 'daily']), ['daily']);
});
