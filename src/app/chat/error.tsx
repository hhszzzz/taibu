/**
 * Chat 路由段错误边界
 * 'use client' - Next.js error boundary 必须是客户端组件
 */
'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function ChatError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[ChatError]', error);
    }, [error]);

    return (
        <div className="flex min-h-[60vh] items-center justify-center bg-background px-4">
            <div className="max-w-sm w-full text-center">
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-500/10 flex items-center justify-center">
                    <span className="text-2xl text-red-500">!</span>
                </div>
                <h2 className="text-lg font-semibold mb-2">对话加载失败</h2>
                <p className="text-sm text-foreground-secondary mb-6">
                    {error.message || '加载对话时发生了意外错误'}
                </p>
                <div className="flex gap-3 justify-center">
                    <button
                        onClick={reset}
                        className="px-6 py-2.5 rounded-xl bg-accent text-on-accent text-sm font-medium hover:bg-accent/90 transition-colors"
                    >
                        重试
                    </button>
                    <Link
                        href="/chat"
                        className="px-6 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-background-secondary transition-colors"
                    >
                        返回对话
                    </Link>
                </div>
                {/* Phones show no site navigation on /chat. */}
                <Link href="/" className="mt-4 inline-block text-sm text-foreground-secondary hover:text-foreground transition-colors">
                    返回首页
                </Link>
            </div>
        </div>
    );
}
