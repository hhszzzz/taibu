'use client';

import { createElement, Fragment, useEffect, useId, useRef, useState } from 'react';
import { Bug, ChevronRight, ChevronsUpDown, Gauge, Github, LogOut, User } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Modal } from '@/components/ui/Modal';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { signOut } from '@/lib/auth';
import { buildMembershipInfo } from '@/lib/user/membership';
import { getUserEmailDisplay } from '@/lib/user-email';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import type { User as SupabaseUser } from '@/lib/auth';
import { SettingsCenterLink } from '@/components/settings/SettingsCenterLink';
import { SETTINGS_CENTER_TAB_ICONS } from '@/components/settings/settings-center-icons';
import { useCurrentUserProfile } from '@/lib/hooks/useCurrentUserProfile';
import { useIsDesktopLayout } from '@/lib/hooks/useIsDesktopLayout';
import { openSettingsCenter } from '@/lib/settings-center';
import type { SettingsCenterTab } from '@/lib/settings-center';

interface SidebarUserCardProps {
    user: SupabaseUser;
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
        <User size={Math.round(size / 2)} />
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

const MENU_PANEL_CLASS = 'absolute bottom-full mb-2 z-[100] overflow-visible rounded-[10px] bg-surface p-1 shadow-[var(--shadow-panel-popover)] animate-in fade-in zoom-in-95 duration-100 origin-bottom-left';
// 菜单项 = claude 账户菜单 comfortable 密度：32px / r8 / 14px / 10px 内衬。
const MENU_ITEM_CLASS = 'flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-foreground transition-colors hover:bg-fill-ghost-hover';
const MENU_ICON_CLASS = 'h-4 w-4 shrink-0 text-foreground-secondary';
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
    <SettingsCenterLink tab={tab} onClick={onClick} className={MENU_ITEM_CLASS}>
      {createElement(SETTINGS_CENTER_TAB_ICONS[tab], { size: 16, className: MENU_ICON_CLASS })}
      <span>{label}</span>
    </SettingsCenterLink>
  );
}

export function SidebarUserCard({ user, collapsed = false, appearance = 'card' }: SidebarUserCardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [isUsageOpen, setIsUsageOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const usageTitleId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const isDesktopSidebar = useIsDesktopLayout();
  const { isFeatureEnabled } = useFeatureToggles();
  const { profile, loading: profileLoading, resolved: profileResolved, error: profileError } = useCurrentUserProfile({ enabled: isDesktopSidebar });
  const personalizationEnabled = isFeatureEnabled('chat') && isFeatureEnabled('ai-personalization');
  const chartsEnabled = isFeatureEnabled('charts');
  const helpEnabled = isFeatureEnabled('help');

  const membership = profileResolved && !profileError ? buildMembershipInfo(profile ?? null) : null;
  const avatarUrl = profile?.avatar_url ?? null;
  const displayName = profile?.nickname || user.email?.split('@')[0] || '用户';
  const displayEmail = getUserEmailDisplay(user);
  const membershipLabel = profileLoading || !profileResolved
    ? '...'
    : profileError
      ? '加载失败'
      : membershipLabels[membership?.type || 'free'];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
        setIsHelpMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      setIsHelpMenuOpen(false);
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

  const toggleMenu = () => {
    setIsMenuOpen((prev) => {
      const next = !prev;
      if (!next) {
        setIsHelpMenuOpen(false);
      }
      return next;
    });
  };

  return (
    <div className="relative" ref={menuRef}>
      {appearance === 'account' ? (
        <button
          type="button"
          onClick={toggleMenu}
          aria-expanded={isMenuOpen}
          aria-label={collapsed ? '账户与设置' : undefined}
          title={collapsed ? '账户与设置' : undefined}
          className={collapsed
            ? `mt-1 flex h-9 w-9 items-center justify-center rounded-full border border-border transition-colors ${isMenuOpen ? 'ring-2 ring-accent/30' : 'hover:border-border-hover'}`
            : `flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-foreground transition-colors ${isMenuOpen ? 'bg-fill-field' : 'hover:bg-fill-ghost-hover'}`}
        >
          <Avatar src={avatarUrl} alt={displayName} size={collapsed ? 34 : 26} round />
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
        </button>
      ) : (
      <button
        type="button"
        onClick={toggleMenu}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2 transition-colors duration-150 ${
          collapsed ? 'justify-center py-1' : 'h-10'
        } ${
          isMenuOpen ? 'bg-background-tertiary' : 'hover:bg-fill-ghost-hover'
        }`}
      >
        <Avatar src={avatarUrl} alt={displayName} size={26} />
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
      </button>
      )}

      {isMenuOpen ? (
        <div className={`${MENU_PANEL_CLASS} ${collapsed ? 'left-2' : 'left-0'} w-[272px]`}>
          <div className="flex flex-col">
            {/* claude 账户菜单实测：头部只留邮箱（12px muted、截断），没有头像块 */}
            <div className="truncate px-2.5 py-2.5 text-[12.5px] text-foreground-tertiary">{displayEmail}</div>

            <div className="mx-1 my-1 h-px bg-border" />

            <div className="flex flex-col gap-1">
              {shortcuts.map((item, index) => (
                <Fragment key={item.tab}>
                  <UserMenuShortcutLink {...item} onClick={() => setIsMenuOpen(false)} />
                  {index === 0 ? (
                    <button type="button" onClick={() => { setIsMenuOpen(false); setIsUsageOpen(true); }} className={`${MENU_ITEM_CLASS} w-full`}>
                      <Gauge size={16} className={MENU_ICON_CLASS} aria-hidden="true" />
                      <span>用量</span>
                    </button>
                  ) : null}
                </Fragment>
              ))}
            </div>

            {helpEnabled ? <div className="mx-1 my-1 h-px bg-border" /> : null}

            {helpEnabled ? (
              <div>
                {/* claude 二级菜单：独立浮层（与一级留出间距），支持键盘与点击外关闭。 */}
                <button
                  ref={helpRef}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={isHelpMenuOpen}
                  onClick={() => setIsHelpMenuOpen((prev) => !prev)}
                  onMouseEnter={() => setIsHelpMenuOpen(true)}
                  className={`${MENU_ITEM_CLASS} w-full justify-between`}
                >
                  <span className="flex items-center gap-2.5">
                    {createElement(SETTINGS_CENTER_TAB_ICONS.help, { size: 16, className: MENU_ICON_CLASS })}
                    <span>帮助</span>
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 text-foreground-secondary transition-transform ${isHelpMenuOpen ? 'translate-x-0.5 text-foreground-secondary' : ''}`}
                  />
                </button>
                <FloatingPanel open={isHelpMenuOpen} anchorRef={helpRef} onClose={() => setIsHelpMenuOpen(false)}
                  label="帮助" side="right-start" align="start" className="user-help-menu" arrowNavigation initialFocus="none" restoreFocus={false}>
                  <SettingsCenterLink tab="help" onClick={() => setIsMenuOpen(false)} className={MENU_ITEM_CLASS}>
                    {createElement(SETTINGS_CENTER_TAB_ICONS.help, { size: 16, className: MENU_ICON_CLASS })}
                    <span>帮助中心</span>
                  </SettingsCenterLink>
                  <a href={PROJECT_REPO_URL} target="_blank" rel="noreferrer" onClick={() => setIsMenuOpen(false)} className={MENU_ITEM_CLASS}>
                    <Github className={MENU_ICON_CLASS} />
                    <span>GitHub</span>
                  </a>
                  <a href={PROJECT_ISSUES_URL} target="_blank" rel="noreferrer" onClick={() => setIsMenuOpen(false)} className={MENU_ITEM_CLASS}>
                    <Bug className={MENU_ICON_CLASS} />
                    <span>报告错误/需求</span>
                  </a>
                </FloatingPanel>
              </div>
            ) : null}

            <div className="mx-1 my-1 h-px bg-border" />

            <div className="flex flex-col">
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="group flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-foreground/78 transition-colors hover:bg-fill-ghost-hover hover:text-danger disabled:opacity-50"
              >
                {signingOut ? (
                  <SoundWaveLoader variant="inline" />
                ) : (
                  <LogOut className="h-[18px] w-[18px] shrink-0 text-foreground/42 transition-colors group-hover:text-danger" />
                )}
                <span>{signingOut ? '退出中...' : '退出登录'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 用量弹窗 = claude 账户菜单「用量」的解剖：13px 标题 + 12px 副题、label+value 行、发丝分隔、底部链接行 */}
      <Modal open={isUsageOpen} onClose={() => setIsUsageOpen(false)} labelledBy={usageTitleId} className="usage-dialog">
        <div className="px-1.5 py-1">
          <div className="px-2.5 pt-2">
            <h3 id={usageTitleId} className="text-[13px] font-medium leading-[1.4] text-foreground">用量</h3>
            <p className="mt-0.5 text-xs leading-[1.4] text-foreground-tertiary">套餐使用限额 · {membershipLabel}</p>
          </div>
          <div className="mx-2.5 my-2 h-px bg-border" />
          <div className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs leading-[1.4]">
            <span className="text-foreground">积分余额</span>
            <span className="tabular-nums text-foreground-tertiary">{membership ? membership.aiChatCount : '—'}</span>
          </div>
          <div className="mx-2.5 my-2 h-px bg-border" />
          <button type="button" onClick={() => { setIsUsageOpen(false); openSettingsCenter('upgrade'); }}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-xs text-foreground-secondary transition-colors hover:bg-fill-ghost-hover">
            <span>查看订阅与积分</span><ChevronRight size={14} aria-hidden="true" />
          </button>
          <p className="px-2.5 pb-2 pt-1 text-[11px] leading-[1.5] text-foreground-tertiary">签到、激活码或会员权益可获得积分。</p>
        </div>
      </Modal>
    </div>
  );
}
