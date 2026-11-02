/**
 * 视觉模型选择器
 *
 * 仅显示视觉模型（平台的，以及打开了「识图」的自定义模型），用于手相/面相分析；支持推理模式切换。
 * 移动端为整行表单字段，桌面端为设计稿 Face「视觉模型」行右侧的小胶囊。
 */
'use client'; // 需要下拉浮层开合状态、模型列表查询与本机的自定义模型 Key

import { useMemo, useState, useEffect } from 'react';
import { ChevronDown, Eye, Lightbulb } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { ModelIcon } from '@/components/ui/ModelIcon';
import { ByokKeyDialog } from '@/components/byok/ByokKeyDialog';
import { useAvailableModels } from '@/lib/hooks/useAvailableModels';
import { ownModelChoice, useOwnModels, type OwnModel } from '@/lib/byok/client';
import { byokComposerEffort } from '@/lib/byok/config';
import { DEFAULT_VISION_MODEL_ID } from '@/lib/ai/ai-config';
import { getVendorName } from '@/lib/ai/vendor-labels';
import { formatTokenPrices } from '@/lib/billing/format';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { Button } from '@/components/ui/Button';
import type { AIReasoningEffort } from '@/types';

interface VisionModelSelectorProps {
    selectedModel?: string;
    onModelChange?: (modelId: string) => void;
    reasoningEnabled?: boolean;
    onReasoningChange?: (enabled: boolean) => void;
    /** An own model starts at its default effort. */
    onReasoningEffortChange?: (effort: AIReasoningEffort | null) => void;
    /** The signed-in member, whose own vision models are listed too. */
    userId?: string | null;
    disabled?: boolean;
}

export function VisionModelSelector({
    selectedModel = DEFAULT_VISION_MODEL_ID,
    onModelChange,
    reasoningEnabled = false,
    onReasoningChange,
    onReasoningEffortChange,
    userId,
    disabled = false,
}: VisionModelSelectorProps) {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [keyModel, setKeyModel] = useState<OwnModel | null>(null);
    const modelsQuery = useAvailableModels(null, {
        enabled: !!onModelChange,
        vision: true,
    });
    const own = useOwnModels(onModelChange ? userId : null);
    const models = useMemo(() => [
        ...(modelsQuery.data ?? []),
        ...own.models.filter(model => model.usage === 'chat' && model.supportsVision).map(ownModelChoice),
    ], [modelsQuery.data, own.models]);
    const loading = modelsQuery.isLoading;
    const error = modelsQuery.error instanceof Error ? modelsQuery.error.message : null;

    // 确保选中的模型存在；自己的模型可能还在加载。
    useEffect(() => {
        if (!models.length || !onModelChange || own.loading || own.failed) return;
        if (models.some(model => model.id === selectedModel)) return;
        onModelChange(models[0].id);
    }, [models, onModelChange, own.failed, own.loading, selectedModel]);

    /** Own models start at their default effort; one without a key on this device asks for it first. */
    const chooseModel = (id: string) => {
        const model = models.find(item => item.id === id);
        if (!model) return;
        if ('own' in model && model.own) {
            if (!model.own.ready) { setKeyModel(model.own); return; }
            const effort = byokComposerEffort(model.own.defaultEffort);
            onReasoningChange?.(effort.reasoning);
            onReasoningEffortChange?.(effort.reasoningEffort);
        }
        onModelChange?.(id);
    };

    const currentModel = useMemo(() => {
        return models.find(m => m.id === selectedModel) || models[0];
    }, [selectedModel, models]);

    const isDisabled = disabled || loading || models.length === 0;

    // 推理模式相关逻辑
    const canToggleReasoning = currentModel?.supportsReasoning && !currentModel?.isReasoningDefault;
    const isReasoningForced = currentModel?.supportsReasoning && currentModel?.isReasoningDefault;
    const reasoningTooltip = !currentModel?.supportsReasoning
        ? '当前模型不支持推理模式'
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

    return (
        <div className="flex w-full items-center gap-2 lg:w-auto">
            {onModelChange && (
                <div className="min-w-0 flex-1 lg:flex-none">
                    <Menu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                        <MenuTrigger
                            className={`flex h-11 w-full items-center gap-1.5 rounded-xl border-[0.5px] border-border-hover bg-surface px-3 text-[0.9375rem] transition-colors lg:h-8 lg:w-auto lg:rounded-lg lg:border-0 lg:bg-background-secondary lg:px-2.5 lg:text-[0.8125rem] ${isDisabled
                                ? 'cursor-not-allowed text-foreground-secondary opacity-60'
                                : 'text-foreground hover:bg-background-secondary lg:hover:bg-background-tertiary'
                                }`}
                            disabled={isDisabled}
                            aria-label="视觉分析模型"
                        >
                            {loading ? (
                                <SoundWaveLoader variant="inline" />
                            ) : currentModel ? (
                                <ModelIcon icon={currentModel.icon} vendor={currentModel.vendor} />
                            ) : (
                                <Eye className="w-4 h-4" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-left lg:max-w-[140px] lg:flex-none">
                                {loading
                                    ? ''
                                    : models.length === 0
                                        ? '无可用模型'
                                        : currentModel?.name || '选择模型'}
                            </span>
                            <ChevronDown className={`h-4 w-4 shrink-0 text-foreground-tertiary transition-transform lg:h-3.5 lg:w-3.5 ${dropdownOpen ? 'rotate-180' : ''}`} />
                        </MenuTrigger>

                        <MenuContent side="bottom" align="start" className="w-72 overflow-hidden p-0" aria-label="视觉分析模型">
                            <div className="border-b border-border bg-background-secondary/50 px-3 py-2 text-xs font-medium text-foreground-secondary">
                                视觉分析模型
                            </div>
                            <MenuRadioGroup value={selectedModel} onValueChange={value => chooseModel(String(value))}>
                                {models.map((model) => {
                                    const ownModel = 'own' in model ? model.own : undefined;
                                    const prices = ownModel ? null : formatTokenPrices('pricing' in model ? model.pricing : undefined);
                                    return (
                                        <MenuRadioItem
                                            key={model.id}
                                            value={model.id}
                                            closeOnClick
                                            className="flex items-center gap-2 rounded-none py-2.5 pl-3 pr-8 text-sm data-checked:bg-accent/10 data-checked:text-accent"
                                        >
                                            <ModelIcon icon={model.icon} vendor={model.vendor} />
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate font-medium">{model.name}</div>
                                                <div className="text-xs text-foreground-secondary">
                                                    {ownModel ? `${ownModel.connection.name} · ${ownModel.ready ? '自定义，不计费' : '需填 Key'}` : getVendorName(model.vendor)}
                                                </div>
                                            </div>
                                            {prices && (
                                                <span className="shrink-0 text-xs tabular-nums text-foreground-tertiary" title="每百万 token 输入 / 输出价格（美元）">{prices}</span>
                                            )}
                                        </MenuRadioItem>
                                    );
                                })}
                            </MenuRadioGroup>
                        </MenuContent>
                    </Menu>

                    {error && !loading && (
                        <div className="mt-1 text-xs text-danger">{error}</div>
                    )}
                    {userId && <ByokKeyDialog model={keyModel} userId={userId} onClose={() => setKeyModel(null)} onSaved={model => {
                        setKeyModel(null);
                        const effort = byokComposerEffort(model.defaultEffort);
                        onReasoningChange?.(effort.reasoning);
                        onReasoningEffortChange?.(effort.reasoningEffort);
                        onModelChange?.(model.ref);
                    }} />}
                </div>
            )}

            {/* 推理按钮 */}
            {onReasoningChange && (
                <Button unstyled
                    onClick={handleReasoningToggle}
                    disabled={disabled || !canToggleReasoning}
                    className={`flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm transition-colors lg:h-8 lg:rounded-lg lg:text-[0.8125rem] ${disabled || !currentModel?.supportsReasoning
                        ? 'opacity-30 cursor-not-allowed text-foreground-secondary'
                        : isReasoningForced
                            ? 'text-warning cursor-default'
                            : reasoningEnabled
                                ? 'text-warning'
                                : 'hover:bg-background-tertiary text-foreground-secondary hover:text-foreground'
                        }`}
                    title={reasoningTooltip}
                >
                    <Lightbulb className={`h-4 w-4 ${(reasoningEnabled || isReasoningForced) ? 'fill-warning' : ''}`} />
                    <span>推理</span>
                </Button>
            )}
        </div>
    );
}
