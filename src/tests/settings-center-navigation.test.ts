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
  openSettingsCenter,
  closeSettingsCenter,
} from '../lib/settings-center';
import { DEFAULT_MOBILE_DRAWER_ORDER, DEFAULT_TOOL_ORDER } from '../lib/user/settings';

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
  upgradeEnabled: true, chartsEnabled: true, knowledgeBaseEnabled: true,
  mcpServiceEnabled: true, personalizationEnabled: true, helpEnabled: true, isAdmin: false,
};

// Mounted-panel identity, close/reopen and per-user loading are behavior-owned by
// scripts/tests/p5-browser-fixture.mjs, enforced by pnpm test:browser in verify/CI.
// Unit tests below retain fast route/registry contracts and unique UI/security guards.


test('settings center keeps only the merged membership tab and rejects removed legacy credits hash', () => {
  const tabs = getSettingsCenterTabs(ENABLED_FLAGS);

  assert.equal(tabs.some((tab) => tab.id === 'upgrade' && tab.disabled === false), true);
  assert.equal(getNavItemById('settings-upgrade')?.href, getSettingsCenterRouteTarget('upgrade'));
  assert.equal(parseSettingsCenterHash('#settings/credits'), null);
  assert.equal(
    getSettingsCenterRouteTarget('upgrade', { search: '?claim=ok' }),
    '/bazi?claim=ok#settings/upgrade',
  );
  assert.equal(
    getSettingsCenterRouteTargetForPath('/daliuren', 'upgrade', { search: '?foo=bar' }),
    '/daliuren?foo=bar#settings/upgrade',
  );
  assert.equal(
    getSettingsCenterRouteTargetForPath('/', 'general'),
    '/#settings/general',
  );
  assert.equal(tabs.findIndex((tab) => tab.id === 'byok'), tabs.findIndex((tab) => tab.id === 'personalization') + 1);
  assert.equal(tabs.at(-1)?.id, 'help');
  assert.equal(getSettingsCenterRouteTarget('byok'), '/bazi#settings/byok');
});

test('settings navigation uses the current path, replaces tabs and closes through browser history', (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const writes: Array<{ method: string; url: string }> = [];
  let state: unknown = null;
  let backCalls = 0;
  const location = new URL('https://fixture.invalid/daliuren?step=2');
  const change = (method: string, next: unknown, url: string) => { state = next; writes.push({ method, url }); };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location,
    history: {
      get state() { return state; },
      pushState: (next: unknown, _unused: string, url: string) => change('push', next, url),
      replaceState: (next: unknown, _unused: string, url: string) => change('replace', next, url),
      back: () => { backCalls++; },
    },
    dispatchEvent: () => true,
  } });
  t.after(() => originalWindow
    ? Object.defineProperty(globalThis, 'window', originalWindow)
    : Reflect.deleteProperty(globalThis, 'window'));

  assert.equal(getCurrentSettingsCenterRouteTarget('general'), '/daliuren?step=2#settings/general');
  openSettingsCenter('personalization');
  openSettingsCenter('byok', { replace: true });
  closeSettingsCenter();
  assert.deepEqual(writes, [
    { method: 'push', url: '/daliuren?step=2#settings/personalization' },
    { method: 'replace', url: '/daliuren?step=2#settings/byok' },
  ]);
  assert.equal(backCalls, 1);
});

test('disabled membership is unavailable in both tab projection and explanation', () => {
  const flags = { ...ENABLED_FLAGS, upgradeEnabled: false };
  assert.equal(getSettingsCenterTabs(flags).find(tab => tab.id === 'upgrade')?.disabled, true);
  assert.deepEqual(getSettingsCenterDisabledState('upgrade', flags), {
    title: '暂未开放', description: '当前订阅不可用。',
  });
});

test('checkin is removed from default user-facing tool orders', () => {
  const defaultToolOrder = DEFAULT_TOOL_ORDER as readonly string[];
  const defaultMobileDrawerOrder = DEFAULT_MOBILE_DRAWER_ORDER as readonly string[];

  assert.equal(defaultToolOrder.includes('checkin'), false);
  assert.equal(defaultMobileDrawerOrder.includes('checkin'), false);
  assert.equal(defaultMobileDrawerOrder.includes('user/credits'), false);
  assert.equal(defaultMobileDrawerOrder.includes('settings-upgrade'), true);
  assert.deepEqual(getSidebarToolItems().map(item => item.id), [...DEFAULT_TOOL_ORDER]);
});

test('shared navigation and admin feature toggles do not expose legacy credits entries', () => {
  assert.equal(NAV_REGISTRY.some(item => item.id === 'user/credits' || item.href === '/user/credits'), false);
  assert.equal(getFeatureModules().some(item => item.id === 'credits' || item.label === '积分流水'), false);
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
  assert.match(html, /href="\/bazi#settings\/personalization"/u);
});

test('settings panels retain route boundaries, Linux.do claims and private account affordances', () => {
  const hostSource = readFileSync(resolve(process.cwd(), 'src/components/settings/SettingsCenterHost.tsx'), 'utf8');
  const upgradePanelSource = readFileSync(resolve(process.cwd(), 'src/components/settings/panels/UpgradePanel.tsx'), 'utf8');
  const userMenuSource = readFileSync(resolve(process.cwd(), 'src/components/layout/UserMenu.tsx'), 'utf8');

  assert.doesNotMatch(hostSource, /import\(['"]@\/app\//u);
  assert.equal(hostSource.includes('SETTINGS_CENTER_GROUP_LABELS[entry.group]'), false);
  assert.equal(upgradePanelSource.includes("const hasLinuxDoLogin = typeof user?.user_metadata?.linuxdo_sub === 'string'"), true);
  assert.equal(upgradePanelSource.includes('{hasLinuxDoLogin ? ('), true);
  assert.equal(upgradePanelSource.includes("showToast('success', 'Linux.do 月度会员已领取')"), false);
  assert.equal(upgradePanelSource.includes("showToast('success', `恭喜领取 ${planName ?? '会员'} 会员`)"), true);
  assert.equal(upgradePanelSource.includes('const linuxDoClaimDisabled = hasLinuxDoLogin'), true);
  assert.equal(upgradePanelSource.includes("returnTo: getSettingsCenterRouteTargetForPath(pathname, 'upgrade'"), true);
  assert.equal(userMenuSource.includes("`${membershipLabels[membership?.type || 'free']} Plan`"), false);
  assert.equal(userMenuSource.includes("import { getUserEmailDisplay } from '@/lib/user-email';"), true);
  assert.equal(userMenuSource.includes('const displayEmail = getUserEmailDisplay(user);'), true);
  assert.equal(userMenuSource.includes('{user.email}'), false);
});

test('settings center host renders disabled tabs as locked non-clickable controls and falls back to general', () => {
  const hostSource = readFileSync(resolve(process.cwd(), 'src/components/settings/SettingsCenterHost.tsx'), 'utf8');

  assert.equal(hostSource.includes('loaded: featureTogglesLoaded'), true);
  assert.equal(hostSource.includes("openSettingsCenter('general', { replace: true })"), true);
  assert.equal(hostSource.includes('disabled={tab.disabled}'), true);
  assert.equal(hostSource.includes('aria-disabled={tab.disabled}'), true);
  assert.equal(hostSource.includes('cursor-not-allowed'), true);
  assert.equal(hostSource.includes('LockKeyhole'), true);
  assert.equal(hostSource.includes('border-amber-400/60'), false);
  assert.equal(hostSource.includes('bg-amber-500/5'), false);
  assert.equal(hostSource.includes('rounded-md border border-border px-1.5 py-0.5 text-[10px] text-foreground/50'), false);
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
