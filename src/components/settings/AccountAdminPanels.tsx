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
import { openSettingsCenter } from '@/lib/settings-center';
import {
  SettingsTabs,
  getSettingsTabId,
  getSettingsTabPanelId,
  type SettingsTabOption,
} from '@/components/settings/SettingsControls';
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

type AdminSubtabOwner = 'admin-features' | 'admin-ai-services' | 'admin-agent-extensions';
type AdminFeatureTab = 'toggles' | 'keys';
type AdminAITab = 'models' | 'gateways' | 'agent-tasks' | 'agent-evals';
type AdminExtensionsTab = 'mcp' | 'skills' | 'profiles' | 'policy' | 'schedules';

const FEATURE_TABS: SettingsTabOption<AdminFeatureTab>[] = [
  { id: 'toggles', label: '功能开关' },
  { id: 'keys', label: '激活码' },
];

const AI_TABS: SettingsTabOption<AdminAITab>[] = [
  { id: 'models', label: '模型管理' },
  { id: 'gateways', label: '网关管理' },
  { id: 'agent-tasks', label: 'Agent 任务' },
  { id: 'agent-evals', label: 'Agent 测评' },
];

const EXTENSIONS_TABS: SettingsTabOption<AdminExtensionsTab>[] = [
  { id: 'mcp', label: 'MCP 服务' },
  { id: 'skills', label: '技能' },
  { id: 'profiles', label: '角色' },
  { id: 'policy', label: '用户扩展' },
  { id: 'schedules', label: '定时任务' },
];

function PanelFallback() {
  return (
    <div className="flex min-h-[240px] items-center justify-center">
      <SoundWaveLoader variant="inline" />
    </div>
  );
}

function resolveAdminFeatureTab(value: string | null | undefined): AdminFeatureTab {
  return value === 'keys' ? 'keys' : 'toggles';
}

function resolveAdminAITab(value: string | null | undefined): AdminAITab {
  return value === 'gateways' || value === 'agent-tasks' || value === 'agent-evals' ? value : 'models';
}

function resolveAdminExtensionsTab(value: string | null | undefined): AdminExtensionsTab {
  return value === 'policy' || value === 'skills' || value === 'profiles' || value === 'schedules' ? value : 'mcp';
}

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
  label,
  tabs,
  resolveTab,
  renderPanel,
}: {
  owner: AdminSubtabOwner;
  label: string;
  tabs: readonly SettingsTabOption<T>[];
  resolveTab: (value: string | null | undefined) => T;
  /** `active` is false for a visited tab kept mounted behind the current one. */
  renderPanel: (tab: T, active: boolean) => ReactNode;
}) {
  const activeTab = useResolvedSettingsCenterSubtab(owner, resolveTab);
  const visited = useVisitedSubtabs(activeTab);

  return (
    <div className="flex flex-col gap-6">
      <SettingsTabs
        label={label}
        idPrefix={owner}
        tabs={tabs}
        value={activeTab}
        onChange={(nextTab) => openSettingsCenter(owner, { subpath: nextTab })}
      />
      <Suspense fallback={<PanelFallback />}>
        {visited.map(tab => (
          <div
            key={tab}
            role="tabpanel"
            id={getSettingsTabPanelId(owner, tab)}
            aria-labelledby={getSettingsTabId(owner, tab)}
            hidden={tab !== activeTab}
            inert={tab !== activeTab}
          >
            {renderPanel(tab, tab === activeTab)}
          </div>
        ))}
      </Suspense>
    </div>
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
      label="功能与激活码"
      tabs={FEATURE_TABS}
      resolveTab={resolveAdminFeatureTab}
      renderPanel={renderFeaturePanel}
    />
  );
}

export function AdminAIServicesContent() {
  return (
    <AdminSubtabs
      owner="admin-ai-services"
      label="AI 服务"
      tabs={AI_TABS}
      resolveTab={resolveAdminAITab}
      renderPanel={renderAIPanel}
    />
  );
}

export function AdminAgentExtensionsContent() {
  return (
    <AdminSubtabs
      owner="admin-agent-extensions"
      label="Agent 扩展"
      tabs={EXTENSIONS_TABS}
      resolveTab={resolveAdminExtensionsTab}
      renderPanel={renderExtensionsPanel}
    />
  );
}
