/**
 * 功能模块开关管理面板
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState)
 * - 有开关切换交互功能
 */
'use client';

import { useState } from "react";
import { requestBrowserData } from '@/lib/browser-api';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { useFeatureToggles } from "@/lib/hooks/useFeatureToggles";
import { getFeatureModules } from '@/lib/navigation/registry';

const MODULES = getFeatureModules();

type PendingToggle = { featureId: string; enabled: boolean };

export function FeatureTogglePanel() {
    const { isFeatureEnabled, isLoading, loaded, error: loadError, refresh } = useFeatureToggles();
    // 保存期间先显示目标状态；失败时清掉，开关回到服务端状态。
    const [pending, setPending] = useState<PendingToggle | null>(null);
    const [error, setError] = useState("");

    const handleToggle = async (featureId: string, currentlyEnabled: boolean) => {
        if (pending || isLoading) return;

        setPending({ featureId, enabled: !currentlyEnabled });
        setError("");

        try {
            await requestBrowserData(
                "/api/feature-toggles",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ featureId, disabled: currentlyEnabled }),
                },
                { fallbackMessage: "更新失败，请重试" },
            );

            await refresh();
        } catch (err) {
            setError(err instanceof Error && err.message ? err.message : "更新失败，请重试");
        } finally {
            setPending(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <SoundWaveLoader variant="inline" />
                <span className="ml-2 text-sm text-foreground-secondary">加载功能状态...</span>
            </div>
        );
    }

    // 状态没读到时不渲染开关：全部显示为关闭会误导，点击还会写入错误的值。
    if (!loaded) {
        return (
            <div role="alert" className="settings-alert">
                {loadError?.message || '功能状态加载失败'}
                <button type="button" onClick={() => { void refresh(); }}>重试</button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <p className="settings-help">关闭后，用户将无法访问对应页面、入口或接入说明。</p>

            {error ? (
                <div role="alert" className="settings-alert">{error}</div>
            ) : null}

            {/* 分隔线画在每格右侧和下方，被外框裁掉最外一圈。 */}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))] overflow-hidden rounded-[14px] border border-border bg-surface">
                {MODULES.map(({ id, label }) => {
                    const enabled = pending?.featureId === id ? pending.enabled : isFeatureEnabled(id);

                    return (
                        <li
                            key={id}
                            className="flex min-h-[3.25rem] items-center justify-between gap-3 px-4 shadow-[1px_0_0_var(--border),0_1px_0_var(--border)]"
                        >
                            <span className={`min-w-0 truncate text-sm ${enabled ? 'text-foreground' : 'text-foreground-tertiary'}`}>{label}</span>
                            <SettingsSwitch
                                label={label}
                                checked={enabled}
                                disabled={!!pending}
                                onToggle={() => { void handleToggle(id, isFeatureEnabled(id)); }}
                            />
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
