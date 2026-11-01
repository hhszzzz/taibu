import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsCenterLink } from '../components/settings/SettingsCenterLink';
import Module from 'node:module';

import {
  getCurrentSettingsCenterRouteTarget,
  getSettingsCenterDisabledState,
  getSettingsCenterRouteTarget,
  getSettingsCenterRouteTargetForPath,
  getSettingsCenterTabs,
  parseSettingsCenterHash,
  parseSettingsCenterPath,
  SETTINGS_CENTER_NAVIGATE_EVENT,
  openSettingsCenter,
  closeSettingsCenter,
} from '../lib/settings-center';
import { DEFAULT_MOBILE_DRAWER_ORDER, DEFAULT_TOOL_ORDER } from '../lib/user/settings';
import { ADMIN_SUBTABS, isAdminSubTab, isAdminSubtabOwner, resolveAdminSubTab } from '../lib/admin/settings-subtabs';

// These tests exercise real navigation data, not vendor SVG rendering. Isolate
// Phosphor's browser/ESM entry from the existing CommonJS node:test loader.
const iconPath = require.resolve('@phosphor-icons/react');
const originalIcons = require.cache[iconPath];
const icons = new Module(iconPath);
icons.exports = Object.fromEntries(['YinYangIcon', 'CheckerboardIcon', 'CompassRoseIcon', 'StarOfDavidIcon', 'FlowerLotusIcon'].map(name => [name, () => null]));
require.cache[iconPath] = icons;
const { NAV_REGISTRY, getFeatureModules, getNavItemById, getSidebarToolItems } = (() => {
  try { return require('../lib/navigation/registry') as typeof import('../lib/navigation/registry'); }
  finally {
    if (originalIcons) require.cache[iconPath] = originalIcons;
    else delete require.cache[iconPath];
  }
})();

const ENABLED_FLAGS = {
  sharesEnabled: true, skillsEnabled: true, connectorsEnabled: true,
  billingEnabled: true, chartsEnabled: true, knowledgeBaseEnabled: true,
  mcpServiceEnabled: true, agentEnabled: true, personalizationEnabled: true, helpEnabled: true, isAdmin: false,
};

// Mounted-panel identity, close/reopen and per-user loading are behavior-owned by
// scripts/tests/browser-components.mjs, enforced by pnpm test:browser in verify/CI.
// Unit tests below retain fast route/registry contracts and unique UI/security guards.


test('settings center exposes the wallet and usage log tabs and rejects removed legacy credits hash', () => {
  const tabs = getSettingsCenterTabs(ENABLED_FLAGS);

  assert.equal(tabs.some((tab) => tab.id === 'billing' && tab.disabled === false), true);
  assert.equal(tabs.find(tab => tab.id === 'billing')?.label, '钱包');
  assert.equal(tabs.find(tab => tab.id === 'usage-log')?.label, '用量日志');
  assert.deepEqual(tabs.filter(tab => tab.beta).map(tab => tab.id), ['billing', 'usage-log', 'skills', 'connectors'],
    'the wallet and the usage log are still shown as beta');
  assert.equal(tabs.findIndex((tab) => tab.id === 'usage-log'), tabs.findIndex((tab) => tab.id === 'billing') + 1);
  assert.equal(getNavItemById('settings-billing')?.href, getSettingsCenterRouteTarget('billing'));
  assert.equal(getSettingsCenterRouteTarget('usage-log'), '/settings/usage-log');
  assert.equal(parseSettingsCenterHash('#settings/credits'), null);
  assert.equal(
    getSettingsCenterRouteTarget('billing', { search: '?payment=paid' }),
    '/settings/billing?payment=paid',
  );
  assert.equal(
    getSettingsCenterRouteTargetForPath('/daliuren', 'billing', { search: '?foo=bar' }),
    '/settings/billing?foo=bar',
  );
  assert.equal(
    getSettingsCenterRouteTargetForPath('/', 'general'),
    '/settings/general',
  );
  assert.equal(tabs.findIndex((tab) => tab.id === 'byok'), tabs.findIndex((tab) => tab.id === 'personalization') + 1);
  assert.equal(tabs.at(-1)?.id, 'help');
  assert.equal(getSettingsCenterRouteTarget('byok'), '/settings/byok');
});

test('settings routes dispatch framework navigation without writing history themselves', (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const navigation: unknown[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: new URL('https://fixture.invalid/daliuren?step=2'),
    dispatchEvent: (event: CustomEvent) => { assert.equal(event.type, SETTINGS_CENTER_NAVIGATE_EVENT); navigation.push(event.detail); return true; },
  } });
  t.after(() => originalWindow ? Object.defineProperty(globalThis, 'window', originalWindow) : Reflect.deleteProperty(globalThis, 'window'));
  assert.equal(getCurrentSettingsCenterRouteTarget('general'), '/settings/general');
  openSettingsCenter('personalization');
  openSettingsCenter('admin-ai-services', { replace: true, subpath: 'gateways' });
  closeSettingsCenter();
  assert.deepEqual(navigation, [
    { href: '/settings/personalization', replace: false },
    { href: '/settings/admin-ai-services/gateways', replace: true },
    { href: '/bazi', replace: false },
  ]);
});

test('settings page addresses and legacy hashes resolve to the same categories', () => {
  for (const tab of ['general', 'personalization', 'byok', 'charts', 'admin-features'] as const) {
    assert.equal(parseSettingsCenterPath('/settings/' + tab)?.tab, parseSettingsCenterHash('#settings/' + tab));
  }
  assert.equal(parseSettingsCenterPath('/settings/admin-billing')?.tab, 'admin-billing');
  assert.equal(isAdminSubtabOwner('admin-features'), false);
  assert.equal(parseSettingsCenterPath('/settings/unknown'), null);
  assert.equal(parseSettingsCenterPath('/bazi'), null);
  assert.equal(getSettingsCenterRouteTarget('admin-ai-services', { subpath: 'gateways' }), '/settings/admin-ai-services/gateways');
});

test('disabled billing disables both the wallet and the usage log with their own explanations', () => {
  const flags = { ...ENABLED_FLAGS, billingEnabled: false };
  const tabs = getSettingsCenterTabs(flags);
  assert.equal(tabs.find(tab => tab.id === 'billing')?.disabled, true);
  assert.equal(tabs.find(tab => tab.id === 'usage-log')?.disabled, true);
  assert.deepEqual(getSettingsCenterDisabledState('billing', flags), {
    title: '暂未开放', description: '当前钱包不可用。',
  });
  assert.deepEqual(getSettingsCenterDisabledState('usage-log', flags), {
    title: '暂未开放', description: '当前用量日志不可用。',
  });
});

test('checkin is removed from default user-facing tool orders', () => {
  const defaultToolOrder = DEFAULT_TOOL_ORDER as readonly string[];
  const defaultMobileDrawerOrder = DEFAULT_MOBILE_DRAWER_ORDER as readonly string[];

  assert.equal(defaultToolOrder.includes('checkin'), false);
  assert.equal(defaultMobileDrawerOrder.includes('checkin'), false);
  assert.equal(defaultMobileDrawerOrder.includes('user/credits'), false);
  assert.equal(defaultMobileDrawerOrder.includes('settings-billing'), true);
  assert.deepEqual(getSidebarToolItems().map(item => item.id), [...DEFAULT_TOOL_ORDER]);
});

test('shared navigation and admin feature toggles do not expose legacy credits entries', () => {
  assert.equal(NAV_REGISTRY.some(item => item.id === 'user/credits' || item.href === '/user/credits'), false);
  assert.equal(getFeatureModules().some(item => item.id === 'credits' || item.label === '积分流水'), false);
  for (const id of ['agent', 'skills', 'connectors', 'schedules', 'memory', 'shares', 'annual-report']) {
    assert.ok(getFeatureModules().some(item => item.id === id), `${id} is available to administrators`);
  }
  for (const id of ['credits', 'taiyi', 'astrology', 'almanac']) {
    assert.equal(getFeatureModules().some(item => item.id === id), false, `${id} is no longer a switch`);
  }
  const headerSource = readFileSync(resolve(process.cwd(), 'src/components/layout/Header.tsx'), 'utf8');
  assert.equal(headerSource.includes("'/user/credits'"), false);
});

test('help navigation resolves the canonical settings route without legacy shells', () => {
  assert.equal(getNavItemById('settings-help')?.href, getSettingsCenterRouteTarget('help'));
  assert.equal(NAV_REGISTRY.some(item => ['/help', '/user/help'].includes(item.href)), false);
});

test('personalization registry and rendered link resolve the canonical settings route', () => {
  assert.equal(getNavItemById('settings-personalization')?.href, getSettingsCenterRouteTarget('personalization'));
  assert.equal(NAV_REGISTRY.some(item => item.href === '/user/ai-settings' || item.id === 'user/settings/ai'), false);
  const linkProps = { tab: 'personalization' as const, children: 'Preferences' };
  const html = renderToStaticMarkup(createElement(SettingsCenterLink, linkProps));
  assert.match(html, /href="\/settings\/personalization"/u);
});

test('settings panels retain route boundaries, payment results and private account affordances', () => {
  const hostSource = readFileSync(resolve(process.cwd(), 'src/components/settings/SettingsCenterHost.tsx'), 'utf8');
  const billingPanelSource = readFileSync(resolve(process.cwd(), 'src/components/settings/panels/BillingPanel.tsx'), 'utf8');
  const userMenuSource = readFileSync(resolve(process.cwd(), 'src/components/layout/UserMenu.tsx'), 'utf8');

  assert.doesNotMatch(hostSource, /import\(['"]@\/app\//u);
  assert.equal(hostSource.includes('SETTINGS_CENTER_GROUP_LABELS[entry.group]'), false);
  assert.equal(billingPanelSource.includes('const paymentResult = searchParams.get(\'payment\')'), true);
  assert.equal(billingPanelSource.includes('url.searchParams.delete(\'payment\')'), true);
  assert.equal(billingPanelSource.includes('showToast(result.tone, result.message)'), true);
  assert.equal(billingPanelSource.includes('redeemCode(code)'), true);
  assert.equal(billingPanelSource.includes('buyPlan(buying.id)'), true);
  assert.equal(billingPanelSource.includes('submitCheckout(await startCheckout(input))'), true);
  assert.equal(billingPanelSource.includes('formatUsd(result.amountMicros)'), true);
  assert.equal(userMenuSource.includes("`${membershipLabels[membership?.type || 'free']} Plan`"), false);
  // 账户菜单不再显示邮箱：不引 getUserEmailDisplay，也不渲染 user.email。
  assert.equal(userMenuSource.includes('getUserEmailDisplay'), false);
  assert.equal(userMenuSource.includes('displayEmail'), false);
  assert.equal(userMenuSource.includes('{user.email}'), false);
});

test('settings page renders disabled categories as locked non-clickable controls and falls back after flags load', () => {
  const hostSource = readFileSync(resolve(process.cwd(), 'src/components/settings/SettingsCenterPage.tsx'), 'utf8');

  assert.equal(hostSource.includes('loaded: featureTogglesLoaded'), true);
  assert.equal(hostSource.includes("router.replace(getSettingsCenterRouteTarget('general'))"), true);
  assert.equal(hostSource.includes('disabled={tab.disabled}'), true);
  assert.equal(hostSource.includes('aria-disabled={tab.disabled}'), true);
  assert.equal(hostSource.includes('cursor-not-allowed'), true);
  assert.equal(hostSource.includes('LockKeyhole'), true);
  assert.equal(hostSource.includes('border-amber-400/60'), false);
  assert.equal(hostSource.includes('bg-amber-500/5'), false);
  assert.equal(hostSource.includes('rounded-md border border-border px-1.5 py-0.5 text-[10px] text-foreground/50'), false);
});

test('the administrator 日志 category owns usage, Agent tasks and schedules; management subpages stay ordered', () => {
  const tabs = getSettingsCenterTabs({ ...ENABLED_FLAGS, isAdmin: true });
  assert.equal(getSettingsCenterTabs(ENABLED_FLAGS).some(tab => tab.id === 'admin-logs'), false);
  assert.deepEqual([tabs.find(tab => tab.id === 'admin-logs')?.label, tabs.find(tab => tab.id === 'admin-logs')?.group], ['日志', 'management']);
  assert.equal(tabs.findIndex(tab => tab.id === 'admin-logs'), tabs.findIndex(tab => tab.id === 'help') - 1);
  assert.deepEqual(ADMIN_SUBTABS['admin-logs'].map(option => option.label), ['用量日志', 'Agent 任务', '定时任务']);
  assert.deepEqual(ADMIN_SUBTABS['admin-billing'].map(option => option.id), ['users', 'plans', 'codes', 'orders', 'settings']);
  assert.deepEqual(ADMIN_SUBTABS['admin-ai-services'].map(option => option.id), ['models', 'gateways', 'agent-evals']);
  assert.equal(ADMIN_SUBTABS['admin-agent-extensions'].find(option => option.id === 'schedules')?.label, '定时任务额度');
});

test('mcp settings tab follows the public service feature toggle', () => {
  const flags = { ...ENABLED_FLAGS, mcpServiceEnabled: false };

  const tabs = getSettingsCenterTabs(flags);

  assert.equal(tabs.some((tab) => tab.id === 'mcp-service' && tab.disabled === true), true);
  assert.deepEqual(getSettingsCenterDisabledState('mcp-service', flags), {
    title: '暂未开放',
    description: '当前 MCP 服务入口不可用。',
  });
});

test('connectors sit among the extensions, follow the Agent toggle, and their admin page is for administrators only', () => {
  const tabs = getSettingsCenterTabs(ENABLED_FLAGS);
  const connectors = tabs.find(tab => tab.id === 'connectors');
  assert.deepEqual([connectors?.group, connectors?.label, connectors?.disabled], ['extensions', '连接器', false]);
  assert.equal(tabs.findIndex(tab => tab.id === 'mcp-service'), tabs.findIndex(tab => tab.id === 'connectors') + 1,
    'the inbound connectors stand next to, and apart from, the outbound MCP service page');
  assert.equal(tabs.some(tab => tab.id === 'admin-agent-extensions'), false);
  assert.equal(getSettingsCenterTabs({ ...ENABLED_FLAGS, isAdmin: true }).find(tab => tab.id === 'admin-agent-extensions')?.group, 'management');
  const off = { ...ENABLED_FLAGS, agentEnabled: false };
  assert.equal(getSettingsCenterTabs(off).find(tab => tab.id === 'connectors')?.disabled, true);
  assert.equal(getSettingsCenterDisabledState('connectors', off)?.title, '暂未开放');
  assert.deepEqual(parseSettingsCenterPath('/settings/admin-agent-extensions/policy'), { tab: 'admin-agent-extensions', subpath: 'policy' });
});

test('mcp service panel exposes public remote access without login or api keys', () => {
  const panelSource = readFileSync(resolve(process.cwd(), 'src/components/settings/panels/McpServicePanel.tsx'), 'utf8');
  const featureToggleSource = readFileSync(resolve(process.cwd(), 'src/components/admin/FeatureTogglePanel.tsx'), 'utf8');

  assert.equal(panelSource.includes("useState<McpConnectionMode>('remote')"), true);
  assert.equal(panelSource.includes('MCP 接入方式'), true);
  assert.equal(panelSource.includes('可用工具'), true);
  assert.equal(panelSource.includes('公开 Streamable HTTP'), true);
  assert.equal(panelSource.includes('无需认证'), true);
  assert.equal(panelSource.includes('本地 Stdio'), true);
  assert.equal(panelSource.includes('useSessionSafe'), false);
  assert.equal(panelSource.includes('SettingsLoginRequired'), false);
  assert.equal(panelSource.includes('border-amber-500'), false);
  assert.equal(panelSource.includes('bg-amber-500/10'), false);
  assert.equal(panelSource.includes("bg-amber-500/15 px-2 py-0.5 text-[11px]"), false);
  assert.equal(panelSource.includes('API Key 认证'), false);
  assert.equal(panelSource.includes('/api/user/mcp-key'), false);
  assert.equal(panelSource.includes('OAuth'), false);
  assert.equal(getFeatureModules().find(item => item.id === 'mcp-service')?.label, 'MCP 服务');
  assert.equal(featureToggleSource.includes('MCP OAuth'), false);
});

test('privacy and terms pages link back to canonical settings help route instead of /help shell', () => {
  const privacySource = readFileSync(resolve(process.cwd(), 'src/app/privacy/page.tsx'), 'utf8');
  const termsSource = readFileSync(resolve(process.cwd(), 'src/app/terms/page.tsx'), 'utf8');

  assert.equal(privacySource.includes('getSettingsCenterRouteTarget(\'help\')'), true);
  assert.equal(privacySource.includes('href="/help"'), false);
  assert.equal(termsSource.includes('getSettingsCenterRouteTarget(\'help\')'), true);
  assert.equal(termsSource.includes('href="/help"'), false);
});

test('header uses canonical settings labels and legal-page back fallback', () => {
  const headerSource = readFileSync(resolve(process.cwd(), 'src/components/layout/Header.tsx'), 'utf8');
  const announcementHostSource = readFileSync(resolve(process.cwd(), 'src/components/providers/AnnouncementPopupHost.tsx'), 'utf8');

  assert.equal(headerSource.includes("'/checkin': '订阅'"), false);
  assert.equal(headerSource.includes("'/user/ai-settings': '个性化'"), false);
  assert.equal(headerSource.includes("'/user/settings': '设置'"), false);
  assert.equal(headerSource.includes("'/user/charts': '命盘'"), false);
  assert.equal(headerSource.includes("'/user/mcp': 'MCP OAuth'"), false);
  assert.equal(headerSource.includes("'/help': '帮助'"), false);
  assert.equal(headerSource.includes("'/privacy': '隐私政策'"), true);
  assert.equal(headerSource.includes("'/terms': '服务条款'"), true);
  assert.equal(headerSource.includes("'/admin/features': '功能与激活码'"), false);
  assert.equal(headerSource.includes("'/admin/announcements': '公告'"), false);
  assert.equal(headerSource.includes("'/privacy': getSettingsCenterRouteTarget('help')"), true);
  assert.equal(headerSource.includes("'/terms': getSettingsCenterRouteTarget('help')"), true);
  assert.equal(headerSource.includes("'/user/settings': '偏好设置'"), false);
  assert.equal(headerSource.includes("'/user/ai-settings': 'AI 个性化'"), false);
  assert.equal(headerSource.includes("'/help': '帮助中心'"), false);
  assert.equal(headerSource.includes("useActiveSettingsCenterTab"), true);
  assert.equal(headerSource.includes("isAdminSettingsCenterTab(activeSettingsTab)"), true);
  assert.equal(announcementHostSource.includes("useActiveSettingsCenterTab"), true);
  assert.equal(announcementHostSource.includes("isAdminSettingsCenterTab(activeSettingsTab)"), true);
});


test('every admin subtab the sidebar offers is accepted by the settings route', () => {
  for (const tab of Object.keys(ADMIN_SUBTABS) as Array<keyof typeof ADMIN_SUBTABS>) {
    assert.equal(isAdminSubtabOwner(tab), true);
    for (const option of ADMIN_SUBTABS[tab]) {
      assert.equal(isAdminSubTab(tab, option.id), true, `${tab}/${option.id} is routable`);
    }
    assert.equal(isAdminSubTab(tab, 'not-a-subtab'), false);
    assert.equal(resolveAdminSubTab(tab, null), ADMIN_SUBTABS[tab][0].id);
  }
  assert.equal(isAdminSubTab('general', 'models'), false);
});
