/**
 * 登录覆盖层组件
 *
 * 'use client' 标记说明：
 * - 读取客户端会话状态
 * - 匿名访问关闭后，未登录只显示登录提示
 */
'use client';

import { useSessionSafe } from '@/components/providers/ClientProviders';
import { LoginRequiredState } from '@/components/auth/LoginRequiredState';

interface LoginOverlayProps {
    children: React.ReactNode;
    message?: string;
}

/**
 * 登录覆盖层组件
 * 未登录时只显示登录提示，不再渲染匿名预览内容
 */
export function LoginOverlay({ children, message = '登录后查看完整内容' }: LoginOverlayProps) {
    const { user, loading } = useSessionSafe();

    // 加载中或已登录，直接显示内容
    if (loading || user) {
        return <>{children}</>;
    }

    return <LoginRequiredState title={message} />;
}
