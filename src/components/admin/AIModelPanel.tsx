/**
 * AI 模型管理面板
 *
 * 功能：
 * - 查看所有模型及其配置
 * - 启用/禁用模型
 * - 修改模型参数
 * - 切换活跃来源
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    RefreshCw,
    ChevronDown,
    ChevronUp,
    Zap,
    Eye,
    Plus,
} from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { getVendorIcon } from '@/lib/ai/vendor-config';
import { getVendorName } from '@/lib/ai/vendor-labels';
import { AIModelCreateForm } from '@/components/admin/AIModelCreateForm';
import { AIModelSettingsForm } from '@/components/admin/AIModelSettingsForm';
import { AIModelSources } from '@/components/admin/AIModelSources';
import {
    TIER_LABELS, USAGE_TYPE_LABELS, ROUTING_MODE_LABELS, createInitialNewModel,
    createEditModelDraft, reconcileModelDrafts, createInitialSourceDraft, normalizeSourceModelIdInput,
    resolveDraftVendor, buildCreateModelPayload, buildEditModelPayload, buildSourcePayload,
    createRoutingModeUpdate, createPrimaryGatewayUpdate,
    type AIModel, type ModelSource, type CreateModelDraft, type EditModelDraft,
    type ManagedGatewayKey, type SourceDraft,
} from '@/lib/admin/ai-model-editor';


export function AIModelPanel() {
    const [models, setModels] = useState<AIModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedModel, setExpandedModel] = useState<string | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showCreateAdvanced, setShowCreateAdvanced] = useState(false);
    const loadedDrafts = useRef<Record<string, EditModelDraft>>({});
    const mounted = useRef(false);
    const loadRequest = useRef<AbortController | null>(null);
    const [modelDrafts, setModelDrafts] = useState<Record<string, EditModelDraft>>({});
    const [addingToModel, setAddingToModel] = useState<string | null>(null);
    const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
    const [editingDraft, setEditingDraft] = useState<SourceDraft | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{ modelId: string; sourceId: string } | null>(null);
    const [deleteModelTarget, setDeleteModelTarget] = useState<{ modelId: string; displayName: string } | null>(null);
    const { showToast } = useToast();
    const [newModel, setNewModel] = useState<CreateModelDraft>(createInitialNewModel);
    const [newSource, setNewSource] = useState(() => ({
        sourceKey: 'newapi' as ManagedGatewayKey,
        ...createInitialSourceDraft(),
    }));

    const resetNewModel = () => {
        setNewModel(createInitialNewModel());
    };

    const resetNewSource = () => {
        setNewSource({
            sourceKey: 'newapi',
            ...createInitialSourceDraft(),
        });
    };

    // 加载模型列表
    const loadModels = useCallback(async () => {
        // A late mutation may request a reload after its account panel unmounted.
        if (!mounted.current) return;
        loadRequest.current?.abort();
        const controller = new AbortController();
        loadRequest.current = controller;
        const isCurrent = () => mounted.current
            && loadRequest.current === controller
            && !controller.signal.aborted;
        setLoading(true);
        setError(null);

        try {
            const data = await requestBrowserData<{ models?: AIModel[] }>(
                '/api/admin/ai-models?includeDisabled=true',
                { method: 'GET', signal: controller.signal },
                { fallbackMessage: '获取模型列表失败' },
            );
            if (!isCurrent()) return;
            const loadedModels = data.models || [];
            setModels(loadedModels);
            const incoming = Object.fromEntries(loadedModels.map(model => [model.id, createEditModelDraft(model)]));
            const previous = loadedDrafts.current;
            loadedDrafts.current = incoming;
            setModelDrafts(current => reconcileModelDrafts(current, previous, incoming));
        } catch (e) {
            if (isCurrent()) setError(e instanceof Error ? e.message : '获取模型列表失败');
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        void loadModels();
        return () => {
            mounted.current = false;
            loadRequest.current?.abort();
        };
    }, [loadModels]);


    const updateNewModel = (updates: Partial<CreateModelDraft>) => {
        setNewModel((current) => ({ ...current, ...updates }));
    };

    const updateModelDraft = (modelId: string, updates: Partial<EditModelDraft>) => {
        setModelDrafts((current) => ({
            ...current,
            [modelId]: {
                ...current[modelId],
                ...updates,
            },
        }));
    };

    const handleCreateRoutingModeChange = (routingMode: AIModel['routingMode']) => {
        updateNewModel(createRoutingModeUpdate(newModel, routingMode));
    };

    const handleCreatePrimaryGatewayChange = (primaryGatewayKey: ManagedGatewayKey) => {
        updateNewModel(createPrimaryGatewayUpdate(newModel, primaryGatewayKey));
    };

    // 更新模型
    const updateModel = async (modelId: string, updates: Partial<AIModel>) => {
        setUpdating(modelId);

        try {
            await requestBrowserData(
                `/api/admin/ai-models/${modelId}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(updates),
                },
                { fallbackMessage: '更新失败' },
            );

            // 刷新列表
            await loadModels();
        } catch (e) {
            console.error('Update model failed:', e);
            showToast('error', e instanceof Error ? e.message : '更新失败');
        } finally {
            setUpdating(null);
        }
    };

    const createModel = async () => {
        const vendor = resolveDraftVendor(newModel);

        if (!newModel.modelKey.trim() || !newModel.displayName.trim()) {
            showToast('warning', '请填写模型 ID 和显示名称');
            return;
        }
        if (!vendor) {
            showToast('warning', '请选择供应商，或填写自定义供应商');
            return;
        }

        setUpdating('creating');
        try {

            await requestBrowserData(
                '/api/admin/ai-models',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(buildCreateModelPayload(newModel)),
                },
                { fallbackMessage: '创建模型失败' },
            );

            showToast('success', '模型已创建');
            setShowCreateForm(false);
            setShowCreateAdvanced(false);
            resetNewModel();
            await loadModels();
        } catch (e) {
            showToast('error', e instanceof Error ? e.message : '创建模型失败');
        } finally {
            setUpdating(null);
        }
    };

    const saveModelSettings = async (modelId: string) => {
        const draft = modelDrafts[modelId];
        if (!draft) return;

        const vendor = draft.vendorPreset === '__custom__'
            ? draft.customVendor.trim()
            : draft.vendorPreset;

        if (!draft.modelKey.trim() || !draft.displayName.trim()) {
            showToast('warning', '请填写模型 ID 和显示名称');
            return;
        }
        if (!vendor) {
            showToast('warning', '请选择供应商，或填写自定义供应商');
            return;
        }

        try {
            await updateModel(modelId, buildEditModelPayload(draft));
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : '自定义参数格式错误');
        }
    };

    // 切换活跃来源
    const activateSource = async (modelId: string, sourceId: string) => {
        setUpdating(modelId);

        try {
            await requestBrowserData(
                `/api/admin/ai-models/${modelId}/sources/${sourceId}`,
                {
                    method: 'POST',
                },
                { fallbackMessage: '切换来源失败' },
            );

            // 刷新列表
            await loadModels();
        } catch (e) {
            console.error('Activate source failed:', e);
            showToast('error', e instanceof Error ? e.message : '切换来源失败');
        } finally {
            setUpdating(null);
        }
    };

    const beginEditSource = (source: ModelSource, modelKey: string) => {
        setEditingSourceId(source.id);
        setEditingDraft({
            modelIdOverride: normalizeSourceModelIdInput(source.modelIdOverride || '', modelKey) || '',
            reasoningModelId: source.reasoningModelId || '',
            priority: source.priority,
            isEnabled: source.isEnabled,
            notes: source.notes || '',
        });
    };

    const saveSource = async (modelId: string, sourceId: string, modelKey: string) => {
        if (!editingDraft) return;

        setUpdating(modelId);
        try {
            await requestBrowserData(
                `/api/admin/ai-models/${modelId}/sources/${sourceId}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(buildSourcePayload(editingDraft, modelKey)),
                },
                { fallbackMessage: '保存来源失败' },
            );

            setEditingSourceId(null);
            setEditingDraft(null);
            await loadModels();
            showToast('success', '来源已更新');
        } catch (e) {
            showToast('error', e instanceof Error ? e.message : '保存来源失败');
        } finally {
            setUpdating(null);
        }
    };

    const addSource = async (modelId: string, modelKey: string) => {
        setUpdating(modelId);
        try {
            await requestBrowserData(
                `/api/admin/ai-models/${modelId}/sources`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        sourceKey: newSource.sourceKey,
                        ...buildSourcePayload(newSource, modelKey),
                    }),
                },
                { fallbackMessage: '添加来源失败' },
            );

            setAddingToModel(null);
            resetNewSource();
            await loadModels();
            showToast('success', '来源已添加');
        } catch (e) {
            showToast('error', e instanceof Error ? e.message : '添加来源失败');
        } finally {
            setUpdating(null);
        }
    };

    const deleteSource = async (modelId: string, sourceId: string) => {
        setUpdating(modelId);
        try {
            await requestBrowserData(
                `/api/admin/ai-models/${modelId}/sources/${sourceId}`,
                {
                    method: 'DELETE',
                },
                { fallbackMessage: '删除来源失败' },
            );

            await loadModels();
            setDeleteTarget(null);
            showToast('success', '来源已删除');
        } catch (e) {
            showToast('error', e instanceof Error ? e.message : '删除来源失败');
        } finally {
            setUpdating(null);
        }
    };

    const deleteModel = async (modelId: string) => {
        setUpdating(modelId);
        try {
            await requestBrowserData(
                `/api/admin/ai-models/${modelId}`,
                {
                    method: 'DELETE',
                },
                { fallbackMessage: '删除模型失败' },
            );

            if (expandedModel === modelId) {
                setExpandedModel(null);
            }
            setDeleteModelTarget(null);
            await loadModels();
            showToast('success', '模型已删除');
        } catch (e) {
            showToast('error', e instanceof Error ? e.message : '删除模型失败');
        } finally {
            setUpdating(null);
        }
    };

    // 清除缓存
    const clearCache = async () => {
        try {
            await requestBrowserData(
                '/api/admin/ai-models/cache',
                {
                    method: 'POST',
                },
                { fallbackMessage: '清除缓存失败' },
            );
            showToast('success', '缓存已清除');
        } catch (e) {
            console.error('Clear cache failed:', e);
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
                    onClick={loadModels}
                    className="px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent/90"
                >
                    重试
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* 工具栏 */}
            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-foreground-secondary">
                    共 {models.length} 个模型
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowCreateForm((value) => !value)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-accent text-white hover:bg-accent/90 transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        新增模型
                    </button>
                    <button
                        onClick={clearCache}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-background-secondary hover:bg-background-secondary/80 transition-colors"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        清除缓存
                    </button>
                </div>
            </div>

            {showCreateForm && (
                <AIModelCreateForm
                    newModel={newModel}
                    setNewModel={setNewModel}
                    updateNewModel={updateNewModel}
                    showCreateAdvanced={showCreateAdvanced}
                    setShowCreateAdvanced={setShowCreateAdvanced}
                    setShowCreateForm={setShowCreateForm}
                    resetNewModel={resetNewModel}
                    handleCreateRoutingModeChange={handleCreateRoutingModeChange}
                    handleCreatePrimaryGatewayChange={handleCreatePrimaryGatewayChange}
                    createModel={createModel}
                    updating={updating}
                />
            )}

            {/* 模型列表 */}
            <div className="space-y-3">
                {models.map(model => {
                    const isExpanded = expandedModel === model.id;
                    const isUpdating = updating === model.id;
                    const activeSource = model.sources.find(s => s.isActive);
                    const tierInfo = TIER_LABELS[model.requiredTier];
                    const modelDraft = modelDrafts[model.id] || createEditModelDraft(model);
                    const isAddingHere = addingToModel === model.id;
                    const availableGatewayOptions = (['newapi', 'octopus'] as ManagedGatewayKey[]).filter(
                        (gatewayKey) => !model.sources.some((source) => source.sourceKey === gatewayKey)
                    );

                    return (
                        <div
                            key={model.id}
                            className="border border-border rounded-xl overflow-hidden"
                        >
                            {/* 模型头部 */}
                            <div
                                className="flex items-center justify-between p-4 cursor-pointer hover:bg-background-secondary/50 transition-colors"
                                onClick={() => setExpandedModel(isExpanded ? null : model.id)}
                            >
                                <div className="flex items-center gap-3">
                                    {/* 启用状态 */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            updateModel(model.id, { isEnabled: !model.isEnabled });
                                        }}
                                        disabled={isUpdating}
                                        className={`w-10 h-6 rounded-full relative transition-colors ${model.isEnabled ? 'bg-green-500' : 'bg-background-tertiary'
                                            }`}
                                    >
                                        <span
                                            className={`absolute top-1 w-4 h-4 rounded-full bg-background transition-transform ${model.isEnabled ? 'left-5' : 'left-1'
                                                }`}
                                        />
                                    </button>

                                    {/* 模型信息 */}
                                    <div>
                                        <div className="flex items-center gap-2">
                                            {getVendorIcon(model.vendor, 16)}
                                            <span className="font-medium">{model.displayName}</span>
                                            <span className="text-xs text-foreground-secondary">
                                                {getVendorName(model.vendor)}
                                            </span>
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-background-secondary text-foreground-secondary">
                                                {USAGE_TYPE_LABELS[model.usageType] || model.usageType}
                                            </span>
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${tierInfo.color}`}>
                                                {tierInfo.label}
                                            </span>
                                            {model.supportsReasoning && (
                                                <span title="支持推理">
                                                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                                                </span>
                                            )}
                                            {model.supportsVision && (
                                                <span title="支持视觉">
                                                    <Eye className="w-3.5 h-3.5 text-blue-500" />
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-foreground-secondary mt-0.5">
                                            {activeSource?.sourceName || '无活跃来源'}
                                            {activeSource && !activeSource.hasApiKey && (
                                                <span className="text-red-500 ml-2">API Key 未配置</span>
                                            )}
                                            <span className="ml-2">· {ROUTING_MODE_LABELS[model.routingMode]}</span>
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    {isUpdating && <SoundWaveLoader variant="inline" />}
                                    {isExpanded ? (
                                        <ChevronUp className="w-5 h-5 text-foreground-secondary" />
                                    ) : (
                                        <ChevronDown className="w-5 h-5 text-foreground-secondary" />
                                    )}
                                </div>
                            </div>

                            {/* 展开内容 */}
                            {isExpanded && (
                                <div className="border-t border-border p-4 bg-background-secondary/30">
                                    <AIModelSettingsForm
                                        model={model}
                                        modelDraft={modelDraft}
                                        isUpdating={isUpdating}
                                        updateModelDraft={updateModelDraft}
                                        saveModelSettings={saveModelSettings}
                                        setDeleteModelTarget={setDeleteModelTarget}
                                    />

                                    <AIModelSources
                                        model={model}
                                        isUpdating={isUpdating}
                                        availableGatewayOptions={availableGatewayOptions}
                                        isAddingHere={isAddingHere}
                                        setAddingToModel={setAddingToModel}
                                        newSource={newSource}
                                        setNewSource={setNewSource}
                                        editingSourceId={editingSourceId}
                                        setEditingSourceId={setEditingSourceId}
                                        editingDraft={editingDraft}
                                        setEditingDraft={setEditingDraft}
                                        beginEditSource={beginEditSource}
                                        saveSource={saveSource}
                                        activateSource={activateSource}
                                        setDeleteTarget={setDeleteTarget}
                                        resetNewSource={resetNewSource}
                                        addSource={addSource}
                                    />

                                    {/* 描述 */}
                                    {model.description && (
                                        <p className="mt-4 text-xs text-foreground-secondary">
                                            {model.description}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <ConfirmDialog
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={() => deleteTarget ? deleteSource(deleteTarget.modelId, deleteTarget.sourceId) : undefined}
                title="确认删除"
                description="确定要删除这个来源绑定吗？删除后该模型将不再使用对应网关。"
                confirmText="确认删除"
                variant="danger"
                loading={!!deleteTarget && updating === deleteTarget.modelId}
            />

            <ConfirmDialog
                isOpen={!!deleteModelTarget}
                onClose={() => setDeleteModelTarget(null)}
                onConfirm={() => deleteModelTarget ? deleteModel(deleteModelTarget.modelId) : undefined}
                title="确认删除模型"
                description={`确定要删除 ${deleteModelTarget?.displayName || '该模型'} 吗？对应来源绑定也会一起删除。`}
                confirmText="确认删除"
                variant="danger"
                loading={!!deleteModelTarget && updating === deleteModelTarget.modelId}
            />
        </div>
    );
}
