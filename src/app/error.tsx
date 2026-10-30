/**
 * 全局错误边界
 * 'use client' - Next.js error boundary 必须是客户端组件
 */
'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[GlobalError]', error);
    }, [error]);

    return (
        <div className="flex min-h-[60vh] items-center justify-center bg-background px-4">
            <div className="max-w-sm w-full text-center">
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-danger/10 flex items-center justify-center">
                    <span className="text-2xl text-danger">!</span>
                </div>
                <h2 className="text-lg font-semibold mb-2">出了点问题</h2>
                <p className="text-sm text-foreground-secondary mb-6">
                    {error.message || '页面加载时发生了意外错误'}
                </p>
                <Button size="lg" className="px-6" onClick={reset}>重试</Button>
            </div>
        </div>
    );
}
