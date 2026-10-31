'use client';

import { createElement, Fragment, useState } from 'react';
import { ChevronRight, ChevronsUpDown } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { BustIcon, FeedbackIcon, GaugeIcon, GithubIcon, LogoutIcon } from '@/lib/navigation/nav-icons';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '@/components/ui/Menu';
import { signOut } from '@/lib/auth';
import { buildMembershipInfo, pricingPlans } from '@/lib/user/membership';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import type { AuthUser } from '@/lib/auth';
import { SettingsCenterLink } from '@/components/settings/SettingsCenterLink';
import { SETTINGS_CENTER_TAB_ICONS } from '@/components/settings/settings-center-icons';
import { useCurrentUserProfile } from '@/lib/hooks/useCurrentUserProfile';
import { useIsDesktopLayout } from '@/lib/hooks/useIsDesktopLayout';
import { openSettingsCenter } from '@/lib/settings-center';
import type { SettingsCenterTab } from '@/lib/settings-center';

interface SidebarUserCardProps {
    user: AuthUser;
    collapsed?: boolean;
    /** `account`: the chat sidebar's footer row (membership and credits) or, collapsed, its round rail button. */
    appearance?: 'card' | 'account';
}

const membershipLabels: Record<string, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
};

function Avatar({ src, alt, size = 32, round = false }: { src: string | null; alt: string; size?: number; round?: boolean }) {
  const [error, setError] = useState(false);

  if (round) {
    return src && !error ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={size} height={size} className="flex-shrink-0 rounded-full object-cover" style={{ width: size, height: size }} onError={() => setError(true)} />
    ) : (
      <span aria-hidden="true" className="flex flex-shrink-0 items-center justify-center rounded-full bg-background-tertiary text-foreground-secondary" style={{ width: size, height: size }}>
        {createElement(BustIcon, { size: Math.round(size * 0.62) })}
      </span>
    );
  }

  if (!src || error) {
    return (
      <div
        className="flex flex-shrink-0 items-center justify-center rounded-full border-[0.5px] border-border bg-fill-control font-medium text-foreground-secondary"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {alt[0]?.toUpperCase() || 'U'}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className="flex-shrink-0 rounded-full border-[0.5px] border-border object-cover"
      style={{ width: size, height: size }}
      onError={() => setError(true)}
    />
  );
}

// 菜单项 = claude 账户菜单 comfortable 密度：32px / r8 / 14px / 10px 内衬。
const MENU_ITEM_CLASS = 'flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-foreground transition-colors hover:bg-fill-ghost-hover';
const MENU_ICON_CLASS = 'h-[18px] w-[18px] shrink-0 text-foreground-secondary';
const PROJECT_REPO_URL = 'https://github.com/hhszzzz/taibu';
const PROJECT_ISSUES_URL = 'https://docs.qq.com/smartsheet/DS3JSQ0dHTUdrVWFh';

type UserMenuShortcut = {
  tab: Extract<SettingsCenterTab, 'general' | 'personalization' | 'charts' | 'help'>;
  label: string;
};

function UserMenuShortcutLink({
  tab,
  label,
  onClick,
}: UserMenuShortcut & { onClick: () => void }) {
  return (
    <MenuItem
      render={(
        <SettingsCenterLink tab={tab} onClick={onClick} className={MENU_ITEM_CLASS}>
          {createElement(SETTINGS_CENTER_TAB_ICONS[tab], { size: 18, className: MENU_ICON_CLASS })}
          <span>{label}</span>
        </SettingsCenterLink>
      )}
    />
  );
}

export function SidebarUserCard({ user, collapsed = false, appearance = 'card' }: SidebarUserCardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const isDesktopSidebar = useIsDesktopLayout();
  const { isFeatureEnabled } = useFeatureToggles();
  const { profile, loading: profileLoading, resolved: profileResolved, error: profileError } = useCurrentUserProfile({ enabled: isDesktopSidebar });
  const personalizationEnabled = isFeatureEnabled('chat') && isFeatureEnabled('ai-personalization');
  const chartsEnabled = isFeatureEnabled('charts');
  const helpEnabled = isFeatureEnabled('help');

  const membership = profileResolved && !profileError ? buildMembershipInfo(profile ?? null) : null;
  const avatarUrl = profile?.avatar_url ?? null;
  const displayName = profile?.nickname || user.email?.split('@')[0] || '用户';
  const membershipLabel = profileLoading || !profileResolved
    ? '...'
    : profileError
      ? '加载失败'
      : membershipLabels[membership?.type || 'free'];

  // 「用量」二级菜单：与 composer 上下文环同源的积分读数（余额 / 套餐上限 / 已用占比）。
  const planLabel = membership ? membershipLabels[membership.type] : '—';
  const planLimit = pricingPlans.find(plan => plan.id === (membership?.type ?? 'free'))?.creditLimit ?? 10;
  const creditBalance = membership?.aiChatCount;
  const creditLimit = typeof creditBalance === 'number' ? Math.max(planLimit, creditBalance) : planLimit;
  const usedPercent = typeof creditBalance === 'number' && creditLimit > 0
    ? Math.min(100, Math.round(Math.max(0, creditLimit - creditBalance) / creditLimit * 100))
    : 0;

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      setIsMenuOpen(false);
      window.location.reload();
    } catch (error) {
      console.error('Sign out error:', error);
      setSigningOut(false);
    }
  };

  const shortcuts: UserMenuShortcut[] = [
    { tab: 'general', label: '设置' },
    ...(personalizationEnabled ? [{ tab: 'personalization', label: '个性化' } as const] : []),
    ...(chartsEnabled ? [{ tab: 'charts', label: '命盘' } as const] : []),
  ];

  return (
    <div>
      <Menu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        {appearance === 'account' ? (
          <MenuTrigger
            aria-label={collapsed ? '账户与设置' : undefined}
            title={collapsed ? '账户与设置' : undefined}
            className={collapsed
              ? `mt-1 flex h-9 w-9 items-center justify-center rounded-full border border-border transition-colors data-popup-open:ring-2 data-popup-open:ring-accent/30 hover:border-border-hover`
              : `flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-foreground transition-colors data-popup-open:bg-fill-field hover:bg-fill-ghost-hover`}
          >
            <Avatar src={avatarUrl} alt={displayName} size={collapsed ? 34 : 24} round />
            {!collapsed ? (
              <>
                {/* claude 侧栏底账户行实测：头像 24、单行「名 · 计划」+ 12px chevron；整行留出 40px 呼吸。 */}
                <span className="flex min-w-0 flex-1 items-baseline gap-1 text-[14px]">
                  <span className="truncate font-medium text-foreground">{displayName}</span>
                  <span aria-hidden="true" className="text-foreground-tertiary">·</span>
                  <span className="truncate text-foreground-secondary">{membershipLabel}</span>
                </span>
                <ChevronsUpDown size={12} aria-hidden="true" className="flex-shrink-0 text-foreground-secondary" />
              </>
            ) : null}
          </MenuTrigger>
        ) : (
          <MenuTrigger
            className={`flex w-full items-center gap-2.5 rounded-lg px-2 transition-colors duration-150 ${
              collapsed ? 'justify-center py-1' : 'h-9'
            } hover:bg-fill-ghost-hover data-popup-open:bg-background-tertiary`}
          >
            <Avatar src={avatarUrl} alt={displayName} size={24} />
            {!collapsed ? (
              <>
                <span className="flex min-w-0 flex-1 items-baseline gap-1 text-[14px]">
                  <span className="truncate font-medium text-foreground">{displayName}</span>
                  <span aria-hidden="true" className="text-foreground-tertiary">·</span>
                  <span className="truncate text-foreground-secondary">{membershipLabel}</span>
                </span>
                <ChevronsUpDown size={13} aria-hidden="true" className="flex-shrink-0 text-foreground-secondary" />
              </>
            ) : null}
          </MenuTrigger>
        )}

        <MenuContent side="top" sideOffset={8} className={`w-[272px] rounded-[10px] ${collapsed ? 'ml-2' : ''}`}>
          <div className="flex flex-col py-1">
            <div className="flex flex-col gap-1">
              {shortcuts.map((item, index) => (
                <Fragment key={item.tab}>
                  <UserMenuShortcutLink {...item} onClick={() => setIsMenuOpen(false)} />
                  {index === 0 ? (
                    <MenuSub>
                      <MenuSubTrigger className={`${MENU_ITEM_CLASS} justify-between`}>
                        <span className="flex items-center gap-2.5">
                          {createElement(GaugeIcon, { size: 18, className: MENU_ICON_CLASS })}
                          <span>用量</span>
                        </span>
                      </MenuSubTrigger>
                      <MenuSubContent className="user-usage-menu">
                        <div className="px-1.5 py-1">
                          <div className="flex items-baseline justify-between gap-3 px-1.5 pt-1">
                            <strong className="text-[13px] font-medium leading-[1.4] text-foreground">积分</strong>
                            <span className="text-xs leading-[1.4] text-foreground-tertiary">{planLabel}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 px-1.5 py-1.5 text-xs leading-[1.4]">
                            <span className="text-foreground">剩余积分</span>
                            <span className="tabular-nums text-foreground-tertiary">{typeof creditBalance === 'number' ? `${creditBalance} / ${creditLimit}` : '—'}</span>
                          </div>
                          <div className="mx-1.5 my-1 h-1 overflow-hidden rounded-full bg-fill-field" aria-hidden="true">
                            <span className="block h-full rounded-full bg-accent" style={{ width: `${usedPercent}%` }} />
                          </div>
                          <p className="px-1.5 pb-1 pt-2 text-[11px] leading-[1.5] text-foreground-tertiary">每次平台模型对话消耗 1 积分；签到与升级可补充。</p>
                          <div className="mx-1.5 my-1 h-px bg-border" />
                          <MenuItem className="flex w-full items-center justify-between gap-3 px-1.5 py-1.5 text-xs text-foreground-secondary"
                            onClick={() => { setIsMenuOpen(false); openSettingsCenter('upgrade'); }}>
                            <span>查看订阅与积分</span><ChevronRight size={14} aria-hidden="true" />
                          </MenuItem>
                        </div>
                      </MenuSubContent>
                    </MenuSub>
                  ) : null}
                </Fragment>
              ))}
            </div>

            {helpEnabled ? <MenuSeparator className="mx-1 my-1" /> : null}

            {helpEnabled ? (
              <MenuSub>
                <MenuSubTrigger className={`${MENU_ITEM_CLASS} justify-between`}>
                  <span className="flex items-center gap-2.5">
                    {createElement(SETTINGS_CENTER_TAB_ICONS.help, { size: 18, className: MENU_ICON_CLASS })}
                    <span>帮助</span>
                  </span>
                </MenuSubTrigger>
                <MenuSubContent className="user-help-menu">
                  <MenuItem render={(
                    <SettingsCenterLink tab="help" onClick={() => setIsMenuOpen(false)} className={MENU_ITEM_CLASS}>
                      {createElement(SETTINGS_CENTER_TAB_ICONS.help, { size: 18, className: MENU_ICON_CLASS })}
                      <span>帮助中心</span>
                    </SettingsCenterLink>
                  )} />
                  <MenuItem render={(
                    <a href={PROJECT_REPO_URL} target="_blank" rel="noreferrer" onClick={() => setIsMenuOpen(false)} className={MENU_ITEM_CLASS}>
                      {createElement(GithubIcon, { size: 18, className: MENU_ICON_CLASS })}
                      <span>GitHub</span>
                    </a>
                  )} />
                  <MenuItem render={(
                    <a href={PROJECT_ISSUES_URL} target="_blank" rel="noreferrer" onClick={() => setIsMenuOpen(false)} className={MENU_ITEM_CLASS}>
                      {createElement(FeedbackIcon, { size: 18, className: MENU_ICON_CLASS })}
                      <span>报告错误/需求</span>
                    </a>
                  )} />
                </MenuSubContent>
              </MenuSub>
            ) : null}

            <MenuSeparator className="mx-1 my-1" />

            <MenuItem
              disabled={signingOut}
              onClick={() => { void handleSignOut(); }}
              className="group flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-foreground/78 transition-colors data-disabled:opacity-50 hover:bg-fill-ghost-hover hover:text-danger"
            >
              {signingOut ? (
                <SoundWaveLoader variant="inline" />
              ) : (
                createElement(LogoutIcon, { size: 18, className: 'shrink-0 text-foreground/42 transition-colors group-hover:text-danger' })
              )}
              <span>{signingOut ? '退出中...' : '退出登录'}</span>
            </MenuItem>
          </div>
        </MenuContent>
      </Menu>
    </div>
  );
}
