// Controlled editor view; drafts and request orchestration stay in AIModelPanel.
'use client';

import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { VENDOR_PRESETS, type AIModel, type CreateModelDraft, type CreateVendorPreset, type ManagedGatewayKey } from '@/lib/admin/ai-model-editor';

type Props = {
    newModel: CreateModelDraft;
    setNewModel: Dispatch<SetStateAction<CreateModelDraft>>;
    updateNewModel: (updates: Partial<CreateModelDraft>) => void;
    showCreateAdvanced: boolean;
    setShowCreateAdvanced: Dispatch<SetStateAction<boolean>>;
    setShowCreateForm: Dispatch<SetStateAction<boolean>>;
    resetNewModel: () => void;
    handleCreateRoutingModeChange: (mode: AIModel['routingMode']) => void;
    handleCreatePrimaryGatewayChange: (gateway: ManagedGatewayKey) => void;
    createModel: () => Promise<void>;
    updating: string | null;
};

export function AIModelCreateForm({ newModel, setNewModel, updateNewModel, showCreateAdvanced, setShowCreateAdvanced, setShowCreateForm, resetNewModel, handleCreateRoutingModeChange, handleCreatePrimaryGatewayChange, createModel, updating }: Props) {
    return (
        <div className="border border-border rounded-xl p-4 bg-background-secondary/30 space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">创建模型</h3>
                <button
                    onClick={() => {
                        setShowCreateForm(false);
                        setShowCreateAdvanced(false);
                        resetNewModel();
                    }}
                    className="text-xs text-foreground-secondary hover:text-foreground"
                >
                    取消
                </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">模型 ID</label>
                    <input
                        type="text"
                        value={newModel.modelKey}
                        onChange={(e) => updateNewModel({ modelKey: e.target.value })}
                        placeholder="deepseek-v3.2"
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    />
                </div>
                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">显示名称</label>
                    <input
                        type="text"
                        value={newModel.displayName}
                        onChange={(e) => updateNewModel({ displayName: e.target.value })}
                        placeholder="DeepSeek V3.2"
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    />
                </div>
                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">供应商</label>
                    <select
                        value={newModel.vendorPreset}
                        onChange={(e) => updateNewModel({ vendorPreset: e.target.value as CreateVendorPreset })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    >
                        {VENDOR_PRESETS.map((vendor) => (
                            <option key={vendor.value} value={vendor.value}>
                                {vendor.label}
                            </option>
                        ))}
                        <option value="__custom__">自定义供应商</option>
                    </select>
                    {newModel.vendorPreset === '__custom__' && (
                        <input
                            type="text"
                            value={newModel.customVendor}
                            onChange={(e) => updateNewModel({ customVendor: e.target.value })}
                            placeholder="添加供应商，如 ChatGPT"
                            className="mt-2 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                        />
                    )}
                </div>
                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">模型类型</label>
                    <select
                        value={newModel.usageType}
                        onChange={(e) => updateNewModel({ usageType: e.target.value as AIModel['usageType'] })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    >
                        <option value="chat">聊天</option>
                        <option value="vision">视觉</option>
                        <option value="embedding">Embedding</option>
                        <option value="rerank">Rerank</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">路由模式</label>
                    <select
                        value={newModel.routingMode}
                        onChange={(e) => handleCreateRoutingModeChange(e.target.value as AIModel['routingMode'])}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    >
                        <option value="auto">自动故障转移</option>
                        <option value="newapi">固定 NewAPI</option>
                        <option value="octopus">固定 Octopus</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">主绑定网关</label>
                    <select
                        value={newModel.primaryGatewayKey}
                        onChange={(e) => handleCreatePrimaryGatewayChange(e.target.value as ManagedGatewayKey)}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    >
                        <option value="newapi">NewAPI</option>
                        <option value="octopus">Octopus</option>
                    </select>
                    <p className="mt-1 text-[11px] text-foreground-secondary">
                        创建时直接绑定主网关；若选择自动故障转移，后续可再添加备用来源。
                    </p>
                </div>
                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">会员等级</label>
                    <select
                        value={newModel.requiredTier}
                        onChange={(e) => updateNewModel({ requiredTier: e.target.value as AIModel['requiredTier'] })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    >
                        <option value="free">Free</option>
                        <option value="plus">Plus</option>
                        <option value="pro">Pro</option>
                    </select>
                </div>
                <div className="col-span-2">
                    <label className="block text-xs text-foreground-secondary mb-1">描述</label>
                    <input
                        type="text"
                        value={newModel.description}
                        onChange={(e) => updateNewModel({ description: e.target.value })}
                        placeholder="可选"
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    />
                </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={newModel.supportsReasoning}
                        onChange={(e) => setNewModel({
                            ...newModel,
                            supportsReasoning: e.target.checked,
                            isReasoningDefault: e.target.checked ? newModel.isReasoningDefault : false,
                        })}
                    />
                    支持推理
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={newModel.isReasoningDefault}
                        disabled={!newModel.supportsReasoning}
                        onChange={(e) => updateNewModel({ isReasoningDefault: e.target.checked })}
                    />
                    默认开启推理
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={newModel.supportsVision}
                        onChange={(e) => updateNewModel({ supportsVision: e.target.checked })}
                    />
                    支持视觉
                </label>
            </div>
            {newModel.supportsReasoning && (
                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">推理等级</label>
                    <select
                        value={newModel.reasoningRequiredTier}
                        onChange={(e) => updateNewModel({ reasoningRequiredTier: e.target.value })}
                        className="w-full max-w-xs px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    >
                        <option value="free">Free</option>
                        <option value="plus">Plus</option>
                        <option value="pro">Pro</option>
                    </select>
                </div>
            )}
            <div className="pt-2 border-t border-border/70">
                <button
                    type="button"
                    onClick={() => setShowCreateAdvanced((value) => !value)}
                    className="flex items-center gap-2 text-sm font-medium text-foreground-secondary hover:text-foreground"
                >
                    {showCreateAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    高级设置
                </button>
            </div>
            {showCreateAdvanced && (
                <div className="space-y-4 rounded-xl border border-border bg-background/70 p-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-foreground-secondary mb-1">默认温度</label>
                            <input
                                type="number"
                                min="0"
                                max="2"
                                step="0.1"
                                value={newModel.defaultTemperature}
                                onChange={(e) => setNewModel({ ...newModel, defaultTemperature: parseFloat(e.target.value || '0.7') })}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-foreground-secondary mb-1">Top P</label>
                            <label className="flex items-center gap-2 text-sm mb-2">
                                <input
                                    type="checkbox"
                                    checked={newModel.defaultTopP !== null}
                                    onChange={(e) => setNewModel({
                                        ...newModel,
                                        defaultTopP: e.target.checked ? 1 : null,
                                    })}
                                />
                                启用 Top P
                            </label>
                            {newModel.defaultTopP !== null && (
                                <input
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={newModel.defaultTopP}
                                    onChange={(e) => setNewModel({ ...newModel, defaultTopP: parseFloat(e.target.value || '1') })}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                />
                            )}
                        </div>
                        <div>
                            <label className="block text-xs text-foreground-secondary mb-1">Presence Penalty</label>
                            <label className="flex items-center gap-2 text-sm mb-2">
                                <input
                                    type="checkbox"
                                    checked={newModel.defaultPresencePenalty !== null}
                                    onChange={(e) => setNewModel({
                                        ...newModel,
                                        defaultPresencePenalty: e.target.checked ? 0 : null,
                                    })}
                                />
                                启用 Presence Penalty
                            </label>
                            {newModel.defaultPresencePenalty !== null && (
                                <input
                                    type="number"
                                    min="-2"
                                    max="2"
                                    step="0.1"
                                    value={newModel.defaultPresencePenalty}
                                    onChange={(e) => setNewModel({
                                        ...newModel,
                                        defaultPresencePenalty: parseFloat(e.target.value || '0'),
                                    })}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                />
                            )}
                        </div>
                        <div>
                            <label className="block text-xs text-foreground-secondary mb-1">Frequency Penalty</label>
                            <label className="flex items-center gap-2 text-sm mb-2">
                                <input
                                    type="checkbox"
                                    checked={newModel.defaultFrequencyPenalty !== null}
                                    onChange={(e) => setNewModel({
                                        ...newModel,
                                        defaultFrequencyPenalty: e.target.checked ? 0 : null,
                                    })}
                                />
                                启用 Frequency Penalty
                            </label>
                            {newModel.defaultFrequencyPenalty !== null && (
                                <input
                                    type="number"
                                    min="-2"
                                    max="2"
                                    step="0.1"
                                    value={newModel.defaultFrequencyPenalty}
                                    onChange={(e) => setNewModel({
                                        ...newModel,
                                        defaultFrequencyPenalty: parseFloat(e.target.value || '0'),
                                    })}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                />
                            )}
                        </div>
                        <div className="col-span-2">
                            <label className="flex items-center gap-2 text-sm mb-2">
                                <input
                                    type="checkbox"
                                    checked={newModel.defaultMaxTokens !== null}
                                    onChange={(e) => setNewModel({
                                        ...newModel,
                                        defaultMaxTokens: e.target.checked ? 4000 : null,
                                    })}
                                />
                                启用最大输出限制（Cherry 默认不强制写死）
                            </label>
                            {newModel.defaultMaxTokens !== null && (
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={newModel.defaultMaxTokens}
                                    onChange={(e) => setNewModel({ ...newModel, defaultMaxTokens: parseInt(e.target.value || '4000', 10) })}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                />
                            )}
                        </div>
                        {newModel.supportsReasoning && (
                            <>
                                <div>
                                    <label className="block text-xs text-foreground-secondary mb-1">默认思考等级</label>
                                    <select
                                        value={newModel.defaultReasoningEffort || ''}
                                        onChange={(e) => setNewModel({
                                            ...newModel,
                                            defaultReasoningEffort: (e.target.value || null) as AIModel['defaultReasoningEffort'],
                                        })}
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                    >
                                        <option value="">不设置</option>
                                        <option value="minimal">Minimal</option>
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-foreground-secondary mb-1">思考等级参数格式</label>
                                    <select
                                        value={newModel.reasoningEffortFormat || 'reasoning_object'}
                                        onChange={(e) => setNewModel({
                                            ...newModel,
                                            reasoningEffortFormat: e.target.value as AIModel['reasoningEffortFormat'],
                                        })}
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                    >
                                        <option value="reasoning_object">reasoning.effort</option>
                                        <option value="reasoning_effort">reasoning_effort</option>
                                    </select>
                                </div>
                            </>
                        )}
                        <div className="col-span-2">
                            <label className="block text-xs text-foreground-secondary mb-1">自定义参数</label>
                            <textarea
                                value={newModel.customParametersText}
                                onChange={(e) => setNewModel({ ...newModel, customParametersText: e.target.value })}
                                rows={6}
                                placeholder={'{\n  "presence_penalty": 0.5,\n  "frequency_penalty": 0.2,\n  "reasoning": { "effort": "high" }\n}'}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
                            />
                            <p className="text-[11px] text-foreground-secondary mt-1">
                                Cherry 风格做法：模型专属参数如 `presence_penalty`、`frequency_penalty`、供应商私有字段放这里。这里会在基础参数之后合并并覆盖。
                            </p>
                        </div>
                    </div>
                </div>
            )}
            <div className="flex justify-end">
                <button
                    onClick={createModel}
                    disabled={updating === 'creating'}
                    className="px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 text-sm"
                >
                    {updating === 'creating' ? '创建中...' : '创建模型'}
                </button>
            </div>
        </div>

    );
}
