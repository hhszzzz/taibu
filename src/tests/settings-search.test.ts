import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSettingsSearchItems } from '../lib/settings-search';
import type { SettingsCenterTab } from '../lib/settings-center';

const tabs: SettingsCenterTab[] = ['general', 'billing', 'charts', 'knowledge-base', 'skills'];

test('settings search matches labels, descriptions and keywords only inside available tabs', () => {
    assert.deepEqual(matchSettingsSearchItems('钱包', tabs).map(item => [item.id, item.tab]), [['billing-wallet', 'billing']]);
    assert.deepEqual(matchSettingsSearchItems('字号', tabs).map(item => item.id), ['general-preferences']);
    assert.deepEqual(matchSettingsSearchItems('命盘', tabs).map(item => item.id), ['charts-bazi', 'charts-ziwei', 'charts-default']);
    assert.deepEqual(matchSettingsSearchItems('模型', tabs), [], 'a closed or hidden tab offers no target');
    assert.deepEqual(matchSettingsSearchItems('', tabs), []);
});
