/**
 * 视觉模型选择器
 * 
 * 仅显示 Qwen VL 和 Gemini VL 模型，用于手相/面相分析
 * 支持推理模式切换
 */
'use client';

import { useMemo, useState, useEffect } from 'react';
import { ChevronDown, Eye, Lightbulb } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { getVendorIcon } from '@/lib/ai/vendor-config';
import { useAvailableModels } from '@/lib/hooks/useAvailableModels';
import type { AIVendor } from '@/types';
import { DEFAULT_VISION_MODEL_ID } from '@/lib/ai/ai-config';
import { getVendorName } from '@/lib/ai/vendor-labels';

interface VisionModelConfig {
    id: string;
    name: string;
    vendor: AIVendor;
    supportsReasoning: boolean;
    isReasoningDefault?: boolean;
    allowed?: boolean;
    blockedReason?: string | null;
    reasoningAllowed?: boolean;
}

interface VisionModelSelectorProps {
    selectedModel?: string;
    onModelChange?: (modelId: string) => void;
    reasoningEnabled?: boolean;
    onReasoningChange?: (enabled: boolean) => void;
    disabled?: boolean;
    compact?: boolean;
}

export function VisionModelSelector({
    selectedModel = DEFAULT_VISION_MODEL_ID,
    onModelChange,
    reasoningEnabled = false,
    onReasoningChange,
    disabled = false,
    compact = false,
}: VisionModelSelectorProps) {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const modelsQuery = useAvailableModels(null, {
        enabled: !!onModelChange,
        vision: true,
    });
    const models = useMemo(() => (modelsQuery.data ?? []) as VisionModelConfig[], [modelsQuery.data]);
    const loading = modelsQuery.isLoading;
    const error = modelsQuery.error instanceof Error ? modelsQuery.error.message : null;

    // 确保选中的模型存在
    useEffect(() => {
        if (!models.length || !onModelChange) return;
        const selected = models.find(model => model.id === selectedModel);
        if (selected && selected.allowed !== false) return;
        const nextModel = models.find(model => model.allowed !== false) || models[0];
        if (nextModel && nextModel.id !== selectedModel) {
            onModelChange(nextModel.id);
        }
    }, [models, onModelChange, selectedModel]);

    const currentModel = useMemo(() => {
        return models.find(m => m.id === selectedModel) || models[0];
    }, [selectedModel, models]);

    const isDisabled = disabled || loading || models.length === 0;

    // 推理模式相关逻辑
    const reasoningAllowed = currentModel?.reasoningAllowed ?? currentModel?.supportsReasoning;
    const canToggleReasoning = reasoningAllowed && currentModel?.supportsReasoning && !currentModel?.isReasoningDefault;
    const isReasoningForced = reasoningAllowed && currentModel?.isReasoningDefault;
    const reasoningTooltip = !currentModel?.supportsReasoning
        ? '当前模型不支持推理模式'
        : !reasoningAllowed
            ? (currentModel?.blockedReason || '当前无法使用推理模式')
            : isReasoningForced
                ? '此模型默认开启推理'
                : reasoningEnabled
                    ? '关闭推理模式'
                    : '开启推理模式';

    const handleReasoningToggle = () => {
        if (canToggleReasoning && onReasoningChange) {
            onReasoningChange(!reasoningEnabled);
        }
    };

    if (!onModelChange && !onReasoningChange) return null;

    const buttonPadding = compact ? 'px-2 py-1' : 'px-2.5 py-1.5';
    const textSize = compact ? 'text-xs' : 'text-sm';

    return (
        <div className="flex items-center gap-2">
            {onModelChange && (
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className={`flex items-center gap-1.5 ${buttonPadding} rounded-lg transition-all ${textSize} ${isDisabled
                            ? 'opacity-50 cursor-not-allowed text-foreground-secondary'
                            : 'hover:bg-background-secondary border border-border text-foreground-secondary hover:text-foreground'
                            }`}
                        disabled={isDisabled}
                    >
                        {loading ? (
                            <SoundWaveLoader variant="inline" />
                        ) : currentModel ? (
                            getVendorIcon(currentModel.vendor)
                        ) : (
                            <Eye className="w-4 h-4" />
                        )}
                        <span className={`${compact ? 'max-w-[80px]' : 'max-w-[100px]'} truncate`}>
                            {loading
                                ? ''
                                : models.length === 0
                                    ? '无可用模型'
                                    : currentModel?.name || '选择模型'}
                        </span>
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {dropdownOpen && !isDisabled && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setDropdownOpen(false)}
                            />
                            <div className="absolute top-full left-0 mt-2 w-52 bg-background border border-border rounded-lg shadow-lg z-20 overflow-hidden">
                                <div className="text-xs font-medium text-foreground-secondary px-3 py-2 bg-background-secondary/50 border-b border-border">
                                    视觉分析模型
                                </div>
                                {models.map((model) => {
                                    const isAllowed = model.allowed !== false;
                                    return (
                                        <button
                                            key={model.id}
                                            type="button"
                                            onClick={() => {
                                                if (isAllowed && onModelChange) {
                                                    onModelChange(model.id);
                                                }
                                                setDropdownOpen(false);
                                            }}
                                            className={`w-full px-3 py-2.5 text-left text-sm transition-colors flex items-center gap-2 ${isAllowed ? 'hover:bg-background-secondary' : 'opacity-50 cursor-not-allowed'
                                                } ${selectedModel === model.id ? 'bg-accent/10 text-accent' : ''}`}
                                            disabled={!isAllowed}
                                        >
                                            {getVendorIcon(model.vendor)}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium truncate">{model.name}</div>
                                                <div className="text-xs text-foreground-secondary">
                                                    {getVendorName(model.vendor)}
                                                </div>
                                            </div>
                                            {!isAllowed && model.blockedReason && (
                                                <span className="text-xs text-amber-600">{model.blockedReason}</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {error && !loading && (
                        <div className="mt-1 text-xs text-rose-500">{error}</div>
                    )}
                </div>
            )}

            {/* 推理按钮 */}
            {onReasoningChange && (
                <button
                    type="button"
                    onClick={handleReasoningToggle}
                    disabled={disabled || !canToggleReasoning}
                    className={`flex items-center gap-1.5 ${buttonPadding} rounded-lg transition-all ${textSize} ${disabled || !currentModel?.supportsReasoning || !reasoningAllowed
                        ? 'opacity-30 cursor-not-allowed text-foreground-secondary'
                        : isReasoningForced
                            ? 'text-yellow-600 cursor-default'
                            : reasoningEnabled
                                ? 'text-yellow-600'
                                : 'hover:bg-background-tertiary text-foreground-secondary hover:text-foreground'
                        }`}
                    title={reasoningTooltip}
                >
                    <Lightbulb className={`${compact ? 'w-4 h-4' : 'w-4.5 h-4.5'} ${(reasoningEnabled || isReasoningForced) ? 'fill-yellow-500' : ''}`} />
                    <span className={compact ? 'hidden sm:inline' : 'hidden md:inline'}>
                        推理
                    </span>
                </button>
            )}
        </div>
    );
}
