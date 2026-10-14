/**
 * 订阅内容
 *
 * 'use client' 标记说明：
 * - 使用 hooks 管理会员、签到、激活码与积分记录状态
 * - 该模块供统一设置中心复用
 */
'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  CalendarCheck,
  CheckCircle2,
  Key,
  Lock,
  RefreshCw,
} from 'lucide-react';
import {
  type CheckinStatus,
  fetchCheckinStatus,
  performCheckinAction,
} from '@/components/checkin/checkin-client';
import { AuthModal } from '@/components/auth/AuthModal';
import { CheckinModal } from '@/components/checkin/CheckinModal';
import { CreditProgressBar } from '@/components/membership/CreditProgressBar';
import { CreditTransactionsPanel } from '@/components/membership/CreditTransactionsPanel';
import { KeyActivationModal } from '@/components/membership/KeyActivationModal';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useToast } from '@/components/ui/Toast';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { getSettingsCenterRouteTargetForPath } from '@/lib/settings-center';
import { describePricingPlan, getMembershipInfo, pricingPlans, type MembershipInfo } from '@/lib/user/membership';

type ClaimStatus =
  | 'ok'
  | 'cooldown'
  | 'lower_tier_ignored'
  | 'no_eligibility'
  | 'claim_failed'
  | 'missing_linuxdo';

type LinuxDoClaimPlanName = 'Plus' | 'Pro';

function resolveMembershipPlanName(type: MembershipInfo['type'] | null | undefined): LinuxDoClaimPlanName | null {
  if (type === 'pro') return 'Pro';
  if (type === 'plus') return 'Plus';
  return null;
}

function resolveLinuxDoPlanNameFromUser(user: ReturnType<typeof useSessionSafe>['user']): LinuxDoClaimPlanName | null {
  const providerMetadata = user?.user_metadata?.linuxdo_provider_metadata;
  if (!providerMetadata || typeof providerMetadata !== 'object') {
    return null;
  }

  const trustLevel = (providerMetadata as { trust_level?: unknown }).trust_level;
  if (typeof trustLevel !== 'number') {
    return null;
  }
  if (trustLevel >= 3) {
    return 'Pro';
  }
  if (trustLevel === 2) {
    return 'Plus';
  }
  return null;
}

function buildLinuxDoClaimLockKey(userId: string) {
  return `taibu:linuxdo-membership-claim:${userId}`;
}

function buildLegacyLinuxDoClaimLockKey(userId: string) {
  return `mingai:linuxdo-membership-claim:${userId}`;
}

function persistLinuxDoClaimLock(
  userId: string,
  nextAvailableAt: string,
  planName: LinuxDoClaimPlanName | null,
) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(buildLinuxDoClaimLockKey(userId), JSON.stringify({
    nextAvailableAt,
    planName,
  }));
  window.sessionStorage.removeItem(buildLegacyLinuxDoClaimLockKey(userId));
}

function clearLinuxDoClaimLock(userId: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(buildLinuxDoClaimLockKey(userId));
  window.sessionStorage.removeItem(buildLegacyLinuxDoClaimLockKey(userId));
}

function readLinuxDoClaimLock(userId: string): { nextAvailableAt: string; planName: LinuxDoClaimPlanName | null } | null {
  if (typeof window === 'undefined') return null;

  const raw = window.sessionStorage.getItem(buildLinuxDoClaimLockKey(userId));
  window.sessionStorage.removeItem(buildLegacyLinuxDoClaimLockKey(userId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      nextAvailableAt?: unknown;
      planName?: unknown;
    };
    if (typeof parsed.nextAvailableAt !== 'string' || parsed.nextAvailableAt.trim().length === 0) {
      return null;
    }
    return {
      nextAvailableAt: parsed.nextAvailableAt,
      planName: parsed.planName === 'Plus' || parsed.planName === 'Pro' ? parsed.planName : null,
    };
  } catch {
    return null;
  }
}

function ActionCard({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  action: ReactNode;
  tone?: 'neutral' | 'success';
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-surface p-[18px]">
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${tone === 'success' ? 'bg-success/10 text-success' : 'bg-background-secondary text-foreground-secondary'}`}
      >
        {icon}
      </span>
      <span className="text-[15px] font-medium text-foreground">{title}</span>
      <span className="text-[13px] leading-relaxed text-foreground-secondary">{description}</span>
      <div className="mt-auto pt-0.5">{action}</div>
    </div>
  );
}

const CARD_BUTTON = 'settings-button settings-button-compact';
const CARD_PRIMARY_BUTTON = `${CARD_BUTTON} settings-button-primary`;
const CARD_LINK_BUTTON = 'inline-flex h-9 items-center px-0.5 text-[13px] text-accent transition-colors hover:text-accent-hover';

export default function UpgradePanel() {
  const pathname = usePathname();
  const { user, loading: sessionLoading } = useSessionSafe();
  const searchParams = useSearchParams();
  const { isFeatureEnabled, loaded: featureLoaded } = useFeatureToggles();
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [checkinStatus, setCheckinStatus] = useState<CheckinStatus | null>(null);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinSubmitting, setCheckinSubmitting] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [transactionsRefreshKey, setTransactionsRefreshKey] = useState(0);
  const [linuxDoClaimLockedUntil, setLinuxDoClaimLockedUntil] = useState<string | null>(null);
  const [linuxDoClaimPlanName, setLinuxDoClaimPlanName] = useState<LinuxDoClaimPlanName | null>(null);
  const { showToast } = useToast();
  const hasLinuxDoLogin = typeof user?.user_metadata?.linuxdo_sub === 'string'
    && user.user_metadata.linuxdo_sub.trim().length > 0;

  const checkinEnabled = featureLoaded && isFeatureEnabled('checkin');

  const refreshMembership = useCallback(async (userId: string) => {
    const result = await getMembershipInfo(userId);
    if (result.ok) {
      setMembership(result.info);
      setMembershipError(null);
      return result;
    }

    setMembershipError(result.error.message || '获取会员状态失败');
    return result;
  }, []);

  const refreshCheckinStatus = useCallback(async () => {
    if (!user || !checkinEnabled) {
      setCheckinStatus(null);
      setCheckinError(null);
      return null;
    }

    setCheckinLoading(true);
    try {
      const nextStatus = await fetchCheckinStatus();
      if (nextStatus.ok) {
        setCheckinStatus(nextStatus.status);
        setCheckinError(null);
        return nextStatus.status;
      }

      console.error('获取签到状态失败:', nextStatus.error);
      setCheckinStatus(null);
      setCheckinError(nextStatus.error.message || '获取签到状态失败');
      return null;
    } catch (error) {
      console.error('获取签到状态失败:', error);
      setCheckinStatus(null);
      setCheckinError('获取签到状态失败，请稍后重试');
      return null;
    } finally {
      setCheckinLoading(false);
    }
  }, [checkinEnabled, user]);

  const refreshMembershipAndCheckin = useCallback(async (userId: string) => {
    await Promise.all([
      refreshMembership(userId),
      checkinEnabled ? refreshCheckinStatus() : Promise.resolve(null),
    ]);
  }, [checkinEnabled, refreshCheckinStatus, refreshMembership]);

  useEffect(() => {
    const init = async () => {
      if (sessionLoading) return;
      if (user) {
        await refreshMembership(user.id);
      } else {
        setMembership(null);
        setMembershipError(null);
      }
      setLoading(false);
    };
    void init();
  }, [refreshMembership, sessionLoading, user]);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user || !checkinEnabled) {
      setCheckinStatus(null);
      setCheckinError(null);
      return;
    }
    void refreshCheckinStatus();
  }, [checkinEnabled, refreshCheckinStatus, sessionLoading, user]);

  useEffect(() => {
    if (!user?.id || !hasLinuxDoLogin) {
      setLinuxDoClaimLockedUntil(null);
      setLinuxDoClaimPlanName(null);
      return;
    }

    const storedLock = readLinuxDoClaimLock(user.id);
    if (!storedLock) {
      setLinuxDoClaimLockedUntil(null);
      setLinuxDoClaimPlanName(null);
      return;
    }

    if (new Date(storedLock.nextAvailableAt).getTime() <= Date.now()) {
      clearLinuxDoClaimLock(user.id);
      setLinuxDoClaimLockedUntil(null);
      setLinuxDoClaimPlanName(null);
      return;
    }

    setLinuxDoClaimLockedUntil(storedLock.nextAvailableAt);
    setLinuxDoClaimPlanName(storedLock.planName);
  }, [hasLinuxDoLogin, user?.id]);

  useEffect(() => {
    const claim = searchParams.get('claim') as ClaimStatus | null;
    if (!claim) return;

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('claim');
    nextUrl.searchParams.delete('next_available_at');
    window.history.replaceState({}, '', nextUrl.toString());

    if (claim === 'ok') {
      const fallbackPlanName = resolveLinuxDoPlanNameFromUser(user);
      const lockedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      setLinuxDoClaimLockedUntil(lockedUntil);
      setLinuxDoClaimPlanName(fallbackPlanName);
      if (user?.id) {
        persistLinuxDoClaimLock(user.id, lockedUntil, fallbackPlanName);
      }
      void (async () => {
        let planName = fallbackPlanName;
        if (user?.id) {
          const membershipResult = await refreshMembership(user.id);
          if (membershipResult.ok) {
            planName = resolveMembershipPlanName(membershipResult.info?.type) ?? planName;
          }
        }

        setLinuxDoClaimPlanName(planName);
        if (user?.id) {
          persistLinuxDoClaimLock(user.id, lockedUntil, planName);
        }
        showToast('success', `恭喜领取 ${planName ?? '会员'} 会员`);
      })();
      return;
    }

    if (claim === 'cooldown') {
      const nextAvailableAt = searchParams.get('next_available_at');
      const fallbackPlanName = resolveLinuxDoPlanNameFromUser(user);
      if (nextAvailableAt) {
        setLinuxDoClaimLockedUntil(nextAvailableAt);
        setLinuxDoClaimPlanName(fallbackPlanName);
        if (user?.id) {
          persistLinuxDoClaimLock(user.id, nextAvailableAt, fallbackPlanName);
        }
      }
      const formatted = nextAvailableAt
        ? new Date(nextAvailableAt).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : null;
      showToast('info', formatted ? `本月已领取，请在 ${formatted} 后再试` : '本月已领取，请下次再来');
      return;
    }

    if (claim === 'lower_tier_ignored') {
      if (user?.id) {
        clearLinuxDoClaimLock(user.id);
      }
      setLinuxDoClaimLockedUntil(null);
      setLinuxDoClaimPlanName(null);
      showToast('info', '当前已有更高等级会员，本次 Linux.do 月领未覆盖');
      return;
    }

    if (claim === 'no_eligibility') {
      if (user?.id) {
        clearLinuxDoClaimLock(user.id);
      }
      setLinuxDoClaimLockedUntil(null);
      setLinuxDoClaimPlanName(null);
      showToast('info', '当前 Linux.do 等级不足，无法领取本月会员');
      return;
    }

    if (claim === 'missing_linuxdo') {
      if (user?.id) {
        clearLinuxDoClaimLock(user.id);
      }
      setLinuxDoClaimLockedUntil(null);
      setLinuxDoClaimPlanName(null);
      showToast('error', '请使用 Linux.do 账号重新登录后再领取');
      return;
    }

    if (user?.id) {
      clearLinuxDoClaimLock(user.id);
    }
    setLinuxDoClaimLockedUntil(null);
    setLinuxDoClaimPlanName(null);
    showToast('error', '领取会员失败，请稍后重试');
  }, [refreshMembership, searchParams, showToast, user]);

  const handleKeySuccess = (info: MembershipInfo | null) => {
    if (info) {
      setMembership(info);
      setMembershipError(null);
    }

    if (user) {
      void refreshMembershipAndCheckin(user.id);
    }
    setTransactionsRefreshKey((value) => value + 1);
  };

  const handleCheckinClick = () => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    if (!checkinStatus?.canCheckin || checkinSubmitting) {
      return;
    }

    setCheckinSubmitting(true);
    void (async () => {
      try {
        const result = await performCheckinAction();
        if (result.ok) {
          setCheckinError(null);
          setCheckinStatus((prev) => prev ? {
            ...prev,
            canCheckin: false,
            todayCheckedIn: true,
            blockedReason: 'already_checked_in',
            currentCredits: typeof result.credits === 'number' ? result.credits : prev.currentCredits,
            creditLimit: typeof result.creditLimit === 'number' ? result.creditLimit : prev.creditLimit,
          } : prev);
          showToast('success', `签到成功！+${result.rewardCredits} 积分`);
          void refreshMembership(user.id);
          setTransactionsRefreshKey((value) => value + 1);
          return;
        }

        showToast('error', result.message || '签到失败');
        if (result.blockedReason === 'already_checked_in') {
          setCheckinStatus((prev) => prev ? {
            ...prev,
            canCheckin: false,
            todayCheckedIn: true,
            blockedReason: 'already_checked_in',
          } : prev);
        } else if (result.blockedReason === 'credit_cap_reached') {
          setCheckinStatus((prev) => prev ? {
            ...prev,
            canCheckin: false,
            blockedReason: 'credit_cap_reached',
            currentCredits: typeof result.credits === 'number' ? result.credits : prev.currentCredits,
            creditLimit: typeof result.creditLimit === 'number' ? result.creditLimit : prev.creditLimit,
          } : prev);
        }
      } catch (error) {
        console.error('签到失败:', error);
        const errorMessage = error instanceof Error ? error.message : '签到失败，请稍后重试';
        setCheckinError(errorMessage);
        showToast('error', errorMessage);
      } finally {
        setCheckinSubmitting(false);
      }
    })();
  };

  const currentPlan = membership?.type || 'free';
  const currentSearch = searchParams.toString();
  const linuxdoClaimUrl = useMemo(() => {
    const returnToSearchParams = new URLSearchParams(currentSearch);
    returnToSearchParams.delete('claim');
    returnToSearchParams.delete('next_available_at');
    const returnToSearch = returnToSearchParams.toString();
    const params = new URLSearchParams({
      intent: 'membership-claim',
      returnTo: getSettingsCenterRouteTargetForPath(pathname, 'upgrade', {
        search: returnToSearch ? `?${returnToSearch}` : '',
      }),
    });
    return `/api/auth/linuxdo?${params.toString()}`;
  }, [currentSearch, pathname]);
  const linuxDoClaimDisabled = hasLinuxDoLogin
    && !!linuxDoClaimLockedUntil
    && new Date(linuxDoClaimLockedUntil).getTime() > Date.now();
  const linuxDoClaimLabel = linuxDoClaimDisabled
    ? linuxDoClaimPlanName
      ? `已领取 ${linuxDoClaimPlanName}`
      : '本月已领取'
    : '领取本月会员';
  const [rewardMin, rewardMax] = checkinStatus?.rewardRange ?? [1, 3];
  const rewardText = rewardMin === rewardMax ? `${rewardMin}` : `${rewardMin}–${rewardMax}`;
  const checkinCard: { title: string; description: string; tone: 'neutral' | 'success'; action: ReactNode } = !user
    ? {
        title: '每日签到',
        description: '登录后每天可签到领取积分',
        tone: 'neutral',
        action: <button type="button" onClick={handleCheckinClick} className={CARD_PRIMARY_BUTTON}>登录后签到</button>,
      }
    : checkinError && !checkinStatus
      ? {
          title: '每日签到',
          description: checkinError,
          tone: 'neutral',
          action: <button type="button" onClick={() => void refreshCheckinStatus()} disabled={checkinLoading} className={CARD_BUTTON}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />重试</button>,
        }
      : checkinStatus?.todayCheckedIn
        ? {
            title: '今日已签到',
            description: `明天签到可再得 ${rewardText} 积分`,
            tone: 'success',
            action: <button type="button" onClick={() => setShowCheckinModal(true)} className={CARD_LINK_BUTTON}>查看签到日历</button>,
          }
        : checkinStatus?.blockedReason === 'credit_cap_reached'
          ? {
              title: '每日签到',
              description: '积分已达上限，消耗后再来签到',
              tone: 'neutral',
              action: <button type="button" disabled className={CARD_BUTTON}><Lock className="h-3.5 w-3.5" aria-hidden="true" />已封顶</button>,
            }
          : {
              title: '每日签到',
              description: checkinStatus ? `签到可得 ${rewardText} 积分` : '正在读取签到状态…',
              tone: 'neutral',
              action: (
                <button
                  type="button"
                  onClick={handleCheckinClick}
                  disabled={checkinSubmitting || checkinLoading || !checkinStatus?.canCheckin}
                  className={CARD_PRIMARY_BUTTON}
                >
                  {checkinSubmitting ? '签到中' : '立即签到'}
                </button>
              ),
            };

  if (loading) {
    return (
      <div className="space-y-8" aria-busy="true">
        <div className="h-44 animate-pulse rounded-2xl border border-border bg-surface" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map(index => <div key={index} className="h-40 animate-pulse rounded-[14px] border border-border bg-surface" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {user && membershipError && !membership ? (
        <div role="alert" className="settings-alert">
          <span className="min-w-0 flex-1">{membershipError}</span>
          <button type="button" onClick={() => void refreshMembership(user.id)}>重试</button>
        </div>
      ) : (
        <CreditProgressBar
          credits={membership?.aiChatCount ?? 0}
          membershipType={currentPlan}
          expiresAt={membership?.expiresAt ?? null}
        />
      )}

      <section aria-label="补充积分与会员" className="grid grid-cols-[repeat(auto-fit,minmax(12.5rem,1fr))] gap-3">
        {checkinEnabled ? (
          <ActionCard
            icon={checkinCard.tone === 'success' ? <CheckCircle2 className="h-[18px] w-[18px]" /> : <CalendarCheck className="h-[18px] w-[18px]" />}
            title={checkinCard.title}
            description={checkinCard.description}
            tone={checkinCard.tone}
            action={checkinCard.action}
          />
        ) : null}
        <ActionCard
          icon={<Key className="h-[18px] w-[18px]" />}
          title="激活码"
          description="兑换会员时长或积分"
          action={(
            <button
              type="button"
              onClick={() => {
                if (!user) {
                  setShowAuthModal(true);
                  return;
                }
                setShowKeyModal(true);
              }}
              className={CARD_BUTTON}
            >
              输入激活码
            </button>
          )}
        />
        {hasLinuxDoLogin ? (
          <ActionCard
            icon={linuxDoClaimDisabled ? <Lock className="h-[18px] w-[18px]" /> : <RefreshCw className="h-[18px] w-[18px]" />}
            title="Linux.do 月领"
            description="按 Linux.do 等级每月领取一次会员"
            action={linuxDoClaimDisabled ? (
              <button type="button" disabled title="本月已领取 LinuxDo 会员" className={CARD_BUTTON}>{linuxDoClaimLabel}</button>
            ) : (
              <a href={linuxdoClaimUrl} title="领取本月 LinuxDo 会员" className={CARD_PRIMARY_BUTTON}>{linuxDoClaimLabel}</a>
            )}
          />
        ) : null}
      </section>

      <section aria-labelledby="membership-plans-heading">
        <h3 id="membership-plans-heading" className="pb-3 text-[13px] font-medium text-foreground-tertiary">会员等级</h3>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(12.5rem,1fr))] gap-3">
          {pricingPlans.map(plan => {
            const { summary, perks } = describePricingPlan(plan);
            const current = plan.id === currentPlan;
            return (
              <div
                key={plan.id}
                aria-current={current ? 'true' : undefined}
                className={`flex flex-col gap-2.5 rounded-[14px] p-[18px] ${current ? 'border-[1.5px] border-accent bg-surface' : 'border border-border'}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-xl text-foreground">{plan.name}</span>
                  {current ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-strong">当前</span> : null}
                </span>
                <span className="text-pretty text-[13px] text-foreground-secondary">{summary}</span>
                <ul className="text-[13px] leading-[1.7] text-foreground">
                  {perks.map(perk => <li key={perk}>{perk}</li>)}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <CreditTransactionsPanel pageSize={5} refreshKey={transactionsRefreshKey} />

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />

      <KeyActivationModal
        isOpen={showKeyModal}
        onClose={() => setShowKeyModal(false)}
        onSuccess={handleKeySuccess}
      />

      <CheckinModal
        isOpen={showCheckinModal}
        onClose={() => setShowCheckinModal(false)}
        stackLevel="settings"
      />
    </div>
  );
}
