'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Eye, EyeOff, LockKeyhole, Monitor, PencilLine } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import type { CustomProviderConfig } from '@/types';
import { getVendorName } from '@/lib/ai/vendor-labels';
import { matchModelVendor } from '@/lib/ai/vendor-match';
import { getVendorIcon } from '@/lib/ai/vendor-config';
import {
    clearCustomProvider,
    CUSTOM_PROVIDER_CHANGED_EVENT,
    getCustomProvider,
    getLastCustomProvider,
    setCustomProvider,
} from '@/lib/chat/custom-provider';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { CUSTOM_PROVIDER_MAX_MODEL_ID_LENGTH, CUSTOM_PROVIDER_MAX_MODEL_NAME_LENGTH, hasRedundantVersionSuffix, maskCustomProviderApiKey, validateCustomProviderInput } from '@/lib/ai/custom-provider-url';

type CustomProviderDraft = {
    apiUrl: string;
    apiKey: string;
    modelId: string;
    modelName: string;
    imageModelId: string;
};

type CustomProviderFormErrors = {
    apiUrl?: string;
    apiKey?: string;
    modelId?: string;
    modelName?: string;
    imageModelId?: string;
};

interface CustomProviderPanelProps {
    /** 嵌入设置页：标题由设置中心渲染，面板改为宽版布局；否则为对话页弹窗。 */
    embedded?: boolean;
    onClose?: () => void;
    onChange?: (config: CustomProviderConfig | null) => void;
}

const EMPTY_DRAFT: CustomProviderDraft = {
    apiUrl: '',
    apiKey: '',
    modelId: '',
    modelName: '',
    imageModelId: '',
};

function draftFromConfig(config: CustomProviderConfig | null): CustomProviderDraft {
    if (!config) return EMPTY_DRAFT;
    return {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        modelId: config.modelId,
        modelName: config.modelName ?? '',
        imageModelId: config.imageModelId ?? '',
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
    return `w-full rounded-xl border border-border-hover bg-surface text-foreground outline-none transition-colors duration-150 placeholder:text-foreground-tertiary focus:border-accent ${
        compact ? 'h-10 px-3 text-sm' : 'h-11 px-3.5 text-[15px]'
    }`;
}

function StorageNotice({ compact }: { compact: boolean }) {
    if (compact) {
        return (
            <p className="flex items-start gap-2 rounded-xl bg-background-secondary px-3 py-2.5 text-xs leading-relaxed text-foreground-secondary">
                <LockKeyhole aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>Key 只存在浏览器，对话与生图直连；Agent 会加密临时保存。</span>
            </p>
        );
    }
    return (
        <div className="flex flex-col gap-2.5 rounded-xl bg-background-secondary px-[18px] py-4 text-[13px] leading-relaxed text-foreground">
            <p className="flex items-start gap-2.5">
                <Monitor aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-foreground-secondary" />
                <span><b className="font-medium">对话、解读、润色与生图</b>：Key 只存在当前标签页，由浏览器直连模型供应商，不经过本站服务器；关闭页面即失效。生成的图片会上传到本站保存。</span>
            </p>
            <p className="flex items-start gap-2.5">
                <LockKeyhole aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-foreground-secondary" />
                <span><b className="font-medium">Agent 任务</b>：Key 会加密后临时保存，任务结束即删除。定时任务始终使用本站模型。</span>
            </p>
        </div>
    );
}

/** 面板不再选择供应商：一律按手工配置保存，厂商标签来自模型 ID 的前缀匹配。 */
function resolveDraftConfig(draft: CustomProviderDraft): CustomProviderConfig {
    const vendor = matchModelVendor(draft.modelId);
    return {
        providerKey: 'other',
        providerLabel: vendor ? getVendorName(vendor) : '其他',
        apiUrl: draft.apiUrl.trim(),
        apiKey: draft.apiKey.trim(),
        modelId: draft.modelId.trim(),
        modelName: draft.modelName.trim() || undefined,
        imageModelId: draft.imageModelId.trim() || undefined,
    };
}

function buildFormErrors(draft: CustomProviderDraft): CustomProviderFormErrors {
    const errors: CustomProviderFormErrors = validateCustomProviderInput({
        apiUrl: draft.apiUrl,
        apiKey: draft.apiKey,
        modelId: draft.modelId,
    });
    if (draft.modelName.trim().length > CUSTOM_PROVIDER_MAX_MODEL_NAME_LENGTH) {
        errors.modelName = '显示名称过长';
    }
    if (draft.imageModelId.trim().length > CUSTOM_PROVIDER_MAX_MODEL_ID_LENGTH) {
        errors.imageModelId = '生图模型过长';
    }
    return errors;
}

export function CustomProviderPanel({
    embedded = false,
    onClose,
    onChange,
}: CustomProviderPanelProps) {
    const { showToast } = useToast();

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

    // 标签按模型 ID 前缀实时推导：旧配置存过的 providerLabel 只作回退，
    // 这样改名、改网关后摘要与图标都会自愈。
    const activeVendor = activeConfig ? matchModelVendor(activeConfig.modelId) : null;
    const activeProviderLabel = activeVendor ? getVendorName(activeVendor) : activeConfig?.providerLabel ?? '其他';
    const activeUrl = formatProviderUrl(activeConfig?.apiUrl);
    const matchedVendor = useMemo(() => matchModelVendor(draft.modelId), [draft.modelId]);
    // 手写了 /v1 或 /chat/completions 时提示不必写（标准化同样能容错）；
    // 网关自带的版本段（/api/paas/v4、/v1beta/openai）不算冗余。
    const urlIncludesVersionSuffix = useMemo(() => hasRedundantVersionSuffix(draft.apiUrl), [draft.apiUrl]);
    const errors = useMemo(() => buildFormErrors(draft), [draft]);
    const hasErrors = Object.keys(errors).length > 0;

    const handleFieldChange = (field: keyof CustomProviderDraft, value: string) => {
        setDraft((prev) => ({ ...prev, [field]: value }));
    };

    /** 实际请求模型变化时，显示名称默认跟随；用户改过显示名称后不再覆盖。 */
    const handleModelIdChange = (modelId: string) => {
        setSubmitted(false);
        setDraft((prev) => ({
            ...prev,
            modelId,
            modelName: !prev.modelName.trim() || prev.modelName === prev.modelId ? modelId : prev.modelName,
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

        const nextConfig = resolveDraftConfig(draft);

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
    const secondaryButtonClass = compact ? 'px-3.5' : 'px-4';
    const primaryButtonClass = compact ? 'flex-1 px-4' : 'px-5';
    const sectionTitleClass = embedded ? 'text-[13px] font-medium text-foreground-tertiary' : 'sr-only';
    const apiKeyToggleLabel = showApiKey ? '隐藏 API Key' : '显示 API Key';
    const apiKeyError = submitted ? errors.apiKey : undefined;
    const apiUrlError = submitted ? errors.apiUrl : undefined;
    const modelIdError = submitted ? errors.modelId : undefined;
    const modelNameError = submitted ? errors.modelName : undefined;
    const imageModelIdError = submitted ? errors.imageModelId : undefined;

    const apiKeyToggle = (
        <IconButton
            label={apiKeyToggleLabel}
            title={apiKeyToggleLabel}
            expand="none"
            onClick={() => setShowApiKey((prev) => !prev)}
            className="h-8 w-8 rounded-lg"
        >
            {showApiKey ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
        </IconButton>
    );

    const summary = activeConfig ? (
        <section aria-labelledby={`${fieldId}-summary`} className="flex flex-col gap-3">
            <h3 id={`${fieldId}-summary`} className={sectionTitleClass}>当前启用</h3>
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
                <div className={`flex items-center gap-3 ${compact ? 'px-4 py-3.5' : 'px-5 py-4'}`}>
                    <span aria-hidden="true" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-background-secondary">
                        {getVendorIcon(activeVendor ?? 'other', 22)}
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
                    <div className={`flex items-center gap-4 border-t border-border ${compact ? 'px-4 py-3' : 'px-5 py-3.5'}`}>
                        <dt className="flex-shrink-0 text-foreground-tertiary">生图模型</dt>
                        <dd className="min-w-0 flex-1 truncate text-right text-foreground-secondary">
                            {activeConfig.imageModelId ? <code className="font-mono">{activeConfig.imageModelId}</code> : '未设置，生图使用本站模型'}
                        </dd>
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
                    <Button variant="ghost" size="lg" onClick={handleDeactivate} className="px-3 hover:text-danger">
                        停用
                    </Button>
                    <Button variant="secondary" size="lg" onClick={handleStartEdit} className={secondaryButtonClass}>
                        <PencilLine aria-hidden="true" className="h-3.5 w-3.5" />
                        编辑配置
                    </Button>
                </div>
            </div>
        </section>
    ) : null;

    const form = (
        <section aria-labelledby={`${fieldId}-form`} className="flex flex-col gap-3">
            <h3 id={`${fieldId}-form`} className={sectionTitleClass}>{activeConfig ? '编辑配置' : '配置模型'}</h3>
            <div className={compact
                ? 'flex flex-col gap-4'
                : 'flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5 sm:p-6'
            }>
                <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={`${fieldId}-api-url`}>API URL</FieldLabel>
                    <Input
                        id={`${fieldId}-api-url`}
                        value={draft.apiUrl}
                        onChange={(event) => handleFieldChange('apiUrl', event.target.value)}
                        aria-invalid={apiUrlError ? true : undefined}
                        aria-describedby={`${fieldId}-api-url-hint${apiUrlError ? ` ${fieldId}-api-url-error` : ''}`}
                        className={monoFieldClass}
                        placeholder="https://api.deepseek.com"
                        autoComplete="off"
                        inputMode="url"
                    />
                    <p id={`${fieldId}-api-url-hint`} className="text-xs text-foreground-tertiary">
                        只填到域名即可，<span className="font-mono">/v1</span> 与 <span className="font-mono">/chat/completions</span> 会按需自动补全。
                    </p>
                    {urlIncludesVersionSuffix ? (
                        <p role="status" className="text-xs text-foreground-secondary">
                            地址里不用写 <span className="font-mono">/v1</span> 或 <span className="font-mono">/chat/completions</span>，保存时会自动处理。
                        </p>
                    ) : null}
                    <InputError id={`${fieldId}-api-url-error`} message={apiUrlError} />
                </div>

                <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={`${fieldId}-api-key`}>API Key</FieldLabel>
                    <div className="relative">
                        <Input
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

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                        <FieldLabel htmlFor={`${fieldId}-model-id`}>实际请求模型</FieldLabel>
                        <div className="relative">
                            <Input
                                id={`${fieldId}-model-id`}
                                value={draft.modelId}
                                onChange={(event) => handleModelIdChange(event.target.value)}
                                aria-invalid={modelIdError ? true : undefined}
                                aria-describedby={modelIdError ? `${fieldId}-model-id-error` : undefined}
                                className={`${monoFieldClass} pr-10`}
                                placeholder="例如 deepseek-chat"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            {matchedVendor ? (
                                <span
                                    aria-hidden="true"
                                    title={getVendorName(matchedVendor)}
                                    className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-foreground-secondary"
                                >
                                    {getVendorIcon(matchedVendor, 16)}
                                </span>
                            ) : null}
                        </div>
                        <InputError id={`${fieldId}-model-id-error`} message={modelIdError} />
                    </div>
                    <div className="flex flex-col gap-2">
                        <FieldLabel htmlFor={`${fieldId}-model-name`}>显示名称</FieldLabel>
                        <Input
                            id={`${fieldId}-model-name`}
                            value={draft.modelName}
                            onChange={(event) => handleFieldChange('modelName', event.target.value)}
                            aria-invalid={modelNameError ? true : undefined}
                            aria-describedby={modelNameError ? `${fieldId}-model-name-error` : undefined}
                            className={fieldClass}
                            placeholder="默认跟随实际请求模型，可修改"
                            autoComplete="off"
                        />
                        <InputError id={`${fieldId}-model-name-error`} message={modelNameError} />
                    </div>
                </div>

                <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor={`${fieldId}-image-model-id`}>生图模型（可选）</FieldLabel>
                    <Input
                        id={`${fieldId}-image-model-id`}
                        value={draft.imageModelId}
                        onChange={(event) => handleFieldChange('imageModelId', event.target.value)}
                        aria-invalid={imageModelIdError ? true : undefined}
                        aria-describedby={`${fieldId}-image-model-id-hint${imageModelIdError ? ` ${fieldId}-image-model-id-error` : ''}`}
                        className={monoFieldClass}
                        placeholder="例如 gpt-image-1"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <p id={`${fieldId}-image-model-id-hint`} className="text-xs text-foreground-tertiary">
                        同一地址与 Key 下的生图模型，供输入框生图与 Agent 使用；留空时生图使用本站模型并按张计费。
                    </p>
                    <InputError id={`${fieldId}-image-model-id-error`} message={imageModelIdError} />
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="lg" onClick={handleActivate} className={primaryButtonClass}>
                        {activeConfig ? '保存并启用' : '启用服务'}
                    </Button>
                    {activeConfig ? (
                        <Button variant="secondary" size="lg" onClick={handleCancelEdit} className={secondaryButtonClass}>
                            取消
                        </Button>
                    ) : lastConfig ? (
                        <Button variant="secondary" size="lg" onClick={handleReactivateLastConfig} className={secondaryButtonClass}>
                            恢复上次配置
                        </Button>
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
        <div className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-lg)] md:w-[420px]">
            <div className="min-w-0 pr-8">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 id="custom-provider-panel-title" className="font-display text-lg leading-snug text-foreground">自定义模型</h3>
                        <span className="rounded-full bg-background-secondary px-2 py-0.5 text-[11px] font-medium tracking-wide text-foreground-secondary">BYOK</span>
                    </div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-foreground-secondary">用你自己的 API Key 调用模型，不消耗本站余额。</p>
                </div>
            </div>
            {body}
            <StorageNotice compact />
        </div>
    );
}
