/**
 * 八字路由段错误边界
 * 'use client' - Next.js error boundary 必须是客户端组件
 */
'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function BaziError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[BaziError]', error);
    }, [error]);

    return (
        <div className="flex min-h-[60vh] items-center justify-center bg-background px-4">
            <div className="max-w-sm w-full text-center">
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-danger/10 flex items-center justify-center">
                    <span className="text-2xl text-danger">!</span>
                </div>
                <h2 className="mb-2 font-display text-xl">八字排盘出错</h2>
                <p className="text-sm text-foreground-secondary mb-6">
                    {error.message || '加载八字排盘时发生了意外错误'}
                </p>
                <div className="flex gap-3 justify-center">
                    <button
                        onClick={reset}
                        className="h-11 px-6 rounded-xl bg-accent text-on-accent text-sm font-medium hover:bg-accent-hover transition-colors"
                    >
                        重试
                    </button>
                    <Link
                        href="/bazi"
                        className="inline-flex h-11 items-center px-6 rounded-xl border-[0.5px] border-border-hover bg-surface text-sm font-medium hover:bg-background-secondary transition-colors"
                    >
                        返回八字
                    </Link>
                </div>
            </div>
        </div>
    );
}
