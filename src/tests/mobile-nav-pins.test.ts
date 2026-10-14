import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePinList } from '../lib/navigation/pin-store';
import {
  DEFAULT_MOBILE_NAV_PINS,
  isMobileNavPinnable,
  resolveMobileNavPin,
  toggleMobileNavPin,
} from '../lib/navigation/mobile-nav-pins';
import { NAV_REGISTRY, getNavItemById } from '../lib/navigation/registry';
import { DEFAULT_MOBILE_DRAWER_ORDER, DEFAULT_MOBILE_MAIN_ITEMS } from '../lib/user/settings';

const allEnabled = () => true;

test('normalizePinList honours the per-store cap after dropping malformed ids', () => {
  assert.deepEqual(normalizePinList(['Bad Id', 'meihua', 'liuyao'], 1), ['meihua']);
  assert.deepEqual(normalizePinList(['meihua', 'meihua', 'tarot'], 2), ['meihua', 'tarot']);
  assert.deepEqual(normalizePinList([], 1), []);
  assert.equal(normalizePinList('liuyao', 1), null);
});

test('toggleMobileNavPin keeps a single slot: replace, clear, never mutate input', () => {
  const pins = ['liuyao'];
  assert.deepEqual(toggleMobileNavPin(pins, 'meihua'), ['meihua']);
  assert.deepEqual(toggleMobileNavPin(pins, 'liuyao'), []);
  assert.deepEqual(toggleMobileNavPin([], 'tarot'), ['tarot']);
  assert.deepEqual(pins, ['liuyao']);
});

test('default mobile pin is frozen and matches the previous fixed bottom-bar entry', () => {
  assert.ok(Object.isFrozen(DEFAULT_MOBILE_NAV_PINS));
  assert.deepEqual([...DEFAULT_MOBILE_NAV_PINS], ['liuyao']);
  assert.deepEqual(resolveMobileNavPin(DEFAULT_MOBILE_NAV_PINS, allEnabled)?.id, 'liuyao');
});

test('only divination methods outside the fortune pair can take the pinned slot', () => {
  const pinnable = (id: string) => {
    const item = getNavItemById(id);
    assert.ok(item, `${id} should exist in the registry`);
    return isMobileNavPinnable(item);
  };
  assert.equal(pinnable('meihua'), true);
  assert.equal(pinnable('daily'), false);
  assert.equal(pinnable('monthly'), false);
  assert.equal(pinnable('chat'), false);
  assert.equal(pinnable('settings-general'), false);
});

test('resolveMobileNavPin drops empty, stale, non-pinnable and disabled pins', () => {
  assert.equal(resolveMobileNavPin([], allEnabled), null);
  assert.equal(resolveMobileNavPin(['removed-method'], allEnabled), null);
  assert.equal(resolveMobileNavPin(['daily'], allEnabled), null);
  assert.equal(resolveMobileNavPin(['chat'], allEnabled), null);
  assert.equal(resolveMobileNavPin(['tarot'], id => id !== 'tarot'), null);
  assert.equal(resolveMobileNavPin(['tarot'], allEnabled)?.href, '/tarot');
});

test('a pinned method never duplicates a fixed bottom-bar entry', () => {
  for (const id of DEFAULT_MOBILE_MAIN_ITEMS) {
    assert.equal(resolveMobileNavPin([id], allEnabled), null, `${id} is already a fixed entry`);
  }
});

test('the mobile sheet lists every divination method exactly once', () => {
  const order = DEFAULT_MOBILE_DRAWER_ORDER as readonly string[];
  assert.equal(new Set(order).size, order.length);
  for (const id of order) {
    assert.ok(getNavItemById(id), `${id} should exist in the registry`);
  }
  const missing = NAV_REGISTRY
    .filter(item => item.category === 'divination' && !order.includes(item.id))
    .map(item => item.id);
  assert.deepEqual(missing, []);
});
