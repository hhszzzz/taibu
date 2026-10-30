/**
 * Chat 路由段错误边界
 * 'use client' - Next.js error boundary 必须是客户端组件
 */
'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { StatePanel, STATE_PRIMARY_ACTION_CLASS, STATE_SECONDARY_ACTION_CLASS } from '@/components/ui/StatePanel';
import { Button } from '@/components/ui/Button';

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
        <div className="bg-background">
            <StatePanel layout="page" titleAs="h2" tone="danger" icon={AlertCircle}
                title="对话加载失败"
                description={error.message || '加载对话时发生了意外错误'}
                action={<>
                    <Button size="sm" className={STATE_PRIMARY_ACTION_CLASS} onClick={reset}>重试</Button>
                    <Link href="/chat" className={STATE_SECONDARY_ACTION_CLASS}>返回对话</Link>
                    {/* Phones show no site navigation on /chat. */}
                    <Link href="/" className={STATE_SECONDARY_ACTION_CLASS}>返回首页</Link>
                </>} />
        </div>
    );
}
