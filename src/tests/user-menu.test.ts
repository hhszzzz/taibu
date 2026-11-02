import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('user menu uses registry icons and removes heavy account shortcuts', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/layout/UserMenu.tsx'), 'utf8');
  const hostSource = readFileSync(resolve(process.cwd(), 'src/components/settings/SettingsCenterPage.tsx'), 'utf8');
  const iconSource = readFileSync(resolve(process.cwd(), 'src/components/settings/settings-center-icons.tsx'), 'utf8');

  assert.equal(source.includes("import { SETTINGS_CENTER_TAB_ICONS } from '@/components/settings/settings-center-icons'"), true);
  assert.equal(source.includes('createElement(SETTINGS_CENTER_TAB_ICONS[tab]'), true);
  assert.equal(source.includes("{ tab: 'general', label: '设置' }"), true);
  assert.equal(source.includes("{ tab: 'personalization', label: '个性化' }"), true);
  assert.equal(source.includes("{ tab: 'charts', label: '命盘' }"), true);
  assert.equal(source.includes('PROJECT_REPO_URL'), true);
  assert.equal(source.includes('PROJECT_ISSUES_URL'), true);
  assert.equal(source.includes('https://github.com/hhszzzz/taibu'), true);
  assert.equal(source.includes('https://docs.qq.com/smartsheet/DS3JSQ0dHTUdrVWFh'), true);
  assert.equal(source.includes('tab="help"'), true);
  assert.equal(source.includes('帮助中心'), true);
  assert.equal(source.includes('报告错误/需求'), true);
  assert.equal(hostSource.includes("from '@/components/settings/settings-center-icons'"), true);
  assert.equal(hostSource.includes('SETTINGS_CENTER_TAB_ICONS'), true);
  // 设置中心图标 = 全站自绘单线图标（nav-icons），不再混用 phosphor / lucide。
  assert.equal(iconSource.includes("from '@/lib/navigation/nav-icons'"), true);
  assert.equal(iconSource.includes('PersonalizationIcon'), true);
  assert.equal(iconSource.includes('SettingsIcon'), true);
  assert.equal(iconSource.includes('HelpIcon'), true);
  assert.equal(source.includes('tab="upgrade"'), false);
  assert.equal(source.includes('tab="profile"'), false);
  assert.equal(source.includes('tab="admin-announcements"'), false);
  // 账户菜单 = 共享 Menu：一级面板 r10，帮助走 MenuSub，不再手写 FloatingPanel 与点击外关闭。
  assert.equal(source.includes('rounded-2xl'), false);
  assert.equal(source.includes("from '@/components/ui/Menu'"), true);
  assert.equal(source.includes('<MenuSub>'), true);
  assert.equal(source.includes('<MenuSubTrigger'), true);
  assert.equal(source.includes('data-popup-open:bg-fill-field'), true);
  assert.equal(source.includes('FloatingPanel'), false);
  assert.equal(source.includes('document.addEventListener(\'mousedown\''), false);
  assert.equal(source.includes('user-help-menu'), true);
  // 用量从 composer 的圆环移到账户菜单，作为「余额」二级菜单；不再有独立的用量弹窗。
  assert.equal(source.includes('user-usage-menu'), true);
  assert.equal(source.includes('可用额度'), true);
  assert.equal(source.includes("openSettingsCenter('billing')"), true);
  assert.equal(source.includes("openSettingsCenter('usage-log')"), true);
  assert.equal(source.includes('<span>钱包</span>'), true);
  assert.equal(source.includes('<span>用量日志</span>'), true);
  // 关闭「钱包与用量」后，账户行与「余额」二级菜单一起隐藏。
  assert.equal(source.includes('{index === 0 && billingEnabled ? ('), true);
  assert.equal(source.includes('{billingEnabled ? <>'), true);
  assert.equal(source.includes('订阅与余额'), false);
  assert.equal(source.includes('usage-dialog'), false);
  assert.equal(source.includes('isUsageOpen'), false);
});
