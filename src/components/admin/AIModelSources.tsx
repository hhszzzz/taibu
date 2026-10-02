// Controlled editor view; drafts and request orchestration stay in AIModelPanel.
'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Check, ChevronUp, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { getSourceModelIdState, type AIModel, type ModelSource, type ManagedGatewayKey, type SourceDraft } from '@/lib/admin/ai-model-editor';

type Props = {
    model: AIModel;
    isUpdating: boolean;
    availableGatewayOptions: ManagedGatewayKey[];
    isAddingHere: boolean;
    setAddingToModel: (modelId: string | null) => void;
    newSource: SourceDraft & { sourceKey: ManagedGatewayKey };
    setNewSource: Dispatch<SetStateAction<SourceDraft & { sourceKey: ManagedGatewayKey }>>;
    editingSourceId: string | null;
    setEditingSourceId: (id: string | null) => void;
    editingDraft: SourceDraft | null;
    setEditingDraft: (draft: SourceDraft | null) => void;
    beginEditSource: (source: ModelSource, modelKey: string) => void;
    saveSource: (modelId: string, sourceId: string, modelKey: string) => Promise<void>;
    activateSource: (modelId: string, sourceId: string) => Promise<void>;
    setDeleteTarget: (target: { modelId: string; sourceId: string }) => void;
    resetNewSource: () => void;
    addSource: (modelId: string, modelKey: string) => Promise<void>;
};

export function AIModelSources({ model, isUpdating, availableGatewayOptions, isAddingHere, setAddingToModel, newSource, setNewSource, editingSourceId, setEditingSourceId, editingDraft, setEditingDraft, beginEditSource, saveSource, activateSource, setDeleteTarget, resetNewSource, addSource }: Props) {
    return (
        <div className="mt-4 rounded-xl border border-border bg-background/70 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                    <p className="text-sm font-medium">来源与故障转移</p>
                    <p className="text-[11px] text-foreground-secondary mt-1">
                        主来源失败时，自动切到下一个已启用且网关可用的来源。固定路由模式只会请求对应网关。
                    </p>
                </div>
                {availableGatewayOptions.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => {
                            setAddingToModel(model.id);
                            setNewSource((current) => ({
                                ...current,
                                sourceKey: availableGatewayOptions[0],
                            }));
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-dashed border-border hover:border-accent hover:text-accent transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        {model.sources.length > 0 ? '添加备用来源' : '添加来源'}
                    </button>
                ) : (
                    <span className="text-[11px] text-foreground-secondary">
                        已绑定全部可用网关
                    </span>
                )}
            </div>

            <div className="space-y-3">
                {model.sources.length === 0 && (
                    <div className="text-sm text-foreground-secondary px-3 py-4 border border-dashed border-border rounded-lg">
                        当前模型还没有任何来源绑定，请至少绑定一个网关，否则运行时会直接失败。
                    </div>
                )}

                {model.sources.map((source) => {
                    const isEditing = editingSourceId === source.id && editingDraft;
                    const sourceModelId = getSourceModelIdState(model.modelKey, source.modelIdOverride);
                    return (
                        <div
                            key={source.id}
                            className={`rounded-lg border p-3 ${source.isActive
                                ? 'border-accent bg-accent/5'
                                : 'border-border bg-background'
                                }`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-sm">{source.sourceName}</span>
                                        {source.isActive && (
                                            <span className="text-xs bg-accent text-white px-2 py-0.5 rounded-full">
                                                首选
                                            </span>
                                        )}
                                        {!source.isEnabled && (
                                            <span className="text-xs bg-gray-500/10 text-gray-500 px-2 py-0.5 rounded-full">
                                                已禁用
                                            </span>
                                        )}
                                        {!source.hasApiKey && (
                                            <span className="text-xs bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full">
                                                未配置 Key
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 space-y-1 text-xs text-foreground-secondary">
                                        <p>{source.apiKeyEnvVar || '未配置 Key 环境变量'} → {source.apiUrl || '未配置 Base URL'}</p>
                                        <p>
                                            {sourceModelId.inherited ? '模型 ID' : '上游模型 ID'}: {sourceModelId.value}
                                            {sourceModelId.inherited && '（跟随模型）'}
                                        </p>
                                        {source.reasoningModelId && <p>推理模型 ID: {source.reasoningModelId}</p>}
                                        <p>优先级: {source.priority}</p>
                                        {source.notes && <p>备注: {source.notes}</p>}
                                    </div>

                                    {isEditing && editingDraft && (
                                        <div className="grid grid-cols-2 gap-3 mt-3">
                                            <div>
                                                <label className="block text-xs text-foreground-secondary mb-1">上游模型 ID（可选）</label>
                                                <input
                                                    type="text"
                                                    value={editingDraft.modelIdOverride}
                                                    onChange={(e) => setEditingDraft({ ...editingDraft, modelIdOverride: e.target.value })}
                                                    placeholder={`留空则跟随模型 ID（${model.modelKey}）`}
                                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-foreground-secondary mb-1">推理模型 ID</label>
                                                <input
                                                    type="text"
                                                    value={editingDraft.reasoningModelId}
                                                    onChange={(e) => setEditingDraft({ ...editingDraft, reasoningModelId: e.target.value })}
                                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-foreground-secondary mb-1">优先级</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="1"
                                                    value={editingDraft.priority}
                                                    onChange={(e) => setEditingDraft({ ...editingDraft, priority: parseInt(e.target.value || '0', 10) })}
                                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                                />
                                            </div>
                                            <div className="flex items-end">
                                                <label className="flex items-center gap-2 text-sm">
                                                    <input
                                                        type="checkbox"
                                                        checked={editingDraft.isEnabled}
                                                        onChange={(e) => setEditingDraft({ ...editingDraft, isEnabled: e.target.checked })}
                                                    />
                                                    启用绑定
                                                </label>
                                            </div>
                                            <div className="col-span-2">
                                                <label className="block text-xs text-foreground-secondary mb-1">备注</label>
                                                <input
                                                    type="text"
                                                    value={editingDraft.notes}
                                                    onChange={(e) => setEditingDraft({ ...editingDraft, notes: e.target.value })}
                                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center gap-2">
                                    {!isEditing && (
                                        <button
                                            type="button"
                                            onClick={() => beginEditSource(source, model.modelKey)}
                                            disabled={isUpdating}
                                            className="p-1.5 rounded-lg hover:bg-background-secondary transition-colors"
                                            title="编辑来源"
                                        >
                                            <Pencil className="w-4 h-4 text-foreground-secondary" />
                                        </button>
                                    )}
                                    {isEditing && editingDraft && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => saveSource(model.id, source.id, model.modelKey)}
                                                disabled={isUpdating}
                                                className="p-1.5 rounded-lg hover:bg-background-secondary transition-colors"
                                                title="保存修改"
                                            >
                                                <Save className="w-4 h-4 text-green-500" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingSourceId(null);
                                                    setEditingDraft(null);
                                                }}
                                                disabled={isUpdating}
                                                className="p-1.5 rounded-lg hover:bg-background-secondary transition-colors"
                                                title="取消编辑"
                                            >
                                                <ChevronUp className="w-4 h-4 text-foreground-secondary" />
                                            </button>
                                        </>
                                    )}
                                    {!source.isActive && (
                                        <button
                                            type="button"
                                            onClick={() => activateSource(model.id, source.id)}
                                            disabled={isUpdating || !!isEditing || model.routingMode !== 'auto'}
                                            className="p-1.5 rounded-lg hover:bg-background-secondary transition-colors disabled:opacity-40"
                                            title={model.routingMode === 'auto' ? '设为首选' : '固定路由模式下不可切换首选'}
                                        >
                                            <Check className="w-4 h-4 text-green-500" />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setDeleteTarget({ modelId: model.id, sourceId: source.id })}
                                        disabled={isUpdating || !!isEditing}
                                        className="p-1.5 rounded-lg hover:bg-background-secondary transition-colors"
                                        title="删除来源"
                                    >
                                        <Trash2 className="w-4 h-4 text-red-500" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {isAddingHere && (
                    <div className="rounded-lg border border-border bg-background p-4">
                        <h4 className="font-medium text-sm mb-3">添加来源</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-foreground-secondary mb-1">绑定网关</label>
                                <select
                                    value={newSource.sourceKey}
                                    onChange={(e) => setNewSource({
                                        ...newSource,
                                        sourceKey: e.target.value as ManagedGatewayKey,
                                    })}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                >
                                    {availableGatewayOptions.map((gatewayKey) => (
                                        <option key={gatewayKey} value={gatewayKey}>
                                            {gatewayKey === 'newapi' ? 'NewAPI' : 'Octopus'}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-foreground-secondary mb-1">上游模型 ID（可选）</label>
                                <input
                                    type="text"
                                    value={newSource.modelIdOverride}
                                    onChange={(e) => setNewSource({ ...newSource, modelIdOverride: e.target.value })}
                                    placeholder={`留空则跟随模型 ID（${model.modelKey}）`}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-foreground-secondary mb-1">推理模型 ID</label>
                                <input
                                    type="text"
                                    value={newSource.reasoningModelId}
                                    onChange={(e) => setNewSource({ ...newSource, reasoningModelId: e.target.value })}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-foreground-secondary mb-1">优先级</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={newSource.priority}
                                    onChange={(e) => setNewSource({ ...newSource, priority: parseInt(e.target.value || '0', 10) })}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                />
                            </div>
                            <div className="col-span-2">
                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={newSource.isEnabled}
                                        onChange={(e) => setNewSource({ ...newSource, isEnabled: e.target.checked })}
                                    />
                                    启用绑定
                                </label>
                            </div>
                            <div className="col-span-2">
                                <label className="block text-xs text-foreground-secondary mb-1">备注</label>
                                <input
                                    type="text"
                                    value={newSource.notes}
                                    onChange={(e) => setNewSource({ ...newSource, notes: e.target.value })}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-4">
                            <button
                                type="button"
                                onClick={() => {
                                    setAddingToModel(null);
                                    resetNewSource();
                                }}
                                className="px-3 py-1.5 rounded-lg text-sm border border-border hover:bg-background-secondary"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => addSource(model.id, model.modelKey)}
                                disabled={isUpdating}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
                            >
                                {isUpdating ? <SoundWaveLoader variant="inline" /> : <Save className="w-3.5 h-3.5" />}
                                保存
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>

    );
}
