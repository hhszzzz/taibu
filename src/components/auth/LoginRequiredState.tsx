/**
 * 需登录状态：说明 + 登录按钮，点击直接打开登录弹窗
 *
 * 'use client' 标记说明：
 * - 使用 useState 控制 AuthModal 开关
 */
'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { AuthModal } from '@/components/auth/AuthModal';
import { StatePanel, STATE_PRIMARY_ACTION_CLASS, type StatePanelProps } from '@/components/ui/StatePanel';
import { Button } from '@/components/ui/Button';

interface LoginRequiredStateProps {
    title?: string;
    description?: string;
    layout?: StatePanelProps['layout'];
}

export function LoginRequiredState({
    title = '登录后查看完整内容',
    description = '你的数据只对你自己可见。',
    layout = 'page',
}: LoginRequiredStateProps) {
    const [showAuthModal, setShowAuthModal] = useState(false);

    return (
        <>
            <StatePanel
                layout={layout}
                titleAs="h2"
                icon={Lock}
                tone="accent"
                title={title}
                description={description}
                action={(
                    <Button unstyled type="button" onClick={() => setShowAuthModal(true)} className={STATE_PRIMARY_ACTION_CLASS}>
                        登录
                    </Button>
                )}
            />
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </>
    );
}
