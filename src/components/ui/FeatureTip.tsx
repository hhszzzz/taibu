/**
 * 通用功能提示：`line` 是一行说明，`card` 是带标题与操作的浮层卡片，`bubble` 是只带文字的尖角气泡。
 * 关闭状态按 storageKey 记在本机；放在哪里、靠哪一侧由调用方决定，floating 时相对最近定位祖先按 side 弹出。
 */
'use client';

import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import './feature-tip.css';

export interface FeatureTipAction {
    label: string;
    onClick: () => void;
}

export interface FeatureTipProps {
    /** 关闭状态存为 `${storageKey}:dismissed`。 */
    storageKey: string;
    /** 卡片标题。 */
    title?: ReactNode;
    children: ReactNode;
    action?: FeatureTipAction;
    icon?: ReactNode;
    /** `line`：一行弱提示；`card`：带标题、正文与操作的浮层卡片；`bubble`：只有文字的尖角气泡。 */
    variant?: 'line' | 'card' | 'bubble';
    /** floating 时相对锚点的方向。 */
    side?: 'top' | 'bottom' | 'left' | 'right';
    /** 相对锚点定位（absolute），由最近的 position: relative 祖先决定基准。 */
    floating?: boolean;
    /** 在父级 flex 容器中的对齐方向；floating 时是沿锚点边缘的对齐。 */
    align?: 'start' | 'center' | 'end';
    dismissible?: boolean;
    className?: string;
}

export function FeatureTip({
    storageKey, title, children, action, icon, variant = 'line', side = 'bottom', floating = false, align = 'start', dismissible = true, className,
}: FeatureTipProps) {
    const [dismissedNow, setDismissedNow] = useState(false);
    const dismissalKey = `${storageKey}:dismissed`;
    const subscribe = useCallback((onChange: () => void) => {
        window.addEventListener('storage', onChange);
        return () => window.removeEventListener('storage', onChange);
    }, []);
    const readDismissed = useCallback(() => {
        try {
            return localStorage.getItem(dismissalKey) === '1';
        } catch {
            return false;
        }
    }, [dismissalKey]);
    const storedDismissed = useSyncExternalStore(subscribe, readDismissed, () => false);
    // A non-dismissible tip (the bubble) is not hidden by an old dismissal under the same key.
    if (dismissible && (dismissedNow || storedDismissed)) return null;
    const dismiss = () => {
        try { localStorage.setItem(dismissalKey, '1'); } catch { /* optional */ }
        setDismissedNow(true);
    };
    const rootClass = `feature-tip ${variant === 'line' ? 'is-line' : variant === 'card' ? 'is-card' : 'is-bubble'} align-${align}`
        + `${floating ? ' is-floating' : ''}${floating || variant === 'bubble' ? ` side-${side}` : ''}${className ? ` ${className}` : ''}`;
    const closeButton = dismissible
        ? <button type="button" className="feature-tip-close" aria-label="关闭提示" onClick={dismiss}><X size={12} aria-hidden="true" /></button>
        : null;
    if (variant === 'bubble') {
        return (
            <div className={rootClass} role="note" data-feature-tip={storageKey}>
                <span className="feature-tip-text">{children}</span>
            </div>
        );
    }
    if (variant === 'card') {
        return (
            <div className={rootClass} role="note" data-feature-tip={storageKey}>
                <div className="feature-tip-card-head">
                    <span className="feature-tip-card-icon" aria-hidden="true">{icon ?? <Info size={15} />}</span>
                    {title ? <span className="feature-tip-card-title">{title}</span> : null}
                    {closeButton}
                </div>
                <div className="feature-tip-text">{children}</div>
                {action && <button type="button" className="feature-tip-card-action" onClick={action.onClick}>{action.label}</button>}
            </div>
        );
    }
    return (
        <div className={rootClass} role="note" data-feature-tip={storageKey}>
            <span className="feature-tip-icon" aria-hidden="true">{icon ?? <Info size={13} />}</span>
            <span className="feature-tip-text">{children}</span>
            {action && <button type="button" className="feature-tip-action" onClick={action.onClick}>{action.label}</button>}
            {closeButton}
        </div>
    );
}
