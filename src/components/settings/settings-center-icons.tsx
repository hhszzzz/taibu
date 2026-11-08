import type { ComponentType } from 'react';
import {
  BellIcon,
  BillingIcon,
  ChartsIcon,
  ConnectorsIcon,
  FeatureFlagsIcon,
  GaugeIcon,
  HelpIcon,
  KeyIcon,
  KnowledgeIcon,
  McpIcon,
  MegaphoneIcon,
  MemoryIcon,
  PersonalizationIcon,
  PluginIcon,
  ProfileIcon,
  RecordsIcon,
  ScheduleIcon,
  ServerIcon,
  SettingsIcon,
  ShareLinkIcon,
  SkillIcon,
  SubscriptionIcon,
  WalletIcon,
} from '@/lib/navigation/nav-icons';
import type { SettingsSearchIconName } from '@/lib/settings-search';
import type { SettingsCenterTab } from '@/lib/settings-center';

export type SettingsCenterIconProps = {
  className?: string;
  size?: number | string;
  /** 保留旧调用签名（此前的 phosphor 图标带字重）；自定义单线图标不使用。 */
  weight?: string;
};

export const SETTINGS_CENTER_ICON_SIZES = {
  sidebar: 20,
  disabled: 20,
  mobile: 14,
} as const;

/**
 * 设置中心图标 = 全站统一的自绘单线图标（与占术导航同一套 24 网格语言）。
 * 这里只把默认尺寸固定成设置侧的 18px，形状与权重完全交给 nav-icons。
 */
function withDefaultSize(Icon: ComponentType<{ className?: string; size?: number | string }>) {
  const Wrapped = ({ size = SETTINGS_CENTER_ICON_SIZES.sidebar, className }: SettingsCenterIconProps) => (
    <Icon size={size} className={className} />
  );
  Wrapped.displayName = `WithDefaultSize(${Icon.displayName ?? Icon.name ?? 'Icon'})`;
  return Wrapped;
}

export const SETTINGS_CENTER_TAB_ICONS: Record<SettingsCenterTab, ComponentType<SettingsCenterIconProps>> = {
  profile: withDefaultSize(ProfileIcon),
  general: withDefaultSize(SettingsIcon),
  billing: withDefaultSize(BillingIcon),
  'usage-log': withDefaultSize(GaugeIcon),
  shares: withDefaultSize(ShareLinkIcon),
  personalization: withDefaultSize(PersonalizationIcon),
  byok: withDefaultSize(KeyIcon),
  help: withDefaultSize(HelpIcon),
  charts: withDefaultSize(ChartsIcon),
  'knowledge-base': withDefaultSize(KnowledgeIcon),
  connectors: withDefaultSize(ConnectorsIcon),
  skills: withDefaultSize(SkillIcon),
  'mcp-service': withDefaultSize(McpIcon),
  'admin-announcements': withDefaultSize(MegaphoneIcon),
  'admin-features': withDefaultSize(FeatureFlagsIcon),
  'admin-billing': withDefaultSize(BillingIcon),
  'admin-ai-services': withDefaultSize(ServerIcon),
  'admin-agent-extensions': withDefaultSize(PluginIcon),
  'admin-logs': withDefaultSize(RecordsIcon),
};

/** 搜索结果里有专属图标的设置项（如「记忆」），其余沿用所在分页的图标。 */
export const SETTINGS_SEARCH_ITEM_ICONS: Record<SettingsSearchIconName, ComponentType<SettingsCenterIconProps>> = {
  bell: withDefaultSize(BellIcon),
  memory: withDefaultSize(MemoryIcon),
  schedule: withDefaultSize(ScheduleIcon),
  subscription: withDefaultSize(SubscriptionIcon),
  wallet: withDefaultSize(WalletIcon),
};
