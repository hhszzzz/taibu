'use client';

import { createElement, Fragment, useRef, useState } from 'react';
import { ChevronRight, ChevronsUpDown } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { BustIcon, FeedbackIcon, GaugeIcon, GithubIcon, LogoutIcon } from '@/lib/navigation/nav-icons';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '@/components/ui/Menu';
import { signOut } from '@/lib/auth';
import { formatUsd } from '@/lib/billing/money';
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
    /** `account`: the chat sidebar's footer row (name and balance) or, collapsed, its round rail button. */
    appearance?: 'card' | 'account';
}

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
  tab: Extract<SettingsCenterTab, 'general' | 'usage-log' | 'personalization' | 'charts' | 'help'>;
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
  const { profile, balance, loading: profileLoading, resolved: profileResolved, error: profileError } = useCurrentUserProfile({ enabled: isDesktopSidebar });
  const personalizationEnabled = isFeatureEnabled('chat') && isFeatureEnabled('ai-personalization');
  const chartsEnabled = isFeatureEnabled('charts');
  const helpEnabled = isFeatureEnabled('help');
  const billingEnabled = isFeatureEnabled('billing');
  const usageLogEnabled = isFeatureEnabled('usage-log');

  const avatarUrl = profile?.avatar_url ?? null;
  const displayName = profile?.nickname || user.email?.split('@')[0] || '用户';
  // 账户行 = claude 的「名 · 计划」：这里换成可用额度。
  const balanceLabel = profileLoading || !profileResolved
    ? '...'
    : profileError || !balance
      ? '加载失败'
      : formatUsd(balance.spendableMicros);

  // 余额卡片：悬停打开，指针离开卡片后收回，不跟用户抢住弹层。
  const [balanceOpen, setBalanceOpen] = useState(false);
  const balanceCloseTimer = useRef<number | undefined>(undefined);
  const keepBalanceOpen = () => { window.clearTimeout(balanceCloseTimer.current); setBalanceOpen(true); };
  const scheduleBalanceClose = () => {
    window.clearTimeout(balanceCloseTimer.current);
    balanceCloseTimer.current = window.setTimeout(() => setBalanceOpen(false), 160);
  };

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
    ...(usageLogEnabled && !billingEnabled ? [{ tab: 'usage-log', label: '用量日志' } as const] : []),
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
                  {billingEnabled ? <>
                    <span aria-hidden="true" className="text-foreground-tertiary">·</span>
                    <span className="truncate tabular-nums text-foreground-secondary">{balanceLabel}</span>
                  </> : null}
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
                  {billingEnabled ? <>
                    <span aria-hidden="true" className="text-foreground-tertiary">·</span>
                    <span className="truncate tabular-nums text-foreground-secondary">{balanceLabel}</span>
                  </> : null}
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
                  {index === 0 && billingEnabled ? (
                    <MenuSub open={balanceOpen} onOpenChange={setBalanceOpen}>
                      <MenuSubTrigger onPointerEnter={keepBalanceOpen} className={`${MENU_ITEM_CLASS} justify-between`}>
                        <span className="flex items-center gap-2.5">
                          {createElement(GaugeIcon, { size: 18, className: MENU_ICON_CLASS })}
                          <span>余额</span>
                        </span>
                      </MenuSubTrigger>
                      <MenuSubContent sideOffset={8} className="user-usage-menu" onPointerEnter={keepBalanceOpen} onPointerLeave={scheduleBalanceClose}>
                        <div className="px-1.5 py-1">
                          <div className="flex items-baseline justify-between gap-3 px-1.5 pt-1">
                            <strong className="text-[13px] font-medium leading-[1.4] text-foreground">可用额度</strong>
                            <span className="text-[13px] font-medium tabular-nums leading-[1.4] text-foreground">{balance ? formatUsd(balance.spendableMicros) : '—'}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 px-1.5 pt-1.5 text-xs leading-[1.4]">
                            <span className="text-foreground-secondary">余额</span>
                            <span className={`tabular-nums ${balance && balance.walletMicros < 0 ? 'text-danger' : 'text-foreground-tertiary'}`}>{balance ? formatUsd(balance.walletMicros) : '—'}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 px-1.5 py-1.5 text-xs leading-[1.4]">
                            <span className="text-foreground-secondary">订阅剩余</span>
                            <span className="tabular-nums text-foreground-tertiary">{balance ? formatUsd(balance.subscriptionMicros) : '—'}</span>
                          </div>
                          <p className="px-1.5 pb-1 pt-1 text-[11px] leading-[1.5] text-foreground-tertiary">平台模型按实际用量计费，先扣订阅额度再扣余额；使用自己的 API 不计费。</p>
                          <div className="mx-1.5 my-1 h-px bg-border" />
                          <MenuItem className="flex w-full items-center justify-between gap-3 px-1.5 py-1.5 text-xs text-foreground-secondary"
                            onClick={() => { setIsMenuOpen(false); openSettingsCenter('billing'); }}>
                            <span>钱包</span><ChevronRight size={14} aria-hidden="true" />
                          </MenuItem>
                          <MenuItem className="flex w-full items-center justify-between gap-3 px-1.5 py-1.5 text-xs text-foreground-secondary"
                            onClick={() => { setIsMenuOpen(false); openSettingsCenter('usage-log'); }}>
                            <span>用量日志</span><ChevronRight size={14} aria-hidden="true" />
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
                <MenuSubContent sideOffset={8} className="user-help-menu">
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
