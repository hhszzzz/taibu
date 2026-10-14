'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { supabase } from '@/lib/auth';
import { requestBrowserJson } from '@/lib/browser-api';

type CreditTransaction = {
  id: string;
  amount: number;
  type: 'earn' | 'spend' | 'refund';
  source: string;
  description: string | null;
  balance_after: number | null;
  created_at: string;
};

const SOURCE_LABELS: Record<string, string> = {
  activation_key: '激活码',
  checkin: '每日签到',
  ai_usage: 'AI 消费',
  ai_refund: 'AI 退款',
};

interface CreditTransactionsPanelProps {
  pageSize?: number;
  refreshKey?: number;
}

export function CreditTransactionsPanel({ pageSize = 5, refreshKey = 0 }: CreditTransactionsPanelProps) {
  const { user, loading: sessionLoading } = useSessionSafe();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [todaySpent, setTodaySpent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [hasMore, setHasMore] = useState(false);

  const fetchTransactions = useCallback(async (nextVisibleCount: number) => {
    if (!user) {
      setTransactions([]);
      setTodaySpent(0);
      setError(null);
      setHasMore(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const loadTransactions = async () => {
        return await requestBrowserJson<{
          items?: CreditTransaction[];
          summary?: {
            todaySpent?: number;
          };
        }>(`/api/credits/transactions?limit=${nextVisibleCount + 1}`, {
          method: 'GET',
        });
      };

      let result = await loadTransactions();
      if (result.error) {
        if (result.status === 401) {
          const { data: { session } } = await supabase.auth.revalidateSession();
          if (session) {
            result = await loadTransactions();
          }
        }

        if (result.error && result.status === 401) {
          setTransactions([]);
          setTodaySpent(0);
          setError(null);
          setHasMore(false);
          return;
        }

        if (result.error) {
          throw new Error(result.error.message || '获取积分流水失败');
        }
      }

      const rows = Array.isArray(result.data?.items) ? result.data.items : [];
      setError(null);
      setTransactions(rows.slice(0, nextVisibleCount));
      setTodaySpent(typeof result.data?.summary?.todaySpent === 'number' ? result.data.summary.todaySpent : 0);
      setHasMore(rows.length > nextVisibleCount);
    } catch (error) {
      console.error('获取积分流水异常:', error);
      setTransactions([]);
      setTodaySpent(0);
      setError(error instanceof Error ? error.message : '获取积分流水失败');
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (sessionLoading) return;
    void fetchTransactions(visibleCount);
  }, [fetchTransactions, refreshKey, sessionLoading, visibleCount]);

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const getAmountColor = (item: CreditTransaction) => {
    if (item.type === 'refund') return 'text-success';
    return item.amount < 0 ? 'text-danger' : 'text-warning';
  };

  const getAmountText = (item: CreditTransaction) => (item.amount > 0 ? `+${item.amount}` : String(item.amount));

  if (!sessionLoading && !user) {
    return null;
  }

  return (
    <section aria-labelledby="credit-transactions-heading">
      <div className="flex items-baseline justify-between gap-4 pb-2">
        <h3 id="credit-transactions-heading" className="text-[13px] font-medium text-foreground-tertiary">积分记录</h3>
        <span className="text-[13px] text-foreground-secondary">今日消耗 {todaySpent}</span>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
        {loading ? (
          Array.from({ length: Math.min(pageSize, 5) }).map((_, index) => (
            <div key={index} className={`h-[60px] animate-pulse bg-background-secondary/60 ${index > 0 ? 'border-t border-border' : ''}`} />
          ))
        ) : error ? (
          <p role="alert" className="px-[18px] py-8 text-sm text-danger">{error}</p>
        ) : transactions.length > 0 ? (
          <>
            {transactions.map((item, index) => (
              <article
                key={item.id}
                className={`flex items-center justify-between gap-4 px-[18px] py-3.5 ${index > 0 ? 'border-t border-border' : ''}`}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm text-foreground">{item.description || SOURCE_LABELS[item.source] || item.source}</span>
                  <span className="text-xs text-foreground-tertiary">{formatDate(item.created_at)}</span>
                </div>
                <span className={`shrink-0 text-sm font-medium ${getAmountColor(item)}`}>{getAmountText(item)}</span>
              </article>
            ))}
            {hasMore ? (
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + pageSize)}
                className="h-12 w-full border-t border-border text-sm text-foreground-secondary transition-colors duration-150 hover:bg-background-secondary hover:text-foreground"
              >
                查看更多
              </button>
            ) : null}
          </>
        ) : (
          <p className="px-[18px] py-8 text-sm text-foreground-secondary">暂无积分记录。</p>
        )}
      </div>
    </section>
  );
}
