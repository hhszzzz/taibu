export const queryKeys = {
  appBootstrap: (viewerId?: string | null) => ['app', 'bootstrap', viewerId ?? 'visitor'] as const,
  appBootstrapPrefix: () => ['app', 'bootstrap'] as const,
  notificationsUnread: (userId?: string | null) => ['notifications', 'unread', userId ?? 'visitor'] as const,
  notificationsPrefix: () => ['notifications'] as const,
  latestAnnouncement: () => ['announcements', 'latest'] as const,
  announcementsPrefix: () => ['announcements'] as const,
  conversationList: (userId?: string | null) => ['chat', 'conversations', userId ?? 'visitor'] as const,
  chatBootstrap: (userId?: string | null) => ['chat', 'bootstrap', userId ?? 'visitor'] as const,
  chatBootstrapPrefix: () => ['chat', 'bootstrap'] as const,
  models: (userId?: string | null, options?: { vision?: boolean; membershipType?: string | null }) => ['models', userId ?? 'visitor', options?.membershipType ?? 'free', options?.vision === true ? 'vision' : 'chat'] as const,
  modelsPrefix: () => ['models'] as const,
  byokCatalog: () => ['models', 'byok-catalog'] as const,
} as const;
