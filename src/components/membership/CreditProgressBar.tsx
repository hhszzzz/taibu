/**
 * 积分余量卡片
 */
'use client';

import type { MembershipType } from '@/lib/user/membership';
import { formatMembershipExpiryDate, getPlanConfig } from '@/lib/user/membership';

interface CreditProgressBarProps {
    credits: number;
    membershipType: MembershipType;
    expiresAt?: Date | null;
}

export function CreditProgressBar({
  credits,
  membershipType,
  expiresAt = null,
}: CreditProgressBarProps) {
  const plan = getPlanConfig(membershipType);
  const limit = plan.creditLimit;
  // 激活码可能让余额超过上限，进度条满格即可，数字照实显示。
  const fillPercentage = Math.min(Math.max(credits, 0) / Math.max(limit, 1), 1) * 100;

  return (
    <section aria-label="当前积分" className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-foreground-secondary">当前积分</span>
          <span className="font-display text-[2.5rem] leading-none text-foreground">
            {credits}<span className="text-xl text-foreground-tertiary"> / {limit}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[13px] font-medium text-accent-strong">{plan.name}</span>
          {expiresAt ? <span className="text-[13px] text-foreground-secondary">{formatMembershipExpiryDate(expiresAt)} 到期</span> : null}
        </div>
      </div>
      <div
        role="progressbar"
        aria-label="积分余量"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(Math.max(credits, 0), limit)}
        className="h-2 overflow-hidden rounded-full bg-background-secondary"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${fillPercentage}%` }} />
      </div>
      <p className="text-[13px] leading-relaxed text-foreground-secondary">每次 AI 对话与解读消耗积分，签到与激活码补充；可累计上限随会员等级提高。</p>
    </section>
  );
}
