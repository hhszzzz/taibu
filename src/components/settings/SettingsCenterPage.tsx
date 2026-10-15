'use client';

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
import { useActiveSettingsCenterTab } from '@/lib/hooks/useSettingsCenterRouteState';
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
import {
  SETTINGS_CENTER_ICON_SIZES,
  SETTINGS_CENTER_TAB_ICONS,
  type SettingsCenterIconProps,
} from '@/components/settings/settings-center-icons';

const LazyGeneralSettingsContent = lazy(() => import('@/components/settings/panels/GeneralSettingsPanel'));
const LazyUpgradeContent = lazy(() => import('@/components/settings/panels/UpgradePanel'));
const LazyAISettingsContent = lazy(() => import('@/components/settings/panels/AISettingsPanel'));
const LazyBYOKContent = lazy(() => import('@/components/settings/panels/BYOKPanel'));
const LazyChartsContent = lazy(() => import('@/components/settings/panels/ChartsPanel'));
const LazyKnowledgeBaseManageContent = lazy(() => import('@/components/settings/panels/KnowledgeBasePanel'));
const LazyMcpPageContent = lazy(() => import('@/components/settings/panels/McpServicePanel'));
const LazyProfileContent = lazy(() => import('@/components/settings/panels/ProfilePanel'));
const LazyHelpContent = lazy(() => import('@/components/settings/panels/HelpPanel'));
const LazyAdminAnnouncementsContent = lazy(async () => ({
  default: (await import('@/components/settings/AccountAdminPanels')).AdminAnnouncementsContent,
}));
const LazyAdminFeaturesContent = lazy(async () => ({
  default: (await import('@/components/settings/AccountAdminPanels')).AdminFeaturesContent,
}));
const LazyAdminAIServicesContent = lazy(async () => ({
  default: (await import('@/components/settings/AccountAdminPanels')).AdminAIServicesContent,
}));

export type SettingsCenterTabItem = {
  id: SettingsCenterTab;
  label: string;
  group: string;
  icon: ComponentType<{ className?: string; size?: number | string }>;
  disabled: boolean;
};

function SettingsPanelFallback() {
  return (
    <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-border bg-background">
      <div className="text-sm text-foreground-secondary">加载中...</div>
    </div>
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
    <div className="rounded-lg border border-border bg-background p-5">
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
    <div className="rounded-lg border border-border bg-background p-5">
      <h2 className="text-sm font-semibold text-foreground">无权限访问</h2>
      <p className="mt-1 text-sm text-foreground-secondary">当前账号不在管理员名单中，无法查看该管理面板。</p>
    </div>
  );
}

function AdminStateErrorState() {
  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <h2 className="text-sm font-semibold text-foreground">管理员状态加载失败</h2>
      <p className="mt-1 text-sm text-foreground-secondary">暂时无法确认当前账号的管理员权限，请稍后重试。</p>
    </div>
  );
}

function isAdminTab(tab: SettingsCenterTab) {
  return isAdminSettingsCenterTab(tab);
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
  if (isAdminTab(tab)) {
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
    case 'upgrade':
      return renderLazyPanel(<LazyUpgradeContent />);
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
    case 'mcp-service':
      return renderLazyPanel(<LazyMcpPageContent />);
    case 'admin-announcements':
      return renderLazyPanel(<LazyAdminAnnouncementsContent />);
    case 'admin-features':
      return renderLazyPanel(<LazyAdminFeaturesContent />);
    case 'admin-ai-services':
      return renderLazyPanel(<LazyAdminAIServicesContent />);
  }
}

export function SettingsCenterPage({ children }: { children: React.ReactNode }) {
  const activeTab = useActiveSettingsCenterTab();
  const router = useRouter();
  const { isFeatureEnabled, loaded: featureTogglesLoaded } = useFeatureToggles();
  const { user } = useSessionSafe();
  const { profile, loading: profileLoading, error: profileError } = useCurrentUserProfile({ enabled: !!activeTab });
  const isAdmin = !!profile?.is_admin;
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const flags = useMemo<SettingsCenterFlags>(() => ({
    upgradeEnabled: !featureTogglesLoaded || isFeatureEnabled('upgrade'),
    chartsEnabled: !featureTogglesLoaded || isFeatureEnabled('charts'),
    knowledgeBaseEnabled: !featureTogglesLoaded || isFeatureEnabled('knowledge-base'),
    mcpServiceEnabled: !featureTogglesLoaded || isFeatureEnabled('mcp-service'),
    personalizationEnabled: featureTogglesLoaded && isFeatureEnabled('chat') && isFeatureEnabled('ai-personalization'),
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
    <header className="settings-page-header">
      <Link href="/bazi" className="settings-back"><ArrowLeft size={16} /><span>返回太卜</span></Link>
      <h1 id="settings-center-heading">设置</h1>
      <button type="button" className="settings-mobile-menu" aria-label="设置分类" aria-expanded={mobileNavigation} aria-controls="settings-navigation" onClick={() => setMobileNavigation(value => !value)}><Menu size={18} /><span>分类</span></button>
    </header>
    <div className="settings-page-body">
      <aside id="settings-navigation" className={`settings-navigation${mobileNavigation ? ' is-open' : ''}`}>
        <nav aria-label="设置分类">
          {(['account', 'extensions', 'management'] as const).map(group => {
            const items = tabs.filter(tab => tab.group === group);
            if (!items.length) return null;
            return <div className="settings-nav-group" key={group}>
              <h2>{SETTINGS_CENTER_GROUP_LABELS[group]}</h2>
              <div className="settings-nav-list">
                {items.map(tab => {
                  const Icon = tab.icon;
                  const content = <><Icon size={SETTINGS_CENTER_ICON_SIZES.sidebar} className="shrink-0" /><span>{tab.label}</span>{tab.disabled ? <LockKeyhole size={14} /> : <ChevronRight size={14} className="settings-nav-chevron" />}</>;
                  return tab.disabled ? <button key={tab.id} type="button" disabled={tab.disabled} aria-disabled={tab.disabled} className="settings-nav-item cursor-not-allowed">{content}</button>
                    : <Link key={tab.id} href={getSettingsCenterRouteTarget(tab.id)} aria-current={tab.id === displayTab ? 'page' : undefined} className="settings-nav-item" onClick={() => setMobileNavigation(false)}>{content}</Link>;
                })}
              </div>
            </div>;
          })}
        </nav>
      </aside>
      <div className={`settings-content${mobileNavigation ? ' mobile-hidden' : ''}`}>
        <div className="settings-content-heading"><h2>{activeTabLabel}</h2>{displayTabState?.description && <p>{displayTabState.description}</p>}</div>
        {children}
        {renderedTabs.map(tab => <div key={`${user?.id ?? 'visitor'}:${tab}`} className={tab === resolvedActiveTab ? 'block' : 'hidden'} aria-hidden={tab === resolvedActiveTab ? undefined : true} inert={tab !== resolvedActiveTab}>
          {renderSettingsCenterPanel(tab, flags, { isLoggedIn: !!user, isAdmin, profileLoading, profileError: !!profileError })}
        </div>)}
      </div>
    </div>
  </section>;
}
