/**
 * 通用状态面板：空状态、搜索无结果、加载失败、需登录、功能关闭
 *
 * 纯展示组件，不使用 hooks，可在 Server / Client Component 中复用。
 * 视觉与画布 States 看板一致：虚线框 + 圆形图标 + 衬线标题 + 说明 + 操作。
 */
import type { ComponentType, ReactNode } from 'react';

/** 状态面板里的主操作按钮（登录、开始占测等）。 */
export const STATE_PRIMARY_ACTION_CLASS = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:opacity-50';
/** 状态面板里的次操作按钮（重试、清除搜索、返回首页等）。 */
export const STATE_SECONDARY_ACTION_CLASS = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-5 text-sm text-foreground transition-colors hover:bg-background-secondary disabled:opacity-50';

type StateTone = 'neutral' | 'accent' | 'danger';

const ICON_TONE_CLASS: Record<StateTone, string> = {
    neutral: 'bg-background-secondary text-foreground-tertiary',
    accent: 'bg-accent-soft text-accent',
    danger: 'bg-danger/10 text-danger',
};

export interface StatePanelProps {
    title: ReactNode;
    description?: ReactNode;
    icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
    /** 图标与标题配色；danger 同时把面板换成错误样式并设为 role="alert"。 */
    tone?: StateTone;
    /** 操作按钮区，通常传入一个 Link 或 button。 */
    action?: ReactNode;
    /** 整页状态（需登录、功能关闭）不需要外框，铺满主区域居中。 */
    layout?: 'framed' | 'page';
    /** 整页状态用 h2 承接页面结构；列表内的状态用段落即可。 */
    titleAs?: 'h2' | 'p';
    className?: string;
}

export function StatePanel({
    title,
    description,
    icon: Icon,
    tone = 'neutral',
    action,
    layout = 'framed',
    titleAs: Title = 'p',
    className = '',
}: StatePanelProps) {
    const isDanger = tone === 'danger';
    const containerClass = layout === 'page'
        ? 'min-h-[60vh] justify-center px-4 py-12'
        : `rounded-[14px] border-[0.5px] px-6 py-14 md:py-16 ${isDanger ? 'border-danger/25 bg-danger/5' : 'border-dashed border-border-hover'}`;

    return (
        <div role={isDanger ? 'alert' : undefined} className={`flex flex-col items-center text-center ${containerClass} ${className}`}>
            {Icon ? (
                <div className={`mb-4 flex items-center justify-center rounded-full ${layout === 'page' ? 'h-12 w-12' : 'h-11 w-11'} ${ICON_TONE_CLASS[tone]}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
            ) : null}
            <Title className={`font-display leading-snug ${layout === 'page' ? 'text-xl' : 'text-lg'} ${isDanger ? 'text-danger' : 'text-foreground'}`}>
                {title}
            </Title>
            {description ? (
                <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-foreground-secondary">{description}</p>
            ) : null}
            {action ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">{action}</div> : null}
        </div>
    );
}
