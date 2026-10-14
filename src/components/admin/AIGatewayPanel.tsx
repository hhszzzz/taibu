/**
 * AI 网关管理面板
 *
 * 管理全局 NewAPI / Octopus 配置
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { RefreshCw, Save } from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';

interface AIGateway {
    id: string;
    gatewayKey: 'newapi' | 'octopus';
    displayName: string;
    baseUrl: string;
    apiKeyEnvVar: string;
    hasApiKey: boolean;
    transport: 'openai_compatible';
    isEnabled: boolean;
    notes: string | null;
}

const GATEWAY_DESCRIPTIONS: Record<AIGateway['gatewayKey'], string> = {
    newapi: '主网关，通常用于优先路由',
    octopus: '备用网关，可用于固定路由或自动故障转移',
};

export function AIGatewayPanel() {
    const [gateways, setGateways] = useState<AIGateway[]>([]);
    const [savedGateways, setSavedGateways] = useState<AIGateway[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const { showToast } = useToast();
    useUnsavedSettingsGuard(!loading && JSON.stringify(gateways) !== JSON.stringify(savedGateways));

    const loadGateways = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const data = await requestBrowserData<{ gateways?: AIGateway[] }>(
                '/api/admin/ai-gateways',
                { method: 'GET' },
                { fallbackMessage: '获取网关列表失败' },
            );
            setGateways(data.gateways || []);
            setSavedGateways(data.gateways || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : '获取网关列表失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadGateways();
    }, [loadGateways]);

    const updateGatewayField = <K extends keyof AIGateway>(id: string, field: K, value: AIGateway[K]) => {
        setGateways((current) => current.map((gateway) => (
            gateway.id === id
                ? { ...gateway, [field]: value }
                : gateway
        )));
    };

    const saveGateway = async (gateway: AIGateway) => {
        setUpdatingId(gateway.id);
        try {
            await requestBrowserData(
                `/api/admin/ai-gateways/${gateway.id}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        displayName: gateway.displayName.trim(),
                        baseUrl: gateway.baseUrl.trim(),
                        apiKeyEnvVar: gateway.apiKeyEnvVar.trim(),
                        transport: gateway.transport,
                        isEnabled: gateway.isEnabled,
                        notes: gateway.notes?.trim() || null,
                    }),
                },
                { fallbackMessage: '保存网关失败' },
            );

            showToast('success', `${gateway.displayName} 已更新`);
            await loadGateways();
        } catch (e) {
            showToast('error', e instanceof Error ? e.message : '保存网关失败');
        } finally {
            setUpdatingId(null);
        }
    };

    if (loading) {
        return <SoundWaveLoader variant="block" />;
    }

    if (error) {
        return (
            <div className="text-center py-12">
                <p className="text-red-500 mb-4">{error}</p>
                <button
                    onClick={loadGateways}
                    className="px-4 py-2 rounded-lg bg-accent text-on-accent hover:bg-accent/90"
                >
                    重试
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-foreground-secondary">
                    配置统一网关入口。模型只维护映射关系，网关地址与密钥环境变量在这里集中管理。
                </p>
                <button
                    onClick={loadGateways}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-background-secondary hover:bg-background-secondary/80 transition-colors"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    刷新
                </button>
            </div>

            <div className="space-y-3">
                {gateways.map((gateway) => {
                    const isUpdating = updatingId === gateway.id;

                    return (
                        <div
                            key={gateway.id}
                            className="border border-border rounded-xl p-4 bg-background-secondary/20"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-medium">{gateway.displayName}</h3>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-background text-foreground-secondary uppercase">
                                            {gateway.gatewayKey}
                                        </span>
                                        {gateway.hasApiKey ? (
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">
                                                已检测到 Key
                                            </span>
                                        ) : (
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-danger/10 text-danger">
                                                未检测到 Key
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-foreground-secondary mt-1">
                                        {GATEWAY_DESCRIPTIONS[gateway.gatewayKey]}
                                    </p>
                                </div>
                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={gateway.isEnabled}
                                        onChange={(e) => updateGatewayField(gateway.id, 'isEnabled', e.target.checked)}
                                        disabled={isUpdating}
                                    />
                                    启用
                                </label>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mt-4">
                                <div>
                                    <label className="block text-xs text-foreground-secondary mb-1">显示名称</label>
                                    <input
                                        type="text"
                                        value={gateway.displayName}
                                        onChange={(e) => updateGatewayField(gateway.id, 'displayName', e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-foreground-secondary mb-1">Key 环境变量</label>
                                    <input
                                        type="text"
                                        value={gateway.apiKeyEnvVar}
                                        onChange={(e) => updateGatewayField(gateway.id, 'apiKeyEnvVar', e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-foreground-secondary mb-1">Base URL</label>
                                    <input
                                        type="text"
                                        value={gateway.baseUrl}
                                        onChange={(e) => updateGatewayField(gateway.id, 'baseUrl', e.target.value)}
                                        placeholder="https://gateway.example/v1"
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                    />
                                    <p className="text-[11px] text-foreground-secondary mt-1">
                                        填 OpenAI 兼容 Base URL，系统会按 chat / embedding / rerank 自动拼接接口路径。
                                    </p>
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-foreground-secondary mb-1">备注</label>
                                    <input
                                        type="text"
                                        value={gateway.notes || ''}
                                        onChange={(e) => updateGatewayField(gateway.id, 'notes', e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end mt-4">
                                <button
                                    onClick={() => saveGateway(gateway)}
                                    disabled={isUpdating}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-accent text-on-accent hover:bg-accent/90 disabled:opacity-50"
                                >
                                    {isUpdating ? <SoundWaveLoader variant="inline" /> : <Save className="w-3.5 h-3.5" />}
                                    保存网关
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
