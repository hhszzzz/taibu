/**
 * Navigation Registry — single source of truth for all navigation items.
 *
 * Every consumer (Sidebar, MobileNav, FeatureTogglePanel) imports helpers from this module instead of maintaining
 * its own duplicated item arrays.
 */
import {
  BotMessageSquare,
  User,
  Settings,
  CircleStar,
  Bell,
  MessageCircleHeart,
  BookOpenText,
  Scroll,
  CircleQuestionMark,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import {
  BaziIcon,
  CommunityIcon,
  DailyIcon,
  DaliurenIcon,
  FaceIcon,
  HepanIcon,
  LiuyaoIcon,
  MbtiIcon,
  MeihuaIcon,
  MonthlyIcon,
  PalmIcon,
  QimenIcon,
  RecordsIcon,
  TarotIcon,
  XiaoliurenIcon,
  ZiweiIcon,
} from '@/lib/navigation/nav-icons';
import { getSettingsCenterRouteTarget } from '@/lib/settings-center';

/** Icon type shared by Lucide icons and the custom single-stroke nav icons. */
export type NavIcon = ComponentType<{ className?: string; size?: number | string }>;

export type { LucideIcon };

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type NavCategory = 'divination' | 'tool' | 'user';

/** Sub-grouping used by the "全部占术" panel and the mobile drawer. */
export type DivinationGroup = 'chart' | 'divine' | 'sanshi' | 'xiang' | 'fortune';

export interface NavItemDef {
  /** Unique identifier — matches route segment or user-settings key */
  id: string;
  /** Route path */
  href: string;
  /** Display label (Chinese) */
  label: string;
  /** Icon component (Lucide or Phosphor) */
  icon: NavIcon;
  /** Optional emoji for sidebar tooltip / share cards */
  emoji?: string;
  /** Short description */
  description?: string;
  /**
   * Feature-toggle ID used by `useFeatureToggles().isFeatureEnabled()`.
   * When omitted the `id` itself is used as the feature ID.
   */
  featureId?: string;
  /** Logical grouping */
  category: NavCategory;
  /** Divination sub-group; required for `category: 'divination'` items. */
  group?: DivinationGroup;
}

// ---------------------------------------------------------------------------
// Registry data
// ---------------------------------------------------------------------------

export const NAV_REGISTRY: readonly NavItemDef[] = [
  // ── Divination ──────────────────────────────────────────────────────────
  { id: 'bazi', href: '/bazi', label: '八字', icon: BaziIcon, emoji: '🔮', description: '四柱八字精批', category: 'divination', group: 'chart' },
  { id: 'hepan', href: '/hepan', label: '八字合盘', icon: HepanIcon, emoji: '💑', description: '八字合盘', category: 'divination', group: 'chart' },
  { id: 'ziwei', href: '/ziwei', label: '紫微斗数', icon: ZiweiIcon, emoji: '⭐', description: '紫微命盘', category: 'divination', group: 'chart' },
  { id: 'tarot', href: '/tarot', label: '塔罗', icon: TarotIcon, emoji: '🃏', description: '塔罗占卜', category: 'divination', group: 'divine' },
  { id: 'liuyao', href: '/liuyao', label: '六爻', icon: LiuyaoIcon, emoji: '☯️', description: '六爻占卜', category: 'divination', group: 'divine' },
  { id: 'qimen', href: '/qimen', label: '奇门遁甲', icon: QimenIcon, emoji: '🧭', description: '奇门遁甲', category: 'divination', group: 'sanshi' },
  { id: 'daliuren', href: '/daliuren', label: '大六壬', icon: DaliurenIcon, emoji: '📜', description: '大六壬', category: 'divination', group: 'sanshi' },
  { id: 'meihua', href: '/meihua', label: '梅花易数', icon: MeihuaIcon, description: '梅花易数', category: 'divination', group: 'divine' },
  { id: 'xiaoliuren', href: '/xiaoliuren', label: '小六壬', icon: XiaoliurenIcon, description: '小六壬', category: 'divination', group: 'divine' },
  { id: 'face', href: '/face', label: '面相', icon: FaceIcon, emoji: '👤', description: '面相分析', category: 'divination', group: 'xiang' },
  { id: 'palm', href: '/palm', label: '手相', icon: PalmIcon, emoji: '🖐️', description: '手相分析', category: 'divination', group: 'xiang' },
  { id: 'mbti', href: '/mbti', label: 'MBTI 测试', icon: MbtiIcon, emoji: '🧩', description: '性格测试', category: 'divination', group: 'xiang' },

  { id: 'daily', href: '/daily', label: '日运', icon: DailyIcon, description: '日运 · 黄历', category: 'divination', group: 'fortune' },
  { id: 'monthly', href: '/monthly', label: '月运', icon: MonthlyIcon, description: '月运', category: 'divination', group: 'fortune' },

  // ── Tools ───────────────────────────────────────────────────────────────
  { id: 'chat', href: '/chat', label: '新聊天', icon: BotMessageSquare, category: 'tool' },
  { id: 'records', href: '/records', label: '命理记录', icon: RecordsIcon, category: 'tool' },
  { id: 'community', href: '/community', label: '社区', icon: CommunityIcon, category: 'tool' },

  // ── User ────────────────────────────────────────────────────────────────
  { id: 'settings-profile', href: getSettingsCenterRouteTarget('profile'), label: '我的', icon: User, category: 'user' },
  { id: 'settings-general', href: getSettingsCenterRouteTarget('general'), label: '设置', icon: Settings, category: 'user' },
  { id: 'settings-upgrade', href: getSettingsCenterRouteTarget('upgrade'), label: '订阅', icon: CircleStar, featureId: 'upgrade', category: 'user' },
  { id: 'settings-charts', href: getSettingsCenterRouteTarget('charts'), label: '命盘', icon: Scroll, featureId: 'charts', category: 'user' },
  { id: 'notifications', href: '/user/notifications', label: '通知', icon: Bell, featureId: 'notifications', category: 'user' },
  { id: 'settings-personalization', href: getSettingsCenterRouteTarget('personalization'), label: '个性化', icon: MessageCircleHeart, featureId: 'ai-personalization', category: 'user' },
  { id: 'settings-knowledge-base', href: getSettingsCenterRouteTarget('knowledge-base'), label: '知识库', icon: BookOpenText, featureId: 'knowledge-base', category: 'user' },
  { id: 'settings-help', href: getSettingsCenterRouteTarget('help'), label: '帮助中心', icon: CircleQuestionMark, featureId: 'help', category: 'user' },
] as const;

// ---------------------------------------------------------------------------
// Lookup helpers (built once, reused by every consumer)
// ---------------------------------------------------------------------------

const _byId = new Map<string, NavItemDef>(NAV_REGISTRY.map(n => [n.id, n]));

/** Resolve the feature-toggle ID for a given nav item ID. */
export function toFeatureId(navId: string): string {
  return _byId.get(navId)?.featureId ?? navId;
}

/** 导航名称不适合放进提示语时使用的功能名称（如「新聊天」是动作而非功能名）。 */
const FEATURE_LABEL_OVERRIDES: Readonly<Record<string, string>> = { chat: 'AI 对话' };

/** Resolve a human-readable feature name for a feature-toggle ID; null when unknown. */
export function getFeatureLabel(featureId: string): string | null {
  const override = FEATURE_LABEL_OVERRIDES[featureId];
  if (override) return override;
  return NAV_REGISTRY.find(item => (item.featureId ?? item.id) === featureId)?.label ?? null;
}

// ---------------------------------------------------------------------------
// Consumer-specific projections
// ---------------------------------------------------------------------------

/** Sidebar "命理体系" items (divination category). */
export function getSidebarNavItems() {
  return NAV_REGISTRY.filter(n => n.category === 'divination');
}

/** Display order and labels of the divination sub-groups. */
export const DIVINATION_GROUPS: readonly { id: DivinationGroup; label: string }[] = [
  { id: 'chart', label: '命盘' },
  { id: 'divine', label: '卜卦' },
  { id: 'sanshi', label: '三式' },
  { id: 'xiang', label: '相学与性格' },
  { id: 'fortune', label: '运势' },
];

/** Divination items bucketed by sub-group, in `DIVINATION_GROUPS` order; empty groups are dropped. */
export function groupDivinationItems(items: readonly NavItemDef[]): { id: DivinationGroup; label: string; items: NavItemDef[] }[] {
  return DIVINATION_GROUPS
    .map(group => ({ ...group, items: items.filter(item => item.group === group.id) }))
    .filter(group => group.items.length > 0);
}

/** Case-insensitive search over label, description and id; a blank query keeps every item. */
export function filterNavItems(items: readonly NavItemDef[], query: string): readonly NavItemDef[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return items;
  return items.filter(item => `${item.label} ${item.description ?? ''} ${item.id}`.toLowerCase().includes(keyword));
}

/** Sidebar "工具" items (tool category). */
export function getSidebarToolItems() {
  return NAV_REGISTRY.filter((n) => n.category === 'tool');
}

/** FeatureTogglePanel — modules list with admin-specific labels. */
export function getFeatureModules(): { id: string; label: string }[] {
  // Admin panel shows all toggleable features, including some that don't
  // appear in navigation (mcp-service). We derive what we can from the
  // registry and append admin-only entries.
  const fromRegistry: { id: string; label: string }[] = NAV_REGISTRY
    .filter(n => n.category !== 'user' || n.featureId)
    .map(n => ({
      id: n.featureId ?? n.id,
      label: adminLabelOverride[n.featureId ?? n.id] ?? n.label,
    }));

  // Deduplicate by id (some featureIds map to the same toggle)
  const seen = new Set<string>();
  const result: { id: string; label: string }[] = [];
  for (const item of fromRegistry) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }

  // Admin-only entries not in the nav registry
  for (const extra of ADMIN_ONLY_FEATURES) {
    if (!seen.has(extra.id)) {
      seen.add(extra.id);
      result.push(extra);
    }
  }

  return result;
}

/** Label overrides for the admin feature-toggle panel. */
const adminLabelOverride: Record<string, string> = {
  chat: 'AI 功能',
  community: '社区',
  records: '命理记录',
  daily: '日运',
  monthly: '月运',
  'knowledge-base': '知识库',
  'ai-personalization': '个性化',
  notifications: '消息通知',
  upgrade: '订阅',
  help: '帮助',
  charts: '我的命盘',
};

/** Features that only appear in the admin toggle panel. */
const ADMIN_ONLY_FEATURES: { id: string; label: string }[] = [
  { id: 'checkin', label: '签到' },
  { id: 'mcp-service', label: 'MCP 服务' },
];

/** Lookup a single registry entry by id. */
export function getNavItemById(id: string): NavItemDef | undefined {
  return _byId.get(id);
}
