/**
 * AI分析锁定覆盖层组件
 *
 * 参考 LoginOverlay，用于 AI 分析功能的模糊锁定
 * 消耗积分解锁，解锁后永久可见
 */
'use client';

import { useState } from 'react';
import { Lock, Sparkles, Coins } from 'lucide-react';
import { requestBrowserJson } from '@/lib/browser-api';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { openSettingsCenter } from '@/lib/settings-center';

interface AIAnalysisLockProps {
    /** 分析类型 */
    type: 'wuxing' | 'personality';
    /** 标题 */
    title: string;
    /** 描述 */
    description: string;
    /** 是否已解锁 */
    isUnlocked: boolean;
    /** 已解锁的内容 */
    children: React.ReactNode;
    /** 占位内容（模糊显示） */
    placeholder: React.ReactNode;
    /** 用户ID */
    userId: string;
    /** 用户当前积分 */
    credits?: number | null;
    /** 解锁回调 */
    onUnlock: () => void;
    /** 登录回调 */
    onLoginRequired?: () => void;
}

export function AIAnalysisLock({
    type,
    title,
    description,
    isUnlocked,
    children,
    placeholder,
    userId,
    credits,
    onUnlock,
    onLoginRequired,
}: AIAnalysisLockProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // 检测积分是否不足
    const isCreditsInsufficient = credits !== undefined && credits !== null && credits <= 0;

    const handleUnlock = async () => {
        if (!userId) {
            onLoginRequired?.();
            return;
        }

        setLoading(true);
        setError('');

        try {
            const result = await requestBrowserJson<{ success: boolean; remaining: number }>('/api/credits/use', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            });

            if (result.error) {
                if (result.error.code === 'INSUFFICIENT_CREDITS') {
                    setError('积分不足，请先获取积分');
                } else {
                    setError(result.error.message || '解锁失败，请重试');
                }
                setLoading(false);
                return;
            }

            // 触发解锁回调
            onUnlock();
        } catch (err) {
            console.error('Unlock error:', err);
            setError('网络错误，请重试');
        } finally {
            setLoading(false);
        }
    };

    // 已解锁，直接显示内容
    if (isUnlocked) {
        return <>{children}</>;
    }

    // 积分不足时的覆盖层
    if (isCreditsInsufficient) {
        return (
            <div className="relative overflow-hidden rounded-2xl border-[0.5px] border-warning/40 bg-surface">
                <div className="blur-sm pointer-events-none select-none opacity-60 min-h-[280px]">
                    {placeholder}
                </div>
                <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
                    <div className="text-center p-6 max-w-md">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/10">
                            <Coins className="h-7 w-7 text-warning" />
                        </div>
                        <h3 className="mb-2 font-display text-lg">积分不足</h3>
                        <p className="text-sm text-foreground-secondary mb-4">
                            您的积分已用完，请前往订阅页面通过签到、激活码或会员权益继续获取积分
                        </p>
                        <button
                            onClick={() => openSettingsCenter('upgrade')}
                            type="button"
                            className="inline-flex h-11 items-center gap-2 rounded-xl bg-foreground px-6 font-medium text-background transition-opacity hover:opacity-90"
                        >
                            <Coins className="w-4 h-4" />
                            前往订阅
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // 未解锁，显示模糊锁定效果
    return (
        <div className="relative overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface">
            {/* 模糊的占位内容 - 增加最小高度 */}
            <div className="blur-sm pointer-events-none select-none opacity-60 min-h-[280px]">
                {placeholder}
            </div>

            {/* 覆盖层 */}
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
                <div className="text-center p-6 max-w-md">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft">
                        <Lock className="h-7 w-7 text-accent-strong" />
                    </div>
                    <h3 className="mb-2 font-display text-lg">{title}</h3>
                    <p className="text-sm text-foreground-secondary mb-4">
                        {description}
                    </p>

                    {error && (
                        <p role="alert" className="mb-3 text-sm text-danger">{error}</p>
                    )}

                    <button
                        type="button"
                        onClick={handleUnlock}
                        disabled={loading}
                        className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-6 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
                    >
                        {loading ? (
                            <>
                                <SoundWaveLoader variant="inline" />
                                解锁中...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4" />
                                消耗1积分解锁
                            </>
                        )}
                    </button>

                    <p className="text-xs text-foreground-secondary mt-3">
                        解锁后可永久查看此命盘的{type === 'wuxing' ? '五行' : '人格'}分析
                    </p>
                </div>
            </div>
        </div>
    );
}
