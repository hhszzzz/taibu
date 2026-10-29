/**
 * 设置中心的管理页：公告、功能与激活码、AI 服务（含 Agent 任务排障）、Agent 扩展（MCP 服务、技能、智能体角色与用户扩展策略）
 *
 * 'use client' 标记说明：
 * - 子页跟随路由切换，需要 useState / useEffect 记住访问过的子页并保留其状态
 */
'use client';

import { Suspense, lazy, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useActiveSettingsCenterTab, useSettingsCenterSubpath } from '@/lib/hooks/useSettingsCenterRouteState';
import {
  resolveAdminSubTab,
  type AdminSubtabOwner,
  type AdminSubTabId,
} from '@/lib/admin/settings-subtabs';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';

const LazyAnnouncementManagementPanel = lazy(async () => ({
  default: (await import('@/components/admin/AnnouncementManagementPanel')).AnnouncementManagementPanel,
}));
const LazyFeatureTogglePanel = lazy(async () => ({
  default: (await import('@/components/admin/FeatureTogglePanel')).FeatureTogglePanel,
}));
const LazyKeyManagementPanel = lazy(async () => ({
  default: (await import('@/components/admin/KeyManagementPanel')).KeyManagementPanel,
}));
const LazyAIModelPanel = lazy(async () => ({
  default: (await import('@/components/admin/AIModelPanel')).AIModelPanel,
}));
const LazyAIGatewayPanel = lazy(async () => ({
  default: (await import('@/components/admin/AIGatewayPanel')).AIGatewayPanel,
}));
const LazyAgentTaskPanel = lazy(async () => ({
  default: (await import('@/components/admin/AgentTaskPanel')).AgentTaskPanel,
}));
const LazyAgentEvalPanel = lazy(async () => ({
  default: (await import('@/components/admin/AgentEvalPanel')).AgentEvalPanel,
}));
const LazyAgentMcpPanel = lazy(async () => ({
  default: (await import('@/components/admin/AgentMcpPanel')).AgentMcpPanel,
}));
const LazyAgentSkillsPanel = lazy(async () => ({
  default: (await import('@/components/admin/AgentSkillsPanel')).AgentSkillsPanel,
}));
const LazyAgentProfilesPanel = lazy(async () => ({
  default: (await import('@/components/admin/AgentProfilesPanel')).AgentProfilesPanel,
}));
const LazyAgentExtensionsPolicyPanel = lazy(async () => ({
  default: (await import('@/components/admin/AgentExtensionsPolicyPanel')).AgentExtensionsPolicyPanel,
}));
const LazyAgentScheduleLimitsPanel = lazy(async () => ({
  default: (await import('@/components/admin/AgentScheduleLimitsPanel')).AgentScheduleLimitsPanel,
}));

type AdminFeatureTab = AdminSubTabId<'admin-features'>;
type AdminAITab = AdminSubTabId<'admin-ai-services'>;
type AdminExtensionsTab = AdminSubTabId<'admin-agent-extensions'>;

function PanelFallback() {
  return (
    <div className="flex min-h-[240px] items-center justify-center">
      <SoundWaveLoader variant="inline" />
    </div>
  );
}

const resolveAdminFeatureTab = (value: string | null | undefined): AdminFeatureTab =>
  resolveAdminSubTab('admin-features', value);
const resolveAdminAITab = (value: string | null | undefined): AdminAITab =>
  resolveAdminSubTab('admin-ai-services', value);
const resolveAdminExtensionsTab = (value: string | null | undefined): AdminExtensionsTab =>
  resolveAdminSubTab('admin-agent-extensions', value);

function useResolvedSettingsCenterSubtab<T extends string>(
  owner: AdminSubtabOwner,
  resolveTab: (value: string | null | undefined) => T,
) {
  const subpath = useSettingsCenterSubpath();
  const active = useActiveSettingsCenterTab() === owner;
  const resolved = resolveTab(subpath);
  const [retained, setRetained] = useState(resolved);
  useEffect(() => {
    let current = true;
    if (active) queueMicrotask(() => { if (current) setRetained(resolved); });
    return () => { current = false; };
  }, [active, resolved]);
  return active ? resolved : retained;
}

function useVisitedSubtabs<T extends string>(active: T) {
  const [visited, setVisited] = useState<T[]>([active]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => { if (current) setVisited(tabs => tabs.includes(active) ? tabs : [...tabs, active]); });
    return () => { current = false; };
  }, [active]);
  return visited.includes(active) ? visited : [...visited, active];
}

/** 子页跟随路由切换；访问过的子页保持挂载，切回时不丢失列表与草稿。 */
function AdminSubtabs<T extends string>({
  owner,
  resolveTab,
  renderPanel,
}: {
  owner: AdminSubtabOwner;
  resolveTab: (value: string | null | undefined) => T;
  /** `active` is false for a visited tab kept mounted behind the current one. */
  renderPanel: (tab: T, active: boolean) => ReactNode;
}) {
  const activeTab = useResolvedSettingsCenterSubtab(owner, resolveTab);
  const visited = useVisitedSubtabs(activeTab);

  return (
    <Suspense fallback={<PanelFallback />}>
      {visited.map(tab => (
        <div key={tab} hidden={tab !== activeTab} inert={tab !== activeTab}>
          {renderPanel(tab, tab === activeTab)}
        </div>
      ))}
    </Suspense>
  );
}

const renderFeaturePanel = (tab: AdminFeatureTab) => (tab === 'toggles' ? <LazyFeatureTogglePanel /> : <LazyKeyManagementPanel />);
const renderAIPanel = (tab: AdminAITab, active: boolean) => (
  tab === 'models' ? <LazyAIModelPanel />
    : tab === 'gateways' ? <LazyAIGatewayPanel />
      : tab === 'agent-tasks' ? <LazyAgentTaskPanel active={active} /> : <LazyAgentEvalPanel active={active} />
);
const renderExtensionsPanel = (tab: AdminExtensionsTab) => (
  tab === 'mcp' ? <LazyAgentMcpPanel />
    : tab === 'skills' ? <LazyAgentSkillsPanel />
      : tab === 'profiles' ? <LazyAgentProfilesPanel />
        : tab === 'schedules' ? <LazyAgentScheduleLimitsPanel /> : <LazyAgentExtensionsPolicyPanel />
);

export function AdminAnnouncementsContent() {
  return (
    <Suspense fallback={<PanelFallback />}>
      <LazyAnnouncementManagementPanel />
    </Suspense>
  );
}

export function AdminFeaturesContent() {
  return (
    <AdminSubtabs
      owner="admin-features"
      resolveTab={resolveAdminFeatureTab}
      renderPanel={renderFeaturePanel}
    />
  );
}

export function AdminAIServicesContent() {
  return (
    <AdminSubtabs
      owner="admin-ai-services"
      resolveTab={resolveAdminAITab}
      renderPanel={renderAIPanel}
    />
  );
}

export function AdminAgentExtensionsContent() {
  return (
    <AdminSubtabs
      owner="admin-agent-extensions"
      resolveTab={resolveAdminExtensionsTab}
      renderPanel={renderExtensionsPanel}
    />
  );
}
