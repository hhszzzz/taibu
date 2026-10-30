/**
 * 签到弹窗组件
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { CalendarCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Dialog } from '@/components/ui/Dialog';
import { CheckinCalendarPanel } from '@/components/checkin/CheckinCalendarPanel';
import {
  fetchCheckinStatus,
  type CheckinStatus,
} from '@/components/checkin/checkin-client';

interface CheckinModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CheckinModal({
  isOpen,
  onClose,
}: CheckinModalProps) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<CheckinStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const nextStatus = await fetchCheckinStatus();
      if (nextStatus.ok) {
        setStatus(nextStatus.status);
        setStatusError(null);
        return;
      }

      console.error('获取签到状态失败:', nextStatus.error);
      setStatusError(nextStatus.error.message || '获取签到状态失败');
    } catch (error) {
      console.error('获取签到状态失败:', error);
      setStatusError('获取签到状态失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    void loadStatus();
  }, [isOpen, loadStatus]);

  const rewardRangeText = status ? `${status.rewardRange[0]}-${status.rewardRange[1]} 积分` : '--';
  const statusText = status?.todayCheckedIn
    ? '今天已签到'
    : status?.blockedReason === 'credit_cap_reached'
      ? '当前已封顶'
      : `今日奖励 ${rewardRangeText}`;

  return (
    <Dialog bare open={isOpen} onClose={onClose} labelledBy="checkin-title" className="dialog-plain dialog-md">
      <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-background shadow-xl animate-fade-in">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="checkin-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <CalendarCheck className="h-4 w-4 text-warning" />
            每日签到
          </h2>
          <IconButton label="关闭" size="sm" expand="none" onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </div>

        <div className="space-y-4 px-5 py-5">
          {loading ? (
            <>
              <div className="h-11 rounded-lg bg-foreground/5 animate-pulse" />
              <div className="h-64 rounded-lg bg-foreground/5 animate-pulse" />
            </>
          ) : (
            <>
              {statusError ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
                  <span className="min-w-0 flex-1">{statusError}</span>
                  <Button variant="ghost" size="xs" className="shrink-0 text-warning hover:bg-warning/10 hover:text-warning"
                    onClick={() => {
                      setLoading(true);
                      void loadStatus();
                    }}>
                    重试
                  </Button>
                </div>
              ) : null}

              {status ? (
                <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-foreground-secondary">
                  {statusText}
                </div>
              ) : null}

              <CheckinCalendarPanel active={isOpen} />
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
