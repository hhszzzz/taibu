/**
 * 设置中心的管理页：公告、功能开关、计费（用户账户、套餐、兑换码、订单、充值设置）、AI 服务（模型、网关、自定义模型策略与 Agent 测评）、
 * Agent 扩展（MCP 服务、技能、智能体角色、用户扩展策略与定时任务额度）、日志（用量日志、Agent 任务、定时任务）
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
const LazyBillingUsagePanel = lazy(async () => ({
  default: (await import('@/components/admin/billing/BillingUsagePanel')).BillingUsagePanel,
}));
const LazyBillingUsersPanel = lazy(async () => ({
  default: (await import('@/components/admin/billing/BillingUsersPanel')).BillingUsersPanel,
}));
const LazyBillingPlansPanel = lazy(async () => ({
  default: (await import('@/components/admin/billing/BillingPlansPanel')).BillingPlansPanel,
}));
const LazyBillingCodesPanel = lazy(async () => ({
  default: (await import('@/components/admin/billing/BillingCodesPanel')).BillingCodesPanel,
}));
const LazyBillingOrdersPanel = lazy(async () => ({
  default: (await import('@/components/admin/billing/BillingOrdersPanel')).BillingOrdersPanel,
}));
const LazyBillingSettingsPanel = lazy(async () => ({
  default: (await import('@/components/admin/billing/BillingSettingsPanel')).BillingSettingsPanel,
}));
const LazyAIModelPanel = lazy(async () => ({
  default: (await import('@/components/admin/AIModelPanel')).AIModelPanel,
}));
const LazyAIGatewayPanel = lazy(async () => ({
  default: (await import('@/components/admin/AIGatewayPanel')).AIGatewayPanel,
}));
const LazyByokPolicyPanel = lazy(async () => ({
  default: (await import('@/components/admin/ByokPolicyPanel')).ByokPolicyPanel,
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
const LazyAgentScheduleRunsPanel = lazy(async () => ({
  default: (await import('@/components/admin/AgentScheduleRunsPanel')).AgentScheduleRunsPanel,
}));
const LazyDeploymentLogsPanel = lazy(async () => ({
  default: (await import('@/components/admin/DeploymentLogsPanel')).DeploymentLogsPanel,
}));

type AdminBillingTab = AdminSubTabId<'admin-billing'>;
type AdminAITab = AdminSubTabId<'admin-ai-services'>;
type AdminExtensionsTab = AdminSubTabId<'admin-agent-extensions'>;
type AdminLogsTab = AdminSubTabId<'admin-logs'>;

function PanelFallback() {
  return (
    <div className="flex min-h-[240px] items-center justify-center">
      <SoundWaveLoader variant="inline" />
    </div>
  );
}

function useResolvedSettingsCenterSubtab<T extends AdminSubtabOwner>(owner: T): AdminSubTabId<T> {
  const subpath = useSettingsCenterSubpath();
  const active = useActiveSettingsCenterTab() === owner;
  const resolved = resolveAdminSubTab(owner, subpath);
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
function AdminSubtabs<T extends AdminSubtabOwner>({
  owner,
  renderPanel,
}: {
  owner: T;
  /** `active` is false for a visited tab kept mounted behind the current one. */
  renderPanel: (tab: AdminSubTabId<T>, active: boolean) => ReactNode;
}) {
  const activeTab = useResolvedSettingsCenterSubtab(owner);
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

const renderBillingPanel = (tab: AdminBillingTab, active: boolean) => (
  tab === 'users' ? <LazyBillingUsersPanel />
    : tab === 'plans' ? <LazyBillingPlansPanel />
      : tab === 'codes' ? <LazyBillingCodesPanel />
        : tab === 'orders' ? <LazyBillingOrdersPanel active={active} /> : <LazyBillingSettingsPanel />
);
const renderAIPanel = (tab: AdminAITab, active: boolean) => (
  tab === 'models' ? <LazyAIModelPanel />
    : tab === 'gateways' ? <LazyAIGatewayPanel />
      : tab === 'byok' ? <LazyByokPolicyPanel /> : <LazyAgentEvalPanel active={active} />
);
const renderLogsPanel = (tab: AdminLogsTab, active: boolean) => (
  tab === 'usage' ? <LazyBillingUsagePanel active={active} />
    : tab === 'agent-tasks' ? <LazyAgentTaskPanel active={active} />
      : tab === 'schedules' ? <LazyAgentScheduleRunsPanel active={active} /> : <LazyDeploymentLogsPanel />
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
    <Suspense fallback={<PanelFallback />}>
      <LazyFeatureTogglePanel />
    </Suspense>
  );
}

export function AdminBillingContent() {
  return (
    <AdminSubtabs owner="admin-billing" renderPanel={renderBillingPanel} />
  );
}

export function AdminAIServicesContent() {
  return (
    <AdminSubtabs owner="admin-ai-services" renderPanel={renderAIPanel} />
  );
}

export function AdminAgentExtensionsContent() {
  return (
    <AdminSubtabs owner="admin-agent-extensions" renderPanel={renderExtensionsPanel} />
  );
}

export function AdminLogsContent() {
  return (
    <AdminSubtabs owner="admin-logs" renderPanel={renderLogsPanel} />
  );
}
