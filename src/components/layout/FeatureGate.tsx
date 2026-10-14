/**
 * 功能模块门控组件
 *
 * 只检查 feature toggle 开关，不要求登录。
 * 匿名用户可以访问已开放的功能，但各页面自行处理保存/历史等需登录的操作。
 */
'use client';

import { useSyncExternalStore } from 'react';
import { CloudOff, PauseCircle } from 'lucide-react';
import Link from 'next/link';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { getFeatureLabel } from '@/lib/navigation/registry';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { StatePanel, STATE_SECONDARY_ACTION_CLASS } from '@/components/ui/StatePanel';

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
            <StatePanel
                layout="page"
                titleAs="h2"
                icon={CloudOff}
                title="功能状态加载失败"
                description="暂时无法确认该功能是否开放，请稍后重试。"
                action={(
                    <button type="button" onClick={() => void refresh()} className={STATE_SECONDARY_ACTION_CLASS}>
                        重试
                    </button>
                )}
            />
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
        const label = getFeatureLabel(featureId);
        return (
            <StatePanel
                layout="page"
                titleAs="h2"
                icon={PauseCircle}
                title="该功能暂时关闭"
                description={label ? `管理员已暂停「${label}」，稍后再来看看。` : '管理员已暂停这项功能，稍后再来看看。'}
                action={<Link href="/" className={STATE_SECONDARY_ACTION_CLASS}>返回首页</Link>}
            />
        );
    }

    return <>{children}</>;
}
