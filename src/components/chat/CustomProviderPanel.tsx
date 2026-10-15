'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Eye, EyeOff, KeyRound, LockKeyhole, Monitor, PencilLine } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import type { CustomProviderConfig } from '@/types';
import {
    buildByokProviderOptions,
    getByokProviderLabel,
    isOtherByokProviderKey,
    normalizeByokProviderKey,
    type ByokProviderOption,
} from '@/lib/ai/byok-catalog';
import { getVendorIcon } from '@/lib/ai/vendor-config';
import {
    clearCustomProvider,
    CUSTOM_PROVIDER_CHANGED_EVENT,
    getCustomProvider,
    getLastCustomProvider,
    setCustomProvider,
} from '@/lib/chat/custom-provider';
import { useByokModelCatalog } from '@/lib/hooks/useByokModelCatalog';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { maskCustomProviderApiKey, validateCustomProviderInput } from '@/lib/ai/custom-provider-url';

type CustomProviderDraft = {
    providerKey: string;
    apiUrl: string;
    apiKey: string;
    modelId: string;
    modelName: string;
};

type CustomProviderFormErrors = {
    providerKey?: string;
    apiUrl?: string;
    apiKey?: string;
    modelId?: string;
};

interface CustomProviderPanelProps {
    /** 嵌入设置页：标题由设置中心渲染，面板改为宽版布局；否则为对话页弹窗。 */
    embedded?: boolean;
    onClose?: () => void;
    onChange?: (config: CustomProviderConfig | null) => void;
}

const EMPTY_DRAFT: CustomProviderDraft = {
    providerKey: '',
    apiUrl: '',
    apiKey: '',
    modelId: '',
    modelName: '',
};

function draftFromConfig(config: CustomProviderConfig | null): CustomProviderDraft {
    if (!config) return EMPTY_DRAFT;
    return {
        providerKey: normalizeByokProviderKey(config.providerKey) || 'other',
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        modelId: config.modelId,
        modelName: config.modelName ?? '',
    };
}

function formatProviderUrl(apiUrl?: string | null) {
    if (!apiUrl) return '未设置';
    try {
        return new URL(apiUrl).toString();
    } catch {
        return apiUrl;
    }
}

function InputError({ id, message }: { id?: string; message?: string }) {
    if (!message) return null;
    return <p id={id} role="alert" className="text-xs text-danger">{message}</p>;
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
    return <label htmlFor={htmlFor} className="text-[13px] text-foreground-secondary">{children}</label>;
}

// 设置页（宽版）与对话页弹窗（紧凑版）共用同一结构，只切换控件尺寸。
function fieldControlClass(compact: boolean) {
    return `w-full rounded-[10px] border border-border-hover bg-surface text-foreground outline-none transition-colors duration-150 placeholder:text-foreground-tertiary focus:border-accent ${
        compact ? 'h-10 px-3 text-sm' : 'h-11 px-3.5 text-[15px]'
    }`;
}

function StorageNotice({ compact }: { compact: boolean }) {
    if (compact) {
        return (
            <p className="flex items-start gap-2 rounded-[10px] bg-background-secondary px-3 py-2.5 text-xs leading-relaxed text-foreground-secondary">
                <LockKeyhole aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>Key 只存在当前标签页，普通对话由浏览器直连供应商；Agent 任务会加密临时保存，结束即删除。</span>
            </p>
        );
    }
    return (
        <div className="flex flex-col gap-2.5 rounded-xl bg-background-secondary px-[18px] py-4 text-[13px] leading-relaxed text-foreground">
            <p className="flex items-start gap-2.5">
                <Monitor aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-foreground-secondary" />
                <span><b className="font-medium">普通对话与解读</b>：Key 只存在当前标签页，由浏览器直连模型供应商，不经过本站服务器；关闭页面即失效。</span>
            </p>
            <p className="flex items-start gap-2.5">
                <LockKeyhole aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-foreground-secondary" />
                <span><b className="font-medium">Agent 任务</b>：Key 会加密后临时保存，任务结束即删除。</span>
            </p>
        </div>
    );
}

function resolveDraftConfig(
    draft: CustomProviderDraft,
    providers: ByokProviderOption[],
): CustomProviderConfig | null {
    const apiKey = draft.apiKey.trim();

    if (isOtherByokProviderKey(draft.providerKey)) {
        return {
            providerKey: 'other',
            providerLabel: '其他',
            apiUrl: draft.apiUrl.trim(),
            apiKey,
            modelId: draft.modelId.trim(),
            modelName: draft.modelName.trim() || undefined,
        };
    }

    const provider = providers.find((item) => item.key === draft.providerKey);
    if (!provider) {
        return null;
    }

    const selectedModel = provider.models.find((item) => item.id === draft.modelId.trim());
    return {
        providerKey: provider.key,
        providerLabel: provider.label,
        apiUrl: provider.defaultApiUrl ?? '',
        apiKey,
        modelId: draft.modelId.trim(),
        modelName: selectedModel?.name || draft.modelName.trim() || undefined,
    };
}

function buildFormErrors(
    draft: CustomProviderDraft,
    providers: ByokProviderOption[],
): CustomProviderFormErrors {
    const errors: CustomProviderFormErrors = {};

    if (isOtherByokProviderKey(draft.providerKey)) {
        return validateCustomProviderInput({
            apiUrl: draft.apiUrl,
            apiKey: draft.apiKey,
            modelId: draft.modelId,
        });
    }

    if (!draft.providerKey) {
        errors.providerKey = '请选择模型供应商';
        return errors;
    }

    const provider = providers.find((item) => item.key === draft.providerKey);
    if (!provider) {
        errors.providerKey = '请选择模型供应商';
        return errors;
    }

    const validation = validateCustomProviderInput({
        apiUrl: provider.defaultApiUrl ?? '',
        apiKey: draft.apiKey,
        modelId: draft.modelId,
    });

    if (!draft.modelId.trim()) {
        errors.modelId = '请选择模型';
    } else if (validation.modelId) {
        errors.modelId = validation.modelId;
    }

    if (!provider.defaultApiUrl || validation.apiUrl) {
        errors.providerKey = '当前供应商预设地址不可用';
    }

    if (validation.apiKey) {
        errors.apiKey = validation.apiKey;
    }

    return errors;
}

export function CustomProviderPanel({
    embedded = false,
    onClose,
    onChange,
}: CustomProviderPanelProps) {
    const { showToast } = useToast();
    const byokCatalog = useByokModelCatalog();
    const fallbackProviders = useMemo(() => buildByokProviderOptions([]), []);
    const providers = byokCatalog.providers;
    const safeProviders = providers.length > 0 ? providers : fallbackProviders;

    const [activeConfig, setActiveConfig] = useState<CustomProviderConfig | null>(() => getCustomProvider());
    const [draft, setDraft] = useState<CustomProviderDraft>(() => draftFromConfig(getCustomProvider()));
    const [lastConfig, setLastConfig] = useState<CustomProviderConfig | null>(() => getLastCustomProvider());
    const [isEditing, setIsEditing] = useState(() => !getCustomProvider());
    const [showApiKey, setShowApiKey] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const fieldId = useId();
    useUnsavedSettingsGuard(isEditing && JSON.stringify(draft) !== JSON.stringify(draftFromConfig(activeConfig)));

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const sync = () => {
            const nextConfig = getCustomProvider();
            const nextLastConfig = getLastCustomProvider();
            setActiveConfig(nextConfig);
            setLastConfig(nextLastConfig);
            setDraft(draftFromConfig(nextConfig));
            setShowApiKey(false);
            setIsEditing((prev) => (nextConfig ? prev : true));
            setSubmitted(false);
        };
        sync();
        window.addEventListener(CUSTOM_PROVIDER_CHANGED_EVENT, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(CUSTOM_PROVIDER_CHANGED_EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, []);

    const selectedProvider = useMemo(
        () => safeProviders.find((item) => item.key === draft.providerKey) ?? null,
        [safeProviders, draft.providerKey],
    );
    const isOtherProvider = isOtherByokProviderKey(draft.providerKey);
    const activeProviderLabel = getByokProviderLabel(activeConfig?.providerKey, activeConfig?.providerLabel);
    const activeUrl = formatProviderUrl(activeConfig?.apiUrl);
    const errors = useMemo(() => buildFormErrors(draft, safeProviders), [draft, safeProviders]);
    const hasErrors = Object.keys(errors).length > 0;

    const handleFieldChange = (field: keyof CustomProviderDraft, value: string) => {
        setDraft((prev) => ({ ...prev, [field]: value }));
    };

    const handleProviderChange = (providerKey: string) => {
        setSubmitted(false);
        if (!providerKey) {
            setDraft((prev) => ({
                ...prev,
                providerKey: '',
                apiUrl: '',
                modelId: '',
                modelName: '',
            }));
            return;
        }

        if (isOtherByokProviderKey(providerKey)) {
            setDraft((prev) => ({
                ...prev,
                providerKey,
                apiUrl: prev.providerKey === providerKey ? prev.apiUrl : '',
                modelId: '',
                modelName: '',
            }));
            return;
        }

        const provider = safeProviders.find((item) => item.key === providerKey);
        const firstModel = provider?.models[0];
        setDraft((prev) => ({
            ...prev,
            providerKey,
            apiUrl: provider?.defaultApiUrl ?? '',
            modelId: firstModel?.id ?? '',
            modelName: firstModel?.name ?? '',
        }));
    };

    const handleModelChange = (modelId: string) => {
        const selectedModel = selectedProvider?.models.find((item) => item.id === modelId);
        setSubmitted(false);
        setDraft((prev) => ({
            ...prev,
            modelId,
            modelName: selectedModel?.name ?? '',
        }));
    };

    const handleManualModelIdChange = (modelId: string) => {
        const selectedModel = selectedProvider?.models.find((item) => item.id === modelId.trim());
        setSubmitted(false);
        setDraft((prev) => ({
            ...prev,
            modelId,
            modelName: selectedModel?.name ?? '',
        }));
    };

    const handleStartEdit = () => {
        setDraft(draftFromConfig(activeConfig));
        setShowApiKey(false);
        setSubmitted(false);
        setIsEditing(true);
    };

    const handleCancelEdit = () => {
        setDraft(draftFromConfig(activeConfig));
        setShowApiKey(false);
        setSubmitted(false);
        setIsEditing(false);
    };

    const handleActivate = () => {
        setSubmitted(true);
        if (hasErrors) return;

        const nextConfig = resolveDraftConfig(draft, safeProviders);
        if (!nextConfig) return;

        setCustomProvider(nextConfig);
        setActiveConfig(nextConfig);
        setLastConfig(nextConfig);
        setShowApiKey(false);
        setSubmitted(false);
        setIsEditing(false);
        onChange?.(nextConfig);
        showToast('success', activeConfig ? '已更新自定义模型配置' : '已启用自定义模型');
        if (!embedded) {
            onClose?.();
        }
    };

    const handleDeactivate = () => {
        clearCustomProvider();
        setActiveConfig(null);
        setDraft(EMPTY_DRAFT);
        setShowApiKey(false);
        setSubmitted(false);
        setIsEditing(true);
        onChange?.(null);
        showToast('success', '已停用自定义模型');
        if (!embedded) {
            onClose?.();
        }
    };

    const handleReactivateLastConfig = () => {
        if (!lastConfig) return;

        setCustomProvider(lastConfig);
        setActiveConfig(lastConfig);
        setDraft(draftFromConfig(lastConfig));
        setShowApiKey(false);
        setSubmitted(false);
        setIsEditing(false);
        onChange?.(lastConfig);
        showToast('success', '已恢复上次启用的自定义模型');
        if (!embedded) {
            onClose?.();
        }
    };

    const compact = !embedded;
    const fieldClass = fieldControlClass(compact);
    const monoFieldClass = `${fieldClass} font-mono placeholder:font-sans`;
    const secondaryButtonClass = `inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-border-hover bg-surface font-medium text-foreground transition-colors duration-150 hover:bg-background-secondary ${
        compact ? 'h-10 px-3.5 text-sm' : 'h-10 px-4 text-sm'
    }`;
    const primaryButtonClass = `inline-flex items-center justify-center rounded-[10px] bg-accent font-medium text-on-accent transition-colors duration-150 hover:bg-accent-hover ${
        compact ? 'h-10 flex-1 px-4 text-sm' : 'h-11 px-5 text-sm'
    }`;
    const sectionTitleClass = embedded ? 'text-[13px] font-medium text-foreground-tertiary' : 'sr-only';
    const apiKeyToggleLabel = showApiKey ? '隐藏 API Key' : '显示 API Key';
    const modelSuggestions = !isOtherProvider ? selectedProvider?.models ?? [] : [];
    const providerError = submitted ? errors.providerKey : undefined;
    const apiKeyError = submitted ? errors.apiKey : undefined;
    const apiUrlError = submitted ? errors.apiUrl : undefined;
    const modelIdError = submitted ? errors.modelId : undefined;

    const apiKeyToggle = (
        <button
            type="button"
            onClick={() => setShowApiKey((prev) => !prev)}
            aria-label={apiKeyToggleLabel}
            title={apiKeyToggleLabel}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-foreground-secondary transition-colors duration-150 hover:bg-background-secondary hover:text-foreground"
        >
            {showApiKey ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
        </button>
    );

    const summary = activeConfig ? (
        <section aria-labelledby={`${fieldId}-summary`} className="flex flex-col gap-3">
            <h3 id={`${fieldId}-summary`} className={sectionTitleClass}>当前启用</h3>
            <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
                <div className={`flex items-center gap-3 ${compact ? 'px-4 py-3.5' : 'px-5 py-4'}`}>
                    <span aria-hidden="true" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-background-secondary">
                        {getVendorIcon(normalizeByokProviderKey(activeConfig.providerKey) || 'other', 22)}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium text-foreground">{activeConfig.modelName || activeConfig.modelId}</p>
                        <p className="truncate text-xs text-foreground-secondary">
                            {activeProviderLabel} · <code className="font-mono">{activeConfig.modelId}</code>
                        </p>
                    </div>
                    <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
                        已启用
                    </span>
                </div>
                <dl className="border-t border-border text-[13px]">
                    <div className={`flex items-center gap-4 ${compact ? 'px-4 py-3' : 'px-5 py-3.5'}`}>
                        <dt className="flex-shrink-0 text-foreground-tertiary">接口地址</dt>
                        <dd className="min-w-0 flex-1 truncate text-right font-mono text-foreground-secondary" title={activeUrl}>{activeUrl}</dd>
                    </div>
                    <div className={`flex items-center gap-4 border-t border-border ${compact ? 'py-1.5 pl-4 pr-2' : 'py-2 pl-5 pr-3'}`}>
                        <dt className="flex-shrink-0 text-foreground-tertiary">API Key</dt>
                        <dd className="flex min-w-0 flex-1 items-center justify-end gap-1">
                            <code className="min-w-0 truncate font-mono text-foreground-secondary">
                                {showApiKey ? activeConfig.apiKey : maskCustomProviderApiKey(activeConfig.apiKey)}
                            </code>
                            {apiKeyToggle}
                        </dd>
                    </div>
                </dl>
                <div className={`flex items-center justify-between gap-2 border-t border-border bg-background ${compact ? 'px-4 py-3' : 'px-5 py-3.5'}`}>
                    <button
                        type="button"
                        onClick={handleDeactivate}
                        className="inline-flex h-10 items-center justify-center rounded-[10px] px-3 text-sm text-foreground-secondary transition-colors duration-150 hover:bg-background-secondary hover:text-danger"
                    >
                        停用
                    </button>
                    <button type="button" onClick={handleStartEdit} className={secondaryButtonClass}>
                        <PencilLine aria-hidden="true" className="h-3.5 w-3.5" />
                        编辑配置
                    </button>
                </div>
            </div>
        </section>
    ) : null;

    const form = (
        <section aria-labelledby={`${fieldId}-form`} className="flex flex-col gap-3">
            <h3 id={`${fieldId}-form`} className={sectionTitleClass}>{activeConfig ? '编辑配置' : '配置模型'}</h3>
            <div className={compact
                ? 'flex flex-col gap-4'
                : 'flex flex-col gap-5 rounded-[14px] border border-border bg-surface p-5 sm:p-6'
            }>
                <div className="flex flex-col gap-2">
                    <span id={`${fieldId}-provider`} className="text-[13px] text-foreground-secondary">模型供应商</span>
                    <div role="radiogroup" aria-labelledby={`${fieldId}-provider`} className="flex flex-wrap gap-2">
                        {safeProviders.map((provider) => {
                            const selected = draft.providerKey === provider.key;
                            return (
                                <button
                                    key={provider.key}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    onClick={() => handleProviderChange(provider.key)}
                                    className={`inline-flex h-9 items-center gap-1.5 rounded-full border pl-2 pr-3 text-[13px] transition-colors duration-150 ${
                                        selected
                                            ? 'border-accent bg-accent-light font-medium text-accent-strong'
                                            : 'border-border bg-surface text-foreground hover:border-border-hover'
                                    }`}
                                >
                                    <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center">{getVendorIcon(provider.key, 16)}</span>
                                    {provider.label}
                                </button>
                            );
                        })}
                    </div>
                    {selectedProvider?.defaultApiUrl ? (
                        <p className="min-w-0 truncate text-xs text-foreground-tertiary">
                            请求直连 <span className="font-mono">{selectedProvider.defaultApiUrl}</span>
                        </p>
                    ) : null}
                    <InputError message={providerError} />
                </div>

                {isOtherProvider ? (
                    <div className="flex flex-col gap-2">
                        <FieldLabel htmlFor={`${fieldId}-api-url`}>API URL</FieldLabel>
                        <input
                            id={`${fieldId}-api-url`}
                            value={draft.apiUrl}
                            onChange={(event) => handleFieldChange('apiUrl', event.target.value)}
                            aria-invalid={apiUrlError ? true : undefined}
                            aria-describedby={apiUrlError ? `${fieldId}-api-url-error` : undefined}
                            className={monoFieldClass}
                            placeholder="https://api.example.com/v1"
                            autoComplete="off"
                            inputMode="url"
                        />
                        <InputError id={`${fieldId}-api-url-error`} message={apiUrlError} />
                    </div>
                ) : null}

                <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={`${fieldId}-api-key`}>API Key</FieldLabel>
                    <div className="relative">
                        <input
                            id={`${fieldId}-api-key`}
                            value={draft.apiKey}
                            onChange={(event) => handleFieldChange('apiKey', event.target.value)}
                            type={showApiKey ? 'text' : 'password'}
                            aria-invalid={apiKeyError ? true : undefined}
                            aria-describedby={apiKeyError ? `${fieldId}-api-key-error` : undefined}
                            className={`${monoFieldClass} pr-11`}
                            placeholder="sk-..."
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <span className="absolute inset-y-0 right-1.5 flex items-center">{apiKeyToggle}</span>
                    </div>
                    <InputError id={`${fieldId}-api-key-error`} message={apiKeyError} />
                </div>

                <div className={isOtherProvider ? 'grid gap-4 sm:grid-cols-2' : 'flex flex-col gap-2'}>
                    <div className="flex flex-col gap-2">
                        <div className="flex items-baseline justify-between gap-3">
                            <FieldLabel htmlFor={`${fieldId}-model-id`}>Model ID</FieldLabel>
                            {!isOtherProvider && selectedProvider ? (
                                <span className="text-xs text-foreground-tertiary">可填写该供应商支持的任意模型</span>
                            ) : null}
                        </div>
                        <input
                            id={`${fieldId}-model-id`}
                            value={draft.modelId}
                            onChange={(event) => (isOtherProvider
                                ? handleFieldChange('modelId', event.target.value)
                                : handleManualModelIdChange(event.target.value))}
                            aria-invalid={modelIdError ? true : undefined}
                            aria-describedby={modelIdError ? `${fieldId}-model-id-error` : undefined}
                            className={monoFieldClass}
                            placeholder={isOtherProvider ? 'gpt-4.1-mini' : selectedProvider?.models[0]?.id ?? '先选择供应商'}
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <InputError id={`${fieldId}-model-id-error`} message={modelIdError} />
                    </div>
                    {isOtherProvider ? (
                        <div className="flex flex-col gap-2">
                            <FieldLabel htmlFor={`${fieldId}-model-name`}>显示名称（可选）</FieldLabel>
                            <input
                                id={`${fieldId}-model-name`}
                                value={draft.modelName}
                                onChange={(event) => handleFieldChange('modelName', event.target.value)}
                                className={fieldClass}
                                placeholder="在对话里显示的名字"
                                autoComplete="off"
                            />
                        </div>
                    ) : modelSuggestions.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-foreground-tertiary">推荐</span>
                            {modelSuggestions.map((model) => (
                                <button
                                    key={model.id}
                                    type="button"
                                    aria-pressed={draft.modelId.trim() === model.id}
                                    onClick={() => handleModelChange(model.id)}
                                    className="h-7 rounded-full border border-border bg-surface px-2.5 text-xs text-foreground-secondary transition-colors duration-150 hover:border-border-hover hover:text-foreground aria-pressed:border-accent aria-pressed:bg-accent-light aria-pressed:text-accent-strong"
                                >
                                    {model.name}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                    <button type="button" onClick={handleActivate} className={primaryButtonClass}>
                        {activeConfig ? '保存并启用' : '启用服务'}
                    </button>
                    {activeConfig ? (
                        <button type="button" onClick={handleCancelEdit} className={secondaryButtonClass}>
                            取消
                        </button>
                    ) : lastConfig ? (
                        <button type="button" onClick={handleReactivateLastConfig} className={secondaryButtonClass}>
                            恢复上次配置
                        </button>
                    ) : null}
                </div>
            </div>
        </section>
    );

    const body = activeConfig && !isEditing ? summary : form;

    if (embedded) {
        return (
            <div className="flex flex-col gap-8">
                <StorageNotice compact={false} />
                {body}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5 shadow-[0_10px_30px_rgba(34,30,20,0.12)] md:w-[420px]">
            <div className="flex items-start gap-3 pr-8">
                <span aria-hidden="true" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
                    <KeyRound className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 id="custom-provider-panel-title" className="font-display text-lg leading-snug text-foreground">自定义模型</h3>
                        <span className="rounded-full bg-background-secondary px-2 py-0.5 text-[11px] font-medium tracking-wide text-foreground-secondary">BYOK</span>
                    </div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-foreground-secondary">用你自己的 API Key 调用模型，不消耗本站积分。</p>
                </div>
            </div>
            {body}
            <StorageNotice compact />
        </div>
    );
}
