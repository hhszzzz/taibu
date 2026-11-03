/**
 * 功能模块开关管理面板
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState)
 * - 有开关切换交互功能
 */
'use client';

import { useCallback, useEffect, useState } from "react";
import { requestBrowserData } from '@/lib/browser-api';
import { Button } from '@/components/ui/Button';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { useFeatureToggles } from "@/lib/hooks/useFeatureToggles";
import { getFeatureModules } from '@/lib/navigation/registry';
import { AGENT_TOOL_SCOPE_DEFINITIONS, type AgentToolScopeId } from '@/lib/agent/tool-catalog';

const MODULES = getFeatureModules();

type PendingToggle = { featureId: string; enabled: boolean };
type PendingScopeToggle = { scopeId: AgentToolScopeId; enabled: boolean };

export function FeatureTogglePanel() {
    const { isFeatureEnabled, isLoading, loaded, error: loadError, refresh } = useFeatureToggles();
    // 保存期间先显示目标状态；失败时清掉，开关回到服务端状态。
    const [pending, setPending] = useState<PendingToggle | null>(null);
    const [scopeState, setScopeState] = useState<{ loaded: boolean; scopes: Record<string, boolean>; error: string | null }>({
        loaded: false,
        scopes: {},
        error: null,
    });
    const [scopePending, setScopePending] = useState<PendingScopeToggle | null>(null);
    const [error, setError] = useState("");

    const loadScopes = useCallback(async () => {
        setScopeState(current => ({ ...current, error: null }));
        try {
            const data = await requestBrowserData<{ scopes?: Record<string, boolean> }>(
                "/api/agent-tool-scopes",
                undefined,
                { fallbackMessage: "加载 Agent 工具范围失败" },
            );
            setScopeState({ loaded: true, scopes: data.scopes ?? {}, error: null });
        } catch (err) {
            setScopeState(current => ({ ...current, loaded: false, error: err instanceof Error ? err.message : "加载 Agent 工具范围失败" }));
        }
    }, []);

    useEffect(() => { void loadScopes(); }, [loadScopes]);

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

    const handleScopeToggle = async (scopeId: AgentToolScopeId, currentlyEnabled: boolean) => {
        if (scopePending || pending || !scopeState.loaded) return;
        setScopePending({ scopeId, enabled: !currentlyEnabled });
        setError("");
        try {
            await requestBrowserData(
                "/api/agent-tool-scopes",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ scopeId, disabled: currentlyEnabled }),
                },
                { fallbackMessage: "更新 Agent 工具范围失败" },
            );
            await loadScopes();
        } catch (err) {
            setError(err instanceof Error && err.message ? err.message : "更新 Agent 工具范围失败");
        } finally {
            setScopePending(null);
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
                <Button variant="ghost" size="xs" onClick={() => { void refresh(); }}>重试</Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <p className="settings-help">关闭后，用户将无法访问对应页面、入口或接入说明；对应的 Agent 调用也会在执行前收到明确的关闭提示。</p>

            {error ? (
                <div role="alert" className="settings-alert">{error}</div>
            ) : null}

            {/* 分隔线画在每格右侧和下方，被外框裁掉最外一圈。 */}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))] overflow-hidden rounded-2xl border border-border bg-surface">
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

            <div className="mt-4 space-y-3">
                <div>
                    <h3 className="text-sm font-medium text-foreground">Agent 工具范围</h3>
                    <p className="mt-1 text-xs text-foreground-secondary">这些开关只影响 Agent 使用工具，不会隐藏用户页面。关闭后工具仍会保留在模型上下文中，但调用会返回可修正的权限错误。「代码模式」「计划模式」关闭后，输入框不再提供该模式，已保存的开关也会失效。</p>
                </div>
                {scopeState.error ? (
                    <div role="alert" className="settings-alert">
                        {scopeState.error}
                        <Button variant="ghost" size="xs" onClick={() => { void loadScopes(); }}>重试</Button>
                    </div>
                ) : null}
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] overflow-hidden rounded-2xl border border-border bg-surface">
                    {AGENT_TOOL_SCOPE_DEFINITIONS.map(({ id, label, description }) => {
                        const enabled = scopePending?.scopeId === id
                            ? scopePending.enabled
                            : scopeState.scopes[id] !== true;
                        return (
                            <li key={id} className="flex min-h-[4.5rem] items-center justify-between gap-3 px-4 py-2 shadow-[1px_0_0_var(--border),0_1px_0_var(--border)]">
                                <span className="min-w-0">
                                    <span className={`block truncate text-sm ${enabled ? 'text-foreground' : 'text-foreground-tertiary'}`}>{label}</span>
                                    <span className="block truncate text-[11px] text-foreground-secondary" title={description}>{description}</span>
                                </span>
                                <SettingsSwitch
                                    label={label}
                                    checked={enabled}
                                    disabled={!!scopePending || !!pending || !scopeState.loaded}
                                    onToggle={() => { void handleScopeToggle(id, scopeState.scopes[id] !== true); }}
                                />
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
