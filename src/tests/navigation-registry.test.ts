import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_REGISTRY, filterNavItems, getNavItemById, groupDivinationItems, type NavItemDef } from '../lib/navigation/registry';
import { DEFAULT_MOBILE_DRAWER_ORDER } from '../lib/user/settings';

const divinations = NAV_REGISTRY.filter(item => item.category === 'divination');
const ids = (items: readonly NavItemDef[]) => items.map(item => item.id);

test('filterNavItems keeps every item for a blank query', () => {
  assert.equal(filterNavItems(divinations, ''), divinations);
  assert.equal(filterNavItems(divinations, '   '), divinations);
});

test('filterNavItems matches label, description and id case-insensitively', () => {
  assert.deepEqual(ids(filterNavItems(divinations, '梅花')), ['meihua']);
  assert.deepEqual(ids(filterNavItems(divinations, '黄历')), ['daily']);
  assert.deepEqual(ids(filterNavItems(divinations, ' MBTI ')), ['mbti']);
  assert.deepEqual(ids(filterNavItems(divinations, 'QiMen')), ['qimen']);
  assert.deepEqual(filterNavItems(divinations, '不存在的占术'), []);
});

test('groupDivinationItems follows the caller order inside each group', () => {
  const ordered = (DEFAULT_MOBILE_DRAWER_ORDER as readonly string[])
    .map(id => getNavItemById(id))
    .filter((item): item is NavItemDef => item?.category === 'divination');
  const groups = groupDivinationItems(ordered).map(group => [group.label, ids(group.items)]);
  assert.deepEqual(groups, [
    ['命盘', ['bazi', 'hepan', 'ziwei']],
    ['卜卦', ['liuyao', 'meihua', 'xiaoliuren', 'tarot']],
    ['三式', ['qimen', 'daliuren']],
    ['相学与性格', ['face', 'palm', 'mbti']],
    ['运势', ['daily', 'monthly']],
  ]);
});
