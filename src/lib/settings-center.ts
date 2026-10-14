export const SETTINGS_CENTER_NAMESPACE = 'settings';

export const SETTINGS_CENTER_TABS = [
  'general',
  'profile',
  'upgrade',
  'personalization',
  'byok',
  'charts',
  'knowledge-base',
  'mcp-service',
  'admin-announcements',
  'admin-features',
  'admin-ai-services',
  'help',
] as const;

export type SettingsCenterTab = (typeof SETTINGS_CENTER_TABS)[number];
export type SettingsCenterTabGroup = 'account' | 'extensions' | 'management';

export type SettingsCenterFlags = {
  upgradeEnabled: boolean;
  chartsEnabled: boolean;
  knowledgeBaseEnabled: boolean;
  mcpServiceEnabled: boolean;
  personalizationEnabled: boolean;
  helpEnabled: boolean;
  isAdmin: boolean;
};

export type SettingsCenterTabState = {
  id: SettingsCenterTab;
  label: string;
  group: SettingsCenterTabGroup;
  /** 设置页标题下的一句说明；没有就不显示。 */
  description?: string;
  disabled: boolean;
};

export type SettingsCenterDisabledState = {
  title: string;
  description: string;
};

export const SETTINGS_CENTER_GROUP_LABELS: Record<SettingsCenterTabGroup, string> = {
  account: '账户',
  extensions: '扩展',
  management: '管理',
};

const SETTINGS_CENTER_TAB_META: Record<SettingsCenterTab, Omit<SettingsCenterTabState, 'disabled'>> = {
  profile: { id: 'profile', label: '账户', group: 'account' },
  general: { id: 'general', label: '常规', group: 'account' },
  upgrade: { id: 'upgrade', label: '订阅', group: 'account' },
  help: { id: 'help', label: '帮助', group: 'account', description: '常见问题与联系方式。' },
  personalization: { id: 'personalization', label: '个性化', group: 'extensions', description: '这些偏好会带入 AI 对话与结果页解读。' },
  byok: { id: 'byok', label: '自定义模型', group: 'extensions', description: '用你自己的 API Key 调用模型，不消耗本站积分。' },
  charts: { id: 'charts', label: '命盘', group: 'extensions', description: '保存过的命盘都在这里。默认八字命盘会用于日运、月运和每日早报。' },
  'knowledge-base': { id: 'knowledge-base', label: '知识库', group: 'extensions', description: '把命盘、解读和资料归档到知识库，AI 对话时可以检索引用。' },
  'mcp-service': { id: 'mcp-service', label: 'MCP', group: 'extensions', description: '在支持 MCP 的客户端里直接调用太卜的排盘工具。' },
  'admin-announcements': { id: 'admin-announcements', label: '公告', group: 'management' },
  'admin-features': { id: 'admin-features', label: '功能与激活码', group: 'management' },
  'admin-ai-services': { id: 'admin-ai-services', label: 'AI 服务', group: 'management' },
};

function isSettingsCenterTabDisabled(tab: SettingsCenterTab, flags: SettingsCenterFlags) {
  switch (tab) {
    case 'upgrade':
      return !flags.upgradeEnabled;
    case 'personalization':
      return !flags.personalizationEnabled;
    case 'byok':
      return !flags.personalizationEnabled;
    case 'charts':
      return !flags.chartsEnabled;
    case 'knowledge-base':
      return !flags.knowledgeBaseEnabled;
    case 'mcp-service':
      return !flags.mcpServiceEnabled;
    case 'help':
      return !flags.helpEnabled;
    default:
      return false;
  }
}

export function getSettingsCenterTabs(flags: SettingsCenterFlags): SettingsCenterTabState[] {
  return SETTINGS_CENTER_TABS
    .filter((tab) => flags.isAdmin || SETTINGS_CENTER_TAB_META[tab].group !== 'management')
    .map((tab) => ({
      ...SETTINGS_CENTER_TAB_META[tab],
      disabled: isSettingsCenterTabDisabled(tab, flags),
    }));
}

export function getSettingsCenterDisabledState(
  tab: SettingsCenterTab,
  flags: SettingsCenterFlags,
): SettingsCenterDisabledState | null {
  if (!isSettingsCenterTabDisabled(tab, flags)) {
    return null;
  }

  switch (tab) {
    case 'upgrade':
      return {
        title: '暂未开放',
        description: '当前订阅不可用。',
      };
    case 'knowledge-base':
      return {
        title: '暂未开放',
        description: '当前知识库不可用。',
      };
    case 'mcp-service':
      return {
        title: '暂未开放',
        description: '当前 MCP 服务入口不可用。',
      };
    case 'charts':
      return {
        title: '暂未开放',
        description: '当前命盘不可用。',
      };
    case 'personalization':
      return {
        title: '暂未开放',
        description: '当前个性化不可用。',
      };
    case 'byok':
      return {
        title: '暂未开放',
        description: '当前 BYOK 不可用。',
      };
    case 'help':
      return {
        title: '暂未开放',
        description: '当前帮助不可用。',
      };
    default:
      return null;
  }
}

export const SETTINGS_CENTER_EVENT = 'taibu:settings-center:change';
export const SETTINGS_CENTER_NAVIGATE_EVENT = 'taibu:settings-center:navigate';
export const SETTINGS_CENTER_LEAVE_EVENT = 'taibu:settings-center:leave';
const SETTINGS_CENTER_STATE_KEY = '__taibuSettingsCenter';
export type SettingsCenterCloseMode = 'back' | 'replace';

export function isSettingsCenterTab(value: unknown): value is SettingsCenterTab {
  return typeof value === 'string' && SETTINGS_CENTER_TABS.includes(value as SettingsCenterTab);
}

export function isAdminSettingsCenterTab(tab: SettingsCenterTab | null | undefined): boolean {
  return tab?.startsWith('admin-') === true;
}

function normalizeSettingsCenterSubpath(subpath?: string | null): string | null {
  if (!subpath) return null;
  const normalized = subpath.split('/').filter(Boolean).join('/');
  return normalized || null;
}

function parseSettingsCenterHashParts(hash: string | null | undefined): {
  namespace: string | null;
  tab: string | null;
  subpath: string | null;
} {
  if (!hash) {
    return { namespace: null, tab: null, subpath: null };
  }

  const normalized = hash.replace(/^#/, '').trim();
  if (!normalized) {
    return { namespace: null, tab: null, subpath: null };
  }

  const [namespace, tab, ...rest] = normalized.split('/');
  return {
    namespace: namespace || null,
    tab: tab || null,
    subpath: rest.length > 0 ? rest.join('/') : null,
  };
}

export function buildSettingsCenterHash(tab: SettingsCenterTab, options?: { subpath?: string | null }): string {
  const normalizedSubpath = normalizeSettingsCenterSubpath(options?.subpath);
  return `#${SETTINGS_CENTER_NAMESPACE}/${tab}${normalizedSubpath ? `/${normalizedSubpath}` : ''}`;
}

export function parseSettingsCenterHash(hash: string | null | undefined): SettingsCenterTab | null {
  const { namespace, tab } = parseSettingsCenterHashParts(hash);
  if (namespace !== SETTINGS_CENTER_NAMESPACE) {
    return null;
  }

  return isSettingsCenterTab(tab) ? tab : null;
}

export function parseSettingsCenterHashSubpath(hash: string | null | undefined): string | null {
  const { namespace, tab, subpath } = parseSettingsCenterHashParts(hash);
  if (namespace !== SETTINGS_CENTER_NAMESPACE) {
    return null;
  }
  if (!isSettingsCenterTab(tab)) {
    return null;
  }
  return subpath;
}

export function readSettingsCenterHashFromWindow(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location.hash;
}

export function readSettingsCenterTabFromWindow(): SettingsCenterTab | null {
  if (typeof window === 'undefined') return null;
  return parseSettingsCenterPath(window.location.pathname)?.tab ?? parseSettingsCenterHash(readSettingsCenterHashFromWindow());
}

export function readSettingsCenterSubpathFromWindow(): string | null {
  if (typeof window === 'undefined') return null;
  const route = parseSettingsCenterPath(window.location.pathname);
  return route ? route.subpath : parseSettingsCenterHashSubpath(readSettingsCenterHashFromWindow());
}

export function subscribeSettingsCenterLocation(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  window.addEventListener(SETTINGS_CENTER_EVENT, listener as EventListener);
  return () => {
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
    window.removeEventListener(SETTINGS_CENTER_EVENT, listener as EventListener);
  };
}

export function getSettingsCenterCloseMode(
  state: unknown = typeof window !== 'undefined' ? window.history.state : null,
): SettingsCenterCloseMode {
  const currentState = state as Record<string, unknown> | null;
  return currentState?.[SETTINGS_CENTER_STATE_KEY] === true ? 'back' : 'replace';
}

export function parseSettingsCenterPath(pathname: string | null | undefined): { tab: SettingsCenterTab; subpath: string | null } | null {
  const parts = pathname?.split('/').filter(Boolean) ?? [];
  if (parts[0] !== SETTINGS_CENTER_NAMESPACE || !isSettingsCenterTab(parts[1])) return null;
  return { tab: parts[1], subpath: parts.slice(2).join('/') || null };
}

export function getSettingsCenterRouteTargetForPath(
  _pathname: string | null | undefined,
  tab: SettingsCenterTab,
  options?: {
    subpath?: string | null;
    search?: string | null;
  },
): string {
  const subpath = normalizeSettingsCenterSubpath(options?.subpath);
  const search = options?.search?.trim() || '';
  const query = search ? (search.startsWith('?') ? search : `?${search}`) : '';
  return `/settings/${tab}${subpath ? `/${subpath.split('/').map(encodeURIComponent).join('/')}` : ''}${query}`;
}

export function getCurrentSettingsCenterRouteTarget(
  tab: SettingsCenterTab,
  options?: {
    subpath?: string | null;
    search?: string | null;
  },
): string {
  if (typeof window === 'undefined') {
    return getSettingsCenterRouteTarget(tab, options);
  }

  return getSettingsCenterRouteTarget(tab, options);
}

export function openSettingsCenter(
  tab: SettingsCenterTab,
  options?: {
    replace?: boolean;
    subpath?: string | null;
  },
) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(SETTINGS_CENTER_NAVIGATE_EVENT, {
    detail: { href: getSettingsCenterRouteTarget(tab, options), replace: options?.replace === true },
  }));
}

export function closeSettingsCenter() {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(SETTINGS_CENTER_NAVIGATE_EVENT, { detail: { href: '/bazi', replace: false } }));
}

export function getSettingsCenterRouteTarget(
  tab: SettingsCenterTab,
  options?: {
    subpath?: string | null;
    search?: string | null;
  },
): string {
  return getSettingsCenterRouteTargetForPath('/bazi', tab, options);
}

export function getSettingsCenterTabFromRouteTarget(href: string): SettingsCenterTab | null {
  const path = href.split(/[?#]/u)[0];
  const route = parseSettingsCenterPath(path);
  if (route) return route.tab;
  const hashIndex = href.indexOf('#');
  if (hashIndex < 0) {
    return null;
  }

  return parseSettingsCenterHash(href.slice(hashIndex));
}
