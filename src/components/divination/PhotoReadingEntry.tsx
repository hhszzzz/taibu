/**
 * 面相 / 手相上传页（设计稿 Face / MobileFace）
 *
 * 桌面端左侧照片上传区、右侧拍摄建议 · 问题 · 选项 · 开始分析，底部隐私提示；
 * 移动端单列，开始分析固定在底部导航之上。
 * 页面只提供文案、图标与额外选项；选图压缩、提交接口与跳转结果页在此统一处理。
 */
'use client'; // 需要文件选择/拖拽、表单状态、弹窗与路由跳转

import { useId, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Camera, ChevronDown, ImageIcon, Lock, X, type LucideIcon } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { CreditsModal } from '@/components/ui/CreditsModal';
import { Modal } from '@/components/ui/Modal';
import { VisionModelSelector } from '@/components/ui/VisionModelSelector';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { writeSessionJSON } from '@/lib/cache/session-storage';
import { DEFAULT_VISION_MODEL_ID } from '@/lib/ai/ai-config';
import { isCreditsError } from '@/lib/hooks/useStreamingResponse';
import { preparePhoto, validatePhotoFile, type PreparedPhoto } from '@/lib/divination/photo-reading';

export type PhotoReadingKind = 'face' | 'palm';

const KIND_TABS: ReadonlyArray<{ kind: PhotoReadingKind; label: string; href: string }> = [
    { kind: 'face', label: '面相', href: '/face' },
    { kind: 'palm', label: '手相', href: '/palm' },
];

const CARD_CLASS = 'rounded-2xl border-[0.5px] border-border bg-surface';
const OUTLINE_BUTTON_CLASS = 'inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-4 text-sm text-foreground transition-colors hover:bg-background-secondary';
/** 选项控件：移动端为整行表单字段，桌面端收成设计稿「视觉模型」行右侧的小胶囊。 */
const OPTION_SELECT_CLASS = 'h-11 w-full cursor-pointer appearance-none rounded-[10px] border-[0.5px] border-border-hover bg-surface pl-3 pr-9 text-[0.9375rem] text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 lg:h-8 lg:w-auto lg:rounded-lg lg:border-0 lg:bg-background-secondary lg:pl-2.5 lg:pr-7 lg:text-[0.8125rem]';

export interface PhotoReadingCopy {
    title: string;
    subtitle: string;
    /** 桌面端上传区标题（点击或拖入） */
    uploadTitle: string;
    /** 移动端上传区标题 */
    mobileUploadTitle: string;
    uploadHint: string;
    previewAlt: string;
    tipsTitle: string;
    tips: readonly string[];
    questionPlaceholder: string;
    submitLabel: string;
    /** 未选照片就提交时的提示 */
    missingPhoto: string;
    /** 底部隐私与免责提示 */
    notice: string;
    /** 会员与积分说明 */
    billing: string;
}

export interface PhotoAnalysisOption {
    id: string;
    name: string;
    description: string;
}

interface PhotoReadingResponse {
    success?: boolean;
    error?: string;
    data?: {
        readingId?: string;
        conversationId?: string | null;
        analysis?: string;
    };
}

/** 选项行：移动端「标签在上、控件整行」，桌面端「标签在左、控件在右」。 */
export function PhotoOptionRow({ label, children }: { label: string; children: ReactNode }) {
    const labelId = useId();
    return (
        <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5 lg:min-h-14 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:px-4 lg:py-2.5">
            <span id={labelId} className="text-[0.8125rem] font-medium lg:text-sm lg:font-normal lg:text-foreground-secondary">{label}</span>
            {children}
        </div>
    );
}

/** 两三项的互斥选项（如左手 / 右手）。 */
export function PhotoOptionSegmented<T extends string>({ options, value, onChange }: {
    options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
    value: T;
    onChange: (value: T) => void;
}) {
    return (
        <div className="grid h-11 auto-cols-fr grid-flow-col gap-1 rounded-[10px] bg-background-secondary p-1 lg:h-8 lg:rounded-lg lg:p-0.5">
            {options.map(option => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(option.value)}
                        className={`flex items-center justify-center gap-1.5 rounded-[7px] px-3 text-sm transition-colors lg:rounded-md lg:px-2.5 lg:text-[0.8125rem] ${active ? 'bg-surface text-foreground shadow-[0_1px_2px_rgba(20,20,19,0.08)]' : 'text-foreground-secondary hover:text-foreground'}`}
                    >
                        {option.label}
                        {option.hint && <span className="text-xs text-foreground-tertiary">{option.hint}</span>}
                    </button>
                );
            })}
        </div>
    );
}

export function PhotoReadingEntry({
    kind,
    copy,
    icon: Icon,
    illustration,
    capture,
    endpoint,
    sessionKey,
    resultPath,
    analysisTypes,
    extraOptions,
    extraFields,
    consent,
}: {
    kind: PhotoReadingKind;
    copy: PhotoReadingCopy;
    /** 移动端上传区图标 */
    icon: LucideIcon;
    /** 桌面端上传区的虚线轮廓插画 */
    illustration: ReactNode;
    /** 移动端「拍照」调用的摄像头：面相用前置，手相用后置 */
    capture: 'user' | 'environment';
    endpoint: string;
    sessionKey: string;
    resultPath: string;
    analysisTypes: readonly PhotoAnalysisOption[];
    /** 额外选项行（PhotoOptionRow），排在「分析重点」之前 */
    extraOptions?: ReactNode;
    /** 附加到请求体与结果缓存的字段（如手相的 handType） */
    extraFields?: Readonly<Record<string, string>>;
    /** 首次选图与提交前需确认的免责声明 */
    consent?: { title: string; body: string };
}) {
    const router = useRouter();
    const { showToast } = useToast();
    const { user } = useSessionSafe();
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const albumInputRef = useRef<HTMLInputElement>(null);
    /** 每次选图递增；较早的压缩结果晚到时直接丢弃，避免覆盖用户最后一次选择。 */
    const prepareSeqRef = useRef(0);
    const questionId = useId();
    const consentTitleId = useId();
    const consentBodyId = useId();

    const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
    const [preparing, setPreparing] = useState(false);
    const [question, setQuestion] = useState('');
    const [analysisType, setAnalysisType] = useState(analysisTypes[0]?.id ?? 'full');
    const [selectedModel, setSelectedModel] = useState(DEFAULT_VISION_MODEL_ID);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [showConsent, setShowConsent] = useState(false);
    const [consentAccepted, setConsentAccepted] = useState(false);
    const [showCreditsModal, setShowCreditsModal] = useState(false);

    const analysisInfo = analysisTypes.find(type => type.id === analysisType);
    const needsConsent = Boolean(consent) && !consentAccepted;

    const handleFile = async (file: File) => {
        // 分析请求已发出时不再替换照片（拖入也会走到这里）
        if (isAnalyzing) return;
        const invalid = validatePhotoFile(file);
        if (invalid) {
            showToast('error', invalid);
            return;
        }
        if (needsConsent) setShowConsent(true);

        const seq = ++prepareSeqRef.current;
        setPreparing(true);
        try {
            const prepared = await preparePhoto(file);
            if (seq === prepareSeqRef.current) setPhoto(prepared);
        } catch (error) {
            if (seq === prepareSeqRef.current) {
                showToast('error', error instanceof Error ? error.message : '图片处理失败，请重新选择');
            }
        } finally {
            if (seq === prepareSeqRef.current) setPreparing(false);
        }
    };

    const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // 清空后可再次选择同一张照片
        event.target.value = '';
        if (file) void handleFile(file);
    };

    const handleRemovePhoto = () => {
        prepareSeqRef.current += 1;
        setPreparing(false);
        setPhoto(null);
    };

    const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
        // 拖过子元素时也会触发 dragleave，只有真正离开上传区才取消高亮
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setIsDragging(false);
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void handleFile(file);
    };

    const handleAnalyze = async () => {
        if (!photo) {
            showToast('error', copy.missingPhoto);
            return;
        }
        if (!user) {
            showToast('error', '请先登录');
            return;
        }
        if (needsConsent) {
            setShowConsent(true);
            return;
        }

        setIsAnalyzing(true);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // 公共字段放在附加字段之后，避免被同名附加字段覆盖
                body: JSON.stringify({
                    ...extraFields,
                    action: 'analyze',
                    imageBase64: photo.base64,
                    imageMimeType: photo.mimeType,
                    analysisType,
                    question: question.trim() || undefined,
                    modelId: selectedModel,
                    reasoning: reasoningEnabled,
                }),
            });
            const payload = await response.json() as PhotoReadingResponse;

            if (!response.ok || !payload.success) {
                if (isCreditsError(payload.error ?? null)) {
                    setShowCreditsModal(true);
                    return;
                }
                showToast('error', payload.error || '分析失败');
                return;
            }

            const result = payload.data;
            if (!result?.readingId && !result?.analysis) {
                showToast('error', '未获取到分析结果');
                return;
            }
            writeSessionJSON(sessionKey, {
                ...extraFields,
                readingId: result.readingId,
                conversationId: result.conversationId,
                analysisType,
                analysis: result.analysis,
                isTemporary: !result.readingId,
            });
            router.push(resultPath);
        } catch (error) {
            console.error('分析失败:', error);
            showToast('error', '分析失败，请稍后重试');
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <>
            <div className="min-h-full bg-background text-foreground">
                {/* 桌面端内容宽 920px（设计稿），外加左右 32px 内边距 */}
                <div className="mx-auto flex w-full max-w-[984px] flex-col gap-3.5 px-4 pt-0.5 pb-36 sm:px-6 lg:gap-7 lg:px-8 lg:pt-12 lg:pb-16">
                    {/* 标题与相学类型切换；移动端标题由顶栏显示 */}
                    <header className="flex flex-col gap-3.5 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between lg:gap-4">
                        <div className="flex flex-col gap-2">
                            <h1 className="hidden font-display text-[34px] font-normal leading-tight lg:block">{copy.title}</h1>
                            <p className="px-1 text-center text-[0.8125rem] leading-normal text-foreground-secondary lg:px-0 lg:text-left lg:text-[0.9375rem]">
                                {copy.subtitle}
                            </p>
                        </div>
                        <nav aria-label="相学类型" className="grid h-10 shrink-0 grid-cols-2 gap-1 rounded-[10px] bg-background-secondary p-1 text-sm lg:flex">
                            {KIND_TABS.map(tab => (
                                <Link
                                    key={tab.kind}
                                    href={tab.href}
                                    aria-current={tab.kind === kind ? 'page' : undefined}
                                    className={`flex items-center justify-center rounded-[7px] px-4 transition-colors ${tab.kind === kind ? 'bg-surface text-foreground shadow-[0_1px_2px_rgba(20,20,19,0.08)]' : 'text-foreground-secondary hover:text-foreground'}`}
                                >
                                    {tab.label}
                                </Link>
                            ))}
                        </nav>
                    </header>

                    <div className="flex flex-col gap-3.5 lg:flex-row lg:items-stretch lg:gap-6">
                        {/* 照片上传区：整块可点击/拖入；键盘用户使用其中的按钮 */}
                        <div
                            onClick={() => { if (!photo && !preparing) albumInputRef.current?.click(); }}
                            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            className={`relative flex flex-col items-center justify-center gap-2.5 rounded-[18px] border border-dashed px-4 py-8 text-center transition-colors lg:min-h-[420px] lg:flex-[1_1_340px] lg:gap-4 lg:rounded-[20px] lg:border-[1.5px] lg:p-8 ${photo || preparing ? '' : 'cursor-pointer'} ${isDragging ? 'border-accent bg-accent-soft' : 'border-accent/50 bg-accent-light lg:border-border-hover lg:bg-surface'}`}
                        >
                            {preparing ? (
                                <SoundWaveLoader variant="block" text="正在处理照片" />
                            ) : photo ? (
                                <>
                                    {/* eslint-disable-next-line @next/next/no-img-element -- 本地 data URL 预览，无需 next/image 优化 */}
                                    <img
                                        src={photo.dataUrl}
                                        alt={copy.previewAlt}
                                        className="max-h-60 max-w-full rounded-xl border-[0.5px] border-border object-contain lg:max-h-80"
                                    />
                                    <button type="button" onClick={() => albumInputRef.current?.click()} disabled={isAnalyzing} className={`${OUTLINE_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}>
                                        <ImageIcon className="h-4 w-4" aria-hidden="true" />更换照片
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRemovePhoto}
                                        disabled={isAnalyzing}
                                        aria-label="移除照片"
                                        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <X className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                </>
                            ) : (
                                <>
                                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-accent lg:hidden">
                                        <Icon className="h-7 w-7" strokeWidth={1.7} aria-hidden="true" />
                                    </span>
                                    <span className="hidden text-foreground/25 lg:block" aria-hidden="true">{illustration}</span>
                                    <span className="text-[0.9375rem] font-medium lg:font-display lg:text-[1.1875rem] lg:font-normal">
                                        <span className="lg:hidden">{copy.mobileUploadTitle}</span>
                                        <span className="hidden lg:inline">{copy.uploadTitle}</span>
                                    </span>
                                    <span className="text-xs text-foreground-secondary lg:text-[0.8125rem]">{copy.uploadHint}</span>
                                    <button
                                        type="button"
                                        onClick={(event) => { event.stopPropagation(); albumInputRef.current?.click(); }}
                                        className="hidden h-10 items-center rounded-[10px] bg-background-secondary px-4 text-sm text-foreground transition-colors hover:bg-background-tertiary lg:inline-flex"
                                    >
                                        选择照片
                                    </button>
                                    <div className="mt-1.5 grid w-full grid-cols-2 gap-2 lg:hidden">
                                        <button
                                            type="button"
                                            onClick={(event) => { event.stopPropagation(); cameraInputRef.current?.click(); }}
                                            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] bg-accent text-sm text-on-accent transition-colors hover:bg-accent-hover"
                                        >
                                            <Camera className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />拍照
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => { event.stopPropagation(); albumInputRef.current?.click(); }}
                                            className={OUTLINE_BUTTON_CLASS}
                                        >
                                            <ImageIcon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />从相册选择
                                        </button>
                                    </div>
                                </>
                            )}
                            {/* 隐藏的文件输入：阻止冒泡，避免程序化 click 再次触发上传区的相册选择 */}
                            <input
                                ref={cameraInputRef}
                                type="file"
                                accept="image/*"
                                capture={capture}
                                tabIndex={-1}
                                aria-hidden="true"
                                onChange={handleInputChange}
                                onClick={(event) => event.stopPropagation()}
                                className="hidden"
                            />
                            <input
                                ref={albumInputRef}
                                type="file"
                                accept="image/*"
                                tabIndex={-1}
                                aria-hidden="true"
                                onChange={handleInputChange}
                                onClick={(event) => event.stopPropagation()}
                                className="hidden"
                            />
                        </div>

                        <div className="flex min-w-0 flex-col gap-3.5 lg:flex-[1_1_300px] lg:gap-4">
                            {/* 拍摄建议 */}
                            <section className={`${CARD_CLASS} flex flex-col gap-2 p-4 lg:gap-3 lg:p-5`}>
                                <h2 className="text-xs font-normal text-foreground-secondary lg:text-sm lg:font-medium lg:text-foreground">{copy.tipsTitle}</h2>
                                <ul className="flex list-disc flex-col gap-1.5 pl-[18px] text-sm leading-normal text-foreground lg:leading-relaxed">
                                    {copy.tips.map(tip => <li key={tip}>{tip}</li>)}
                                </ul>
                            </section>

                            {/* 想问的问题 */}
                            <section className="flex flex-col gap-1.5 lg:gap-2.5 lg:rounded-2xl lg:border-[0.5px] lg:border-border lg:bg-surface lg:p-5">
                                <label htmlFor={questionId} className="text-[0.8125rem] font-medium lg:text-sm">
                                    想问的问题 <span className="font-normal text-foreground-tertiary lg:text-foreground-secondary">选填</span>
                                </label>
                                <textarea
                                    id={questionId}
                                    rows={2}
                                    value={question}
                                    onChange={(event) => setQuestion(event.target.value)}
                                    placeholder={copy.questionPlaceholder}
                                    className="min-h-[84px] w-full resize-none rounded-[10px] border-[0.5px] border-border-hover bg-surface p-3 text-[0.9375rem] leading-normal text-foreground placeholder:text-foreground-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 lg:min-h-[66px] lg:px-3 lg:py-2.5 lg:text-sm lg:leading-relaxed"
                                />
                            </section>

                            {/* 选项：移动端为表单字段，桌面端合并为一张设置卡 */}
                            <div className="flex flex-col gap-3.5 lg:gap-0 lg:divide-y-[0.5px] lg:divide-border lg:rounded-xl lg:border-[0.5px] lg:border-border lg:bg-surface">
                                {extraOptions}
                                <PhotoOptionRow label="分析重点">
                                    <div className="relative w-full lg:w-auto">
                                        <select
                                            aria-label="分析重点"
                                            value={analysisType}
                                            onChange={(event) => setAnalysisType(event.target.value)}
                                            title={analysisInfo?.description}
                                            className={OPTION_SELECT_CLASS}
                                        >
                                            {analysisTypes.map(type => (
                                                <option key={type.id} value={type.id}>{type.name}</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary lg:right-2 lg:h-3.5 lg:w-3.5" aria-hidden="true" />
                                    </div>
                                </PhotoOptionRow>
                                <PhotoOptionRow label="视觉模型">
                                    <VisionModelSelector
                                        selectedModel={selectedModel}
                                        onModelChange={setSelectedModel}
                                        reasoningEnabled={reasoningEnabled}
                                        onReasoningChange={setReasoningEnabled}
                                    />
                                </PhotoOptionRow>
                            </div>

                            {/* 开始分析：移动端固定在底部导航之上 */}
                            <div className="fixed inset-x-0 bottom-[calc(4rem+var(--sab))] z-30 flex flex-col gap-2 border-t-[0.5px] border-border bg-background px-4 py-3 sm:px-6 lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0">
                                {!photo && !isAnalyzing && (
                                    <p className="text-center text-xs text-foreground-secondary lg:hidden">先选择一张照片</p>
                                )}
                                <button
                                    type="button"
                                    onClick={() => { void handleAnalyze(); }}
                                    disabled={!photo || preparing || isAnalyzing}
                                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[0.9375rem] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent lg:text-base"
                                >
                                    {isAnalyzing ? (
                                        <>
                                            <SoundWaveLoader variant="inline" />
                                            <span>正在分析，请稍候</span>
                                        </>
                                    ) : copy.submitLabel}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 隐私与免责提示 */}
                    <div className="flex gap-2.5 rounded-xl bg-panel px-3.5 py-3 text-xs leading-[1.7] text-foreground-secondary lg:bg-sidebar lg:px-4 lg:py-3.5 lg:text-[0.8125rem] lg:leading-relaxed">
                        <Lock className="mt-0.5 hidden h-4 w-4 shrink-0 lg:block" strokeWidth={1.7} aria-hidden="true" />
                        <div className="flex flex-col gap-1">
                            <p>{copy.notice}</p>
                            <p className="text-foreground-tertiary">{copy.billing}</p>
                        </div>
                    </div>
                </div>
            </div>

            {consent && (
                <Modal open={showConsent} onClose={() => setShowConsent(false)} labelledBy={consentTitleId} describedBy={consentBodyId}>
                    <div className="flex flex-col gap-5 p-6">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent-light text-accent">
                                    <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                                </span>
                                <h3 id={consentTitleId} className="font-display text-lg">{consent.title}</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowConsent(false)}
                                aria-label="关闭"
                                className="rounded-lg p-1 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"
                            >
                                <X className="h-5 w-5" aria-hidden="true" />
                            </button>
                        </div>
                        <p id={consentBodyId} className="whitespace-pre-line rounded-xl bg-panel p-4 text-sm leading-relaxed text-foreground-secondary">
                            {consent.body}
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setShowConsent(false)}
                                className="h-11 flex-1 rounded-xl border-[0.5px] border-border-hover bg-surface text-sm font-medium transition-colors hover:bg-background-secondary"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setConsentAccepted(true);
                                    setShowConsent(false);
                                }}
                                className="h-11 flex-1 rounded-xl bg-accent text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                            >
                                我已了解
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
            <CreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />
        </>
    );
}
