/**
 * Toast 通知组件
 * 
 * 用于替代浏览器 alert，提供更好的 UX
 */
'use client';

import { useState, createContext, useContext, useCallback, useEffect, useLayoutEffect, useRef, ReactNode, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X, BotMessageSquare, TriangleAlert } from 'lucide-react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { useTopModal } from './Modal';

type ToastType = 'success' | 'error' | 'info' | 'warning' | 'chat';

interface ToastAction {
    label: string;
    onClick: () => void;
}

interface ToastOptions {
    duration?: number;
    action?: ToastAction;
}

interface Toast {
    id: string;
    type: ToastType;
    message: string;
    duration?: number;
    action?: ToastAction;
    /** 正在退场：播完退场动画才从列表移除。 */
    leaving?: boolean;
    /** 超出条数上限而退场：不再影响容器尺寸。 */
    evicted?: boolean;
}

/** 退场动画万一没有结束事件（元素被隐藏、标签页在后台），到点也照样移除。 */
const LEAVE_FALLBACK_MS = 400;
const TOAST_GAP = 8;
const TOAST_PEEK = 10;
const DEFAULT_TOAST_HEIGHT = 48;

type ToastPositionStyle = CSSProperties & {
    '--toast-expanded-offset': string;
    '--toast-collapsed-offset': string;
    '--toast-height': string;
    '--toast-scale': number;
};

type ToastStackStyle = CSSProperties & {
    '--toast-expanded-height': string;
    '--toast-collapsed-height': string;
};

interface ToastContextType {
    showToast: (type: ToastType, message: string, durationOrOptions?: number | ToastOptions) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function normalizeToastOptions(durationOrOptions?: number | ToastOptions): ToastOptions {
    if (typeof durationOrOptions === 'number') {
        return { duration: durationOrOptions };
    }
    return durationOrOptions || {};
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        // 默认 no-op，避免退化为原生 alert 破坏统一交互
        return {
            showToast: ((_type: ToastType, message: string) => {
                if (process.env.NODE_ENV !== 'production') {
                    console.warn('[Toast] ToastProvider is missing, dropped message:', message);
                }
            }) as ToastContextType['showToast']
        };
    }
    return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [stackExpanded, setStackExpanded] = useState(false);
    const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
    const expandTimer = useRef<number | null>(null);
    const leaveTimers = useRef(new Map<string, number>());
    const stackRef = useRef<HTMLDivElement>(null);

    const dropToast = useCallback((id: string) => {
        const timer = leaveTimers.current.get(id);
        if (timer !== undefined) window.clearTimeout(timer);
        leaveTimers.current.delete(id);
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);
    // 先播退场再移除；没有 animationend 时由兜底计时器清理。
    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
    }, []);
    useEffect(() => {
        for (const toast of toasts) {
            if (!toast.leaving || leaveTimers.current.has(toast.id)) continue;
            leaveTimers.current.set(toast.id, window.setTimeout(() => dropToast(toast.id), LEAVE_FALLBACK_MS));
        }
    }, [dropToast, toasts]);
    useEffect(() => () => {
        leaveTimers.current.forEach(timer => window.clearTimeout(timer));
    }, []);

    const showToast = useCallback((type: ToastType, message: string, durationOrOptions?: number | ToastOptions) => {
        const normalized = normalizeToastOptions(durationOrOptions);
        // 错误需要被读到并处理，默认不自动消失；带操作的提示留出操作时间。
        const duration = normalized.duration ?? (type === 'error' ? 0 : normalized.action ? 6000 : type === 'warning' ? 5000 : 3000);
        const id = `${Date.now()}-${Math.random()}`;
        // 超过 4 条时最旧提示与新提示同时进退场，动画结束后再真正移除。
        setToasts(prev => {
            const next: Toast[] = [...prev, { id, type, message, duration, action: normalized.action }];
            const active = next.filter(toast => !toast.leaving);
            const evicted = new Set(active.slice(0, Math.max(0, active.length - 4)).map(toast => toast.id));
            return evicted.size > 0 ? next.map(toast => evicted.has(toast.id) ? { ...toast, leaving: true, evicted: true } : toast) : next;
        });
    }, []);
    // 打开的模态框之外全部 inert：提示挂进最上层对话框，才能被看见、被关闭。
    const host = useTopModal();

    // 多条提示叠成一摞，旧提示只露出底边；指针移入或键盘聚焦时展开。
    const expandStack = useCallback(() => {
        if (expandTimer.current !== null) {
            window.clearTimeout(expandTimer.current);
            expandTimer.current = null;
        }
        setStackExpanded(true);
    }, []);
    const collapseStack = useCallback(() => {
        if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
        // 给短暂移出留出余量，避免收起过于敏感。
        expandTimer.current = window.setTimeout(() => {
            expandTimer.current = null;
            setStackExpanded(false);
        }, 160);
    }, []);
    useEffect(() => () => {
        if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    }, []);

    // 只在真正增删卡片时重建测量；标记退场、展开都不重复测量。
    const toastIds = toasts.map(toast => toast.id).join('|');
    useLayoutEffect(() => {
        const stack = stackRef.current;
        if (!stack) return;
        const cards = Array.from(stack.querySelectorAll<HTMLElement>('[data-toast-card]'));
        const measure = () => {
            setHeights(current => {
                const next = new Map<string, number>();
                let changed = current.size !== cards.length;
                for (const card of cards) {
                    const id = card.dataset.toastId!;
                    const height = card.offsetHeight || DEFAULT_TOAST_HEIGHT;
                    next.set(id, height);
                    if (current.get(id) !== height) changed = true;
                }
                return changed ? next : current;
            });
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        cards.forEach(card => observer.observe(card));
        return () => observer.disconnect();
    }, [toastIds]);

    const orderedToasts = toasts.slice().reverse();
    const layoutToasts = orderedToasts.filter(toast => !toast.evicted);
    const frontHeight = layoutToasts.length > 0 ? heights.get(layoutToasts[0].id) ?? DEFAULT_TOAST_HEIGHT : 0;
    const expandedHeight = layoutToasts.reduce((total, toast, index) =>
        total + (heights.get(toast.id) ?? DEFAULT_TOAST_HEIGHT) + (index > 0 ? TOAST_GAP : 0), 0);
    const collapsedHeight = layoutToasts.length > 0 ? frontHeight + (layoutToasts.length - 1) * TOAST_PEEK : 0;
    const positionedToasts = orderedToasts.map((toast, index) => {
        const height = heights.get(toast.id) ?? DEFAULT_TOAST_HEIGHT;
        const expandedY = orderedToasts.slice(0, index).reduce((total, previous) =>
            total + (heights.get(previous.id) ?? DEFAULT_TOAST_HEIGHT) + TOAST_GAP, 0);
        const style: ToastPositionStyle = {
            zIndex: toasts.length - index,
            '--toast-expanded-offset': `${expandedHeight - expandedY - height}px`,
            '--toast-collapsed-offset': `${collapsedHeight - index * TOAST_PEEK - height}px`,
            '--toast-height': `${height}px`,
            '--toast-scale': Math.max(0.94, 1 - index * 0.02),
        };
        return { toast, style };
    });
    const stackStyle: ToastStackStyle = {
        bottom: 'calc(1rem + var(--sab))',
        pointerEvents: orderedToasts.length === 0 ? 'none' : 'auto',
        '--toast-expanded-height': `${expandedHeight}px`,
        '--toast-collapsed-height': `${collapsedHeight}px`,
    };

    /* 常驻 live region 播报新提示；桌面端叠放，悬停或聚焦展开，触屏始终完整列表。 */
    const stack = (
        <div
            ref={stackRef}
            aria-live="polite"
            data-single={layoutToasts.length === 1 ? '' : undefined}
            data-expanded={stackExpanded ? '' : undefined}
            onPointerMove={expandStack}
            onPointerLeave={collapseStack}
            onFocusCapture={expandStack}
            onBlurCapture={collapseStack}
            style={stackStyle}
            className="app-toast-stack fixed right-4 z-[var(--z-toast)] w-[360px] max-w-[calc(100vw-2rem)] pointer-events-auto"
        >
            <div className="toast-viewport pointer-events-none relative w-full">
                {positionedToasts.map(({ toast, style }) => (
                    <ToastItem key={toast.id} toast={toast} onRemove={removeToast} onLeft={dropToast} suspended={stackExpanded} style={style} />
                ))}
            </div>
        </div>
    );

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {host ? createPortal(stack, host) : stack}
        </ToastContext.Provider>
    );
}

const TOAST_ICONS: Record<ToastType, { icon: typeof CheckCircle2; className: string }> = {
    success: { icon: CheckCircle2, className: 'bg-success/10 text-success' },
    error: { icon: AlertCircle, className: 'bg-danger/10 text-danger' },
    warning: { icon: TriangleAlert, className: 'bg-warning/10 text-warning' },
    info: { icon: Info, className: 'bg-accent/10 text-accent' },
    chat: { icon: BotMessageSquare, className: 'bg-accent/10 text-accent' },
};

function ToastItem({ toast, onRemove, onLeft, suspended, style }: {
    toast: Toast;
    onRemove: (id: string) => void;
    onLeft: (id: string) => void;
    suspended: boolean;
    style: ToastPositionStyle;
}) {
    const { icon: Icon, className: iconClassName } = TOAST_ICONS[toast.type];
    // 悬停、聚焦或展开整摞提示时暂停倒计时，离开后按剩余时间继续。
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const remaining = useRef(toast.duration ?? 0);
    const paused = hovered || focused || suspended;
    useEffect(() => {
        if (remaining.current <= 0 || paused || toast.leaving) return;
        const started = Date.now();
        const timer = setTimeout(() => onRemove(toast.id), remaining.current);
        return () => {
            clearTimeout(timer);
            remaining.current = Math.max(1, remaining.current - (Date.now() - started));
        };
    }, [paused, toast.leaving, toast.id, onRemove]);

    return (
        <div
            data-toast-position
            data-leaving={toast.leaving ? '' : undefined}
            style={style}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
            className="toast-position pointer-events-auto absolute inset-x-0 bottom-0"
        >
            <div
                role={toast.type === 'error' ? 'alert' : undefined}
                data-leaving={toast.leaving ? '' : undefined}
                onAnimationEnd={event => { if (toast.leaving && event.target === event.currentTarget) onLeft(toast.id); }}
                className="toast-item h-full w-full rounded-[14px] bg-surface shadow-[var(--shadow-panel-popover)]"
            >
                <div data-toast-card data-toast-id={toast.id} className="toast-content flex min-h-12 w-full items-center gap-2.5 py-2 pr-2 pl-3">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${iconClassName}`}>
                        <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 break-words py-0.5 text-sm leading-5 text-foreground">{toast.message}</span>
                    {toast.action && (
                        <Button variant="ghost" size="sm" className="ml-1 shrink-0 text-accent hover:bg-accent-soft hover:text-accent"
                            onClick={() => {
                                toast.action?.onClick();
                                onRemove(toast.id);
                            }}>
                            {toast.action.label}
                        </Button>
                    )}
                    <IconButton label="关闭提示" size="sm" expand="none" className="-mr-1 shrink-0 text-foreground-tertiary"
                        onClick={() => onRemove(toast.id)}>
                        <X aria-hidden="true" />
                    </IconButton>
                </div>
            </div>
        </div>
    );
}
