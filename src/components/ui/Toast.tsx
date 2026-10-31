/**
 * Toast 通知组件
 * 
 * 用于替代浏览器 alert，提供更好的 UX
 */
'use client';

import { useState, createContext, useContext, useCallback, useEffect, useLayoutEffect, useRef, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X, BotMessageSquare, TriangleAlert } from 'lucide-react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { useTopModal } from './Modal';
import { prefersReducedMotion } from '@/lib/motion/entrance';
import { slide } from '@/lib/motion/list';

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
}

/** 退场动画万一没有结束事件（元素被隐藏、标签页在后台），到点也照样移除。 */
const LEAVE_FALLBACK_MS = 400;

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
    const stackRef = useRef<HTMLDivElement>(null);
    const positions = useRef(new Map<string, number>());

    // 先退场再移除：标记 leaving 播放退场动画，动画结束（或兜底计时到）才真正拿掉。
    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), LEAVE_FALLBACK_MS);
    }, []);
    const dropToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const showToast = useCallback((type: ToastType, message: string, durationOrOptions?: number | ToastOptions) => {
        const normalized = normalizeToastOptions(durationOrOptions);
        // 错误需要被读到并处理，默认不自动消失；带操作的提示留出操作时间。
        const duration = normalized.duration ?? (type === 'error' ? 0 : normalized.action ? 6000 : type === 'warning' ? 5000 : 3000);
        const id = `${Date.now()}-${Math.random()}`;
        // 同屏最多保留 4 条：新提示从底部进入，旧提示按各自真实高度依次上移。
        setToasts(prev => [...prev, { id, type, message, duration, action: normalized.action }].slice(-4));
    }, []);
    // 打开的模态框之外全部 inert：提示挂进最上层对话框，才能被看见、被关闭。
    const host = useTopModal();

    // 堆叠变化时（新提示进入、旧提示离开）其余提示从原位置滑到新位置，而不是直接跳过去。
    useLayoutEffect(() => {
        const stack = stackRef.current;
        if (!stack) return;
        const next = new Map<string, number>();
        const reduced = prefersReducedMotion();
        // 容器贴底，增减提示时它的顶边也会动；各条取容器顶边加 offsetTop，不含进场与滑动中的位移。
        const origin = stack.getBoundingClientRect().top;
        for (const node of stack.querySelectorAll<HTMLElement>('[data-toast-id]')) {
            const id = node.dataset.toastId!;
            const top = origin + node.offsetTop;
            const before = positions.current.get(id);
            next.set(id, top);
            if (!reduced && before !== undefined) slide(node, before, top, 200);
        }
        positions.current = next;
    }, [toasts]);

    /* Toast 容器：claude 同款右下堆叠（360px 宽、底部 1rem）；新提示依次向上堆。
       常驻的 live region 让读屏软件播报新提示；错误提示单独用 role="alert" 立即打断。 */
    const stack = (
        <div
            ref={stackRef}
            aria-live="polite"
            style={{ bottom: 'calc(1rem + var(--sab))' }}
            className="app-toast-stack fixed right-4 z-[var(--z-toast)] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col items-stretch gap-2 pointer-events-none"
        >
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} onRemove={removeToast} onLeft={dropToast} />
            ))}
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
    success: { icon: CheckCircle2, className: 'text-success' },
    error: { icon: AlertCircle, className: 'text-danger' },
    warning: { icon: TriangleAlert, className: 'text-warning' },
    info: { icon: Info, className: 'text-accent' },
    chat: { icon: BotMessageSquare, className: 'text-accent' },
};

function ToastItem({ toast, onRemove, onLeft }: { toast: Toast; onRemove: (id: string) => void; onLeft: (id: string) => void }) {
    const { icon: Icon, className: iconClassName } = TOAST_ICONS[toast.type];
    // 悬停或焦点在提示内时暂停倒计时，离开后按剩余时间继续。
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const remaining = useRef(toast.duration ?? 0);
    const paused = hovered || focused;
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
            role={toast.type === 'error' ? 'alert' : undefined}
            data-toast-id={toast.id}
            data-leaving={toast.leaving ? '' : undefined}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
            onAnimationEnd={event => { if (toast.leaving && event.target === event.currentTarget) onLeft(toast.id); }}
            className="toast-item pointer-events-auto flex w-full min-h-11 items-start gap-2.5 rounded-xl bg-surface py-2 pr-2 pl-3.5 shadow-[var(--shadow-panel-popover)]"
        >
            <Icon className={`mt-[5px] h-[18px] w-[18px] shrink-0 ${iconClassName}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 break-words py-1 text-sm leading-snug text-foreground">{toast.message}</span>
            {toast.action && (
                <Button variant="ghost" size="sm" className="ml-1 text-accent hover:bg-accent-soft hover:text-accent"
                    onClick={() => {
                        toast.action?.onClick();
                        onRemove(toast.id);
                    }}>
                    {toast.action.label}
                </Button>
            )}
            <IconButton label="关闭提示" size="sm" expand="none" className="text-foreground-tertiary"
                onClick={() => onRemove(toast.id)}>
                <X aria-hidden="true" />
            </IconButton>
        </div>
    );
}
