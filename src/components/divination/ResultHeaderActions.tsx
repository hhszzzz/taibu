import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import { ResultMoreActions } from '@/components/divination/ResultMoreActions';
import type { HeaderMenuItem } from '@/components/layout/HeaderMenuContext';

export interface ResultSaveControl {
    saving: boolean;
    saved: boolean;
    disabled: boolean;
    onSave: () => void;
}

export interface ResultAskControl {
    /** 如「问太卜解卦」「问太卜断局」。 */
    label: string;
    onClick: () => void;
    disabled?: boolean;
}

interface ResultHeaderActionsProps {
    /** 次要操作，收进「更多」浮层；移动端同一组操作由顶栏三点菜单承载。 */
    actions: HeaderMenuItem[];
    actionsLabel: string;
    save: ResultSaveControl;
    ask: ResultAskControl;
}

/**
 * 结果页标题区右侧（桌面端）：更多 · 保存 · 问太卜。
 * 移动端对应的保存与问太卜在底部操作栏（ResultMobileActions）。
 */
export function ResultHeaderActions({ actions, actionsLabel, save, ask }: ResultHeaderActionsProps) {
    return (
        <div className="hidden items-center gap-2 lg:flex">
            <ResultMoreActions actions={actions} label={actionsLabel} />
            <button
                type="button"
                onClick={save.onSave}
                disabled={save.disabled}
                className={`h-10 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3.5 text-sm transition-colors hover:bg-background-secondary disabled:cursor-not-allowed ${save.saved ? 'text-success' : 'text-foreground disabled:opacity-50'}`}
            >
                {save.saved ? '已保存' : save.saving ? '保存中' : '保存'}
            </button>
            <AIFeatureGate>
                <button
                    type="button"
                    onClick={ask.onClick}
                    disabled={ask.disabled}
                    className="h-10 rounded-[10px] bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {ask.label}
                </button>
            </AIFeatureGate>
        </div>
    );
}
