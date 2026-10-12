/**
 * 功能模块门控组件
 *
 * 只检查 feature toggle 开关，不要求登录。
 * 匿名用户可以访问已开放的功能，但各页面自行处理保存/历史等需登录的操作。
 */
'use client';

import { useSyncExternalStore } from 'react';
import { ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';

interface FeatureGateProps {
    featureId: string;
    children: React.ReactNode;
}

export function FeatureGate({ featureId, children }: FeatureGateProps) {
    const hydrated = useSyncExternalStore(
        () => () => {},
        () => true,
        () => false
    );
    const { isFeatureEnabled, isLoading, loaded, error, refresh } = useFeatureToggles({ enabled: hydrated });

    if (!hydrated || isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] bg-background">
                <SoundWaveLoader variant="block" />
            </div>
        );
    }

    if (!loaded && error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <ShieldOff className="w-8 h-8 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-medium text-foreground mb-2">
                    功能状态加载失败
                </h2>
                <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                    暂时无法确认该功能是否开放，请稍后重试。
                </p>
                <button
                    type="button"
                    onClick={() => void refresh()}
                    className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                    重试
                </button>
                {/* Pages such as /chat show no site navigation on phones. */}
                <Link href="/" className="mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    返回首页
                </Link>
            </div>
        );
    }

    if (!loaded) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] bg-background">
                <SoundWaveLoader variant="block" />
            </div>
        );
    }

    if (!isFeatureEnabled(featureId)) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <ShieldOff className="w-8 h-8 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-medium text-foreground mb-2">
                    功能暂未开放
                </h2>
                <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                    该功能当前未启用，请联系管理员或稍后再试
                </p>
                <Link
                    href="/"
                    className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                    返回首页
                </Link>
            </div>
        );
    }

    return <>{children}</>;
}
