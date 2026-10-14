import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, Edit3, Save, Check, Share2, Copy } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';

const BUTTON_BASE_CLASS = 'inline-flex h-10 items-center gap-1.5 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3.5 text-sm transition-colors duration-150 hover:bg-background-secondary active:bg-background-tertiary disabled:cursor-not-allowed';
const SECONDARY_BUTTON_CLASS = `${BUTTON_BASE_CLASS} text-foreground disabled:opacity-50`;
/** 已保存态保持可读（成功色、不降透明度） */
const SAVED_BUTTON_CLASS = `${BUTTON_BASE_CLASS} text-success`;

const MOBILE_ASK_CLASS = 'flex h-12 flex-1 items-center justify-center rounded-xl bg-accent text-[15px] font-medium text-on-accent transition-colors duration-150 hover:bg-accent-hover';
/** 移动端底栏左侧的次要操作按钮（保存、重新洗牌等）。 */
export const MOBILE_SECONDARY_ACTION_CLASS = 'flex h-12 min-w-[76px] items-center justify-center rounded-xl border-[0.5px] border-border-hover bg-surface px-4 text-[15px] transition-colors duration-150 hover:bg-background-secondary only:flex-1';

/** 打开 AI 对话的入口（与页脚「AI 对话」链接同一目的地）。 */
export const ASK_TAIBU_HREF = '/chat';

export function ResultHeader({
    chartId,
    saving,
    saved,
    saveDisabled = false,
    saveLabel = '保存',
    copied,
    jsonCopied,
    showJsonCopy = false,
    onEdit,
    onSave,
    onCopy,
    onCopyJson,
    onShare,
    children,
}: {
    chartId: string | null;
    saving: boolean;
    saved: boolean;
    saveDisabled?: boolean;
    saveLabel?: string;
    copied: boolean;
    jsonCopied?: boolean;
    showJsonCopy?: boolean;
    onEdit: () => void;
    onSave: () => void;
    onCopy: () => void;
    onCopyJson?: () => void;
    onShare: () => void;
    /** 标题区（姓名 + 出生信息），渲染在操作按钮左侧 */
    children?: ReactNode;
}) {
    void chartId;
    return (
        <div className="flex flex-col gap-4">
            <Link
                href="/bazi"
                className="hidden w-fit items-center gap-1.5 text-sm text-foreground-secondary transition-colors hover:text-foreground lg:inline-flex"
            >
                <ChevronLeft className="h-4 w-4" />
                重新排盘
            </Link>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0 flex-1">{children}</div>
                <div className="hidden flex-wrap items-center justify-end gap-2 lg:flex">
                    <button
                        type="button"
                        onClick={onEdit}
                        disabled={saving}
                        className={SECONDARY_BUTTON_CLASS}
                    >
                        <Edit3 className="h-3.5 w-3.5" />
                        修改
                    </button>
                    <button
                        type="button"
                        onClick={onShare}
                        className={SECONDARY_BUTTON_CLASS}
                    >
                        <Share2 className="h-3.5 w-3.5" />
                        分享
                    </button>
                    <button
                        type="button"
                        onClick={onCopy}
                        className={SECONDARY_BUTTON_CLASS}
                    >
                        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? '已复制' : '复制'}
                    </button>
                    {showJsonCopy && onCopyJson && (
                        <button
                            type="button"
                            onClick={onCopyJson}
                            className={SECONDARY_BUTTON_CLASS}
                        >
                            {jsonCopied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                            {jsonCopied ? 'JSON 已复制' : '复制 JSON'}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={saving || saved || saveDisabled}
                        className={saved ? SAVED_BUTTON_CLASS : SECONDARY_BUTTON_CLASS}
                    >
                        {saved ? (
                            <><Check className="h-3.5 w-3.5" />已保存</>
                        ) : saving ? (
                            <><SoundWaveLoader variant="inline" />保存中</>
                        ) : (
                            <><Save className="h-3.5 w-3.5" />{saveLabel}</>
                        )}
                    </button>
                    <AIFeatureGate>
                        <Link
                            href={ASK_TAIBU_HREF}
                            className="inline-flex h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-medium text-on-accent transition-colors duration-150 hover:bg-accent-hover"
                        >
                            问太卜
                        </Link>
                    </AIFeatureGate>
                </div>
            </div>
        </div>
    );
}

/**
 * 移动端底部操作栏容器：左侧次要操作（children）+ 右侧问太卜主操作（桌面端由各页标题区承担）。
 * 固定在底部导航之上；页面容器需在移动端预留约 6rem 的底部留白。
 */
export function MobileActionBar({ children, ask }: {
    children: ReactNode;
    /** 页内主操作（如六爻「问太卜解卦」直接发起解读）；缺省时跳转 AI 对话「问太卜」。 */
    ask?: { label: string; onClick: () => void; disabled?: boolean };
}) {
    return (
        <div className="fixed inset-x-0 bottom-[calc(4rem+var(--sab))] z-30 flex gap-2 border-t-[0.5px] border-border bg-background px-4 py-3 sm:px-6 lg:hidden">
            {children}
            <AIFeatureGate>
                {ask ? (
                    <button
                        type="button"
                        onClick={ask.onClick}
                        disabled={ask.disabled}
                        className={`${MOBILE_ASK_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                        {ask.label}
                    </button>
                ) : (
                    <Link href={ASK_TAIBU_HREF} className={MOBILE_ASK_CLASS}>
                        问太卜
                    </Link>
                )}
            </AIFeatureGate>
        </div>
    );
}

/** 移动端底部操作栏：保存 + 问太卜。 */
export function ResultMobileActions({
    saving,
    saved,
    saveDisabled = false,
    saveLabel = '保存',
    onSave,
    ask,
}: {
    saving: boolean;
    saved: boolean;
    saveDisabled?: boolean;
    saveLabel?: string;
    onSave: () => void;
    ask?: { label: string; onClick: () => void; disabled?: boolean };
}) {
    return (
        <MobileActionBar ask={ask}>
            <button
                type="button"
                onClick={onSave}
                disabled={saving || saved || saveDisabled}
                className={`${MOBILE_SECONDARY_ACTION_CLASS} disabled:cursor-not-allowed ${saved ? 'text-success' : 'text-foreground disabled:opacity-50'}`}
            >
                {saved ? '已保存' : saving ? '保存中' : saveLabel}
            </button>
        </MobileActionBar>
    );
}
