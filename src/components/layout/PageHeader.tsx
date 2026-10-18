/**
 * 页面标题区：衬线 h1 + 副标题（+ 可选动作槽）。
 *
 * 仅用于占术输入页与记录页；结果页有自己的标题区（ResultHeader 家族），不套用本组件。
 * 移动端由顶栏承载标题，因此桌面以外隐藏（与既有输入页一致）。
 */
import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions, className = '' }: {
    title: ReactNode;
    description?: ReactNode;
    /** 右侧动作，例如「新的记录」入口。 */
    actions?: ReactNode;
    className?: string;
}) {
    return (
        <header className={`hidden flex-col gap-2 lg:flex ${className}`}>
            {actions ? (
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <h1 className="font-display text-[2rem] leading-tight font-normal text-foreground">{title}</h1>
                    <div className="flex shrink-0 items-center gap-2">{actions}</div>
                </div>
            ) : (
                <h1 className="font-display text-[2rem] leading-tight font-normal text-foreground">{title}</h1>
            )}
            {description ? <p className="text-[15px] text-foreground-secondary">{description}</p> : null}
        </header>
    );
}
