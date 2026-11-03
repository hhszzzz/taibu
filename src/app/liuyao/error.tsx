/**
 * 六爻路由段错误边界
 * 'use client' - Next.js error boundary 必须是客户端组件
 */
'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export default function LiuyaoError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[LiuyaoError]', error);
    }, [error]);

    return (
        <div className="flex min-h-[60vh] items-center justify-center bg-background px-4">
            <div className="max-w-sm w-full text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-fire-soft">
                    <span className="text-2xl text-danger">!</span>
                </div>
                <h2 className="mb-2 font-display text-xl">六爻起卦出错</h2>
                <p className="text-sm text-foreground-secondary mb-6">
                    {error.message || '加载六爻起卦时发生了意外错误'}
                </p>
                <div className="flex gap-3 justify-center">
                    <Button size="lg" className="h-11 w-28 px-0" onClick={reset}>重试</Button>
                    <Link
                        href="/liuyao"
                        className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'h-11 w-28 px-0')}
                    >
                        返回六爻
                    </Link>
                </div>
            </div>
        </div>
    );
}
