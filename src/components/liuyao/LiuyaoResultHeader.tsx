import { ResultHeaderActions, type ResultSaveControl } from '@/components/divination/ResultHeaderActions';
import type { HeaderMenuItem } from '@/components/layout/HeaderMenuContext';

interface LiuyaoResultHeaderProps {
    question?: string;
    yongShenTargets: readonly string[];
    hexagramName: string;
    /** 有动爻时的变卦名，标题显示为「本卦 之 变卦」。 */
    changedHexagramName?: string;
    /** 桌面端「更多」菜单项；移动端同一组操作由顶栏三点菜单承载。 */
    actions: HeaderMenuItem[];
    save: ResultSaveControl;
    onAsk: () => void;
    askDisabled: boolean;
}

/**
 * 六爻结果页标题区：所问 · 用神，「本卦 之 变卦」，桌面端右侧为更多 · 保存 · 问太卜解卦。
 * 移动端卦名由顶栏承担（useHeaderTitle），所问居中；保存与解卦在底部操作栏。
 */
export function LiuyaoResultHeader({ question, yongShenTargets, hexagramName, changedHexagramName, actions, save, onAsk, askDisabled }: LiuyaoResultHeaderProps) {
    return (
        <header className={`flex-wrap items-end justify-between gap-4 ${question ? 'flex' : 'hidden lg:flex'}`}>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
                {question && (
                    <p className="px-1 text-center text-[0.8125rem] leading-normal text-foreground-secondary lg:px-0 lg:text-left lg:text-sm">
                        问：{question}
                        {yongShenTargets.length > 0 && <> · 用神 {yongShenTargets.join('、')}</>}
                    </p>
                )}
                <h1 className="hidden font-display text-[2.125rem] font-normal leading-tight lg:block">
                    {hexagramName}
                    {changedHexagramName && <> <span className="text-[1.375rem] text-foreground-secondary">之</span> {changedHexagramName}</>}
                </h1>
            </div>
            <ResultHeaderActions actions={actions} actionsLabel="卦盘操作" save={save} ask={{ label: '问太卜解卦', onClick: onAsk, disabled: askDisabled }} />
        </header>
    );
}
