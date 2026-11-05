import type { SettingsCenterTab } from '@/lib/settings-center';

/**
 * 管理端分类的子页。设置页路由、侧栏导航与各管理面板共用这一份定义，
 * 避免界面新增子页后路由白名单没有跟上而 404。
 */
export const ADMIN_SUBTABS = {
  'admin-billing': [
    { id: 'users', label: '用户账户' },
    { id: 'plans', label: '套餐' },
    { id: 'codes', label: '兑换码' },
    { id: 'orders', label: '订单' },
    { id: 'settings', label: '充值设置' },
  ],
  'admin-ai-services': [
    { id: 'models', label: '模型管理' },
    { id: 'gateways', label: '网关管理' },
    { id: 'byok', label: '自定义模型' },
    { id: 'agent-evals', label: 'Agent 测评' },
  ],
  'admin-agent-extensions': [
    { id: 'mcp', label: 'MCP 服务' },
    { id: 'skills', label: '技能' },
    { id: 'profiles', label: '角色' },
    { id: 'policy', label: '用户扩展' },
    { id: 'schedules', label: '定时任务额度' },
  ],
  'admin-logs': [
    { id: 'usage', label: '用量日志' },
    { id: 'agent-tasks', label: 'Agent 任务' },
    { id: 'schedules', label: '定时任务' },
    { id: 'deployment', label: '部署日志' },
  ],
} as const;

export type AdminSubtabOwner = keyof typeof ADMIN_SUBTABS;
type AdminSubTabOption<T extends AdminSubtabOwner> = (typeof ADMIN_SUBTABS)[T][number];
export type AdminSubTabId<T extends AdminSubtabOwner> = AdminSubTabOption<T>['id'];

const ADMIN_SUBTAB_OWNERS = Object.keys(ADMIN_SUBTABS) as AdminSubtabOwner[];

export function isAdminSubtabOwner(tab: SettingsCenterTab | null | undefined): tab is AdminSubtabOwner {
  return !!tab && (ADMIN_SUBTAB_OWNERS as string[]).includes(tab);
}

export function getAdminSubTabs<T extends AdminSubtabOwner>(owner: T): typeof ADMIN_SUBTABS[T] {
  return ADMIN_SUBTABS[owner];
}

function hasSubTab(owner: AdminSubtabOwner, subpath: string | null | undefined): subpath is string {
  return !!subpath && (ADMIN_SUBTABS[owner] as readonly { id: string }[]).some(item => item.id === subpath);
}

/** 该子路径是否属于这个管理分类；非管理分类一律 false。 */
export function isAdminSubTab(tab: SettingsCenterTab | null | undefined, subpath: string | null | undefined): boolean {
  return isAdminSubtabOwner(tab) && hasSubTab(tab, subpath);
}

/** 路由里缺失或写错子页时回落到第一个子页。 */
export function resolveAdminSubTab<T extends AdminSubtabOwner>(owner: T, subpath: string | null | undefined): AdminSubTabId<T> {
  return (hasSubTab(owner, subpath) ? subpath : ADMIN_SUBTABS[owner][0].id) as AdminSubTabId<T>;
}
