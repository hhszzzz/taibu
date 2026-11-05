'use client';

import { BetaBadge } from '@/components/ui/BetaBadge';
import { Button } from '@/components/ui/Button';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import './settings-page.css';
import {
  LockKeyhole,
  ArrowLeft,
  ChevronRight,
  Menu,
} from 'lucide-react';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useCurrentUserProfile } from '@/lib/hooks/useCurrentUserProfile';
import { useActiveSettingsCenterTab, useSettingsCenterSubpath } from '@/lib/hooks/useSettingsCenterRouteState';
import {
  getSettingsCenterDisabledState,
  getSettingsCenterTabs,
  isAdminSettingsCenterTab,
  getSettingsCenterRouteTarget,
  SETTINGS_CENTER_GROUP_LABELS,
  type SettingsCenterFlags,
  type SettingsCenterTab,
} from '@/lib/settings-center';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { getAdminSubTabs, isAdminSubtabOwner, resolveAdminSubTab } from '@/lib/admin/settings-subtabs';
import {
  SETTINGS_CENTER_ICON_SIZES,
  SETTINGS_CENTER_TAB_ICONS,
  type SettingsCenterIconProps,
} from '@/components/settings/settings-center-icons';

/** 侧栏收起状态只保存在本机。 */

const LazyGeneralSettingsContent = lazy(() => import('@/components/settings/panels/GeneralSettingsPanel'));
const LazyBillingContent = lazy(() => import('@/components/settings/panels/BillingPanel'));
const LazyUsageLogContent = lazy(() => import('@/components/settings/panels/UsageLogPanel'));
const LazyAISettingsContent = lazy(() => import('@/components/settings/panels/AISettingsPanel'));
const LazyBYOKContent = lazy(() => import('@/components/settings/panels/BYOKPanel'));
const LazyChartsContent = lazy(() => import('@/components/settings/panels/ChartsPanel'));
const LazyKnowledgeBaseManageContent = lazy(() => import('@/components/settings/panels/KnowledgeBasePanel'));
const LazyMcpPageContent = lazy(() => import('@/components/settings/panels/McpServicePanel'));
const LazyConnectorsContent = lazy(() => import('@/components/settings/panels/ConnectorsPanel'));
const LazySkillsContent = lazy(() => import('@/components/settings/panels/SkillsPanel'));
const LazyProfileContent = lazy(() => import('@/components/settings/panels/ProfilePanel'));
const LazyHelpContent = lazy(() => import('@/components/settings/panels/HelpPanel'));
const LazySharedLinksContent = lazy(() => import('@/components/settings/panels/SharedLinksPanel'));

type AccountAdminPanelName = keyof typeof import('@/components/settings/AccountAdminPanels');

const lazyAccountAdminPanel = (name: AccountAdminPanelName) => lazy(async () => ({
  default: (await import('@/components/settings/AccountAdminPanels'))[name],
}));

const LazyAdminAnnouncementsContent = lazyAccountAdminPanel('AdminAnnouncementsContent');
const LazyAdminFeaturesContent = lazyAccountAdminPanel('AdminFeaturesContent');
const LazyAdminBillingContent = lazyAccountAdminPanel('AdminBillingContent');
const LazyAdminAIServicesContent = lazyAccountAdminPanel('AdminAIServicesContent');
const LazyAdminAgentExtensionsContent = lazyAccountAdminPanel('AdminAgentExtensionsContent');
const LazyAdminLogsContent = lazyAccountAdminPanel('AdminLogsContent');

function SettingsPanelFallback() {
  return (
    <div className="settings-panel-state" role="status">加载中…</div>
  );
}

function SettingsTabDisabledState({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<SettingsCenterIconProps>;
  title: string;
  description: string;
}) {
  return (
    <div className="settings-empty-panel">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md text-foreground-secondary">
          <Icon size={SETTINGS_CENTER_ICON_SIZES.disabled} className="shrink-0" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-foreground-secondary">{description}</p>
        </div>
      </div>
    </div>
  );
}

function AdminPermissionRequiredState({ loggedIn }: { loggedIn: boolean }) {
  if (!loggedIn) {
    return <SettingsLoginRequired title="请先登录后使用管理功能" description="登录后系统会自动识别管理员账号。" />;
  }

  return (
    <div className="settings-empty-panel">
      <h2 className="text-sm font-semibold text-foreground">无权限访问</h2>
      <p className="mt-1 text-sm text-foreground-secondary">当前账号不在管理员名单中，无法查看该管理面板。</p>
    </div>
  );
}

function AdminStateErrorState() {
  return (
    <div className="settings-empty-panel">
      <h2 className="text-sm font-semibold text-foreground">管理员状态加载失败</h2>
      <p className="mt-1 text-sm text-foreground-secondary">暂时无法确认当前账号的管理员权限，请稍后重试。</p>
    </div>
  );
}

function renderLazyPanel(node: ReactElement) {
  return (
    <Suspense fallback={<SettingsPanelFallback />}>
      {node}
    </Suspense>
  );
}

function renderSettingsCenterPanel(
  tab: SettingsCenterTab,
  flags: SettingsCenterFlags,
  options: {
    isLoggedIn: boolean;
    isAdmin: boolean;
    profileLoading: boolean;
    profileError: boolean;
  },
): ReactElement {
  if (isAdminSettingsCenterTab(tab)) {
    if (options.profileLoading) {
      return <SettingsPanelFallback />;
    }
    if (options.profileError) {
      return <AdminStateErrorState />;
    }
    if (!options.isLoggedIn || !options.isAdmin) {
      return <AdminPermissionRequiredState loggedIn={options.isLoggedIn} />;
    }
  }

  const disabledState = getSettingsCenterDisabledState(tab, flags);
  if (disabledState) {
    return (
        <SettingsTabDisabledState
        icon={SETTINGS_CENTER_TAB_ICONS[tab]}
        title={disabledState.title}
        description={disabledState.description}
      />
    );
  }

  switch (tab) {
    case 'profile':
      return renderLazyPanel(<LazyProfileContent />);
    case 'general':
      return renderLazyPanel(<LazyGeneralSettingsContent />);
    case 'billing':
      return renderLazyPanel(<LazyBillingContent />);
    case 'usage-log':
      return renderLazyPanel(<LazyUsageLogContent />);
    case 'shares':
      return renderLazyPanel(<LazySharedLinksContent />);
    case 'personalization':
      return renderLazyPanel(<LazyAISettingsContent />);
    case 'byok':
      return renderLazyPanel(<LazyBYOKContent />);
    case 'help':
      return renderLazyPanel(<LazyHelpContent />);
    case 'charts':
      return renderLazyPanel(<LazyChartsContent />);
    case 'knowledge-base':
      return renderLazyPanel(<LazyKnowledgeBaseManageContent />);
    case 'connectors':
      return renderLazyPanel(<LazyConnectorsContent />);
    case 'skills':
      return renderLazyPanel(<LazySkillsContent />);
    case 'mcp-service':
      return renderLazyPanel(<LazyMcpPageContent />);
    case 'admin-announcements':
      return renderLazyPanel(<LazyAdminAnnouncementsContent />);
    case 'admin-features':
      return renderLazyPanel(<LazyAdminFeaturesContent />);
    case 'admin-billing':
      return renderLazyPanel(<LazyAdminBillingContent />);
    case 'admin-ai-services':
      return renderLazyPanel(<LazyAdminAIServicesContent />);
    case 'admin-agent-extensions':
      return renderLazyPanel(<LazyAdminAgentExtensionsContent />);
    case 'admin-logs':
      return renderLazyPanel(<LazyAdminLogsContent />);
  }
}

export function SettingsCenterPage({ children }: { children: React.ReactNode }) {
  const activeTab = useActiveSettingsCenterTab();
  const router = useRouter();
  const { isFeatureEnabled, loaded: featureTogglesLoaded } = useFeatureToggles();
  const { user } = useSessionSafe();
  const { profile, loading: profileLoading, error: profileError } = useCurrentUserProfile({ enabled: !!activeTab });
  const isAdmin = !!profile?.is_admin;
  const activeSubpath = useSettingsCenterSubpath();
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const flags = useMemo<SettingsCenterFlags>(() => ({
    sharesEnabled: !featureTogglesLoaded || isFeatureEnabled('shares'),
    skillsEnabled: !featureTogglesLoaded || isFeatureEnabled('skills'),
    connectorsEnabled: !featureTogglesLoaded || isFeatureEnabled('connectors'),
    billingEnabled: !featureTogglesLoaded || isFeatureEnabled('billing'),
    usageLogEnabled: !featureTogglesLoaded || isFeatureEnabled('usage-log'),
    chartsEnabled: !featureTogglesLoaded || isFeatureEnabled('charts'),
    knowledgeBaseEnabled: !featureTogglesLoaded || isFeatureEnabled('knowledge-base'),
    mcpServiceEnabled: !featureTogglesLoaded || isFeatureEnabled('mcp-service'),
    agentEnabled: !featureTogglesLoaded || isFeatureEnabled('agent'),
    personalizationEnabled: featureTogglesLoaded && isFeatureEnabled('chat') && isFeatureEnabled('ai-personalization'),
    byokEnabled: !featureTogglesLoaded || isFeatureEnabled('byok'),
    helpEnabled: !featureTogglesLoaded || isFeatureEnabled('help'), isAdmin,
  }), [featureTogglesLoaded, isAdmin, isFeatureEnabled]);
  const tabs = useMemo(() => getSettingsCenterTabs(flags).map(tab => ({ ...tab, icon: SETTINGS_CENTER_TAB_ICONS[tab.id] })), [flags]);
  const activeTabState = tabs.find(tab => tab.id === activeTab);
  const shouldFallbackToGeneral = featureTogglesLoaded && !!activeTabState?.disabled && activeTabState.id !== 'general';
  const resolvedActiveTab = shouldFallbackToGeneral ? 'general' : activeTab;
  const [mountedTabs, setMountedTabs] = useState<SettingsCenterTab[]>([]);
  const renderedTabs = resolvedActiveTab && !mountedTabs.includes(resolvedActiveTab) ? [...mountedTabs, resolvedActiveTab] : mountedTabs;
  useEffect(() => { if (shouldFallbackToGeneral) router.replace(getSettingsCenterRouteTarget('general')); }, [router, shouldFallbackToGeneral]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => { if (current && resolvedActiveTab) setMountedTabs(tabs => tabs.includes(resolvedActiveTab) ? tabs : [...tabs, resolvedActiveTab]); });
    return () => { current = false; };
  }, [resolvedActiveTab]);
  const displayTab = resolvedActiveTab ?? 'general';
  const displayTabState = tabs.find(tab => tab.id === displayTab);
  const activeTabLabel = displayTabState?.label ?? '设置';
  return <section className="settings-page" aria-labelledby="settings-center-heading">
    <aside id="settings-navigation" className={`settings-sidebar${mobileNavigation ? ' is-open' : ''}`}>
      <div className="settings-sidebar-head">
        <h1 id="settings-center-heading" className="settings-sidebar-title">设置</h1>
        <Link href="/bazi" className="settings-back" aria-label="返回太卜"><ArrowLeft size={16} /><span>返回太卜</span></Link>
      </div>
      <nav aria-label="设置分类" className="settings-sidebar-nav">
        {(['account', 'extensions', 'management'] as const).map(group => {
          const items = tabs.filter(tab => tab.group === group);
          if (!items.length) return null;
          return <div className="settings-nav-group" key={group}>
            <h2>{SETTINGS_CENTER_GROUP_LABELS[group]}</h2>
            <div className="settings-nav-list">
              {items.map(tab => {
                const Icon = tab.icon;
                const href = isAdminSubtabOwner(tab.id)
                  ? getSettingsCenterRouteTarget(tab.id, { subpath: resolveAdminSubTab(tab.id, activeSubpath) })
                  : getSettingsCenterRouteTarget(tab.id);
                const content = <><Icon size={SETTINGS_CENTER_ICON_SIZES.sidebar} className="shrink-0" /><span className="settings-nav-label">{tab.label}{tab.beta ? <BetaBadge /> : null}</span>{tab.disabled ? <LockKeyhole size={14} /> : <ChevronRight size={14} className="settings-nav-chevron" />}</>;
                return <div className="settings-nav-entry" key={tab.id}>
                  {tab.disabled
                    ? <Button unstyled type="button" disabled={tab.disabled} aria-disabled={tab.disabled} className="settings-nav-item cursor-not-allowed">{content}</Button>
                    : <Link href={href} aria-current={tab.id === displayTab ? 'page' : undefined} className="settings-nav-item" onClick={() => setMobileNavigation(false)}>{content}</Link>}
                  {isAdminSubtabOwner(tab.id) && tab.id === displayTab && <div className="settings-nav-sub" role="group" aria-label={`${tab.label}子页`}>
                    {getAdminSubTabs(tab.id).map(sub => <Link
                      key={sub.id}
                      href={getSettingsCenterRouteTarget(tab.id, { subpath: sub.id })}
                      aria-current={activeSubpath === sub.id ? 'page' : undefined}
                      className="settings-nav-subitem"
                      onClick={() => setMobileNavigation(false)}
                    >{sub.label}</Link>)}
                  </div>}
                </div>;
              })}
            </div>
          </div>;
        })}
      </nav>
    </aside>
    <Button unstyled type="button" className={`settings-sidebar-scrim${mobileNavigation ? ' is-visible' : ''}`} aria-label="关闭分类" tabIndex={mobileNavigation ? 0 : -1} onClick={() => setMobileNavigation(false)} />
    <main className="settings-main">
      <div className="settings-main-inner">
        <div className="settings-main-head">
          <Button variant="ghost" size="md" className="settings-mobile-menu" aria-label="设置分类" aria-expanded={mobileNavigation} aria-controls="settings-navigation" onClick={() => setMobileNavigation(value => !value)}><Menu size={18} aria-hidden="true" /><span>分类</span></Button>
          <div className="settings-content-heading"><h2>{activeTabLabel}</h2>{displayTabState?.description && <p>{displayTabState.description}</p>}</div>
        </div>
        <div className="settings-content">
          {children}
          {renderedTabs.map(tab => <div key={`${user?.id ?? 'visitor'}:${tab}`} className={tab === resolvedActiveTab ? 'block' : 'hidden'} aria-hidden={tab === resolvedActiveTab ? undefined : true} inert={tab !== resolvedActiveTab}>
            {renderSettingsCenterPanel(tab, flags, { isLoggedIn: !!user, isAdmin, profileLoading, profileError: !!profileError })}
          </div>)}
        </div>
      </div>
    </main>
  </section>;
}
