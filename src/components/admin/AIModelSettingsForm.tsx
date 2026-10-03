// Controlled editor view; drafts and request orchestration stay in AIModelPanel.
'use client';

import { Layers } from 'lucide-react';
import { VENDOR_PRESETS, type AIModel, type EditModelDraft, type CreateVendorPreset } from '@/lib/admin/ai-model-editor';

type Props = {
    model: AIModel;
    modelDraft: EditModelDraft;
    isUpdating: boolean;
    updateModelDraft: (modelId: string, updates: Partial<EditModelDraft>) => void;
    saveModelSettings: (modelId: string) => Promise<void>;
    setDeleteModelTarget: (target: { modelId: string; displayName: string }) => void;
};

export function AIModelSettingsForm({ model, modelDraft, isUpdating, updateModelDraft, saveModelSettings, setDeleteModelTarget }: Props) {
    return (
        <>
            <div className="rounded-xl border border-border bg-background/70 p-4 space-y-4 mb-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-medium">基础信息</p>
                        <p className="text-[11px] text-foreground-secondary mt-1">
                            模型 ID、显示名称和供应商会直接影响管理员配置和运行时解析。
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => saveModelSettings(model.id)}
                            disabled={isUpdating}
                            className="px-3 py-1.5 rounded-lg text-sm bg-background-secondary hover:bg-background-secondary/80"
                        >
                            保存模型设置
                        </button>
                        <button
                            type="button"
                            onClick={() => setDeleteModelTarget({
                                modelId: model.id,
                                displayName: model.displayName,
                            })}
                            disabled={isUpdating}
                            className="px-3 py-1.5 rounded-lg text-sm border border-red-500/30 text-red-500 hover:bg-red-500/10"
                        >
                            删除模型
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-foreground-secondary mb-1">模型 ID</label>
                        <input
                            type="text"
                            value={modelDraft.modelKey}
                            onChange={(e) => updateModelDraft(model.id, { modelKey: e.target.value })}
                            disabled={isUpdating}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-foreground-secondary mb-1">显示名称</label>
                        <input
                            type="text"
                            value={modelDraft.displayName}
                            onChange={(e) => updateModelDraft(model.id, { displayName: e.target.value })}
                            disabled={isUpdating}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-foreground-secondary mb-1">模型类型</label>
                        <select
                            value={modelDraft.usageType}
                            onChange={(e) => updateModelDraft(model.id, {
                                usageType: e.target.value as AIModel['usageType'],
                            })}
                            disabled={isUpdating}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                        >
                            <option value="chat">聊天</option>
                            <option value="vision">视觉</option>
                            <option value="embedding">Embedding</option>
                            <option value="rerank">Rerank</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs text-foreground-secondary mb-1">供应商</label>
                        <select
                            value={modelDraft.vendorPreset}
                            onChange={(e) => updateModelDraft(model.id, {
                                vendorPreset: e.target.value as CreateVendorPreset,
                            })}
                            disabled={isUpdating}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                        >
                            {VENDOR_PRESETS.map((vendor) => (
                                <option key={vendor.value} value={vendor.value}>
                                    {vendor.label}
                                </option>
                            ))}
                            <option value="__custom__">自定义供应商</option>
                        </select>
                        {modelDraft.vendorPreset === '__custom__' && (
                            <input
                                type="text"
                                value={modelDraft.customVendor}
                                onChange={(e) => updateModelDraft(model.id, { customVendor: e.target.value })}
                                disabled={isUpdating}
                                placeholder="添加供应商，如 ChatGPT"
                                className="mt-2 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                            />
                        )}
                    </div>
                    <div className="col-span-2">
                        <label className="block text-xs text-foreground-secondary mb-1">描述</label>
                        <input
                            type="text"
                            value={modelDraft.description}
                            onChange={(e) => updateModelDraft(model.id, { description: e.target.value })}
                            disabled={isUpdating}
                            placeholder="可选"
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                        />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">
                        所需会员等级
                    </label>
                    <select
                        value={modelDraft.requiredTier}
                        onChange={(e) => updateModelDraft(model.id, {
                            requiredTier: e.target.value as AIModel['requiredTier'],
                        })}
                        disabled={isUpdating}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    >
                        <option value="free">Free</option>
                        <option value="plus">Plus</option>
                        <option value="pro">Pro</option>
                    </select>
                </div>

                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">
                        路由模式
                    </label>
                    <select
                        value={modelDraft.routingMode}
                        onChange={(e) => updateModelDraft(model.id, {
                            routingMode: e.target.value as AIModel['routingMode'],
                        })}
                        disabled={isUpdating}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    >
                        <option value="auto">自动故障转移</option>
                        <option value="newapi">固定 NewAPI</option>
                        <option value="octopus">固定 Octopus</option>
                    </select>
                </div>

                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">
                        排序优先级
                    </label>
                    <input
                        type="number"
                        min="0"
                        step="1"
                        value={modelDraft.sortOrder}
                        onChange={(e) => updateModelDraft(model.id, {
                            sortOrder: parseInt(e.target.value || '0', 10),
                        })}
                        disabled={isUpdating}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    />
                    <p className="text-[11px] text-foreground-secondary mt-1">
                        数值越小，越优先作为该类型模型的线上默认项
                    </p>
                </div>

                <div>
                    <label className="block text-xs text-foreground-secondary mb-1">
                        推理等级
                    </label>
                    <select
                        value={modelDraft.reasoningRequiredTier}
                        onChange={(e) => updateModelDraft(model.id, {
                            reasoningRequiredTier: e.target.value,
                        })}
                        disabled={isUpdating || !modelDraft.supportsReasoning}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    >
                        <option value="free">Free</option>
                        <option value="plus">Plus</option>
                        <option value="pro">Pro</option>
                    </select>
                    <p className="text-[11px] text-foreground-secondary mt-1">
                        启用“支持推理”后生效。
                    </p>
                </div>

                <div className="col-span-2">
                    <div className="flex flex-wrap gap-4 text-sm">
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={modelDraft.supportsReasoning}
                                onChange={(e) => updateModelDraft(model.id, {
                                    supportsReasoning: e.target.checked,
                                    isReasoningDefault: e.target.checked ? modelDraft.isReasoningDefault : false,
                                    defaultReasoningEffort: e.target.checked ? modelDraft.defaultReasoningEffort : null,
                                    reasoningEffortFormat: e.target.checked ? (modelDraft.reasoningEffortFormat || 'reasoning_object') : null,
                                })}
                                disabled={isUpdating}
                            />
                            支持推理
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={modelDraft.isReasoningDefault}
                                disabled={!modelDraft.supportsReasoning || isUpdating}
                                onChange={(e) => updateModelDraft(model.id, { isReasoningDefault: e.target.checked })}
                            />
                            默认开启推理
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={modelDraft.supportsVision}
                                onChange={(e) => updateModelDraft(model.id, { supportsVision: e.target.checked })}
                                disabled={isUpdating}
                            />
                            支持视觉
                        </label>
                    </div>
                </div>
            </div>

            <div className="rounded-xl border border-border bg-background/70 p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <Layers className="w-4 h-4" />
                    高级设置
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-foreground-secondary mb-1">
                            默认温度
                        </label>
                        <input
                            type="number"
                            min="0"
                            max="2"
                            step="0.1"
                            value={modelDraft.defaultTemperature}
                            onChange={(e) => updateModelDraft(model.id, {
                                defaultTemperature: parseFloat(e.target.value || '0.7'),
                            })}
                            disabled={isUpdating}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-foreground-secondary mb-1">
                            Top P
                        </label>
                        <label className="flex items-center gap-2 text-sm mb-2">
                            <input
                                type="checkbox"
                                checked={modelDraft.defaultTopP !== null}
                                onChange={(e) => updateModelDraft(model.id, {
                                    defaultTopP: e.target.checked ? 1 : null,
                                })}
                                disabled={isUpdating}
                            />
                            启用 Top P
                        </label>
                        {modelDraft.defaultTopP !== null && (
                            <input
                                type="number"
                                min="0"
                                max="1"
                                step="0.1"
                                value={modelDraft.defaultTopP}
                                onChange={(e) => updateModelDraft(model.id, {
                                    defaultTopP: parseFloat(e.target.value || '1'),
                                })}
                                disabled={isUpdating}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                            />
                        )}
                    </div>
                    <div>
                        <label className="block text-xs text-foreground-secondary mb-1">
                            Presence Penalty
                        </label>
                        <label className="flex items-center gap-2 text-sm mb-2">
                            <input
                                type="checkbox"
                                checked={modelDraft.defaultPresencePenalty !== null}
                                onChange={(e) => updateModelDraft(model.id, {
                                    defaultPresencePenalty: e.target.checked ? 0 : null,
                                })}
                                disabled={isUpdating}
                            />
                            启用 Presence Penalty
                        </label>
                        {modelDraft.defaultPresencePenalty !== null && (
                            <input
                                type="number"
                                min="-2"
                                max="2"
                                step="0.1"
                                value={modelDraft.defaultPresencePenalty}
                                onChange={(e) => updateModelDraft(model.id, {
                                    defaultPresencePenalty: parseFloat(e.target.value || '0'),
                                })}
                                disabled={isUpdating}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                            />
                        )}
                    </div>
                    <div>
                        <label className="block text-xs text-foreground-secondary mb-1">
                            Frequency Penalty
                        </label>
                        <label className="flex items-center gap-2 text-sm mb-2">
                            <input
                                type="checkbox"
                                checked={modelDraft.defaultFrequencyPenalty !== null}
                                onChange={(e) => updateModelDraft(model.id, {
                                    defaultFrequencyPenalty: e.target.checked ? 0 : null,
                                })}
                                disabled={isUpdating}
                            />
                            启用 Frequency Penalty
                        </label>
                        {modelDraft.defaultFrequencyPenalty !== null && (
                            <input
                                type="number"
                                min="-2"
                                max="2"
                                step="0.1"
                                value={modelDraft.defaultFrequencyPenalty}
                                onChange={(e) => updateModelDraft(model.id, {
                                    defaultFrequencyPenalty: parseFloat(e.target.value || '0'),
                                })}
                                disabled={isUpdating}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                            />
                        )}
                    </div>
                    <div className="col-span-2">
                        <label className="flex items-center gap-2 text-sm mb-2">
                            <input
                                type="checkbox"
                                checked={modelDraft.defaultMaxTokens !== null}
                                onChange={(e) => updateModelDraft(model.id, {
                                    defaultMaxTokens: e.target.checked ? 4000 : null,
                                })}
                                disabled={isUpdating}
                            />
                            启用最大输出限制
                        </label>
                        {modelDraft.defaultMaxTokens !== null && (
                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={modelDraft.defaultMaxTokens}
                                onChange={(e) => updateModelDraft(model.id, {
                                    defaultMaxTokens: parseInt(e.target.value || '4000', 10),
                                })}
                                disabled={isUpdating}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                            />
                        )}
                    </div>
                    {modelDraft.supportsReasoning && (
                        <>
                            <div>
                                <label className="block text-xs text-foreground-secondary mb-1">
                                    默认思考等级
                                </label>
                                <select
                                    value={modelDraft.defaultReasoningEffort || ''}
                                    onChange={(e) => updateModelDraft(model.id, {
                                        defaultReasoningEffort: (e.target.value || null) as AIModel['defaultReasoningEffort'],
                                    })}
                                    disabled={isUpdating}
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
                                <label className="block text-xs text-foreground-secondary mb-1">
                                    思考等级参数格式
                                </label>
                                <select
                                    value={modelDraft.reasoningEffortFormat || 'reasoning_object'}
                                    onChange={(e) => updateModelDraft(model.id, {
                                        reasoningEffortFormat: e.target.value as AIModel['reasoningEffortFormat'],
                                    })}
                                    disabled={isUpdating}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                >
                                    <option value="reasoning_object">reasoning.effort</option>
                                    <option value="reasoning_effort">reasoning_effort</option>
                                </select>
                            </div>
                        </>
                    )}
                    <div className="col-span-2">
                        <label className="block text-xs text-foreground-secondary mb-1">
                            自定义参数
                        </label>
                        <textarea
                            rows={6}
                            value={modelDraft.customParametersText}
                            onChange={(e) => updateModelDraft(model.id, {
                                customParametersText: e.target.value,
                            })}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
                        />
                        <p className="text-[11px] text-foreground-secondary mt-2">
                            模型专属参数建议放这里，例如 `presence_penalty`、`frequency_penalty`、供应商私有字段。这里会覆盖基础参数，并在“保存模型设置”时统一生效。
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
}
